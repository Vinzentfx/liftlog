// Where the cloud backup lives.
//
// Both values are public on purpose and are meant to be committed. The anon key
// is not a password, it is a name badge: it says which project is being called
// and that the caller is nobody in particular. Every table has row-level
// security, so that role can do nothing at all on its own. Access appears only
// once a signed-in user's own token rides along on top, and then only to their
// own rows. That is enforced in server/schema.sql, not here.
//
// The key that must never appear in this file, in this repo, or in a chat is
// the `service_role` one. It bypasses row-level security completely.

export const SUPABASE_URL = 'https://txjikhreoshmkjuyomki.supabase.co';

export const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
  + '.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4amlraHJlb3NobWtqdXlvbWtpIiwicm9sZSI6ImFub24i'
  + 'LCJpYXQiOjE3ODU1MDI3ODAsImV4cCI6MjEwMTA3ODc4MH0'
  + '.ZC2EppPZ3qtvb65QJ1_WZa7jTg2Tc8sXgsiFQe2-3LE';

/**
 * Bumped when the consent wording changes, and stored alongside the timestamp
 * on the profile row. Without it "they agreed" is a claim with no content: it
 * would be impossible to say later what anyone actually agreed to.
 */
export const CONSENT_VERSION = '2026-08-01';

// Public half of the Web Push key. The matching private half lives only in
// Supabase Edge Function secrets (server/.vapid-secrets is gitignored).
export const VAPID_PUBLIC_KEY = 'BKPwWaQtwir-hMT7mYY5bOEaZ6c7JBl0aPZgupGm4QknzHmNO8aLDTLmKP5AkbvPpSILwEeHGZgNbaB-o_miDc0';
