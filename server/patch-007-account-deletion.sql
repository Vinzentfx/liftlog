-- Prüft, ob die Berechtigung des Hauptgeräts vorliegt, bevor die Edge Function über Supabase
-- Admin Auth die Identität löscht. Die Funktion löscht absichtlich selbst nichts, damit ein
-- späterer Fehler in der Admin-API kein halb gelöschtes Konto hinterlassen kann. Das Löschen
-- in auth.users entfernt dann kaskadierend jede Zeile von LiftLog.

create or replace function public.authorize_account_deletion(owner_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if length(coalesce(owner_token, '')) < 32 then
    raise exception 'OWNER_TOKEN_WRONG';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.owner_token_hash = digest(owner_token, 'sha256')
  ) then
    raise exception 'OWNER_TOKEN_WRONG';
  end if;
  return true;
end;
$$;

revoke all on function public.authorize_account_deletion(text) from public, anon;
grant execute on function public.authorize_account_deletion(text) to authenticated;
