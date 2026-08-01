# Complete account deletion

The web client never receives the Supabase `service_role` key. Complete account
deletion therefore uses a Supabase Edge Function.

1. Run `patch-007-account-deletion.sql` in the Supabase SQL editor.
2. Install and authenticate the Supabase CLI.
3. From the repository root, link the project and deploy:

   ```sh
   supabase link --project-ref txjikhreoshmkjuyomki
   supabase functions deploy delete-account
   ```

Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to hosted Edge
Functions. Never add the service-role key to this repository or Cloudflare.

After deployment, test with a disposable account. The function first verifies
the device-local owner capability and then deletes the Auth identity; foreign
keys with `on delete cascade` remove its LiftLog database rows.
