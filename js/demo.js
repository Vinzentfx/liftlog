// Whether this build is the public preview.
//
// The repository always says false, so the app friends use never changes, and
// tests/security.test.js fails if that ever stops being true. The GitHub Pages
// workflow (.github/workflows/pages.yml) writes true into its own copy before
// publishing. Nothing else sets it.
//
// What the preview does differently, all of it in js/app.js:
//   - no invite gate and no install hint, because a visitor has no code
//   - no cloud: nothing syncs, and the published copy's CSP does not allow the
//     Supabase host at all, so a stray call fails in the browser rather than
//     reaching the real project
//   - an empty device is filled from showcase-backup.json on first launch
//   - no offline copy: the published sw.js is tools/preview-sw.js, because
//     bootstrap.js registers a worker before any module could say otherwise,
//     and the real one would keep serving last week's sample data
export const DEMO = false;
