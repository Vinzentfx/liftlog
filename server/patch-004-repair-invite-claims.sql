-- Patch 004: unvollständige Aktivierungen von Einladungen reparieren und das Einlösen
-- unabhängig von Ausführungsrechten auf Hilfsfunktionen machen. Nach Patch 003 einspielen.

-- Profile belegen, dass eine Einladung von einer früheren Schemaversion angenommen wurde.
-- Nur fehlende Freigaben wiederherstellen, entzogene Zeilen absichtlich nicht reaktivieren.
insert into public.access_grants (user_id, active, granted_at, revoked_at)
select p.id, true, p.created_at, null
from public.profiles p
left join public.access_grants ag on ag.user_id = p.id
where ag.user_id is null
on conflict (user_id) do nothing;

create or replace function public.claim_invite(invite_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_code text;
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  -- Die Freigabe direkt lesen. Diese RPC darf nicht davon abhängen, dass Aufrufer die
  -- private Hilfsfunktion has_active_access() ausführen dürfen.
  if exists (
    select 1 from public.access_grants ag
    where ag.user_id = auth.uid() and ag.active = true
  ) then
    return;
  end if;

  if not public.consume_security_attempt('claim_invite', 10) then
    raise exception 'RATE_LIMITED';
  end if;

  update public.invites i
  set used_by = auth.uid(), used_at = now()
  where i.code = invite_code and i.used_by is null
  returning i.code into claimed_code;

  if claimed_code is null then
    raise exception 'INVITE_INVALID';
  end if;

  insert into public.profiles (id)
  values (auth.uid())
  on conflict (id) do nothing;

  insert into public.access_grants (
    user_id, active, granted_at, revoked_at, invite_code
  ) values (
    auth.uid(), true, now(), null, claimed_code
  )
  on conflict (user_id) do update set
    active = true,
    granted_at = now(),
    revoked_at = null,
    invite_code = excluded.invite_code;

  delete from public.security_attempts
  where user_id = auth.uid() and action = 'claim_invite';
end;
$$;

revoke all on function public.claim_invite(text) from public, anon;
grant execute on function public.claim_invite(text) to authenticated;
grant execute on function public.has_active_access() to authenticated;

-- Den Ersatz für PostgREST sofort sichtbar machen.
notify pgrst, 'reload schema';
