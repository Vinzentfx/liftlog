// Wo die Cloud-Sicherung liegt.
//
// Beide Werte sind absichtlich öffentlich und gehören ins Repo. Der anon-Schlüssel
// ist kein Passwort, sondern ein Namensschild: er sagt, welches Projekt gerufen wird
// und dass der Aufrufer niemand Bestimmtes ist. Jede Tabelle hat Row-Level-Security,
// allein kann diese Rolle also gar nichts. Zugriff gibt es erst, wenn das Token
// eines angemeldeten Nutzers mitkommt, und dann nur auf dessen eigene Zeilen. Das
// setzt server/schema.sql durch, nicht diese Datei.
//
// Der Schlüssel, der nie in dieser Datei, in diesem Repo oder in einem Chat
// auftauchen darf, ist der `service_role`-Schlüssel. Der umgeht Row-Level-Security komplett.

export const SUPABASE_URL = 'https://txjikhreoshmkjuyomki.supabase.co';

export const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
  + '.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4amlraHJlb3NobWtqdXlvbWtpIiwicm9sZSI6ImFub24i'
  + 'LCJpYXQiOjE3ODU1MDI3ODAsImV4cCI6MjEwMTA3ODc4MH0'
  + '.ZC2EppPZ3qtvb65QJ1_WZa7jTg2Tc8sXgsiFQe2-3LE';

/**
 * Wird erhöht, wenn sich der Text der Einwilligung ändert, und zusammen mit dem
 * Zeitstempel in der Profilzeile gespeichert. Ohne das wäre "hat zugestimmt" eine
 * Behauptung ohne Inhalt, später könnte niemand sagen, wozu eigentlich.
 */
export const CONSENT_VERSION = '2026-08-01';

// Öffentliche Hälfte des Web-Push-Schlüssels. Die private Hälfte liegt nur in den
// Secrets der Supabase Edge Functions (server/.vapid-secrets steht in .gitignore).
export const VAPID_PUBLIC_KEY = 'BKPwWaQtwir-hMT7mYY5bOEaZ6c7JBl0aPZgupGm4QknzHmNO8aLDTLmKP5AkbvPpSILwEeHGZgNbaB-o_miDc0';
