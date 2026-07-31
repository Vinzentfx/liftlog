-- Patch 003: separate one-time invite codes from revocable ongoing access.
-- Apply after patch-002-device-capabilities.sql.

create table if not exists public.access_grants (
  user_id uuid primary key references auth.users on delete cascade,
  active boolean not null default true,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  invite_code text references public.invites(code) on delete set null,
  constraint access_revocation_consistent check (
    (active and revoked_at is null) or (not active and revoked_at is not null)
  )
);
alter table public.access_grants enable row level security;
-- No policies: grants are administered in SQL and exposed only as a boolean RPC.

-- Existing invited profiles remain active when this migration is introduced.
insert into public.access_grants(user_id, active, granted_at)
select id, true, created_at from public.profiles
on conflict (user_id) do nothing;

create or replace function public.has_active_access()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.access_grants
    where user_id = auth.uid() and active = true
  );
$$;

create or replace function public.access_status()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_active_access();
$$;

-- Claiming a new invite can create a profile or reactivate an existing account.
create or replace function public.claim_invite(invite_code text)
returns void language plpgsql security definer set search_path = public as $$
declare claimed text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  if public.has_active_access() then return; end if;
  if not public.consume_security_attempt('claim_invite', 10) then
    raise exception 'RATE_LIMITED';
  end if;

  update public.invites set used_by = auth.uid(), used_at = now()
  where code = invite_code and used_by is null returning code into claimed;
  if claimed is null then raise exception 'INVITE_INVALID'; end if;

  insert into public.profiles(id) values (auth.uid())
  on conflict (id) do nothing;
  insert into public.access_grants(user_id, active, granted_at, revoked_at, invite_code)
  values (auth.uid(), true, now(), null, claimed)
  on conflict (user_id) do update set
    active = true, granted_at = now(), revoked_at = null, invite_code = excluded.invite_code;
  delete from public.security_attempts
  where user_id = auth.uid() and action = 'claim_invite';
end;
$$;

drop policy if exists "read own profile" on public.profiles;
create policy "read active own profile" on public.profiles
  for select using (auth.uid() = id and public.has_active_access());

drop policy if exists "read own devices" on public.devices;
create policy "read active own devices" on public.devices
  for select using (auth.uid() = user_id and public.has_active_access());
drop policy if exists "request own pending device" on public.devices;
create policy "request active pending device" on public.devices
  for insert with check (
    auth.uid() = user_id and public.has_active_access()
    and status = 'pending'
    and wrapped_key is null and wrap_iv is null and wrapped_by is null
  );

drop policy if exists "read own backups" on public.backups;
create policy "read active own backups" on public.backups
  for select using (auth.uid() = user_id and public.has_active_access());

create or replace function public.owner_capability_ok(owner_token text, device uuid default null)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select public.has_active_access() and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.owner_token_hash is not null
      and p.owner_token_hash = digest(owner_token, 'sha256')
      and (device is null or p.owner_device = device)
  );
$$;

-- This harmless heartbeat must be access-controlled too; otherwise a revoked
-- token could still mutate server state even though all meaningful data is shut.
create or replace function public.touch_device(device uuid, owner_token text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  update public.devices set last_seen_at = now()
  where id = device and user_id = auth.uid() and status = 'approved';
end;
$$;

-- Revoked people must still be able to exercise their right to deletion. This
-- RPC validates the device capability directly, without requiring active access.
create or replace function public.delete_cloud_data(owner_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (
    select 1 from public.profiles p where p.id = auth.uid()
      and p.owner_token_hash = digest(owner_token, 'sha256')
  ) then raise exception 'OWNER_TOKEN_WRONG'; end if;
  delete from public.backups where user_id = auth.uid();
  delete from public.devices where user_id = auth.uid();
  delete from public.recovery_proofs where user_id = auth.uid();
  delete from public.access_grants where user_id = auth.uid();
  delete from public.profiles where id = auth.uid();
end;
$$;

revoke all on table public.access_grants from anon, authenticated;
revoke all on function public.has_active_access() from public, anon, authenticated;
grant execute on function public.has_active_access() to authenticated;
revoke all on function public.access_status() from public, anon;
grant execute on function public.access_status() to authenticated;

-- Admin examples:
-- Revoke without deleting anything:
--   update public.access_grants set active = false, revoked_at = now()
--   where user_id = '<USER UUID>';
-- Reactivate without a new invite:
--   update public.access_grants set active = true, revoked_at = null,
--     granted_at = now() where user_id = '<USER UUID>';
