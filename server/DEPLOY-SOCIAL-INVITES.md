# Social invitations and notifications

Run these commands from the LiftLog repository, not in the Supabase SQL editor.

1. Run `server/patch-010-social-plans-invites.sql` once in the Supabase SQL editor.
2. Link the local folder if it is not linked already:

   ```sh
   supabase link --project-ref txjikhreoshmkjuyomki
   ```

3. Upload the private Web Push keys from the gitignored local file and deploy:

   ```sh
   supabase secrets set --env-file server/.vapid-secrets
   supabase functions deploy send-training-invite
   ```

The public VAPID key is intentionally part of the app. The private key in
`server/.vapid-secrets` must never be committed or pasted into client code.
