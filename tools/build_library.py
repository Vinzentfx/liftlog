#!/usr/bin/env python3
"""
Erzeugt js/exercise-library.js aus free-exercise-db.

Übernommen werden nur die *Metadaten*. Die Bilder dieses Repos haben eine ungeklärte Lizenz:
der Maintainer hat auf wiederholte Fragen nie geantwortet, und ein anderes Projekt hat sie
deshalb entfernt, um kein Risiko einzugehen. Wir nehmen also keins davon und benutzen
stattdessen die Muskelkarte als Bild.

Quelldaten: https://github.com/yuhonas/free-exercise-db (Unlicense / gemeinfrei)

    curl -sL -o /tmp/fedb.json \
      https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json
    python3 tools/build_library.py /tmp/fedb.json
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# je Muskel in free-exercise-db: Regionsschlüssel der Körperkarte (js/standards.js REGIONS)
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

# ... und das grobe Feld `muscle`, nach dem die App schon gruppiert (models.MUSCLES)
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

# Kategorien, die kein Krafttraining sind und die Auswahl nur aufblähen würden.
SKIP_CATEGORIES = {"stretching", "cardio"}


def norm(name: str) -> str:
    """Grober Schlüssel, um Dubletten gegen die gepflegte Startliste zu finden."""
    n = name.lower()
    n = re.sub(r"\s*[-–]\s*(medium|wide|close|narrow|reverse|neutral)\s+grip$", "", n)
    n = re.sub(r"[^a-z0-9]+", "", n)
    return n


def main() -> None:
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/fedb.json")
    raw = json.loads(src.read_text())

    # Gepflegte Namen, die schon in der App sind, haben Vorrang: die Stärkestandards hängen an
    # ihnen, eine importierte Beinahe-Dublette darf also nie eine davon verdecken.
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

        # Regionen ohne Dubletten, Reihenfolge bleibt
        pr = list(dict.fromkeys(REGION[m] for m in primary))
        sr = [r for r in dict.fromkeys(REGION[m] for m in secondary) if r not in pr]

        out.append({
            "n": name,
            "m": COARSE.get(primary[0], "Other"),
            "e": EQUIPMENT.get(e.get("equipment"), "Other"),
            "p": pr,
            "s": sr,
            "i": [s.strip() for s in (e.get("instructions") or []) if s.strip()],
            # für die Bewertung der Übungsqualität behalten (js/exercise-rating.js)
            "mech": e.get("mechanic") or None,
            "lvl": e.get("level") or None,
        })

    out.sort(key=lambda x: x["n"])

    body = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    js = f"""// Erzeugt, bitte nicht von Hand ändern. Neu bauen mit tools/build_library.py
//
// Übungsdaten aus free-exercise-db (gemeinfrei).
// https://github.com/yuhonas/free-exercise-db
//
// Die Bilder werden bewusst nicht übernommen, die Lizenz der Bilder in diesem Repo
// wurde nie geklärt. Als Abbildung dient die Muskelkarte (js/bodymap.js).
//
// Kurze Schlüssel, damit die Datei klein bleibt:
//   n=Name  m=Muskelgruppe  e=Gerät  p=Hauptregionen  s=Nebenregionen
//   i=Anleitung  mech=compound|isolation  lvl=beginner|intermediate|expert
export const LIBRARY = {body};
"""
    dest = ROOT / "js" / "exercise-library.js"
    dest.write_text(js)
    print(f"{len(out)} exercises in {dest.relative_to(ROOT)} ({dest.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
