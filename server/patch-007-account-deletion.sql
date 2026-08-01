-- Verify possession of the main-device capability before the Edge Function
-- uses Supabase Admin Auth to delete the identity. This function deliberately
-- performs no deletion itself, so a later Admin API failure cannot leave a
-- half-deleted account. Deleting auth.users then cascades to every LiftLog row.

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
