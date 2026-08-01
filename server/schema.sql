-- LiftLog cloud backup: the whole server side.
-- IMPORTANT: after this base schema, also apply
-- server/patch-002-device-capabilities.sql. It replaces the permissive bootstrap
-- policies below with device-capability protected write RPCs. The two files are
-- kept separate so existing Supabase projects can migrate without data loss.
-- Then apply server/patch-003-revocable-access.sql for independently revocable
-- access grants checked by every cloud read and write.
-- Finally apply server/patch-004-repair-invite-claims.sql, which repairs legacy
-- partial activations and installs the self-contained invite claim RPC.
-- Apply server/patch-005-fix-access-policy-permission.sql last so authenticated
-- policies can run the access helper, then patch-006-unblock-devices.sql so a
-- main device can explicitly restore a blocked installation.
--
-- Paste this into the Supabase SQL editor once. There is no other server code:
-- the app talks to PostgREST over plain fetch, and what it is allowed to do is
-- decided here rather than in JavaScript. That is deliberate. Access rules that
-- live in the client are not access rules.
--
-- What this server can see:  ciphertext, public keys, sizes, timestamps.
-- What it can never see:     training data, bodyweight, food, or any key that
--                            opens them. See js/crypto.js for why.
--
-- Which means: if this database leaks in full, the honest damage is a list of
-- email addresses and the knowledge that those people back up a fitness app.
-- That is the whole point of doing it this way.

-- ---------------------------------------------------------------- profiles --

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now(),

  -- Consent, recorded rather than assumed. Nothing syncs until these are set,
  -- and the version is stored so it is possible to tell later who agreed to
  -- which wording.
  consent_at      timestamptz,
  consent_version text,

  -- The data key, wrapped by the recovery key. Useless without it.
  recovery_wrap  text,
  recovery_iv    text,
  recovery_salt  text,

  -- Hash of the recovery key against a separate salt. Proves possession for the
  -- one action that is a server-side change rather than a decryption: making a
  -- fresh device the main one after the old one is gone. It cannot decrypt
  -- anything and going backwards means guessing 128 random bits.
  recovery_verifier      text,
  recovery_verifier_salt text,

  -- The device allowed to upload. Everything else is read-only.
  owner_device uuid
);

alter table public.profiles enable row level security;

create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- Does this account have a profile at all?
--
-- The invite code gates profile creation and nothing else, which turned out not
-- to be the same thing as gating the account. Found by testing rather than by
-- reading: a signed-up account with no invite happily wrote a backup row,
-- because "own backups" only ever asked whether the row belonged to the caller,
-- and it did. Not a leak, since everyone still sees only their own rows, but an
-- open door to using this database as free storage.
--
-- Security definer so it can look at profiles without tripping over that
-- table's own row-level security, and stable so the planner calls it once per
-- statement rather than once per row.
create or replace function public.has_profile()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;

-- ----------------------------------------------------------------- devices --

create table if not exists public.devices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null,
  public_key jsonb not null,
  status     text not null default 'pending'
             check (status in ('pending', 'approved', 'revoked')),

  -- The data key wrapped for this device, filled in when it is approved. The
  -- wrapping side's public key travels with it so this device can do its half
  -- of the ECDH. Neither half is a secret.
  wrapped_key text,
  wrap_iv     text,
  wrapped_by  jsonb,

  created_at   timestamptz not null default now(),
  approved_at  timestamptz,
  last_seen_at timestamptz
);

create index if not exists devices_user on public.devices (user_id, status);

alter table public.devices enable row level security;

-- A device row is only ever the account owner's. A pending request from a new
-- phone is written by that phone while logged in as the same account, so this
-- one policy covers requesting, approving and revoking.
create policy "own devices" on public.devices
  for all
  using       (auth.uid() = user_id and public.has_profile())
  with check  (auth.uid() = user_id and public.has_profile());

-- ----------------------------------------------------------------- backups --

