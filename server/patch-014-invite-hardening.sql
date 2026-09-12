-- Patch 014: die Grenzen der Einladungssperre echt machen und die Codes unerratbar.
-- Nach patch-013 im SQL-Editor von Supabase einspielen.
--
-- Zwei getrennte Probleme, gefunden durch Lesen dessen, was die Transaktion tut, und nicht
-- dessen, was die Funktion sagt.
--
-- 1. Die Grenzen haben nie gezählt. `consume_security_attempt` hält einen Versuch fest und
--    gibt zurück, ob er im Rahmen lag. Jeder Aufrufer meldet einen falschen Code dann mit
--    `raise exception`, das bricht die Transaktion ab, in der die RPC läuft, und rollt die
--    Zeile zurück, die gerade geschrieben wurde. Ein falscher Versuch ließ den Zähler also
--    genau da, wo er war, und aus "zehn Versuche pro Stunde" wurden zehn Versuche pro
--    Sekunde, für immer. Die Lösung ist, nicht mehr zu werfen: die Funktionen geben jetzt
--    einen Status als Text zurück und schreiben fest, ein gezählter Versuch bleibt also
--    gezählt. `claim_ownership` hatte denselben Fehler und ist genauso behoben.
--
-- 2. Die Grenze hatte ohnehin die falsche Form. Sie hängt an `auth.uid()`, und registrieren
--    kann sich jeder, zehn Versuche pro Gratiskonto sind also unbegrenztes Raten. Das war
--    nur wichtig, weil die Codes kurz und selbst ausgedacht waren, in der Form `MARCEL-2026`:
--    ein Vorname und ein Jahr.
--
--    Deshalb: eine Obergrenze für fehlgeschlagene Versuche über die ganze Instanz, um die der
--    Trick mit den Gratiskonten nicht herumkommt, und `public.new_invite()`, das 80 Bit
--    erzeugt. Das Zweite schließt die Lücke wirklich, das Erste ist für die Codes da, die
--    schon verteilt sind.
--
-- Die globale Grenze ist absichtlich großzügig, weil sie geteilt ist: ein entschlossener
-- Fremder kann sie aufbrauchen und neue Registrierungen für eine Stunde stoppen. Die eigenen
-- Freunde eine Stunde auszusperren ist ein viel kleineres Problem, als einen Fremden
-- hereinzulassen, und sie früher zu lösen ist eine Anweisung, ganz unten in dieser Datei.
--
-- Der Client kommt mit beiden Versionen der Funktionen zurecht, die App läuft also zwischen
-- dem Einspielen hiervon und dem Ausliefern des passenden JavaScripts weiter.

-- globale Sperre

create table if not exists public.invite_guard (
  id boolean primary key default true check (id),
  window_started_at timestamptz not null default now(),
  failures int not null default 0
);
alter table public.invite_guard enable row level security;
-- Keine Policies: Zustand nur für den Server, wie security_attempts.
revoke all on table public.invite_guard from anon, authenticated;

insert into public.invite_guard (id) values (true) on conflict (id) do nothing;

-- Wie viele falsche Codes die ganze Instanz in einer Stunde erzeugen darf. Wer sich bei einem
-- Code vertippt, den er wirklich hat, kommt nicht einmal in die Nähe.
create or replace function public.invite_failure_budget()
returns int language sql immutable as $$ select 30 $$;

create or replace function public.note_invite_failure()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.invite_guard set
    window_started_at = case
      when window_started_at < now() - interval '1 hour' then now()
      else window_started_at end,
    failures = case
      when window_started_at < now() - interval '1 hour' then 1
      else failures + 1 end
  where id;
end; $$;

create or replace function public.invites_locked()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select failures >= public.invite_failure_budget()
      and window_started_at >= now() - interval '1 hour'
    from public.invite_guard where id
  ), false);
$$;

-- claim_invite

-- Gibt einen Status zurück, statt zu werfen, damit ein gezählter Versuch den Aufruf übersteht.
-- 'OK' bei Erfolg, sonst der Grund. Der Rumpf ist sonst der aus Patch 004, ganz übernommen,
-- damit diese Datei allein sagt, was die Funktion jetzt macht.
--
-- Die alte Version ohne Rückgabewert muss ausdrücklich weg: den Rückgabetyp zu ändern macht
-- `create or replace` nicht für einen.
drop function if exists public.claim_invite(text);

