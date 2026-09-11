-- Patch 001: ein Konto ohne Einladung darf nichts speichern können.
--
-- Einmal auf einem Projekt ausführen, das aus der ersten Fassung von schema.sql entstanden
-- ist. Projekte aus dem aktuellen schema.sql haben das schon.
--
-- Die Lücke: der Einladungscode sperrt das Anlegen des Profils, und die Policies auf
-- `backups` und `devices` haben nur gefragt "gehört dir diese Zeile". Bei einem Konto, das
-- registriert, aber nicht eingeladen ist, heißt die Antwort ja, es konnte also schreiben.
-- Gefunden durch Ausprobieren gegen ein echtes Projekt, nicht durch nochmaliges Lesen der Datei.

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
