-- LiftLog Cloud-Sicherung: die ganze Serverseite.
-- Nach diesem Grundschema auch server/patch-002-device-capabilities.sql
-- einspielen. Es ersetzt die offenen Start-Policies unten durch Schreib-RPCs, die
-- an Gerätefähigkeiten hängen. Die zwei Dateien sind getrennt, damit bestehende
-- Supabase-Projekte ohne Datenverlust umziehen können.
-- Danach server/patch-003-revocable-access.sql für einzeln widerrufbare Freigaben,
-- die bei jedem Lesen und Schreiben in der Cloud geprüft werden.
-- Dann server/patch-004-repair-invite-claims.sql, das halb abgeschlossene alte
-- Freischaltungen repariert und die eigenständige RPC zum Einlösen von Einladungen anlegt.
-- server/patch-005-fix-access-policy-permission.sql danach, damit Policies für
-- angemeldete Nutzer die Zugriffs-Hilfsfunktion ausführen können, dann
-- patch-006-unblock-devices.sql, damit ein Hauptgerät eine gesperrte Installation
-- ausdrücklich wiederherstellen kann. patch-007-account-deletion.sql für das
-- vollständige Löschen des eigenen Kontos.
-- patch-008-social-hub.sql danach, wenn der optionale Bereich Nutzer an sein soll;
-- es ändert oder entschlüsselt nie Sicherungsdaten.
-- patch-009-multi-device-backups.sql zuletzt, damit jedes freigegebene Gerät Sicherungen
-- mit Konfliktprüfung beisteuern kann, ohne Besitzerrechte zu bekommen.
-- patch-010-social-plans-invites.sql danach für geplante Anwesenheit, Stärke-Ranglisten,
-- private Trainingseinladungen und Push-Abos.
-- patch-011-notification-preferences.sql danach für den Hauptschalter der
-- Benachrichtigungen und die tägliche Kreatin-Erinnerung.
--
-- Das hier einmal in den SQL-Editor von Supabase kopieren. Anderen Servercode gibt es
-- nicht: die App spricht über einfaches fetch mit PostgREST, und was sie darf, wird
-- hier entschieden und nicht in JavaScript. Das ist Absicht. Zugriffsregeln, die im
-- Client stehen, sind keine Zugriffsregeln.
--
-- Was dieser Server sieht:        Chiffretext, öffentliche Schlüssel, Größen, Zeitstempel.
-- Was er nie sehen kann:          Trainingsdaten, Körpergewicht, Essen oder einen Schlüssel,
--                                 der sie öffnet. Warum, steht in js/crypto.js.
--
-- Heißt: wenn diese Datenbank komplett wegkommt, ist der ehrliche Schaden eine Liste von
-- E-Mail-Adressen und das Wissen, dass diese Leute eine Fitness-App sichern. Genau darum
-- geht es bei diesem Aufbau.

-- Profile

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now(),

  -- Zustimmung, festgehalten statt angenommen. Nichts wird synchronisiert, bevor das gesetzt
  -- ist, und die Version wird gespeichert, damit man später sagen kann, wer welchem
  -- Wortlaut zugestimmt hat.
  consent_at      timestamptz,
  consent_version text,

  -- Der Datenschlüssel, verpackt mit dem Wiederherstellungsschlüssel. Ohne ihn nutzlos.
  recovery_wrap  text,
  recovery_iv    text,
  recovery_salt  text,

  -- Hash des Wiederherstellungsschlüssels mit eigenem Salt. Beweist den Besitz für die eine
  -- Aktion, die eine Änderung am Server ist und keine Entschlüsselung: ein neues Gerät zum
  -- Hauptgerät zu machen, wenn das alte weg ist. Er kann nichts entschlüsseln, und rückwärts
  -- hieße 128 zufällige Bit raten.
  recovery_verifier      text,
  recovery_verifier_salt text,

  -- Das Gerät, das hochladen darf. Alle anderen dürfen nur lesen.
  owner_device uuid
);

alter table public.profiles enable row level security;

create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- Hat dieses Konto überhaupt ein Profil?
--
-- Der Einladungscode sperrt das Anlegen eines Profils und sonst nichts, und das ist nicht
-- dasselbe, wie das Konto zu sperren. Gefunden durch Testen, nicht durch Lesen: ein
-- registriertes Konto ohne Einladung hat fröhlich eine Sicherung geschrieben, weil "eigene
-- Sicherungen" nur gefragt hat, ob die Zeile dem Aufrufer gehört, und das tat sie. Kein Leck,
-- jeder sieht weiter nur seine eigenen Zeilen, aber eine offene Tür, um diese Datenbank als
-- Gratisspeicher zu benutzen.
--
-- Security definer, damit sie in profiles schauen kann, ohne über die Zeilensicherheit dieser
-- Tabelle zu stolpern, und stable, damit der Planer sie einmal pro Anweisung aufruft und
-- nicht einmal pro Zeile.
create or replace function public.has_profile()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;

-- Geräte

