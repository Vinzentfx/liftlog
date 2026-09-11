# LiftLog

A personal workout tracker that installs to the iPhone home screen. No account, no
server, no subscription — all data lives on the device, in the browser's IndexedDB.

Vanilla JavaScript, zero dependencies, zero build step. Charts are hand-drawn SVG
so the whole thing works with the network off.

---

## What's in it

**Home**
- Overall strength rating (0–100) and rank, nine ranks from Bronze to Legend with three divisions each
- Muscle map — front and back, each region coloured by its rating; tap for detail
- Weekly workload, bodyweight trend, streak and recent sessions

**Logging**
- Exercise library, reusable multi-day plans, set-by-set entry
- Plate maths for barbell lifts: what to hang on each side, and when a weight is not loadable
- **Last session's numbers shown inline** and pre-filled, so repeating a workout is three taps
- Rest timer (3 min default) with a chime, auto-started when you complete a set
- Warmup vs working sets, per-exercise notes collected on the exercise's own screen
- A one-tap warm-up ramp, short and close to the working weight, following the two trials that tested it
- PR toasts mid-workout

**Plans**
- Presets: Push/Pull/Legs, Upper/Lower, PPL+Upper/Lower, Full Body, Arnold split
- Per-day exercise lists with target sets and reps
- Strength tier shown inline per lift, plus the weight needed for the next tier

**Calendar** (from Home)
- Month grid of every gym day, measured against your active plan
- Full workout history; tap any date to open that session
- Edit a finished workout — fix a set, add or remove one, correct the date

**Food** (own tab)
- Calories first, the three macros under them, protein against its band
- Search 725 bundled foods — 194 generic, 531 branded — or scan any barcode
- **More** opens every nutrient the day's log knows, micronutrients included
- Carbs, fat, fibre and water — recorded, with no training claim attached
- Meals grouped by time of day; save one as a recipe, repeat yesterday in one tap
- 14-day chart for calories, protein, carbs and fat against their targets
- Maintenance calories derived from your own log and scale, and targets that follow from them

**Library**
- ~776 exercises, searchable by name, muscle group and equipment
- Each one shows which muscles it hits on the same body map, plus step-by-step
  instructions — no exercise photos, for licensing reasons (see below)

**Sharing**
- A plan travels inside a link — no server, no account
- A week card: your week drawn as a PNG for a group chat, built on the phone

**Practical**
- Works fully offline once installed · dark theme built around the blue/glow look
- JSON export/import for backups

---

## Run it locally

```bash
cd ~/liftlog && python3 tools/devserver.py 5173
```

Use `devserver.py` rather than `python3 -m http.server` — it sends `no-store`, so an
edited module actually reloads instead of the browser quietly running the old one.

Open <http://localhost:5173>.

It ships with demo data if you seeded it — wipe it any time via **⚙ → Erase all
data**. To load demo data again, paste `tools/seed-demo.js` into the browser console.

## Run the tests

```bash
cd ~/liftlog
npm install
npm test
npm run test:browser
```

The fast suite uses Node's built-in test runner. The browser suite uses
Playwright with a mobile-sized Chromium window and drives the real app through
workout and navigation flows. GitHub Actions runs both suites for every push and
pull request.

What is tested is narrow on purpose. Not the rating weights: those are judgement
calls against the literature and will move again, and a test would only pin them
down. What is tested is the arithmetic underneath them and the invariants that
have already broken once — dates, because every silent breakage so far has been
a date and none of them showed up until a clock change months later; the two
counts that must agree (a plan's target and a week's actual, which disagreed for
months because each screen counted its own way); and the honesty rules, which
are the point of the app and exactly the sort of thing a refactor reverses
without noticing.

The honesty rules are checked in **both languages**, because the promise is about
what the app is allowed to say, not about which table the sentence lives in: a
German translation that slipped in a "solltest" would break the no-prescription
rule exactly as thoroughly as an English "you should".

A regression test is only worth having if it fails against the bug it describes.
The DST cases were checked that way: reinstate the old fixed-millisecond week
arithmetic and `weekStreak: counts consecutive weeks across a clock change` goes
red on its own. Same for the language guards: drop a key from one table, rename a
placeholder on one side, or put "solltest" into a stall-report string, and the
matching test goes red.

---

## Install on your iPhone

The service worker needs a **secure context**, so offline support only works over
HTTPS (or localhost). That rules out serving it from your Mac over plain
`http://192.168.x.x` — it would still run, but with no offline caching.

### The public preview on GitHub Pages

`.github/workflows/pages.yml` publishes a preview of the app to
`https://<your-username>.github.io/liftlog/`: no invite gate, half a year of
sample data from `tools/build_showcase.mjs`, and no way to reach the real
backend, because the published copy's CSP no longer names it. `js/demo.js`
lists everything the flag changes. The repository always keeps it `false`, and
`tests/security.test.js` fails if it ever is not, so the app friends use is
never affected.

To switch it on: make the repository public (on a free account, Pages only
serves public repositories), then **Settings → Pages → Source: GitHub
Actions**. The workflow runs on every push to `main` and every Monday, so the
sample keeps ending yesterday instead of drifting into the past.

Two things the preview leaves out on purpose. The offline copy: its `sw.js` is
`tools/preview-sw.js`, which clears what the real app cached at this address in
July and then serves nothing, because the real worker would serve last week's
sample from cache. And the two map endpoints in `functions/`, which need Cloudflare and are
simply absent there.

### Then, on the iPhone

1. Open the URL **in Safari** (not Chrome — Safari is the reliable path for this).
2. Tap the **Share** button.
3. Scroll down and tap **Add to Home Screen**.
4. Open it from the home screen. It launches with no browser chrome, keeps its own
   storage, and works in airplane mode.

### Shipping an update

Push to the repo. The app fetches the new version on next launch and applies it on
the launch after that. To make an update land immediately, bump `CACHE` in
[`sw.js`](sw.js) (`liftlog-v4` → `liftlog-v5`).

---

## Back up your data

> Everything is stored **only on that device**. Deleting the home-screen app,
> clearing Safari website data, or resetting the phone will erase your training
> history. There is no cloud copy.

iOS can also evict storage for web apps that go unused for long stretches.

**⚙ → Export backup** writes a `.json` file. Do it every few weeks; AirDrop it to
your Mac or drop it in iCloud Drive. **⚙ → Restore from backup** reads it back,
which is also how you'd move to a new phone. Home nags after 10 workouts or four
weeks without one, because the export was never the missing part — remembering
was.

### The invite gate

The app asks for a code before it opens. What that is honestly worth, said once
so nothing downstream relies on more: this is a static page in a public
repository and every screen runs on the device. Someone who wants past it can
open the developer tools and set a flag. Making it a real lock would mean making
the app need the server to function, which would cost it the ability to work in
a gym basement. What the gate does buy, and this part is real: nobody stumbles
in, and nothing reaches the server without a code.

**It asks once.** Once a device is unlocked it stays unlocked, offline,
indefinitely. The one place this app must never fail is halfway through a set
with no reception, and a login check on every launch fails exactly there. The
flag lives in the `keys` store, so it survives a restore and never travels
inside a backup to someone else's phone.

**Revocation is the one reason it is consulted twice.** With a connection, the
app checks the profile row still exists. Delete it and that person's app locks
the next time they have reception. Offline the check does nothing, and any error
other than "the profile is gone" is treated as a bad connection rather than as
grounds for locking someone out.

**Being locked out does not take your own log away.** The gate offers a file
export when there is training on the device. Revoking access is meant to stop
someone using the app, not to hold their sessions hostage, and anyone determined
could read them out of IndexedDB anyway.

**Signing in is required; uploading is not.** Deliberately separate. A consent
that is a condition of using the service is not freely given under Art. 7(4)
GDPR, and this app would be asking for it over health data. So the code decides
who may use the app, and a second, independent decision decides whether anything
leaves the phone.

### Cloud backup, and what it deliberately cannot do

**Backend deployment order.** For a new Supabase project, apply `server/schema.sql`,
`server/patch-002-device-capabilities.sql`, and then
`server/patch-003-revocable-access.sql`, followed by
`server/patch-004-repair-invite-claims.sql`,
`server/patch-005-fix-access-policy-permission.sql`, and finally
`server/patch-006-unblock-devices.sql` in the SQL editor. For an existing
project, apply each not-yet-applied patch in numeric order before deploying the matching JavaScript.
The patch preserves encrypted backups; existing cloud users enter their recovery
key once so the main device receives its new write capability.

**Status: working end to end.** Sign up, redeem an invite, see the recovery key
once, and the app saves an encrypted copy when it opens. Device approval, the
device list, restoring an older version and deleting everything are all in.
Read-only on secondary devices is enforced by `owner_device`.

`tools/live-check.mjs` walks the whole chain against the real server and cleans
up after itself. It is not part of `node --test`, because it needs the network
and consumes an invite code. What it proves, that no offline test can:

    signed in without an invite, upload         DENIED
    invite redeemed, profile appears            ok
    upload, then the same version again         STALE
    download and decrypt                        byte-identical
    open with the recovery key alone            ok
    wrong verifier / right verifier             RECOVERY_WRONG / takes over
    sign out, sign in, download again           ok
    delete everything                           nothing left

The shape, decided with the person who has to live with it:

