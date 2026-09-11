-- Jedes ausdrücklich freigegebene Gerät darf hochladen, ohne die mächtige Berechtigung des
-- Besitzers zum Freigeben, Entziehen und Löschen zu bekommen. Die Reihenfolge der Versionen
-- bleibt atomar: gleichzeitige Uploads können sich nicht still überschreiben.

create or replace function public.upload_backup_from_device(
  backup_version bigint, backup_iv text, backup_ct text, backup_bytes int,
  device uuid
) returns void language plpgsql security definer set search_path = public as $$
declare expected bigint;
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  if not exists (
    select 1 from public.devices d where d.id=device and d.user_id=auth.uid()
      and d.status='approved' and d.wrapped_key is not null
  ) then raise exception 'NOT_APPROVED'; end if;
  if backup_bytes <= 0 or backup_bytes > 6000000 or length(backup_ct) >= 8000000
     or length(backup_iv) not between 16 and 24 then raise exception 'BACKUP_INVALID'; end if;

  -- Schreiber für dieses Konto nacheinander. Die Profilzeile gibt es für jedes aktivierte
  -- Konto, und sie gibt allen Geräten dasselbe kleine Ziel zum Sperren.
  perform 1 from public.profiles where id=auth.uid() for update;
  select coalesce(max(version),0)+1 into expected from public.backups where user_id=auth.uid();
  if backup_version<>expected then raise exception 'STALE'; end if;

  insert into public.backups(user_id,version,iv,ct,bytes,device_id)
  values(auth.uid(),backup_version,backup_iv,backup_ct,backup_bytes,device);
  update public.devices set last_seen_at=now() where id=device and user_id=auth.uid();
end; $$;

revoke all on function public.upload_backup_from_device(bigint,text,text,int,uuid) from public,anon;
grant execute on function public.upload_backup_from_device(bigint,text,text,int,uuid) to authenticated;
notify pgrst, 'reload schema';
