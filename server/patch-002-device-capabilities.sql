-- Patch 002: Schreiben nur vom Besitzergerät, auf dem Server durchgesetzt.
--
-- Im SQL-Editor von Supabase einspielen, bevor der passende Client ausgerollt wird.
-- Bestehende Cloud-Nutzer behalten ihren Wiederherstellungsnachweis, müssen ihren
-- Wiederherstellungsschlüssel aber einmal eingeben, um die neue Besitzerberechtigung auf dem Gerät zu erzeugen.

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists owner_token_hash bytea;

create table if not exists public.recovery_proofs (
  user_id uuid primary key references auth.users on delete cascade,
  verifier text not null
);
alter table public.recovery_proofs enable row level security;
-- Absichtlich keine Policies: selbst das JWT des Kontos darf den wiederverwendbaren Nachweis nicht lesen.

create table if not exists public.security_attempts (
  user_id uuid not null references auth.users on delete cascade,
  action text not null,
  window_started_at timestamptz not null default now(),
  attempts int not null default 0,
  primary key (user_id, action)
);
alter table public.security_attempts enable row level security;
-- Keine Policies: das ist Zustand fürs Rate-Limit, nur für den Server.

insert into public.recovery_proofs (user_id, verifier)
select id, recovery_verifier from public.profiles
where recovery_verifier is not null
on conflict (user_id) do nothing;

alter table public.profiles drop column if exists recovery_verifier;

alter table public.backups
  -- Alte Zeilen von vor der Pflicht zur device_id erhalten. Dieses Update zerstört mit
  -- Absicht nichts. Das ALTER danach bricht mit einem Fehler ab, wenn sich eine verwaiste
  -- Zeile nicht dem eingetragenen Besitzer zuordnen lässt.
  alter column device_id drop not null;
update public.backups b set device_id = p.owner_device
from public.profiles p
where b.user_id = p.id and b.device_id is null and p.owner_device is not null;
alter table public.backups
  alter column device_id set not null;
alter table public.backups
  add constraint backups_device_fk foreign key (device_id)
  references public.devices(id) on delete restrict;
alter table public.backups
  add constraint backup_version_positive check (version > 0),
  add constraint backup_bytes_sane check (bytes > 0 and bytes <= 6000000),
  add constraint backup_iv_length check (length(iv) between 16 and 24);

drop policy if exists "own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "own devices" on public.devices;
create policy "read own devices" on public.devices
  for select using (auth.uid() = user_id and public.has_profile());
create policy "request own pending device" on public.devices
  for insert with check (
    auth.uid() = user_id and public.has_profile()
    and status = 'pending'
    and wrapped_key is null and wrap_iv is null and wrapped_by is null
  );

drop policy if exists "own backups" on public.backups;
create policy "read own backups" on public.backups
  for select using (auth.uid() = user_id and public.has_profile());

create or replace function public.owner_capability_ok(owner_token text, device uuid default null)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.owner_token_hash is not null
      and p.owner_token_hash = digest(owner_token, 'sha256')
      and (device is null or p.owner_device = device)
  );
$$;

create or replace function public.consume_security_attempt(action_name text, allowed int)
returns boolean language plpgsql security definer set search_path = public as $$
declare current_count int;
begin
  if auth.uid() is null then return false; end if;
  insert into public.security_attempts(user_id, action, window_started_at, attempts)
  values (auth.uid(), action_name, now(), 1)
  on conflict (user_id, action) do update set
    window_started_at = case
      when security_attempts.window_started_at < now() - interval '1 hour' then now()
      else security_attempts.window_started_at end,
    attempts = case
      when security_attempts.window_started_at < now() - interval '1 hour' then 1
      else security_attempts.attempts + 1 end
  returning attempts into current_count;
  return current_count <= allowed;
end;
$$;

create or replace function public.claim_invite(invite_code text)
returns void language plpgsql security definer set search_path = public as $$
declare claimed text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then return; end if;
  if not public.consume_security_attempt('claim_invite', 10) then
    raise exception 'RATE_LIMITED';
  end if;
  update public.invites set used_by = auth.uid(), used_at = now()
  where code = invite_code and used_by is null returning code into claimed;
  if claimed is null then raise exception 'INVITE_INVALID'; end if;
  insert into public.profiles(id) values (auth.uid());
  delete from public.security_attempts where user_id = auth.uid() and action = 'claim_invite';
end;
$$;

create or replace function public.configure_backup(
  device uuid, owner_token text, recovery_wrap text, recovery_iv text,
  recovery_salt text, recovery_verifier text, recovery_verifier_salt text,
  consent_at timestamptz, consent_version text, wrapped_key text,
  wrap_iv text, wrapped_by jsonb
) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  if length(owner_token) < 40 then raise exception 'OWNER_TOKEN_INVALID'; end if;
  if exists (select 1 from public.recovery_proofs where user_id = auth.uid()) then
    raise exception 'ALREADY_CONFIGURED';
  end if;
  if not exists (select 1 from public.devices d where d.id = device
                 and d.user_id = auth.uid() and d.status = 'pending') then
    raise exception 'NO_SUCH_DEVICE';
  end if;

  insert into public.recovery_proofs(user_id, verifier)
  values (auth.uid(), recovery_verifier);
  update public.devices set status = 'approved', approved_at = now(),
    wrapped_key = configure_backup.wrapped_key, wrap_iv = configure_backup.wrap_iv,
    wrapped_by = configure_backup.wrapped_by
  where id = device and user_id = auth.uid();
  update public.profiles set
    recovery_wrap = configure_backup.recovery_wrap,
    recovery_iv = configure_backup.recovery_iv,
    recovery_salt = configure_backup.recovery_salt,
    recovery_verifier_salt = configure_backup.recovery_verifier_salt,
    consent_at = configure_backup.consent_at,
    consent_version = configure_backup.consent_version,
    owner_device = device,
    owner_token_hash = digest(owner_token, 'sha256')
  where id = auth.uid();
