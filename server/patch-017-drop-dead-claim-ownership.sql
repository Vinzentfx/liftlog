-- Patch 017: das claim_ownership von vor 014 in Rente schicken und zwei search_paths festlegen.
--
-- Patch 014 hat claim_ownership durch eine Form mit drei Argumenten ersetzt, die Anfragen
-- begrenzt, ein Besitzertoken prüft und die eingepackten Schlüssel von entzogenen Geräten
-- entfernt. Die neue Signatur wurde angelegt, die alte aber nie gelöscht, beide lebten also
-- nebeneinander. Die alte liest profiles.recovery_verifier, eine Spalte, die Patch 003 nach
-- recovery_proofs verschoben hat. Jeder Aufruf wirft also zur Laufzeit, statt etwas zu tun.
-- Übrig war ein toter SECURITY-DEFINER-Endpunkt an der REST-Oberfläche ohne irgendeine der
-- Absicherungen aus 014.
--
-- Niemand ruft ihn auf: js/cloud.js übergibt owner_token seit 014.
drop function if exists public.claim_ownership(text, uuid);

-- Beide haben Namen ohne Schema gegen den search_path aufgelöst, den der Aufrufer gerade
-- hatte. Keine braucht einen, weil beide jedes Objekt mit ausgeschriebenem Schema ansprechen,
-- die leere Einstellung ist also die strenge Lesart und kein Kompromiss. trim_backup_history
-- läuft als Trigger bei jedem Schreiben einer Sicherung, und nur deshalb lohnt es sich, ihn festzulegen.
alter function public.trim_backup_history() set search_path = '';
alter function public.invite_failure_budget() set search_path = '';
