# Trainingseinladungen und Benachrichtigungen

Die Befehle laufen im LiftLog-Ordner im Terminal, nicht im SQL-Editor von Supabase.

1. `server/patch-010-social-plans-invites.sql` einmal im SQL-Editor von Supabase
   ausführen. Für Antworten auf Einladungen und die Benachrichtigung darüber
   zusätzlich einmal `server/patch-015-training-invite-responses.sql`.
2. Den lokalen Ordner verknüpfen, falls noch nicht geschehen:

   ```sh
   supabase link --project-ref txjikhreoshmkjuyomki
   ```

3. Die privaten Web-Push-Schlüssel aus der gitignorierten lokalen Datei hochladen
   und veröffentlichen:

   ```sh
   supabase secrets set --env-file server/.vapid-secrets
   supabase functions deploy send-training-invite
   ```

Der öffentliche VAPID-Schlüssel gehört mit Absicht zur App. Der private in
`server/.vapid-secrets` darf nie committet oder in Client-Code kopiert werden.
