-- Patch 001: an account without an invite must not be able to store anything.
--
-- Run this once on a project that was created from the first version of
-- schema.sql. Projects set up from the current schema.sql already have it.
--
-- The hole: the invite code gates profile creation, and the policies on
-- `backups` and `devices` only ever asked "is this row yours". For a signed-up
-- but uninvited account the answer is yes, so it could write. Found by trying
-- it against a live project, not by re-reading the file.

create or replace function public.has_profile()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;

drop policy if exists "own backups" on public.backups;
create policy "own backups" on public.backups
  for all
  using       (auth.uid() = user_id and public.has_profile())
  with check  (auth.uid() = user_id and public.has_profile());

drop policy if exists "own devices" on public.devices;
create policy "own devices" on public.devices
  for all
  using       (auth.uid() = user_id and public.has_profile())
  with check  (auth.uid() = user_id and public.has_profile());