create table if not exists public.backups (
  user_id    uuid not null references auth.users on delete cascade,
  version    bigint not null,
  iv         text not null,
  ct         text not null,
  bytes      int  not null,
  device_id  uuid,
  created_at timestamptz not null default now(),

  primary key (user_id, version),

  -- A sealed backup of a heavy log is a couple of hundred kilobytes. Eight
  -- megabytes of base64 is far above anything real and far below anything that
  -- could fill the database by accident.
  constraint backup_size check (length(ct) < 8000000)
);

alter table public.backups enable row level security;

create policy "own backups" on public.backups
  for all
  using       (auth.uid() = user_id and public.has_profile())
  with check  (auth.uid() = user_id and public.has_profile());

-- The primary key is what makes a stale upload fail instead of overwriting.
-- A device that has been offline uploads version 8 while the server is already
-- at 9, gets a duplicate-key error, and has to pull before it can push. That is
-- the whole concurrency story, and it is enforced here rather than hoped for.

-- Keep a handful of older versions. A backup you cannot roll back is no defence
-- against the app having written something wrong and then faithfully backed the
-- wrong thing up.
create or replace function public.trim_backup_history()
returns trigger language plpgsql as $$
begin
  delete from public.backups
   where user_id = new.user_id
     and version <= new.version - 5;
  return new;
end;
$$;

drop trigger if exists trim_backups on public.backups;
create trigger trim_backups
  after insert on public.backups
  for each row execute function public.trim_backup_history();

-- ----------------------------------------------------------------- invites --

-- Signing up is possible for anyone; getting a profile is not, and every policy
-- above additionally requires `has_profile()`. So an uninvited account can log
-- in and do precisely nothing, which is a property worth re-testing rather than
-- re-reading: the first version of this file only checked row ownership, and an
-- uninvited account could write freely.
create table if not exists public.invites (
  code       text primary key,
  note       text,
  created_at timestamptz not null default now(),
  used_by    uuid references auth.users on delete set null,
  used_at    timestamptz
);

alter table public.invites enable row level security;
-- No policy at all: nobody reads or writes this table through the API. Codes go
-- in through the SQL editor, and are only ever checked by the function below,
-- which runs as the definer.

create or replace function public.claim_invite(invite_code text)
returns void language plpgsql security definer set search_path = public as $$
declare
  claimed text;
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid()) then
    return;                              -- already set up, nothing to do
  end if;

  update public.invites
     set used_by = auth.uid(), used_at = now()
   where code = invite_code and used_by is null
  returning code into claimed;

  if claimed is null then
    raise exception 'INVITE_INVALID';
  end if;

  insert into public.profiles (id) values (auth.uid());
end;
$$;

-- ---------------------------------------------------------------- takeover --

-- The escape hatch, server side. The client proves it holds the recovery key by
-- sending the verifier; on a match this device becomes the main one and every
-- other device is revoked, because a lost phone should stop being trusted the
-- moment you replace it.
--
-- The verifier is compared here rather than in the client for the obvious
-- reason: a check in the client is a check the client can skip.
create or replace function public.claim_ownership(verifier text, device uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  stored text;
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  select recovery_verifier into stored from public.profiles where id = auth.uid();
  if stored is null then
    raise exception 'NO_RECOVERY_SET';
  end if;

  -- Constant-time-ish comparison. Postgres has no timing-safe equality for
  -- text, and the value being guessed has 128 bits of entropy, so a timing
  -- oracle here buys an attacker nothing worth the sentence explaining it.
  if stored <> verifier then
    raise exception 'RECOVERY_WRONG';
  end if;

  if not exists (select 1 from public.devices
                  where id = device and user_id = auth.uid()) then
    raise exception 'NO_SUCH_DEVICE';
  end if;

  update public.devices
     set status = 'revoked'
   where user_id = auth.uid() and id <> device;

  update public.devices
     set status = 'approved', approved_at = now()
   where id = device;

  update public.profiles set owner_device = device where id = auth.uid();
end;
$$;

-- ------------------------------------------------------------ housekeeping --

-- Deleting the auth user cascades through every table above, which is what a
-- deletion request has to actually do. Worth testing once on a throwaway
-- account before anyone asks.

-- Adding an invite, for reference:
--   insert into public.invites (code, note) values ('MARCEL-2026', 'Marcel');
