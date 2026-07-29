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

**Library**
- ~776 exercises, searchable by name, muscle group and equipment
- Each one shows which muscles it hits on the same body map, plus step-by-step
  instructions — no exercise photos, for licensing reasons (see below)

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
which is also how you'd move to a new phone.

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

**The service worker precaches with `cache: 'reload'`.** A plain `cache.add()` can
satisfy itself from the browser's HTTP cache, pinning a stale build into the
precache and serving it long after a deploy. Don't remove that flag.

**Keystroke handlers don't re-render.** Weight and rep inputs mutate the session
object and call `store.saveSessionQuiet()`, which persists without notifying
subscribers. Calling `store.updateSession()` on every keystroke would re-render the
screen and destroy the focused input mid-typing.

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