- **One account per person, on their own phone.** Not profiles on a shared device.
- **One writer, many readers.** A second device can look at the data; only the
  main device uploads. That removes conflict resolution entirely, which is the
  part of sync that takes a project rather than a feature. The `(user_id,
  version)` primary key enforces it: a device that has been offline uploads a
  version the server already has, gets a duplicate-key error, and has to pull
  before it can push.
- **End to end encrypted.** The server holds ciphertext, public keys, sizes and
  timestamps. It never sees a key. If the whole database leaked, the honest
  damage is a list of email addresses and the knowledge that those people back
  up a fitness app.
- **The login password is not the encryption key.** It authenticates to the
  server and nothing else, so someone who learns it can fetch the ciphertext and
  get nowhere. That is what makes the device-approval step meaningful rather
  than decorative: the password gets you the box, an approved device or the
  recovery key gets you the lid.
- **Approving a device needs no push.** A new phone leaves a request with its
  public key; the main device sees it the next time it is opened, and approving
  wraps the data key against the newcomer's key over ECDH. No background
  anything, which suits an iOS home-screen app that has none.
- **Off until explicitly turned on**, with the consent and its wording version
  recorded on the profile row rather than assumed.

**A restore must not wipe the device keys.** `keys` is the one object store a
restore leaves alone, and there is a test pinning that. It holds this device's
keypair and the id the server knows it by, which are properties of the phone and
appear in no backup. Clearing it turned "restore from the cloud" into "lock this
device out of the cloud": the device came back a stranger and could no longer
unwrap the data key it had just used to read the download. Found by looking at
the screen after a restore and noticing it claimed to be read-only.

**The recovery key is not optional.** Without it the design has a hole exactly
where the point is: if only the main device holds the key and the main device is
gone, the backup on the server can never be opened, and there is nobody left to
approve a replacement. The server cannot help, because it knows nothing. So the
app generates 128 random bits at signup, shows them once, and they can both
decrypt the backup and install a new main device. Hex, so no character can be
misread off a piece of paper months later.

Making a new device the main one is a change to a row, so the server has to be
convinced of something it cannot check. It stores a hash of the recovery key
against a separate salt and compares that. A verifier is not a key: it decrypts
nothing, and reversing it means guessing the 128 bits.

Compress, then encrypt, always. Ciphertext does not compress, so the other order
uploads the full size for nothing. On a real backup that is 1,237 KB down to
164 KB, 30 ms to seal.

**What none of this changes: he is the controller.** Holding other people's
training, bodyweight and food data makes that true whatever the encryption does,
and bodyweight and intake are plausibly health data under Art. 9. Encryption
shrinks the consequences of a breach to almost nothing and satisfies data
minimisation; it does not remove the duty to obtain consent, to delete on
request, or to answer for the thing. Invite codes keep the group to people he
actually knows, which is what makes those duties practical rather than
theoretical.

### The showcase backup

`showcase-backup.json` in the repo root is half a year of plausible training and
four months of food, for demoing the app without handing over your own log.
Regenerate it with:

```bash
node tools/build_showcase.mjs > showcase-backup.json
```

Load it the same way as any backup: **⚙ → Restore from backup**. On a phone,
open the raw file from GitHub, save it to Files, then pick it in the restore
dialog. **It replaces everything on the device**, so export your own data first
if the device has any.

Two things about how it is built. The records come from `js/models.js`, not from
JSON written by hand — otherwise the demo drifts out of shape the first time a
field is added, and drifts *silently*, because the store reads fields rather than
validating them. And the numbers have to hold together arithmetically: every
figure on screen is derived, so a food log that averages 1,500 kcal for someone
gaining weight produces a 1,984 kcal maintenance estimate and a calorie target
built on top of it. The first draft did exactly that. The generator prints a
summary to stderr for this reason, and it is worth reading before trusting the
file.

It is deliberately not a "load demo data" button in Settings. Importing replaces
everything, and a button that erases a training log would sit in the app forever
for the sake of a demo given twice.

**On eviction, precisely.** An installed home-screen web app is *not* subject to
Safari's seven-day cap on script-writable storage: it has its own usage counter
and a browser-sized quota. It can still be evicted under real storage pressure,
which is what `navigator.storage.persist()` on boot asks to prevent — Settings
reports whether iOS granted it. What none of that protects against is deleting
the app, losing the phone, or a restore going wrong, so the export still matters.
Saying "Safari will wipe this" when it will not just teaches you to ignore the
warnings that do matter.

---

## How it's put together

| Path | What it does |
|---|---|
| `index.html` | App shell — top bar, screen host, tab bar, sheet, rest timer |
| `js/app.js` | Bootstrap and hash router (`#/home`, `#/progress/<exerciseId>`) |
| `js/standards.js` | Strength standards tables and the rating engine |
| `js/rank-art.js` | The nine rank badges, and the rank-up celebration |
| `js/bodymap.js` | Loads the body SVGs and colours regions by tier |
| `assets/body-*.svg` | GENERATED muscle map art — rebuild, don't hand-edit |
| `tools/build_bodymap.py` | Regenerates the body map from body-muscles |
| `NOTICE` | Third-party attributions (Apache-2.0 / CC BY-SA require these) |
| `js/db.js` | Promise wrapper over IndexedDB |
| `js/models.js` | Data model, seed exercise library, and the derived-stat maths |
| `js/store.js` | In-memory state, actions, persistence, subscribe/notify |
| `js/charts.js` | SVG line/bar/heatmap primitives with crosshair tooltips |
| `js/ui.js` | DOM helpers, formatting, bottom sheet, toasts |
| `js/i18n.js` | Interface language: lookup, plurals, static-markup pass |
| `js/strings.js` | Every interface string, German and English side by side |
| `js/pickers.js` | Exercise picker and create/edit form |
| `js/screens/*.js` | One module per tab, plus the settings sheet |
| `sw.js` | Offline precache — **add new modules to `SHELL`** |
| `tools/make_icons.py` | Regenerates the app icons |
| `tools/devserver.py` | No-cache dev server |
| `tools/build_showcase.mjs` | Generates `showcase-backup.json`, the demo dataset |
| `tools/live-check.mjs` | Runs the whole cloud chain against the real project |
| `tests/maths.test.js` | `node --test` over the DOM-free maths — dev only, never served |
| `tests/i18n.test.js` | Key parity, placeholder parity, dead keys, house style |
| `tests/crypto.test.js` | Sealing, the recovery key, device linking |
| `tools/build_library.py` | Regenerates `js/exercise-library.js` from free-exercise-db |
| `js/exercise-library.js` | GENERATED catalogue — don't hand-edit |
| `js/evidence.js` | The papers and thresholds both star ratings are built on |
| `js/exercise-science.js` | Curated length-bias / limiting-factor rules per movement |
| `js/exercise-rating.js` | 1–5 star exercise rating |
| `js/plan-rating.js` | 1–5 star plan rating |
| `js/rating-ui.js` | Shared rating cards, breakdown sheets and source lists |
| `js/log-analysis.js` | What you actually trained, counted the way a plan is |
| `js/plan-doctor.js` | Turns rating complaints into one-tap plan edits |
| `js/swaps.js` | "Same muscle, better position" alternatives |
| `js/history.js` | Strength, tonnage and per-lift trends over time |
| `js/timeline.js` | Eating and training on one set of week buckets |
| `js/crypto.js` | End-to-end encryption for the cloud backup |
| `js/cloud.js` | Talking to Supabase over plain fetch, errors normalised |
| `js/cloud-config.js` | Project URL and anon key, both public on purpose |
| `js/demo.js` | Whether this build is the public preview; always `false` in the repo |
| `.github/workflows/test.yml` | Both test suites on every push and pull request |
| `.github/workflows/pages.yml` | Publishes the public preview to GitHub Pages |
| `tools/preview-sw.js` | The preview's service worker: clears the old app, serves nothing |
| `js/sync.js` | Store plus crypto plus cloud: the only place the three meet |
| `js/screens/account.js` | Sign-up, consent, recovery key, devices, restore |
| `js/screens/gate.js` | The invite gate, asked once per device |
| `server/schema.sql` | The entire server side: tables, access rules, two functions |
| `server/patch-002-device-capabilities.sql` | Required cloud hardening migration; apply before the matching client is deployed |
| `server/patch-003-revocable-access.sql` | Separates one-time invites from revocable ongoing access |
| `server/patch-004-repair-invite-claims.sql` | Repairs partial invite activations and makes claims self-contained |
| `server/patch-005-fix-access-policy-permission.sql` | Lets authenticated RLS policies execute their access check |
| `server/patch-006-unblock-devices.sql` | Lets the main device securely restore a deliberately blocked device |
| `js/nutrition.js` | Targets, daily totals, energy split, maintenance calories |
| `js/foodlookup.js` | Open Food Facts barcode lookup — the only networked module |
| `js/foodsearch.js` | Searching the bundled library and scaling an entry to a portion |
| `js/food-library.js` | GENERATED generic foods from USDA FDC — don't hand-edit |
| `js/brand-library.js` | GENERATED branded products from Open Food Facts (ODbL) |
| `tools/build_brands.py` | Regenerates it — read its licence note first |
| `tools/build_foods.py` | Regenerates it from the USDA bulk CSV |
| `js/schedule.js` | Which plan day belongs to which weekday |
| `js/plan-share.js` | Encode/decode a plan into a link — no server involved |
| `js/plates.js` | What to load per side, and when a weight cannot be reached |
| `js/warmup.js` | A warm-up ramp, from the two trials that tested one |
| `js/progression.js` | What to put on the bar next, and what to put on for the next set |
| `js/fatigue.js` | Whether lifts are still gaining — facts only, no prescription |
| `js/canvas-kit.js` | Canvas text/shape helpers and an SVG-path-to-Path2D loader |
| `js/week-card.js` | One week assembled and drawn as a shareable PNG |
| `js/week-share.js` | The sheet that builds the card and hands it to the share sheet |