create table if not exists public.devices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null,
  public_key jsonb not null,
  status     text not null default 'pending'
             check (status in ('pending', 'approved', 'revoked')),

  -- Der Datenschlüssel, für dieses Gerät verpackt, gefüllt bei der Freigabe. Der öffentliche
  -- Schlüssel der verpackenden Seite reist mit, damit dieses Gerät seine Hälfte des ECDH
  -- rechnen kann. Keine der beiden Hälften ist geheim.
  wrapped_key text,
  wrap_iv     text,
  wrapped_by  jsonb,

  created_at   timestamptz not null default now(),
  approved_at  timestamptz,
  last_seen_at timestamptz
);

create index if not exists devices_user on public.devices (user_id, status);

alter table public.devices enable row level security;

-- Eine Gerätezeile gehört immer nur dem Kontoinhaber. Die Anfrage eines neuen Handys schreibt
-- dieses Handy selbst, angemeldet mit demselben Konto, diese eine Policy deckt also Anfragen,
-- Freigeben und Widerrufen ab.
create policy "own devices" on public.devices
  for all
  using       (auth.uid() = user_id and public.has_profile())
  with check  (auth.uid() = user_id and public.has_profile());

-- Sicherungen

create table if not exists public.backups (
  user_id    uuid not null references auth.users on delete cascade,
  version    bigint not null,
  iv         text not null,
  ct         text not null,
  bytes      int  not null,
  device_id  uuid,
  created_at timestamptz not null default now(),

  primary key (user_id, version),

  -- Die versiegelte Sicherung eines langen Logs hat ein paar hundert Kilobyte. Acht Megabyte
  -- Base64 liegen weit über allem Echten und weit unter allem, was die Datenbank aus
  -- Versehen füllen könnte.
  constraint backup_size check (length(ct) < 8000000)
);

alter table public.backups enable row level security;

create policy "own backups" on public.backups
  for all
  using       (auth.uid() = user_id and public.has_profile())
  with check  (auth.uid() = user_id and public.has_profile());

-- Der Primärschlüssel sorgt dafür, dass ein veralteter Upload fehlschlägt, statt zu
-- überschreiben. Ein Gerät, das offline war, lädt Version 8 hoch, während der Server schon bei
-- 9 ist, bekommt einen Fehler wegen doppeltem Schlüssel und muss erst holen, bevor es schieben
-- kann. Das ist die ganze Geschichte der Nebenläufigkeit, und sie wird hier erzwungen statt erhofft.

-- Ein paar ältere Versionen behalten. Eine Sicherung, die man nicht zurückdrehen kann, schützt
-- nicht davor, dass die App etwas Falsches geschrieben und das Falsche dann brav gesichert hat.
create or replace function public.trim_backup_history()
returns trigger language plpgsql set search_path = '' as $$
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

-- Einladungen

-- Registrieren kann sich jeder, ein Profil bekommen nicht, und jede Policy oben verlangt
-- zusätzlich `has_profile()`. Ein Konto ohne Einladung kann sich also anmelden und genau
-- nichts tun. Das sollte man immer wieder testen statt nur nachlesen: die erste Version
-- dieser Datei hat nur geprüft, wem eine Zeile gehört, und ein Konto ohne Einladung konnte
-- frei schreiben.
create table if not exists public.invites (
  code       text primary key,
  note       text,
  created_at timestamptz not null default now(),
  used_by    uuid references auth.users on delete set null,
  used_at    timestamptz
);

alter table public.invites enable row level security;
-- Gar keine Policy: niemand liest oder schreibt diese Tabelle über die API. Codes kommen über
-- den SQL-Editor hinein und werden nur von der Funktion unten geprüft, die als Definer läuft.

create or replace function public.claim_invite(invite_code text)
returns void language plpgsql security definer set search_path = public as $$
declare
  claimed text;
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid()) then
    return;                              -- schon eingerichtet, nichts zu tun
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

-- Übernahme

-- Der Notausgang auf der Serverseite. Der Client beweist, dass er den Wiederherstellungsschlüssel
-- hat, indem er den Prüfwert schickt. Stimmt er, wird dieses Gerät zum Hauptgerät und jedes
-- andere Gerät wird widerrufen, weil ein verlorenes Handy in dem Moment kein Vertrauen mehr
-- verdient, in dem man es ersetzt.
--
-- Der Prüfwert wird hier verglichen und nicht im Client, aus dem naheliegenden Grund: eine
-- Prüfung im Client ist eine Prüfung, die der Client auslassen kann.
-- Abgelöst durch Patch 014, das ein owner_token als drittes Argument nimmt und die Versuche
-- begrenzt, und durch Patch 017, das diese Signatur aus der echten Datenbank entfernt hat.
-- Steht hier nur noch, weil schema.sql die ursprüngliche Form dokumentiert. Eine frische
-- Installation spielt die Patches der Reihe nach ein.
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

  -- Ungefähr zeitkonstanter Vergleich. Postgres hat keinen timing-sicheren Vergleich für Text,
  -- und der geratene Wert hat 128 Bit Entropie, ein Timing-Orakel bringt einem Angreifer hier
  -- also nichts, was den Satz wert wäre, der es erklärt.
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

-- Aufräumen

-- Das Löschen des Auth-Nutzers läuft per Cascade durch jede Tabelle oben, und genau das muss
-- eine Löschanfrage wirklich tun. Lohnt sich, einmal an einem Wegwerfkonto zu testen, bevor
-- jemand fragt.

-- Eine Einladung anlegen, zum Nachschlagen:
--   insert into public.invites (code, note) values ('MARCEL-2026', 'Marcel');
