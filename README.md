# LiftLog

A personal workout tracker that installs to the iPhone home screen. No account, no
server, no subscription — all data lives on the device, in the browser's IndexedDB.

Vanilla JavaScript, zero dependencies, zero build step. Charts are hand-drawn SVG
so the whole thing works with the network off.

---

## What's in it

**Home**
- Overall strength rating (0–100) and tier, from Beginner to Elite
- Muscle map — front and back, each region coloured by its rating; tap for detail
- Weekly workload, bodyweight trend, streak and recent sessions

**Logging**
- Exercise library, reusable multi-day plans, set-by-set entry
- Plate maths for barbell lifts: what to hang on each side, and when a weight is not loadable
- **Last session's numbers shown inline** and pre-filled, so repeating a workout is three taps
- Rest timer (3 min default) with a chime, auto-started when you complete a set
- Warmup vs working sets, per-exercise notes, PR toasts mid-workout

**Plans**
- Presets: Push/Pull/Legs, Upper/Lower, PPL+Upper/Lower, Full Body, Arnold split
- Per-day exercise lists with target sets and reps
- Strength tier shown inline per lift, plus the weight needed for the next tier

**Calendar**
- Month grid of every gym day, measured against your active plan
- Full workout history; tap any date to open that session
- Edit a finished workout — fix a set, add or remove one, correct the date

**Food** (own tab)
- Protein against a range, plus the day's energy split across protein, carbs and fat
- Carbs, fat, fibre and water — recorded, with no training claim attached
- Meals grouped by time of day; repeat yesterday in one tap
- Barcode lookup, and maintenance calories derived from your own log and scale

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
cd ~/liftlog && node --test
```

No framework, no `package.json`, no dependency — `node:test` ships with Node, and
every module under test is DOM-free, so `tests/maths.test.js` imports straight
out of `js/` with nothing stubbed. The browser never sees the directory.

What is tested is narrow on purpose. Not the rating weights: those are judgement
calls against the literature and will move again, and a test would only pin them
down. What is tested is the arithmetic underneath them and the invariants that
have already broken once — dates, because every silent breakage so far has been
a date and none of them showed up until a clock change months later; the two
counts that must agree (a plan's target and a week's actual, which disagreed for
months because each screen counted its own way); and the honesty rules, which
are the point of the app and exactly the sort of thing a refactor reverses
without noticing.

A regression test is only worth having if it fails against the bug it describes.
The DST cases were checked that way: reinstate the old fixed-millisecond week
arithmetic and `weekStreak: counts consecutive weeks across a clock change` goes
red on its own.

---

## Install on your iPhone

The service worker needs a **secure context**, so offline support only works over
HTTPS (or localhost). That rules out serving it from your Mac over plain
`http://192.168.x.x` — it would still run, but with no offline caching.

### Recommended: GitHub Pages (free, HTTPS, permanent)

The repo is already initialised on `main`, with nothing committed yet:

```bash
cd ~/liftlog && git add -A && git commit -m "LiftLog v1" && gh repo create liftlog --private --source=. --push
```

Then in the repo: **Settings → Pages → Source: deploy from branch `main`, folder
`/ (root)`**. After a minute it's live at
`https://<your-username>.github.io/liftlog/`.

A private repo still publishes a public Pages site on the free plan. There's no
personal data in the code — your workouts never leave your phone — but the URL is
guessable, so treat it as public.

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
| `js/bodymap.js` | Loads the body SVGs and colours regions by tier |
| `assets/body-*.svg` | GENERATED muscle map art — rebuild, don't hand-edit |
| `tools/build_bodymap.py` | Regenerates the body map from body-muscles |
| `NOTICE` | Third-party attributions (Apache-2.0 / CC BY-SA require these) |
| `js/db.js` | Promise wrapper over IndexedDB |
| `js/models.js` | Data model, seed exercise library, and the derived-stat maths |
| `js/store.js` | In-memory state, actions, persistence, subscribe/notify |
| `js/charts.js` | SVG line/bar/heatmap primitives with crosshair tooltips |
| `js/ui.js` | DOM helpers, formatting, bottom sheet, toasts |
| `js/pickers.js` | Exercise picker and create/edit form |
| `js/screens/*.js` | One module per tab, plus the settings sheet |
| `sw.js` | Offline precache — **add new modules to `SHELL`** |
| `tools/make_icons.py` | Regenerates the app icons |
| `tools/devserver.py` | No-cache dev server |
| `tests/maths.test.js` | `node --test` over the DOM-free maths — dev only, never served |
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
| `js/nutrition.js` | Targets, daily totals, energy split, maintenance calories |
| `js/foodlookup.js` | Open Food Facts barcode lookup — the only networked module |
| `js/schedule.js` | Which plan day belongs to which weekday |
| `js/plan-share.js` | Encode/decode a plan into a link — no server involved |
| `js/plates.js` | What to load per side, and when a weight cannot be reached |
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

Your best estimated 1RM per benchmark lift is compared against published strength
standards, normalised by **bodyweight, sex and age**. Each lift lands on a 0–100
score; tier bands are 20 points wide (Beginner / Novice / Intermediate / Advanced /
Elite).

A muscle region's score is the best `lift score × how strongly that lift trains it`
across the benchmark lifts you actually perform — taking the max, so skipping one
lift doesn't drag a region down. A region you never train stays **unrated** rather
than scoring zero, and the overall rating averages only rated regions.

Two deliberate limits:

- **Height is not an input.** No published standard normalises by it. It affects
  leverages, but including it would be invented precision.
- **Only benchmark lifts are rated.** There's no meaningful standard for a cable
  lateral raise, and machine loads vary too much between manufacturers to compare.
  A "100 kg" chest press on one frame is not 100 kg on another — different lever
  arms, different sled weight, plate-loaded versus pin-loaded. So machines get
  accurate *anatomy* (`CONTRIB_EXTRA`) and deliberately no tier. `CONTRIB` used
  to answer both questions at once, which meant the only way to give a movement
  proper regions was to invent a standard for it; they're separate tables now.
  `LOW_CONFIDENCE` flags the one benchmark that is shakier than the rest — leg
  press — and the caveat travels with the tier wherever it's shown.

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
those at 0–2"), and the progression suggestion on the logging screen. That
suggestion is plain double progression — clear the top of the rep range on every
set, then add weight — with RIR as an override in both directions. It is a way to
turn "train close to failure" into a decision on the gym floor, not a research
finding, and it says so.

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
falls back to the progress map, because an unlit body under a Beginner-to-Elite
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
