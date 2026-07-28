#!/usr/bin/env python3
"""
Generate js/exercise-library.js from free-exercise-db.

Only the *metadata* is imported. That repo's images have unresolved licensing —
the maintainer never answered repeated questions and a downstream project stripped
them to avoid the risk — so we take none of them and use the muscle map as the
illustration instead.

Source data: https://github.com/yuhonas/free-exercise-db (Unlicense / public domain)

    curl -sL -o /tmp/fedb.json \
      https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json
    python3 tools/build_library.py /tmp/fedb.json
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# free-exercise-db muscle -> body-map region key (js/standards.js REGIONS)
REGION = {
    "abdominals": "abs",
    "abductors": "glutes",
    "adductors": "quads",
    "biceps": "biceps",
    "calves": "calves",
    "chest": "chest",
    "forearms": "forearms",
    "glutes": "glutes",
    "hamstrings": "hamstrings",
    "lats": "lats",
    "lower back": "lower-back",
    "middle back": "traps",
    "neck": "traps",
    "quadriceps": "quads",
    "shoulders": "delts-front",
    "traps": "traps",
    "triceps": "triceps",
}

# ... -> the coarse `muscle` field the app already groups by (models.MUSCLES)
COARSE = {
    "chest": "Chest",
    "lats": "Back", "middle back": "Back", "lower back": "Back",
    "traps": "Back", "neck": "Back",
    "shoulders": "Shoulders",
    "biceps": "Biceps",
    "triceps": "Triceps",
    "quadriceps": "Quads", "adductors": "Quads",
    "hamstrings": "Hamstrings",
    "glutes": "Glutes", "abductors": "Glutes",
    "calves": "Calves",
    "abdominals": "Core", "forearms": "Other",
}

EQUIPMENT = {
    "barbell": "Barbell", "e-z curl bar": "Barbell",
    "dumbbell": "Dumbbell",
    "cable": "Cable",
    "machine": "Machine",
    "body only": "Bodyweight",
    "kettlebells": "Kettlebell",
    "bands": "Bands",
    "medicine ball": "Other", "exercise ball": "Other",
    "foam roll": "Other", "other": "Other", None: "Other",
}

# Categories that aren't weight training and would only bloat the picker.
SKIP_CATEGORIES = {"stretching", "cardio"}


def norm(name: str) -> str:
    """Loose key for duplicate detection against the curated seed list."""
    n = name.lower()
    n = re.sub(r"\s*[-–]\s*(medium|wide|close|narrow|reverse|neutral)\s+grip$", "", n)
    n = re.sub(r"[^a-z0-9]+", "", n)
    return n


def main() -> None:
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/fedb.json")
    raw = json.loads(src.read_text())

    # Curated names already in the app are canonical: the strength standards are
    # keyed by them, so an imported near-duplicate must never shadow one.
    models = (ROOT / "js" / "models.js").read_text()
    seed_block = models[models.index("const SEED = ["):]
    seed_block = seed_block[: seed_block.index("\n];")]
    curated = {norm(m) for m in re.findall(r"\['([^']+)'", seed_block)}

    out, seen = [], set(curated)
    for e in raw:
        if e.get("category") in SKIP_CATEGORIES:
            continue
        name = (e.get("name") or "").strip()
        if not name:
            continue
        key = norm(name)
        if key in seen:
            continue
        seen.add(key)

        primary = [m for m in (e.get("primaryMuscles") or []) if m in REGION]
        secondary = [m for m in (e.get("secondaryMuscles") or []) if m in REGION]
        if not primary:
            continue

        # dedupe regions while preserving order
        pr = list(dict.fromkeys(REGION[m] for m in primary))
        sr = [r for r in dict.fromkeys(REGION[m] for m in secondary) if r not in pr]

        out.append({
            "n": name,
            "m": COARSE.get(primary[0], "Other"),
            "e": EQUIPMENT.get(e.get("equipment"), "Other"),
            "p": pr,
            "s": sr,
            "i": [s.strip() for s in (e.get("instructions") or []) if s.strip()],
            # kept for the exercise-quality heuristic (js/exercise-rating.js)
            "mech": e.get("mechanic") or None,
            "lvl": e.get("level") or None,
        })

    out.sort(key=lambda x: x["n"])

    body = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    js = f"""// GENERATED — do not edit by hand. Rebuild with tools/build_library.py
//
// Exercise metadata from free-exercise-db (public domain).
// https://github.com/yuhonas/free-exercise-db
//
// Images are deliberately NOT imported: that repository's image licensing was
// never resolved. The muscle map (js/bodymap.js) is used as the illustration.
//
// Keys are short to keep the payload small:
//   n=name  m=muscle group  e=equipment  p=primary regions  s=secondary regions
//   i=instructions  mech=compound|isolation  lvl=beginner|intermediate|expert
export const LIBRARY = {body};
"""
    dest = ROOT / "js" / "exercise-library.js"
    dest.write_text(js)
    print(f"{len(out)} exercises -> {dest.relative_to(ROOT)} ({dest.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
