# Konto vollständig löschen

Der Web-Client bekommt den `service_role`-Schlüssel von Supabase nie zu sehen. Das
vollständige Löschen eines Kontos läuft deshalb über eine Edge Function.

1. `patch-007-account-deletion.sql` im SQL-Editor von Supabase ausführen.
2. Die Supabase CLI installieren und anmelden.
3. Im Hauptordner des Repos das Projekt verknüpfen und veröffentlichen:

   ```sh
   supabase link --project-ref txjikhreoshmkjuyomki
   supabase functions deploy delete-account
   ```

Die aktuelle Laufzeit von Supabase gibt der Funktion den angemeldeten Client
`ctx.supabase` und den privilegierten `ctx.supabaseAdmin`. Nie ein Secret oder
einen Service-Role-Schlüssel in dieses Repo, den Quelltext der Funktion oder
Cloudflare eintragen.

Nach dem Veröffentlichen mit einem Wegwerfkonto testen. Die Funktion prüft zuerst
die Besitzer-Berechtigung auf dem Gerät und löscht dann die Auth-Identität. Die
Fremdschlüssel mit `on delete cascade` räumen danach die Zeilen in der Datenbank weg.