end;
$$;

create or replace function public.approve_device(
  device uuid, wrapped_key text, wrap_iv text, wrapped_by jsonb, owner_token text
) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.owner_capability_ok(owner_token) then raise exception 'OWNER_TOKEN_WRONG'; end if;
  update public.devices set status = 'approved', approved_at = now(),
    wrapped_key = approve_device.wrapped_key, wrap_iv = approve_device.wrap_iv,
    wrapped_by = approve_device.wrapped_by
  where id = device and user_id = auth.uid() and status in ('pending', 'approved');
  if not found then raise exception 'NO_SUCH_DEVICE'; end if;
end;
$$;

create or replace function public.revoke_device(device uuid, owner_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.owner_capability_ok(owner_token) then raise exception 'OWNER_TOKEN_WRONG'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and owner_device = device) then
    raise exception 'CANNOT_REVOKE_OWNER';
  end if;
  update public.devices set status = 'revoked', wrapped_key = null,
    wrap_iv = null, wrapped_by = null
  where id = device and user_id = auth.uid();
  if not found then raise exception 'NO_SUCH_DEVICE'; end if;
end;
$$;

create or replace function public.touch_device(device uuid, owner_token text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.devices set last_seen_at = now()
  where id = device and user_id = auth.uid() and status = 'approved';
end;
$$;

create or replace function public.upload_backup(
  backup_version bigint, backup_iv text, backup_ct text, backup_bytes int,
  device uuid, owner_token text
) returns void language plpgsql security definer set search_path = public, extensions as $$
declare expected bigint;
begin
  if not public.owner_capability_ok(owner_token, device) then raise exception 'OWNER_TOKEN_WRONG'; end if;
  if not exists (select 1 from public.devices where id = device
                 and user_id = auth.uid() and status = 'approved') then
    raise exception 'NOT_APPROVED';
  end if;
  if backup_bytes <= 0 or backup_bytes > 6000000 or length(backup_ct) >= 8000000
     or length(backup_iv) not between 16 and 24 then
    raise exception 'BACKUP_INVALID';
  end if;
  select coalesce(max(version), 0) + 1 into expected
  from public.backups where user_id = auth.uid();
  if backup_version <> expected then raise exception 'STALE'; end if;
  insert into public.backups(user_id, version, iv, ct, bytes, device_id)
  values (auth.uid(), backup_version, backup_iv, backup_ct, backup_bytes, device);
end;
$$;

create or replace function public.claim_ownership(verifier text, device uuid, owner_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare stored text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  if not public.consume_security_attempt('claim_ownership', 5) then
    raise exception 'RATE_LIMITED';
  end if;
  select rp.verifier into stored from public.recovery_proofs rp where rp.user_id = auth.uid();
  if stored is null then raise exception 'NO_RECOVERY_SET'; end if;
  if stored <> verifier then raise exception 'RECOVERY_WRONG'; end if;
  if length(owner_token) < 40 then raise exception 'OWNER_TOKEN_INVALID'; end if;
  if not exists (select 1 from public.devices d where d.id = device and d.user_id = auth.uid()) then
    raise exception 'NO_SUCH_DEVICE';
  end if;
  update public.devices set status = 'revoked', wrapped_key = null,
    wrap_iv = null, wrapped_by = null
  where user_id = auth.uid() and id <> device;
  update public.devices set status = 'approved', approved_at = now() where id = device;
  update public.profiles set owner_device = device,
    owner_token_hash = digest(owner_token, 'sha256') where id = auth.uid();
  delete from public.security_attempts where user_id = auth.uid() and action = 'claim_ownership';
end;
$$;

create or replace function public.delete_cloud_data(owner_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.owner_capability_ok(owner_token) then raise exception 'OWNER_TOKEN_WRONG'; end if;
  delete from public.backups where user_id = auth.uid();
  delete from public.devices where user_id = auth.uid();
  delete from public.recovery_proofs where user_id = auth.uid();
  delete from public.profiles where id = auth.uid();
end;
$$;

revoke all on function public.owner_capability_ok(text, uuid) from public, anon, authenticated;
revoke all on function public.consume_security_attempt(text, int) from public, anon, authenticated;
revoke all on function public.claim_invite(text) from public, anon;
revoke all on function public.configure_backup(uuid,text,text,text,text,text,text,timestamptz,text,text,text,jsonb) from public, anon;
revoke all on function public.approve_device(uuid,text,text,jsonb,text) from public, anon;
revoke all on function public.revoke_device(uuid,text) from public, anon;
revoke all on function public.touch_device(uuid,text) from public, anon;
revoke all on function public.upload_backup(bigint,text,text,int,uuid,text) from public, anon;
revoke all on function public.claim_ownership(text,uuid,text) from public, anon;
revoke all on function public.delete_cloud_data(text) from public, anon;

grant execute on function public.configure_backup(uuid,text,text,text,text,text,text,timestamptz,text,text,text,jsonb) to authenticated;
grant execute on function public.claim_invite(text) to authenticated;
grant execute on function public.approve_device(uuid,text,text,jsonb,text) to authenticated;
grant execute on function public.revoke_device(uuid,text) to authenticated;
grant execute on function public.touch_device(uuid,text) to authenticated;
grant execute on function public.upload_backup(bigint,text,text,int,uuid,text) to authenticated;
grant execute on function public.claim_ownership(text,uuid,text) to authenticated;
grant execute on function public.delete_cloud_data(text) to authenticated;

revoke all on table public.recovery_proofs from anon, authenticated;
revoke all on table public.security_attempts from anon, authenticated;