### The body map

`assets/body-front.svg` and `assets/body-back.svg` are **generated** from
[body-muscles](https://github.com/vulovix/body-muscles) (Apache-2.0) by
`tools/build_bodymap.py`. That project's ~90 fine-grained muscles are collapsed
onto the 15 regions the rating engine scores. Rebuild with:

```bash
curl -sL -o /tmp/mf.ts https://raw.githubusercontent.com/vulovix/body-muscles/main/src/data/muscles.front.ts
curl -sL -o /tmp/mb.ts https://raw.githubusercontent.com/vulovix/body-muscles/main/src/data/muscles.back.ts
python3 tools/build_bodymap.py
```

To swap in different artwork entirely, keep the contract:

- both files share one coordinate space (currently `0 0 35 93` front,
  `37 0 35 93` back); if you change it, rescale the `stroke-width` values in
  `.bodymap` — they are in user units, not pixels
- every muscle shape carries `class="muscle"` and `data-region="<key>"`
- valid keys: `chest`, `delts-front`, `delts-rear`, `traps`, `lats`, `biceps`,
  `triceps`, `forearms`, `abs`, `obliques`, `lower-back`, `glutes`, `quads`,
  `hamstrings`, `calves`
- non-muscle anatomy (head, hands, feet) uses `class="body-base"`
- **do not set `fill` on `.muscle` shapes** — the app colours them by rating
- left/right can be one path per group or two; both are coloured identically

### Three things to know before editing

**Adding a new JS module?** Add it to the `SHELL` array in `sw.js`, or the app
breaks offline while working fine online — the failure won't show up in normal
testing.

**Writing a user-facing string?** It goes in `js/strings.js`, in both languages,
and the code says `t('some.key')`. Never write the sentence at the call site.
`tests/i18n.test.js` fails on a key that exists in one language only, on
placeholders that differ between the two, on a `t()` key nobody defined, and on a
key nobody says. It also enforces the house style: no em dashes, because they
read as a stall mid-sentence on a phone.

**Repairing stored records?** Bump `DATA_VERSION` in `models.js` and add a branch
to `migrate()` in `store.js` — not `LIBRARY_VERSION`. They are separate because a
data fix has to run even when the catalogue hasn't changed, and the catalogue
top-up only ever repairs rows it can match against the bundled seed by name,
which a user's own exercise never will.

**The service worker precaches with `cache: 'reload'`.** A plain `cache.add()` can
satisfy itself from the browser's HTTP cache, pinning a stale build into the
precache and serving it long after a deploy. Don't remove that flag.

**Keystroke handlers don't re-render.** Weight and rep inputs mutate the session
object and call `store.saveSessionQuiet()`, which persists without notifying
subscribers. Calling `store.updateSession()` on every keystroke would re-render the
screen and destroy the focused input mid-typing.

**Changing the database schema?** That's `DB_VERSION` in `db.js`, which is a
different lever from the two above — it controls object stores, not the records
inside them. It has been bumped once, to drop `routines` (v4).

**Adding derived maths?** Put it where it can be tested — a module under `js/`
that touches no DOM — and add a case to `tests/maths.test.js`. Every silent bug
this app has had came from two screens computing the same number their own way,
or from date arithmetic that only breaks twice a year.

### How the rating works

Your best estimated 1RM per lift is compared against published strength
standards, normalised by **bodyweight, sex and age**. Each lift lands on a 0–100
score, and the score maps onto a ladder of **twelve ranks with three divisions
each** — 36 steps from Bronze III to Radiant I.

The ranks are named like a game and calibrated like a standard. `BOUNDS` still
holds the same four published bodyweight multiples it always did, and `ladder()`
turns them into the eight rank boundaries by inserting geometric midpoints:

| Rank | Anchor |
| --- | --- |
| Silver | just over half the novice standard |
| Gold | published **Novice** |
| Platinum | between novice and intermediate |
| Diamond | published **Intermediate** |
| Master | between intermediate and advanced |
| Grandmaster | published **Advanced** |
| Elite | between advanced and elite |
| Legend | published **Elite** |
| Challenger | elite × 1.10 |
| Immortal | elite × 1.22 |
| Radiant | elite × 1.38 |

That shape exists because the old five-tier version put Elite at the fourth of
four boundaries: a reasonably strong lifter arrived at the top name in the app
and had nowhere left to go for the rest of their training life.

The last three are the one genuinely **extrapolated** part of the ladder, and
they live in their own table (`BEYOND_ELITE`, `EXTRAPOLATED_TIERS`) so that
stays visible. Above the elite standard there is no table left, only
competition, and the territory is real: the elite standard is a strong regional
competitor, not the top of the sport. At 80 kg bodyweight, Radiant is a 248 kg
bench, a 331 kg squat and a 375 kg deadlift, which is national-record
neighbourhood. Their rank notes say as much on screen.

A muscle region's score is the best `lift score × how strongly that lift trains
it` across the lifts you actually perform — taking the max, so skipping one lift
doesn't drag a region down. A region you never train stays **unrated** rather
than scoring zero.

**And the contribution weight gates rather than scales.** That second number is
how much a lift *stimulates* a region — a squat trains hamstrings at 0.35 — and
it was being multiplied into the score as though it were a strength discount. A
lifter whose only trapezius evidence was a T-bar row saw "Diamond II", computed
as `row rank × 0.7`. That is not a weak trapezius, it is a row.

At or above `DIRECT_CONTRIBUTION` the lift is a primary or near-primary driver
and the region takes its rank **whole**: if your incline press is Grandmaster,
your chest is Grandmaster, not 95% of Grandmaster. Below it there is no rank at
all — the region is reported as *touched* by name, painted slate grey, and the
sheet says why. The map therefore has three states rather than two: ranked,
reached-but-unmeasurable, and untouched.

**The gate exposed a second problem: the weights themselves were describing the
wrong exercise.** Every row read `lats: 1, traps: 0.65`, which describes a
pulldown. A chest-supported T-bar row is an upper-back movement — the pad takes
the torso out, which is exactly what lets the mid-back do the work — and the
result was that 22 movements reached the trapezius and **not one could rank it**.
Rows now drive the mid-back at 1.0, high rows drive the rear delts at 0.85, a
squat drives the glutes at 0.85, and a cable Y-raise is a rear-delt movement
rather than a front-delt one. Obliques had *nothing* that could rank them at
all; the catalogue's rotation and side-flexion patterns now do. A test asserts
every one of the sixteen regions has at least one movement that can rank it.

**A region's rank is the best driver, not an average of them, and the
corroboration rides alongside.** Averaging the movements that train a muscle
punishes having several: somebody who benches heavy and also does two light
accessory flies would rank below somebody who only benches, which contradicts
both the plan rating (it rewards two movements per muscle) and common sense,
because their chest can still bench what it benches. The single-movement failure
mode averaging is meant to guard against is already handled by the outlier
check. So the number stays the best demonstration, and `drivers` and `spread`
carry what a mean would have smuggled in: on one real log the well-covered
regions agreed to within half a rank across three movements each, while quads
came out 1.3 ranks apart between a squat and a leg extension. The region sheet
says which of those three situations it is. A test asserts adding a movement can
never lower a region.

**And a grey muscle now says what would open it.** `canRank` resolves through the
alias so the suggestion is phrased in the names the user's own library uses:
telling somebody to do a "Cable Oblique Twist" is useless advice about an
exercise they cannot find, when their catalogue calls it Cable Russian Twists.
Strongest driver first, shortest name to break ties, because leading with "Bosu
Ball Cable Crunch With Side Bends" makes a good idea sound ridiculous.

This took two passes to get right, which is worth recording. Removing these
regions from the *average* fixed the overall (one real lifter went from Diamond
back to Grandmaster, matching every one of their individual lift ranks) but left
the discounted number printed on the map and in the region sheet. The internal
score that picks the best touching lift is now deleted before the rating is
returned, because a number reachable from outside is a number that ends up on a
screen.

**The 0–100 score is no longer shown anywhere as a headline.** It read as a
percentage, and a percentage whose top means "beyond a national record in every
muscle group" has an upper half nobody will ever see: it made a perfectly good
Grandmaster feel like a fail mark. Home, the shared card and the friends
leaderboard all show the rank instead, and the strength chart labels its axis
with rank names. The number still exists, still sorts the leaderboard and is
still what the chart is drawn from. It is simply not the thing shouted at
somebody who opened the app to feel good about training.

**Machines are ranked too, and count fully.** They used to be scored off seven
very broad category bands and then discounted to 0.65 on the body map, which was
wrong twice over: the bands were far too soft, and the rank they produced was
then treated as not worth counting. `MACHINE_ANCHOR` replaces them with a ratio
to the barbell lift each machine mirrors — a seated chest press is bench × 0.95,
a machine shoulder press is overhead press × 1.15, a leg extension is squat ×
0.80 — so the standard is as strict as the one it derives from and can count at
full weight. Cables are ranked on the same footing; a stack is a stack whichever
side of the frame the pulley is bolted to. A machine with no anchor falls back
to a category band, and that fallback asks which half of the body the name
belongs to before giving up: an unrecognised leg machine used to land on the
triceps band, which made it far easier to rank than a recognised one. Where a
barbell lift and a machine land a region on the same number, **the published
standard wins the tie**.

**When one lift stands ranks clear of the rest, the app asks about it.** The
symptom is always the same shape: a machine several ranks above everything else
the same person trains. The causes are mundane — the display shows the total
stack while each arm moves half of it, a plate-loaded frame logged as the sum of
both sides, a stack marked in pounds typed in as kilograms — and all three
produce a number that is right for the machine and wrong for the standard.

`buildRating` compares each lift against the **median of the others** (so one
genuinely strong movement cannot hide behind itself) and flags anything two
whole ranks clear, provided there are at least three other rated lifts to
compare with. Where the user has said what the machine's stack tops out at, it
can be blunter: "that is 1.7 times a full stack" is evidence rather than a
hunch.

It is a question, never a correction, and it can be switched off entirely
(`outlierHints`). Switching it off hides the notice and nothing else: the
detection still runs and the rank does not move, because a rank that changed
because somebody silenced a hint would be a worse lie than the one the hint was
about. The app does not know which of those causes it is looking at, or whether
somebody simply has freakish side delts, so it offers the fix and lets the
lifter apply it. The fix is a `loadFactor` on that
exercise, and it changes **how the number is read, not the log**: halving a
recorded set would rewrite what somebody actually did and make their own history
disagree with their memory. Halving the interpretation changes only the
comparison against a standard, which is the part that was wrong.

Both the machine-setup sheet on Train and the correction sheet on Home write
`machineSetups[exerciseId]`, so both spread the existing record rather than
rebuilding it from their own fields. A test asserts that, because the first
version of the second sheet silently deleted the first one's work.

**The machine anchors are calibrated against real stack maxima.** A training
standard cannot answer what it *means* to max out a particular frame; a stack
maximum can. Measured against one real gym's fourteen machines, the rule fitted
was **Legend ≈ a full stack taken for about ten repetitions**, which is where
the one movement with both a published standard and a known stack already sat (a
105 kg pulldown stack against a Legend of 138 kg). The machines were fitted to
agree with it, and a test checks all fourteen still land there.

The consequence is deliberate: on an isolation machine the three ranks above
Legend are out of reach, because a commercial stack cannot express
national-record strength. That is the honest answer, and it is what fixed the
case this was found through — a lateral raise machine handing out the top rank
at well under a full stack.

**Everything in `standards.js` is kilograms, and the app is not.** The published
standards are bodyweight multiples against a 60 or 80 kg reference, and the
allometric exponent means the arithmetic does not cancel out: fed pounds, it
inflates. The same lifter came out a rank and a half stronger in pounds than in
kilograms, silently, for as long as the units setting has existed. The ratio is
now computed in kilograms whatever the app displays, and anything handed back
for a screen is converted on the way out.

**The fallback bands have to stay in step with the anchors.** When the anchored
isolation machines were tightened, `MACHINE_BOUNDS` was left behind, so
`upperIsolation` asked for a Legend of 85 kg where every *recognised* isolation
machine asked 110 to 175. The 63 library movements with no anchor became the
softest route to a rank in the app: a full cable tower on a wrist curl came out
Radiant. There is a test asserting an unrecognised machine is never easier than
a recognised one, and `machineCategory` now checks for squat, deadlift and shrug
patterns before it gives up — a Smith machine deadlift landing in the triceps
band is not a rounding error, it is three ranks.

**A plate-loaded bar is not a stack.** A chest-supported T-bar row is a barbell
with a pad, and the number logged is plates. That matters three times over: the
full-stack calibration rule has nothing to say about it, the "count half of it"
correction is about a display showing both sides at once, and on the body map it
should win a tie the way a barbell does, because it is one. `PLATE_LOADED` marks
them. It also has to make them *rankable at all* — several are tagged `Barbell`
in the catalogue, which kept them out of `RATED_EQUIPMENT` entirely, so a
plate-loaded T-bar row produced no rank whatsoever.

**Two name spaces had drifted apart.** The curated tables were written against
the seed list; the bundled catalogue calls many of the same machines something
else ("Ab Crunch Machine" for Machine Crunch, four spellings of a triceps
pushdown). An exercise with no curated entry was ranked off the coarse category
bands *and contributed to no muscle region at all* — 52 machine and cable
movements were invisible on the body map while still producing a rank, which is
how an ab machine could be trained for months without the abs ever lighting up.
`ALIAS` maps the catalogue's names onto the curated ones, and `buildRating`
falls back to the exercise's own primary and secondary regions for anything left
over. Those regions come from the library record, not from guessing at a name.

**A rank is only built from sets a 1RM estimate is valid for.** Prediction
equations are validated to about ten repetitions and their error grows past it,
worst of all on light isolation work (`SOURCES.ribeiro1rm2024` finds every
equation missing significantly on the arm curl; the 2026 fit over 303,494 sets
finds the conversion depends on the load, not only the reps). So
`bestOneRepMaxByName` prefers sets inside `THRESHOLDS.e1rmWindow` (1–12 reps).
A lift trained *only* above it still gets a rank — a blank would be worse than a
caveat — but it is marked `extrapolated`, counts at 0.85 on the muscle map, and
says so on the lift and in the region sheet.

**A rank is an all-time record, and says how old it is.** Taking a record away
because it is old would delete something that was earned, so
`bestOneRepMaxByName` still takes the maximum over the whole log. But a set from
three years ago printed as "your strength" is its own kind of lie, so the date
rides along on the map's `achievedAt` property, and anything older than six
months is labelled "best from N months ago" on the lift with the reasoning in
its sheet.

**Where a rank sits among everyone else** is the one number in this app that
measures the population using it rather than consulting a table somebody else
assembled. `server/patch-016` stores a 0-100 score per user per metric
(`overall`, `lift:<name>`, `region:<id>`) and returns a count, four percentiles
and a share-below. What that shape rules out is the point:

- No leaderboard, no ordering, no identity. There is no call that returns a row,
  a user id or a name, and the raw table is unreachable from the app role.
- No weights and no repetitions. A score is already normalised for bodyweight,
  sex and age, so it carries far less about a person than "142.5 kg" does. No
  sex column either: splitting again would halve every sample for nothing.
- Only benchmark lift names leave the device. A custom exercise would be a
  population of one, and its name would be the identifying part of it.
- Nothing comes back until **ten other people** have logged the same metric, and
  the asker's own row is excluded from their own percentile.
- Contributing is what buys the answer. There is no read-only path, so nobody is
  measured against a population they declined to join, and switching the setting
  off calls `forget_rank_scores`, which deletes rather than pauses.

**The badges are drawn, not downloaded.** `js/rank-art.js`. The sets worth
having (game-icons.net under CC BY 3.0, the Noun Project, Flaticon, Vecteezy)
are all usable with attribution, and this app already has the machinery for
that. The reason none of them is used is not the licence: none of them is a
*ladder*. A bronze medal from one set, a diamond from another and a crown from
a third share no silhouette, stroke weight or optical size, and the whole point
of twenty-seven steps is that the badges read as one family that escalates.
Nine unrelated icons would look like clip art in a row.

So there is one shield, and it earns things: a stud, then chevrons, then a cut
gem, then stars, then wings, then a crown. Every part is filled with
`var(--tier)`, so the artwork inherits the colour ramp instead of fighting it,
it draws at any size from a chip to a full-screen celebration, it costs nothing
over the wire, and there is no third party to credit or to outlive. A test
asserts the ladder only ever gains: no rank may lose an embellishment the rank
below it had.

**The bar under the score is one segment per rank**, not one per step. At nine
ranks the old strip was 27 notches and already thin; at twelve it would be 36
slivers three pixels wide, which is a texture and not a scale. The division
lives in the partial fill of the current segment instead, and the two badges on
either side — the rank held and the rank being worked towards — are what make it
read as a ladder rather than a progress bar.

**The muscle-map legend is a scale, not a list.** It used to be one chip per
rank, which at nine already wrapped onto two rows of abbreviations and truncated
several of them into nonsense in German. Twelve is unreadable in any language,
and the abbreviations answered the wrong question anyway: nobody reads a legend
to learn that "GM" means Grandmaster, they read it to learn which end is which.
So it is drawn as what it is — an ordinal ramp with its two ends named and
badged. The full scale with every rank and its point range is one tap away on
any muscle. The shared week card does the same thing on canvas.

**Ranking up is a moment, and it happens once.** The rating is rebuilt from the
whole log on every render, so there is no event to hang a celebration on. The
stored `lastSeenRankStep` is the event: the computed step can overtake it
exactly once. A device that has never stored one gets nothing, or every
existing user would be congratulated on first launch for work they did months
ago — and that check has to be `seen === null`, because `Number(null)` is 0 and
finite. A drop stores silently; being told you went down is the banner's job
and it says it more quietly. Under `prefers-reduced-motion` the rays and every
animation are dropped and the badge and the words remain, because the
decoration is the part that is safe to lose.

**The ladder reports a drop as plainly as a climb.** `recentRankChange` compares
against where you stood eight weeks ago in both directions. A demotion is
usually bodyweight moving rather than a verdict on the lifter, so it is stated in
neutral ink with that sentence attached, never in the red the app keeps for
things that went wrong.

Two deliberate limits, and two caveats:

- **Height is not an input.** No published standard normalises by it. It affects
  leverages, but including it would be invented precision.
- **Assisted machines are never ranked.** The number on the stack is how much of
  you the machine is carrying, so ranking it would invert the ladder for anyone
  who uses one. `UNRATEABLE` holds those.
- The machine factors are gym-floor consensus, not measurements, and they cannot
  be: lever arms and stack ratios differ between manufacturers. That is exactly
  what the same-model community percentiles are blended into once any exist.
- `LOW_CONFIDENCE` flags the one benchmark shakier than the rest — leg press —
  and the caveat travels with the rank wherever it's shown.

The numbers are an approximate consensus of commonly published standards — a
yardstick, not a measurement. Ratings can be switched off entirely in Settings.

### How the star ratings work

Separate from the strength rating: every **exercise** and every **plan** carries a
1–5 star score for muscle growth. `js/evidence.js` holds the papers and the
thresholds taken from them, and every threshold used anywhere in the app points
back at an entry there, so a rating can always show its source.

**Plans** are scored on weekly volume (35%), coverage (15%), session size (15%),
exercise selection (15%), variety (10%) and frequency (10%). Two of those weights
are deliberately unfashionable:

- **There is no volume ceiling.** Meta-regression finds growth still rising at the
  top of the studied range, so high volume gets an advisory note about recovery,
  never a deduction. The old rating docked plans past 26 sets per muscle per week;
  nothing supports that.
- **Frequency is only 10%.** At equal weekly volume its own effect on hypertrophy
  is negligible. It earns its 10% as the lever that keeps any single session under
  ~11 fractional sets for one muscle, which is where extra sets stop paying.

A set counts fully for the muscles it primarily trains and as half a set for the
secondary ones — the fractional convention that predicted the meta-analytic
results best.

**Exercises** are scored on muscle length under load (0–3), whether the target
muscle is what fails (0–2), how finely the movement loads (0–2), muscle covered
per set (0–1.5) and whether published standards exist (0–0.5). Equipment is
deliberately *not* a growth criterion — machines and free weights build the same
muscle at matched volume and effort, so equipment only affects how measurable your
progression is.

Two things this is not:

- **Not a measured ranking.** No study compares 900 exercises head to head, and
  the EMG numbers usually quoted for this predict growth badly. Every point comes
  from a property of the movement, not from a trial of it.
- **Not complete.** Where a movement loads the muscle is a curated call in
  `js/exercise-science.js`; about a third of the catalogue matches no rule and is
  scored neutrally and labelled "not classified" rather than guessed at.

Evidence last reviewed July 2026. When you revisit it, update `SOURCES` and
`THRESHOLDS` in `js/evidence.js` together — the raters read the thresholds, the UI
reads the sources, and they are meant to stay in step.

### Effort, and why RIR is optional

Every set can carry a **reps-in-reserve** number. It is optional on purpose: a
blank means "unknown", never "easy", and no rating punishes one. A required
field here would get filled in with noise, and noise about effort is worse than
silence — the whole 2026 evidence base is effort-based rather than load-based,
so a fabricated RIR would corrupt the one input that matters most.

RIR feeds two things: the effort line on Home ("38 of 44 sets have an RIR, 61% of
those at 0–2"), and the progression engine below.

### What to put on the bar next

`js/progression.js`. The old version of this was one function on the training
screen asking a single question: did *every* set last time clear the top of the
rep range? That rule is wrong in both directions at once. It refuses a weight
increase because set four dropped to seven reps — which is what set four is for
— and it has no idea whether the last session was your first exercise of the day
or your fifth. Two lifters with identical logs, one benching fresh and one
benching after nine sets of chest work, got the same advice.

What replaced it:

- **The first working set decides**, and it decides on its own weight. Later
  sets fall off for reasons that say nothing about whether the weight was right,
  so they inform the within-session advice and never the between-session one.
  `openingWeight` is the load the exercise opened on, which is not the same as
  `topWeight`: plenty of people ramp across their working sets, and judging the
  reps of set one against the load of set three was wrong by two increments
  every session.
- **Effort counts toward clearing.** Seven reps with three in reserve is a set of
  ten that stopped early. A blank RIR is *unknown*, not "taken to failure", so
  the `assumedRir` setting says what an empty field is worth (default 1, capped
  at 4). It matters most for people who switch the column off entirely: for them
  every set is blank, and reading blank as failure made every suggestion too
  light. The engine names which it used, and **only the suggestions read it**.
  Records, ranks and charts stay on what was actually written down.
- **Session order is corrected out.** `priorWork` counts the sets standing
  between the start of a session and this exercise, weighted by how much muscle
  they share; `readiness` turns that into the share of fresh strength left.
  Every past session is divided by its own readiness, so a lift that moved from
  first to fifth is compared on the same footing rather than read as a
  regression. The training screen names the shift on the last-time line, because
  a correction nobody can see looks like a bug.
- **A trend, not a verdict on one session.** Three sessions minimum, fitted on
  the order-corrected estimates, projected forward and capped at 5% above what
  was actually done.
- **A live number once the session starts.** After the first set is ticked, the
  advice for the next one comes from today's own effort and the lifter's *own*
  measured set-to-set drop-off, and it lands on the set it is about. It only
  suggests a weight drop when a drop actually buys reps back — demanding that
  every set stay inside the range is the exact mistake described above, and
  repeating it four inches lower down the screen would be no better.

Whatever advice is current becomes the empty field's meaning: ticking a set
without typing logs the number the screen just recommended, or the suggestion is
decoration. On a movement logged one side at a time the number is labelled
**per side**, because without those two words it reads as double the weight.

**Every suggested weight can be made on the equipment it names.** A barbell goes
through `platePlan`, so 101 kg is never printed. A machine goes through its own
increment: the setup sheet takes a **stack increment** per exercise, saved with
the seat and pad numbers because it is a fact about one frame in one gym rather
than a preference. Without it the app assumed 2.5 kg everywhere and asked stacks
that move in fives for 102.5.

**The order cost is pooled when one exercise cannot measure its own.**
`observedOrderCost` needs a lift to have been trained from genuinely different
positions, which for a bench that is always first never happens however long the
log gets. `pooledOrderCost` divides each exercise's estimates by that exercise's
own mean — so a 140 kg squat and a 20 kg lateral raise contribute the same shape
rather than the squat drowning out the raise — and runs the same split across
everything at once. Own measurement first, pooled second, prior last.

Two constants are priors rather than findings and are marked as such in the
source: the per-set fatigue cost of preceding work, and the set-to-set decay.
Both are replaced by the lifter's own numbers as soon as the log carries enough
of them — `observedOrderCost` needs real spread across sessions before it will
answer, `setDecay` needs three.

The between-session rule is still double progression at heart. That is a way to
turn "train close to failure" into a decision on the gym floor, not a research
finding, and it says so.

### Why five tabs, and which five

Home, Train, Food, Plans, Library. A sixth was tried when Food was added, with
Calendar keeping its slot — and the tab pushed to the far edge stopped being
seen at all: the calendar was reported missing within a day of shipping it.

So the slots go to what gets opened *during* something — a session, a meal —
and the two weekly reads, Calendar and Progress, live at the foot of Home as
labelled cards. Not links tucked into a section head, which is what "All ›"
was and is exactly how the calendar disappeared.

The nutrition summary that used to sit on Home went with it. Once Food is a tap
away there is no reason to render the same protein figure twice, and the setting
that hid that card went too — it had nothing left to control.

### Searching for a food

Two different problems, solved two different ways.

**Branded products** go through the barcode. That path is a live query to Open
Food Facts and stays that way — one request per scan, nothing bundled, so no
derived database and no ODbL share-alike.

**Generic foods** — chicken breast, oats, olive oil — ship with the app: 194
entries from USDA FoodData Central, generated by `tools/build_foods.py`. Two
reasons, in this order.

*Licensing.* FDC is a work of the US federal government and therefore public
domain, so it can simply be redistributed. A bundled dump of Open Food Facts
could not be.

*CORS, and something worse.* Open Food Facts cannot be searched by name from a
browser at all. `search.openfoodfacts.org` sends no `access-control-allow-origin`
header, so the request never leaves — verified against the barcode endpoint,
which does send it and does still work. And `api/v2/search` accepts a
`search_terms` parameter, returns HTTP 200, and **ignores it**: the reply is the
whole database, 4.6 million rows, in arbitrary order. A search box wired to that
would have looked like it worked and returned nonsense.

**Branded products** ship too — 531 of them, sold in Germany, extracted from Open
Food Facts by `tools/build_brands.py`. That is a different licensing situation
and it is handled rather than ignored: extracting a subset makes a *derived
database*, so ODbL share-alike applies. `js/brand-library.js` is therefore
licensed ODbL v1.0, Open Food Facts is credited wherever those entries appear,
and NOTICE spells out what a redistributor has to do. The app's own source code
is unaffected — ODbL covers the database, not the program reading it. No product
images are included; those are CC BY-SA and separately licensed.

Search results keep the two apart, and the labels say why: **generic ·
measured** was analysed in a lab, **branded · as labelled** is what a
contributor typed off a packet. Generic entries rank first when both could
answer. A branded entry keeps its barcode when you add it, so scanning that
packet later answers from your own list.

Bundling also means search works with no network, which is a side effect rather
than the reason — the reason is that the alternative does not exist.

The generator matches its staples list against the dataset by **whole word**,
not substring. That is not tidiness: a substring match put "Buckwheat groats"
under *Oats* — shortest-description-wins then made it confident — and nothing
downstream would ever have caught it.

### Micronutrients, and how thin they are

**More** on the food tab opens every nutrient in `NUTRIENTS`, summed for the
day. Each row carries how many of the day's items had no value for it, and a row
where nothing did says "not recorded" rather than printing a zero.

That caveat is the whole feature, because coverage is genuinely poor. A food you
typed in yourself carries only what you entered. A barcode record carries what
the manufacturer submitted, which for micronutrients is usually nothing. Only
the bundled library is complete, because USDA measures. So most of that list
stays empty until meals are built from the library, and the sheet says so
instead of implying a well-rounded day.

There are no percentages of a daily requirement anywhere in it. Reference values
differ by sex, age and country, and dressing a partially-known total as "37% of
your iron" would be inventing precision twice over.

### What the food tab will and will not claim

Protein and calories carry the claims: protein has a defensible hypertrophy
number (as a band — see above), and calories decide whether you gain or lose.
Carbs, fat, fibre and water are **recorded and shown without one**. Carbs and
fat appear only as the split of a day's energy, never as a target, because no
macro ratio has an evidence base worth printing — past protein, "40/30/30" is
folklore with a decimal point. Fibre and water get a reference line, a source
and a caveat, and neither is ever scored against training.

**Unrecorded is not zero.** A food typed off a label that only lists protein has
`null` carbs, not `0`. Summing those as zero would make a day look *lower* in
carbs the more incompletely it was logged, which is precisely backwards. So
`dayTotals` counts the gaps, and the energy split refuses to draw itself while
any item is missing carbs or fat — a bar with a third of the day absent is a
picture of the logging, not of the eating. The card says which items are missing
what instead.

### Maintenance calories, measured rather than predicted

Every other tracker computes this from Mifflin-St Jeor and an activity
multiplier off a dropdown: a population average wearing your name, where the
biggest term in the equation is a guess you are asked to make about your own
life before you have any data.

This one subtracts the energy your weight change accounts for from the energy
you logged. If you averaged 2,600 kcal while gaining 0.2 kg a week, about 220
kcal a day went into the gain and maintenance was near 2,380. The arithmetic is
trivial; the discipline is in refusing to run it — it needs 14 days with
calories logged out of the last 28, two weigh-ins, and at least a fortnight
between them, because below that the scale is mostly water and gut content.

The bodyweight slope is fitted across every weigh-in in the window rather than
taken first-to-last, so a single heavy morning cannot swing the answer.

What it cannot fix is under-logging, which every validation study finds and which
this inherits in full. The sheet says so. It is still anchored to your own scale,
which is more than a formula can say.

### Saved meals hold references, logged meals hold values

The same data appears in two places with deliberately different rules.

A **logged meal** snapshots the numbers at the moment you ate it. It is history:
correcting a food later must never rewrite what last Tuesday said.

A **saved meal** stores food *ids* and amounts, nothing else. It is a recipe:
fixing the protein on your quark should carry into the next breakfast you log
from it. Its totals are computed fresh from the current foods every time it is
drawn.

A food deleted since the meal was saved is skipped and counted rather than
logged as a blank — `logTemplate` reports how many resolved and how many did
not, and the toast says so.

Creating one is offered from the slot header of a day you have just logged,
because that is the moment it costs nothing. A separate builder screen would be
a place nobody goes.

### Carbohydrate and fat targets, without a macro ratio

There is no evidence-based macro *ratio*. "40/30/30" is folklore with a decimal
point, and an app that hands one out is inventing precision. But there is an
evidence-based *order*, and the Targets card follows it:

1. **Calories** — your measured maintenance, plus or minus a pace you pick. The
   pace (0.25–0.5% of bodyweight a week) is training-practice convention, and
   labelled as such.
2. **Protein** — its own band from bodyweight, independent of everything else.
3. **Fat** — 20–35% of energy. The lower edge is a floor worth respecting:
   essential fatty acids, fat-soluble vitamins, and a hormonal cost below it
   (EFSA 2010, and the ACSM/AND/DC position stand agrees for athletes).
4. **Carbohydrate** — whatever is left. Not a target of its own, and not given
   one, because no carbohydrate intake has been shown to build more muscle than
   another once calories and protein match.

So the carb and fat numbers are arithmetic on the user's own calorie figure, not
a ratio pulled out of the air. Inside the fat range nothing distinguishes one
point from another, and the card says so rather than implying the midpoint is
special.

The whole chain rests on the maintenance estimate, so it refuses as a unit: with
too little logging there are no calorie, carb or fat targets, and the card says
which piece is missing. Protein still appears, because it only needs bodyweight.

### The warm-up ramp, and what the trials actually say

This section used to open by saying there is no evidence base for a warm-up
ramp. That is still mostly true of the *number* of sets, and it was never true
of the shape — and the shape the app suggested (roughly half for five, then
three-quarters for three) turns out to be the arm of the comparison that loses.

- **Ribeiro 2020** put forty trained men through squat and bench at 80% of
  maximum after three warm-ups: light only, heavy only, and light-then-heavy.
  Light only came last on both lifts. The heavy set won the squat, the
  progressive pair won the bench.
- **A 2025 crossover** in 29 trained lifters compared no specific warm-up, one
  set of 3–4 at 75%, and two sets at 55% then 75%, at roughly 10RM loads. Every
  difference was negligible, including between one set and two.

So: fewer sets, fewer reps, closer to the working weight. One set on a machine
or a cable, a progressive pair on a bar at normal loads, and **nothing at all**
when the muscle has already worked earlier in the session — the app says that
out loud rather than falling silent. The caveat line is a button now, opening
both papers.

What is still practice rather than finding: the three-step ramp for heavy
low-rep work. Neither trial tested a triple at 90%, and the sheet says which
half of the advice that is.

The offer belongs to the moment before an exercise starts: it appears only when
there is a working weight to ramp towards, and it disappears the moment it is
taken **or the first working set is logged**. A warm-up offered for work you
have already done is worse than no offer at all.

Barbell warm-ups are rounded through `platePlan` and machine warm-ups through the
stack increment, so a suggestion is never a weight the equipment cannot make.

### Why there is no deload feature

There is a card on Progress called **Still moving?**, and it deliberately stops
short of being one. It counts how many of your tracked lifts have stopped
gaining, what your working sets have done over the last three weeks against the
three before, and whether your sets have been drifting closer to failure. Then
it stops.

It will not tell you to take a lighter week. Deloads are near-universal in
training culture and thin in the literature: no trial establishes when one is
due, how long it should last, or that taking one beats simply carrying on.
"Week 7, drop to 60%" would be invented precision of exactly the kind this app
refuses everywhere else, and a stall has plenty of cheaper explanations —
jumping the weight too fast, a bad week of sleep, or three ordinary sessions in
a row.

So `js/fatigue.js` reports and the reader decides. There is a test asserting the
output contains none of "deload", "should", "need to", "too much" — the wording
is the feature, and it is the sort of thing that erodes one helpful-sounding
edit at a time.

The one number it introduces, the band within which a slope counts as flat, is
not invented for it either: it is `FLAT_BAND` in `js/region-progress.js`, the
same convention the muscle map already uses, exported rather than copied so the
two cannot drift apart.

### Editing a workout after the fact

The calendar detail view could only delete, which meant a mistyped rep count
cost you the whole session. That is worse than it sounds: 120 reps instead of 12
mints an estimated 1RM that is never beaten again, permanently lifts the
strength score and bends twelve weeks of slope. Everything this app says is
derived from the log, so the log has to be correctable.

Editing follows the same split as a live workout: keystrokes save quietly
(a re-render mid-typing would destroy the caret), structural changes go through
`store.updateSession` so they re-render and can roll back. Moving a workout to
another day keeps its duration rather than its end time, and the field says out
loud that the week it counts towards moves with it.

### Numbers you type

Weight, bodyweight and protein fields are `type="text"` with
`inputmode="decimal"`, not `type="number"`, and they go through
`parseNumber()` in `js/ui.js`.

The reason is not style. `<input type="number">` accepts a full stop and
nothing else, whatever the locale — but on a German phone the decimal key on
that keypad *is* a comma. Type "82,5" and the digits sit there on screen while
`.value` reads as the empty string: the app stored nothing, said nothing, and
the set was lost. `inputmode="decimal"` keeps the numeric keypad and
`parseNumber` accepts either separator. `normaliseOnBlur` rewrites the field to
what was actually understood, so junk cannot sit there looking accepted.

The trade is losing the browser's own `min`/`step` validation, which this app
was already doing in JS anyway.

### A write that fails has to say so

Every action changes `state` first and persists afterwards — that is what makes
a tap feel instant. The cost is a failure mode worth naming: if the write then
fails (quota exhausted, the origin evicted, private browsing), the screen shows
a set as logged that never reached the disk, and it is gone at the next launch.
Silent data loss that looks like success is the worst thing a training log can
do.

So every write in `js/store.js` goes through one wrapper. A failure is recorded
on `state.storageError`, subscribers are notified, `js/app.js` raises a specific
toast wherever you happen to be, and Home carries a red card above everything
else with an export button. The next write that succeeds clears it.

`updateSession` goes further and rolls back: it copies the session before
mutating and puts the copy back if the write fails, so the screen stops claiming
the set was saved. That path runs on every completed set, which is precisely
where an optimistic lie is least affordable. The copy is a JSON round trip
because these records are plain data by definition — it is the same shape the
backup file holds.

`store.updateSession(id, mutate)` only works if `mutate` contains *every*
change. It snapshots at the moment it is called, so a caller that edits the
session first and then passes an empty callback gets a snapshot of the
already-edited session and the rollback silently does nothing. That is exactly
what ticking a set used to do.

A restore validates the whole file before it erases anything. `importData`
wipes every store and then writes, so a payload that passed the format check but
carried a truncated or wrong-typed body used to leave you with neither the
backup nor what you had.

Opening the database can fail in one more way that used to hang forever: a
schema upgrade cannot run while another tab still holds the old version open.
`db.open()` now rejects on `blocked` and the app says which of the two problems
it is, instead of showing an empty screen at exactly the moment an update ships.

### Two numbers that have to agree

`js/log-analysis.js` counts logged training with the **same** fractional
convention as `js/plan-rating.js`: full credit for primary muscles, half for
secondary, over the 15 body-map regions. Before that, Home counted raw working
sets against the coarse muscle labels, so a plan could promise "Lats 12" while
the chart reported "Back 8" and nothing admitted they were different
measurements. If you touch either counter, touch both.

The "This week vs. plan" card grades against **pace**, not against the finished
week — how many of the plan's sessions you have done so far. Judging a Tuesday
against a full week paints everything red until Sunday and stops meaning
anything.

### Sharing a plan

A plan travels **inside the link**. No server, no account, nothing uploaded —
the link is exactly as private as whoever you send it to.

The part that needs care: exercise ids are generated per install, so an id is
meaningless on another phone. A shared plan therefore carries exercise *names*
plus their muscle group and equipment, and the import re-resolves against the
recipient's library using the same `normName` the catalogue top-up uses.
Anything they don't have is created as a custom exercise — with regions from its
muscle group, so an imported plan never leaves silent holes in the volume count.

A full 39-exercise plan is about 960 characters of URL, deflated with
`CompressionStream` (a plain web API, so no dependency) and base64url-encoded so
it survives a hash untouched. Where compression is unavailable the payload goes
uncompressed and the only cost is a longer link.

The import screen states what would change *before* anything is written,
including how many exercises would be added. An imported plan is deliberately
not made active: importing is browsing, not committing.

### The week card

Home → *This week* → **Share**, or the button on Progress. It renders the week —
strength score and what it moved, sessions, sets, tonnage, streak, the muscle
map, new bests, volume against the plan — as a 1080-wide PNG, and hands it to
the iOS share sheet, a download, or the clipboard.

**Why it is drawn instead of screenshotted.** There is no dependency-free way to
photograph a DOM node. `html2canvas` is a dependency, and the standard trick of
wrapping HTML in an `<svg><foreignObject>` and rasterising it does not work in
WebKit — which is the only browser this app runs in on a phone. So the card is
painted on a canvas by `js/week-card.js`, with primitives in `js/canvas-kit.js`.
The one thing it does not paint by hand is the body map: those shapes are
already vectors, so `loadPaths` reads the same two SVG files the app renders
inline and turns them into `Path2D` objects the canvas fills directly. No
rasterisation step, no data URLs, and exact control over every region's colour.

Layout runs twice: once against a throwaway context to find the height the
content needs, then for real. Both passes run the same code — a measured layout
that drifts from the drawn one is a bug waiting to happen. The measure pass
skips only the two things whose size is arithmetic rather than measurement (the
background and the body map), which is what keeps drawing at ~30 ms.

Nothing is uploaded, and there is no service to be down: the summary comes out
of IndexedDB, the PNG is encoded on the phone, and it stays there until the
share sheet is used. The training half of the app still works in flight mode.

**What it will not claim.** The card shows nothing the app itself would hide.
With `showRatings` off, or without a profile, or before a benchmark lift is
logged, there is no score and no tier map — it says which of those it is, and
falls back to the progress map, because an unlit body under a Bronze-to-Legend
legend says nothing. The score delta is the difference of the *rounded* scores,
so "+1" always matches the two numbers a reader could compare; when bodyweight
moved during the week the card says so, because the score is relative to it. A
muscle trained but not in the plan gets a grey bar and a footnote, not the green
of a target that was hit — there is no pace to be on without a target. And a
movement logged for the first time is not a "new best": without that rule week
one of any programme reads as a wall of records.

Cards can also be made for **last week**, which is when you actually want to send
one. Anything with a time window respects that: `regionProgress` takes a `now`,
so a card about last week cannot see sessions logged since and quietly change
what it said.

### The app has two bodyweights

`settings.bodyweight` is the profile figure. The `bodyweight` store is the log of
weigh-ins. They measure the same thing and they are read by different halves of
the app: the profile one drives the strength score on Home, every lift's tier,
the protein band and — through it — the calorie and carb targets, while the log
drives the weekly strength history, the maintenance estimate and the timeline.

For a long time exactly one place kept them in step: the profile form in
Settings. Weighing in from the Progress screen moved the log and left the profile
where it was, so the two quietly disagreed for as long as you never opened
Settings, and the headline score went on scoring you against a weight you no
longer were.

`logBodyweight()` now writes the profile figure too, but only from the newest
entry (`latestWeight()` in `models.js`, which is pulled out of the store so it can
be tested): the log accepts a date, and correcting last Tuesday's weigh-in must
not become "your weight now".

The same split had a second consequence. `macroTargets()` took maintenance from
the log and the protein band from the profile, so with weigh-ins logged and no
profile it returned `ok: true` with `protein: null`. The Food tab read `.low` off
that null and the whole screen died with "Something broke". It now refuses as a
whole and names the missing part, which is also the honest answer: carbs are what
is left after protein and fat, and without a protein band there is no remainder
to take — the old code silently handed protein's entire share to carbohydrate.

### Week boundaries are calendar weeks

Three times now. A week containing a clock change is 167 or 169 hours long, so
`weekStart + 7 * 86400000` lands an hour off the following Monday and everything
in that hour falls in the wrong bucket. It has been fixed in `weeklyMuscleSets`,
in `weekStreak`, and most recently in `strengthHistory` (a session lifted at
00:30 on the Monday after the spring change was credited to the week before) and
in `timeline` (same, for weigh-ins).

The rule, which the `WEEK` constant in `history.js` now carries in a comment:
**milliseconds are fine for durations and lookback windows, never for deciding
which week a timestamp belongs to.** For that, step by calendar days. Both fixes
have a test that fails against the old arithmetic; both were checked by putting
it back.

### Eating next to training

Three charts on Progress, sharing one x-axis: average calories a day over the
week, bodyweight, and working sets. They are three charts rather than one with
three series because the units have nothing in common — a shared y-axis either
flattens the bodyweight line into a straight edge or blows the calorie bars off
the top. What makes it one timeline is that all three are handed the same
gutters (`padL`/`padR` in `js/charts.js`, added for exactly this) and only the
bottom one draws the dates. If those gutters ever drift apart, the screen is
claiming an alignment it does not have.

Intake is bars and bodyweight is a line, deliberately. A week nobody logged has
to look empty, which bars do and a line does not — a line would join the weeks
either side and draw straight through the gap. Bodyweight is the opposite case:
weigh-ins are points in time and the app already reads them that way everywhere
else.

A week reports an intake average only once it has **4 logged days**
(`MIN_LOGGED_DAYS`), which is a convention and is named as one on screen: below
that the mean says more about which days you remembered than about what you ate.
Within a reported week, only the days that actually carry a value count towards
it — a day logged without calories is a logged day, not a zero-calorie one.
Bodyweight is reported only for weeks with a weigh-in *in* them; carrying the
last figure forward would draw a scale reading for a day nobody stood on it.

**What it will not do is say why.** Three series moving together is not evidence
that one moved another, and with one person and no control group there is no
version of this screen that could be. There is no correlation coefficient here
either — a number would read as a finding. The card describes, and says plainly
that the reading is yours.

### The muscle map has two modes

Because "am I strong?" and "am I getting stronger?" are different questions and
only the first one needs standards.

- **Strength** is the tier map, from `buildRating`. Lights only the regions a
  benchmark lift trains, and always will.
- **Progress** (`js/region-progress.js`) fits your own estimated-1RM slope per
  exercise over 12 weeks and averages it per region, secondary muscles at half
  weight. No standards involved, so *every* exercise counts — which makes it the
  map that actually reflects a machine-based session.

The two scales are never mixed and each carries its own legend. A region needs
three sessions on one movement before a slope means anything; below that it
reports "too few sessions to tell" rather than a number.

### Watching progress

The Progress screen (no tab slot — reached from Home, Library or a session)
answers three different questions:

- **Strength over time** recomputes the overall score for each of the last 20
  weeks *as it stood then*. Two details make the line honest: best-e1RM-so-far is
  cumulative, so a week off does not drop your score; and each week is scored
  against the bodyweight logged at the time, not today's, so a bulk does not
  retroactively make you look weaker in March. A dip in the line almost always
  means the scale moved.
- **What is moving** fits a slope through estimated 1RM per lift over 12 weeks
  and splits them into climbing and flat. Fitted on e1RM rather than top weight,
  so a session where you added reps instead of plates still counts.
- **Weekly workload** switches between sets, tonnage and reps. Sets is what the
  plan rating judges; tonnage is what answers "how much did I move"; reps is what
  moves first when you are progressing inside a rep range.

None of it is cached. A stored trend goes stale the moment a session is edited,
and the recompute is trivial at personal-log sizes.

### Nutrition, and what it deliberately isn't

Three numbers: protein, calories, bodyweight. No food database, no barcode, no
network — you build a list of what you actually eat, and after that logging is
one tap. Thirty entries covers almost anyone, which is less work than fighting a
catalogue of three million products forever.

**Protein is shown as a range, never a number.** 1.6 g/kg is the famous
breakpoint from Morton et al., but its own confidence interval reaches 2.2 and
later work argues the breakpoint may not exist at all. A single target would be
inventing a precision the literature doesn't have — the same reason height stays
out of the strength standards.

**Calories are optional throughout.** A protein-only log is a complete log here:
it answers the one question the training data can be compared against. What the
module deliberately does *not* track is micronutrients, macro splits, and meal
timing — total daily intake dominates timing, and the rest would be numbers for
their own sake.

**Food entries are source-agnostic** — name, portion, protein, calories. An item
typed by hand, filled from a barcode lookup, or drafted from a photo all become
the same record, so adding a source later changes nothing downstream. Logged
meals snapshot their own values, so editing or deleting a food edits your list,
never your history (the same rule the exercise library follows for sessions).

**Unlogged days are excluded from averages, not counted as zero.** A day you
forgot is missing data, not a day you ate no protein; averaging in zeroes would
make a good week with two gaps look like a failure.

### Barcode lookup — the one networked feature

`js/foodlookup.js` is the only module that touches the network, kept separate so
the boundary is obvious: everything else works in flight mode. A failed lookup
falls back to typing the numbers, which is what you'd have done anyway.

**You type the digits; there is no camera.** No browser on iOS implements
`BarcodeDetector`, and a WebAssembly scanner would cost the app its "no
dependencies, no build step" property — for something you do once per product.
The code is stored on the food, so looking the same product up again answers
from your own list and logs it without a request.

**Per 100 g is the ground truth, and you supply the portion.** Every Open Food
Facts record has per-100 g values; `serving_size` is missing on most and, where
present, is whatever the manufacturer felt like calling a serving. So the form
asks how many grams *you* eat and scales live — which is also the honest place
for that decision, since only you saw the plate.

**Licensing.** The database is ODbL (structure) and DbCL (contents). Querying
the live API and keeping what you personally looked up is not redistributing a
database — the case their terms explicitly support ("1 API call = 1 real scan by
a user"). Bundling a dump into the repo *would* create a derived database and
carry share-alike obligations, which is why nothing is mirrored. Attribution is
in Settings → Credits, in the lookup sheet, and in `NOTICE`.

**`User-Agent` can't be set from a browser** — it's on the Fetch spec's
forbidden list. Open Food Facts also accepts `X-User-Agent`, and it's in their
CORS allow-list, so that's what identifies the app.

### Weekday scheduling

Optional, and off until you use it. A plan day can be pinned to a weekday from
its `···` menu; with nothing pinned, the Train tab keeps suggesting whichever
day has gone longest untrained — genuinely the better answer for anyone who
trains when they can rather than on a calendar, so it stays the default.

Once anything *is* scheduled, `js/schedule.js` becomes the single source for
"what's on today" and Home, Train and the plan's Week card all read from it. A
weekday can hold two sessions and a day can sit on no weekday; neither is an
error, so nothing validates them away. The Week card also flags the one case
that silently misleads: fewer scheduled sessions than the plan's `perWeek`
implies means the rating is counting a week the calendar won't deliver.

### Settings that change behaviour

- **Default sets and reps** for newly added plan exercises. Read through
  `store.defaultSets()` / `defaultReps()` by the generator, the plan doctor, the
  template previews *and* the hand-add path — that last one used to hardcode
  3 × 8-12, which disagreed with everything else in the app.
- **Stars off** hides the 1–5 scores and the rating cards but keeps the
  plain-language verdicts; "what to fix" is useful without a grade. Your own
  personal rating survives too — that one is a note to yourself. Gate with
  `store.starsShown()`, not by reading the setting directly.
- **Strength ratings** (`showRatings`) is a *separate* switch for the 0–100 tier
  system. Two different things, two toggles.

### The plan doctor

`js/plan-doctor.js` turns each complaint the rating produces into one small,
reversible edit to one day, applied individually. It never restructures a plan.
Placement is the part that needs care: a day's `target` slots (what the blueprint
built it from) decide where a muscle belongs, then which day already trains
related muscles, and only then which day is emptiest. Sorting by "emptiest day"
alone puts a back squat on pull day.

### Estimated 1RM

Epley: `weight × (1 + reps / 30)`, and just the weight at 1 rep. It's an estimate —
useful for spotting a trend across sessions, not a number to load a bar with.

---

## Exercise illustrations

159 of the 776 exercises have two-frame demo art (start / end position) from
[everkinetic](https://github.com/everkinetic/data), licensed **CC BY-SA 4.0**.
Attribution appears in Settings → Credits. Everything else falls back to the
muscle map, which is why that asset does double duty.

The art ships as white line work carried in the alpha channel, quantised to 8
levels — visually identical on line drawings, but ~6 KB per frame instead of
~32 KB, so the whole set is ~2 MB. It is deliberately **not** precached: the
service worker picks up each image the first time you open that exercise.

everkinetic genuinely has no art for a few big lifts — **deadlift, bent-over
barbell row, hip thrust, lat pulldown variants** — those show the muscle map.
If you want them illustrated, [GymVisual](https://gymvisual.com/) sells the
polished 3D-anatomy style at roughly $0.75 per image in bulk; drop the files in
`assets/exercises/` as `<slug>_1.webp` / `<slug>_2.webp` and add the mapping in
`tools/build_exercise_images.py`.

### Two rules the seeding follows

**Anatomy is never inferred from a name match.** Muscle regions for the curated
lifts come from `CONTRIB` in `js/standards.js` — hand-written per lift. An earlier
version borrowed them from the nearest catalogue entry and produced "Deadlift →
lats" and "Barbell Row → front delts", which silently corrupts the muscle map.

**Written steps are borrowed only above a 0.7 token-similarity threshold.** Below
that the matches are wrong in a way that matters: "Barbell Row" pulls the
instructions for *Upright Row*, "Deadlift" for *Axle Deadlift*. About 50 curated
entries therefore have art and correct anatomy but no prose — that is deliberate.
No instructions beats wrong instructions in a training app.

Rebuild the art with:

```bash
curl -sL https://codeload.github.com/lczarnec/everkinetic_modifications/tar.gz/refs/heads/master -o /tmp/ek.tar.gz
mkdir -p /tmp/ek_repo && tar -xzf /tmp/ek.tar.gz -C /tmp/ek_repo
python3 tools/build_exercise_images.py
```

---

## Why there are no exercise photos

`free-exercise-db`'s **metadata** is public domain and is what the catalogue is
built from. Its **images are not usable**: the licensing was never resolved by the
maintainer despite repeated questions, and a downstream project stripped them to
avoid the risk. `wger` has properly licensed images (CC-BY-SA 4.0, commercial use
with attribution) but only ~360 of them for ~1000 exercises.

So the muscle map does the job instead — one asset serving both the rating map and
the library, no licensing questions, a few KB, and it works offline. If you draw
your own demos later, they slot in alongside it.

Rebuild the catalogue with:

```bash
curl -sL -o /tmp/fedb.json https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json
python3 tools/build_library.py /tmp/fedb.json
```

Bump `LIBRARY_VERSION` in `js/models.js` afterwards so existing installs top up
instead of ignoring the new entries.

---

## Not built yet

An **AI help tab** — ask questions about your own training ("has my squat actually
progressed this quarter?", "build me a 4-day split around my current numbers").

The right shape for it is tool use: give the model functions like
`get_exercise_history(exercise, since)` and `get_weekly_volume()` that query the
local database, rather than stuffing a summary of every workout into the prompt.
That stays cheap and accurate as history grows. Worth building after a few weeks of
real logging, when it's clear which questions actually come up.

A **leaderboard** among friends, undecided. Raw kilos are useless as a ranking —
bodyweight, machine versus barbell and an estimated 1RM all make them
incomparable, which is the whole argument the rest of this app makes. What can
be ranked honestly is the 0–100 strength score (already normalised), relative
progress in percent, and consistency; tonnage cannot, because it rewards junk
volume. If it happens it should synchronise the *ranking only* — name, score,
sessions this week, streak, 12-week progress — never the log itself, and on
something with row-level security rather than hand-rolled, because other
people's training data carries obligations a personal app does not. The week
card exists partly to find out whether a leaderboard is even wanted.
