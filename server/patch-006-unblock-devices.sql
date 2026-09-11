-- Das Hauptgerät darf ein vorher gesperrtes Gerät ausdrücklich wieder freigeben. Die
-- Besitzerberechtigung ist weiter nötig, und gleichzeitig wird eine frische verschlüsselte
-- Kopie des Schlüssels geschrieben, den Status allein zu ändern gibt also nie Zugang zurück.

create or replace function public.approve_device(
  device uuid, wrapped_key text, wrap_iv text, wrapped_by jsonb, owner_token text
) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.owner_capability_ok(owner_token) then raise exception 'OWNER_TOKEN_WRONG'; end if;
  update public.devices set status = 'approved', approved_at = now(),
    wrapped_key = approve_device.wrapped_key, wrap_iv = approve_device.wrap_iv,
    wrapped_by = approve_device.wrapped_by
  where id = device and user_id = auth.uid()
    and status in ('pending', 'approved', 'revoked');
  if not found then raise exception 'NO_SUCH_DEVICE'; end if;
end;
$$;

revoke all on function public.approve_device(uuid,text,text,jsonb,text) from public, anon;
grant execute on function public.approve_device(uuid,text,text,jsonb,text) to authenticated;

notify pgrst, 'reload schema';
