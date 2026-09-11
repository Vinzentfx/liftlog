# Kreatin-Erinnerungen aktivieren

1. `server/patch-011-notification-preferences.sql` im Supabase SQL Editor ausführen.
2. Im Terminal im LiftLog-Ordner die aktualisierten Secrets und Funktionen veröffentlichen:

   ```sh
   supabase secrets set --env-file server/.vapid-secrets
   supabase functions deploy send-creatine-reminders --no-verify-jwt
   supabase functions deploy send-training-invite
   ```

3. In Supabase unter **Integrations > Cron > Jobs > Create job** einen HTTP-Job
   anlegen:

   - Zeitplan: `*/5 * * * *`
   - Methode: `POST`
   - URL: `https://txjikhreoshmkjuyomki.supabase.co/functions/v1/send-creatine-reminders`
   - Header: `x-cron-secret` mit dem Wert `CREATINE_CRON_SECRET` aus der lokalen,
     gitignorierten Datei `server/.vapid-secrets`

Die Funktion läuft alle fünf Minuten, verschickt aber pro Person höchstens die
fällige tägliche Erinnerung oder eine ausdrücklich um eine Stunde verschobene
Erinnerung.