create or replace function public.claim_invite(invite_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_code text;
begin
  if auth.uid() is null then
    return 'NOT_SIGNED_IN';
  end if;

  -- Die Freigabe direkt lesen. Diese RPC darf nicht davon abhängen, dass Aufrufer die private
  -- Hilfsfunktion has_active_access() ausführen dürfen.
  if exists (
    select 1 from public.access_grants ag
    where ag.user_id = auth.uid() and ag.active = true
  ) then
    return 'OK';
  end if;

  -- Vor dem Zähler pro Konto geprüft: wer pro Wegwerfkonto einen Versuch verbraucht, erreicht
  -- nie seine eigene Grenze, seine eigene Grenze ist also nicht die, die ihn stoppen kann.
  if public.invites_locked() then
    return 'RATE_LIMITED';
  end if;

  if not public.consume_security_attempt('claim_invite', 10) then
    return 'RATE_LIMITED';
  end if;

  update public.invites i
  set used_by = auth.uid(), used_at = now()
  where i.code = invite_code and i.used_by is null
  returning i.code into claimed_code;

  if claimed_code is null then
    perform public.note_invite_failure();
    return 'INVITE_INVALID';
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
  return 'OK';
end;
$$;

-- claim_ownership

-- Derselbe Fehler beim Zurückrollen, dieselbe Lösung. Der Wiederherstellungsschlüssel hat 128
-- Bit, die Grenze stand also nie zwischen einem Angreifer und einem Konto. Behoben wird es,
-- weil eine Grenze, die still nichts tut, schlimmer ist als keine: an die denkt man nicht mehr.
drop function if exists public.claim_ownership(text, uuid, text);

create or replace function public.claim_ownership(verifier text, device uuid, owner_token text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare stored text;
begin
  if auth.uid() is null then return 'NOT_SIGNED_IN'; end if;
  if not public.consume_security_attempt('claim_ownership', 5) then
    return 'RATE_LIMITED';
  end if;
  select rp.verifier into stored from public.recovery_proofs rp where rp.user_id = auth.uid();
  if stored is null then return 'NO_RECOVERY_SET'; end if;
  if stored <> verifier then return 'RECOVERY_WRONG'; end if;
  if length(owner_token) < 40 then return 'OWNER_TOKEN_INVALID'; end if;
  if not exists (select 1 from public.devices d where d.id = device and d.user_id = auth.uid()) then
    return 'NO_SUCH_DEVICE';
  end if;
  update public.devices set status = 'revoked', wrapped_key = null,
    wrap_iv = null, wrapped_by = null
  where user_id = auth.uid() and id <> device;
  update public.devices set status = 'approved', approved_at = now() where id = device;
  update public.profiles set owner_device = device,
    owner_token_hash = digest(owner_token, 'sha256') where id = auth.uid();
  delete from public.security_attempts where user_id = auth.uid() and action = 'claim_ownership';
  return 'OK';
end; $$;

-- Codes erzeugen

-- 16 Zeichen aus einem Alphabet mit 30 Zeichen: knapp über 78 Bit. Das Alphabet lässt 0/O/1/I/L/U
-- weg, damit man einen Code am Telefon vorlesen kann, ohne über die Schreibweise zu streiten,
-- und die Vierergruppen sind aus demselben Grund da.
--
-- Nur für den Admin. Nicht an `authenticated` vergeben, läuft also aus dem SQL-Editor und
-- nirgends sonst.
create or replace function public.new_invite(invite_note text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  generated text := '';
  raw bytea;
begin
  raw := gen_random_bytes(16);
  for i in 0..15 loop
    generated := generated || substr(alphabet, (get_byte(raw, i) % length(alphabet)) + 1, 1);
    if i in (3, 7, 11) then generated := generated || '-'; end if;
  end loop;
  insert into public.invites (code, note) values (generated, invite_note);
  return generated;
end; $$;

revoke all on function public.new_invite(text) from public, anon, authenticated;
revoke all on function public.note_invite_failure() from public, anon, authenticated;
revoke all on function public.invites_locked() from public, anon, authenticated;
revoke all on function public.invite_failure_budget() from public, anon, authenticated;
revoke all on function public.claim_invite(text) from public, anon;
grant execute on function public.claim_invite(text) to authenticated;
revoke all on function public.claim_ownership(text, uuid, text) from public, anon;
grant execute on function public.claim_ownership(text, uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- so geht's
--
-- Einen Code erzeugen und einmal auslesen:
--   select public.new_invite('Marcel');
--
-- Welche vorhandenen Codes lohnen sich zu raten? Alles, was kurz ist oder wie ein Wort
-- aussieht. Die unbenutzten löschen und stattdessen neue verteilen:
--   select code, note, used_by from public.invites
--    where used_by is null and length(replace(code, '-', '')) < 12;
--   delete from public.invites
--    where used_by is null and length(replace(code, '-', '')) < 12;
--
-- Die globale Sperre früher lösen, wenn ein Fremder sich darauf gesetzt hat:
--   update public.invite_guard set failures = 0 where id;
--
-- Konten, die sich registriert und nie einen Code eingelöst haben, hinterlassen eine Zeile in
-- auth.users und sonst nichts. Für sich harmlos, aber sie machen das Raten billig und sind es
-- wert, weggeräumt zu werden. Zum Löschen braucht es die Service-Rolle, also das Dashboard
-- und nicht diesen Editor:
--   select u.id, u.email, u.created_at from auth.users u
--     left join public.access_grants ag on ag.user_id = u.id
--    where ag.user_id is null and u.created_at < now() - interval '7 days';
