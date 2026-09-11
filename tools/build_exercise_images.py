#!/usr/bin/env python3
"""
Baut assets/exercises/ und js/exercise-images.js aus dem Bildersatz von everkinetic.

everkinetic steht unter CC-BY-SA 4.0 (https://github.com/everkinetic/data). Das ursprüngliche
CDN ist offline, die Bilder kommen deshalb aus einem Spiegel der Community. Die Namensnennung
steht in README.md und in den Einstellungen der App.

Die Quellbilder sind schwarze Strichzeichnungen auf transparentem Grund. Hier werden sie als
*weiße* Zeichnung neu gerendert, die ganz im Alphakanal steckt. So sitzen sie ohne CSS-Filter
auf der dunklen Oberfläche, und der Alphakanal wird auf 8 Stufen gerundet. Bei Strichen sieht
man keinen Unterschied, und jede Datei schrumpft von ~32 KB auf ~6 KB.

    curl -sL https://codeload.github.com/lczarnec/everkinetic_modifications/tar.gz/refs/heads/master -o /tmp/ek.tar.gz
    mkdir -p /tmp/ek_repo && tar -xzf /tmp/ek.tar.gz -C /tmp/ek_repo
    python3 tools/build_exercise_images.py
"""
import json
import re
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
SRC = Path("/tmp/ek_repo/everkinetic_modifications-master/images")
DEST = ROOT / "assets" / "exercises"
WIDTH = 320          # reicht bei 2x auf einer Handykarte
ALPHA_LEVELS = 8     # Stufen beim Runden, 8 sieht man bei Strichen nicht

# everkinetic-Slug -> genauer Name in der Bibliothek. Nur für Paare, die der Token-Abgleich
# nicht erreicht, und für die Referenzübungen, bei denen ein falscher Treffer schlimmer wäre
# als keiner.
ALIASES = {
    # Gegen die echte Slug-Liste geprüft. Die Namen bei everkinetic passen selten zu denen
    # der Bibliothek, und ein falscher Tipp ergibt still kein Bild.
    "bench_press": "Barbell Bench Press",
    "narrow_grip_bench_press": "Close-Grip Bench Press",
    "bench_press_dumbbell": "Dumbbell Bench Press",
    "incline_bench_press": "Incline Barbell Bench Press",
    "incline_bench_press_dumbbell": "Incline Dumbbell Press",
    "machine_bench_press": "Pec Deck",
    "chest_dips": "Dip",
    "pushups": "Push-Up",

    "barbell_squat": "Back Squat",
    "front_squat_with_barbell": "Front Squat",
    "hack_squat_machine": "Hack Squat",
    "leg_press": "Leg Press",
    "barbell_lunges": "Walking Lunge",
    "leg_extensions": "Leg Extension",
    "standing_leg_curls": "Lying Leg Curl",
    "romanian_dead_lift": "Romanian Deadlift",
    "barbell_good_mornings": "Good Morning",

    "seated_military_press": "Overhead Press",
    "dumbbell_shoulder_press": "Seated Dumbbell Press",
    "arnold_press": "Arnold Press",
    "lateral_dumbbell_raises": "Lateral Raise",
    "upright_barbell_rows": "Upright Row",
    "barbell_shrugs": "Barbell Shrug",

    "chin_ups": "Chin-Up",
    "wide_grip_chin_up": "Pull-Up",
    "wide_grip_lat_pull_down": "Lat Pulldown",

    "bicep_curls_with_barbell": "Barbell Curl",
    "hammer_curls_with_dumbbell": "Hammer Curl",
    "one_arm_preacher_curl_with_dumbbell": "Preacher Curl",
    "lying_triceps_press": "Skull Crusher",
    "triceps_pushdown_with_rope": "Triceps Pushdown",

    "standing_calf_raises_using_machine": "Standing Calf Raise",
    "seated_calf_raise_using_machine": "Seated Calf Raise",
    "plank": "Plank",
    "hanging_leg_raise": "Hanging Leg Raise",
}

# Bewegungen, die everkinetic schlicht nicht hat. Aufgeschrieben, damit niemand noch einmal
# danach sucht. Diese fallen auf die Muskelkarte zurück.
NO_ART = ("Deadlift", "Barbell Row", "Pendlay Row", "Hip Thrust", "Sumo Deadlift")

# --- everkinetic-Metadaten (für Übungen, die wir ganz übernehmen) -------------------

EK_JSON = Path("/tmp/ek.json")

EK_MUSCLE = {
    "chest": ("Chest", "chest"),
    "triceps": ("Triceps", "triceps"),
    "biceps": ("Biceps", "biceps"),
    "shoulders": ("Shoulders", "delts-front"),
    "lateral deltoid": ("Shoulders", "delts-front"),
    "rear deltoid": ("Shoulders", "delts-rear"),
    "posterior deltoid": ("Shoulders", "delts-rear"),
    "trapezius": ("Back", "traps"),
    "middle back": ("Back", "traps"),
    "lats": ("Back", "lats"),
    "back": ("Back", "lats"),
    "lower back": ("Back", "lower-back"),
    "abdominals": ("Core", "abs"),
    "lower abdominals": ("Core", "abs"),
    "core": ("Core", "abs"),
    "obliques": ("Core", "obliques"),
    "gluts": ("Glutes", "glutes"),
    "hamstring": ("Hamstrings", "hamstrings"),
    "hamstrings": ("Hamstrings", "hamstrings"),
    "quadriceps": ("Quads", "quads"),
    "calves": ("Calves", "calves"),
}

# die genaueste gewinnt: ein Eintrag "bench + barbell" ist eine Langhantelübung
EK_EQUIP = [
    ("barbell", "Barbell"), ("bar", "Barbell"),
    ("dumbbell", "Dumbbell"), ("dumbbells", "Dumbbell"), ("dumbell", "Dumbbell"),
    ("cable machine", "Cable"), ("cable", "Cable"), ("v-bar", "Cable"),
    ("smith machine", "Machine"), ("t-bar machine", "Machine"),
    ("butterfly machine", "Machine"), ("bench press machine", "Machine"),
    ("chest machine", "Machine"), ("machine", "Machine"),
    ("exercise band", "Bands"), ("bands", "Bands"), ("band", "Bands"),
    ("body", "Bodyweight"), ("parallel bars", "Bodyweight"),
]


def ek_meta():
    """Slug -> Eintrag in Bibliotheksform, für übernommene everkinetic-Übungen."""
    if not EK_JSON.exists():
        return {}
    out = {}
    for e in json.loads(EK_JSON.read_text()):
        slug = (e.get("name") or "").replace("-", "_")
        title = (e.get("title") or "").strip()
        if not slug or not title:
            continue

        def firsts(v):
            if not v:
                return []
            vals = v if isinstance(v, list) else [v]
            return [p.strip() for val in vals for p in str(val).split(",") if p.strip()]

        pri = [EK_MUSCLE[m] for m in firsts(e.get("primary")) if m in EK_MUSCLE]
        sec = [EK_MUSCLE[m] for m in firsts(e.get("secondary")) if m in EK_MUSCLE]
        if not pri:
            continue

        equip = "Other"
        have = {x.lower() for x in firsts(e.get("equipment"))}
        for needle, label in EK_EQUIP:
            if needle in have:
                equip = label
                break

        pregions = list(dict.fromkeys(r for _, r in pri))
        sregions = [r for _, r in sec if r not in pregions]
        mech = (e.get("type") or "").split(",")[0].strip() or None

        out[slug] = {
            "n": title,
            "m": pri[0][0],
            "e": equip,
            "p": pregions,
            "s": list(dict.fromkeys(sregions)),
            "i": [str(x).strip() for x in (e.get("steps") or []) if str(x).strip()],
            "mech": mech if mech in ("compound", "isolation") else None,
            "lvl": None,
        }
    return out


STOPWORDS = {"with", "the", "a", "on", "and", "to", "of", "for"}


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def tokens(s: str) -> frozenset:
    words = re.split(r"[^a-z0-9]+", s.lower())
    out = set()
    for w in words:
        if not w or w in STOPWORDS:
            continue
        if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]          # grobe Einzahl: shrugs -> shrug
        out.add(w)
    return frozenset(out)


def render(src: Path, dest: Path) -> None:
    """Schwarze Striche -> weiße Striche im Alphakanal, gerundet und verlustfrei."""
    im = Image.open(src)
    w = WIDTH
    h = round(im.height * (w / im.width))
    im = im.resize((w, h), Image.LANCZOS)

    lum, alpha = im.convert("LA").split()
    # Deckung der Tinte: wie dunkel das Pixel ist, begrenzt durch die Transparenz der Quelle
    ink = ImageChops.multiply(ImageChops.invert(lum), alpha)

    step = 256 // ALPHA_LEVELS
    ink = ink.point(lambda v: min(255, (v // step) * step + step // 2) if v > step // 2 else 0)

    out = Image.new("RGBA", (w, h), (255, 255, 255, 0))
    out.putalpha(ink)
    out.save(dest, "WEBP", lossless=True, method=4)


def library_names() -> list:
    lib = (ROOT / "js" / "exercise-library.js").read_text()
    entries = json.loads(re.search(r"export const LIBRARY = (.*);\n$", lib, re.S).group(1))
    models = (ROOT / "js" / "models.js").read_text()
    seed = models[models.index("const SEED = ["):]
    seed = seed[: seed.index("\n];")]
    curated = re.findall(r"\['([^']+)'", seed)
    return curated + [e["n"] for e in entries]


def main() -> None:
    if not SRC.is_dir():
        sys.exit(f"Quellbilder nicht gefunden unter {SRC}, siehe Docstring")

    names = library_names()
    by_norm = {}
    by_tokens = {}
    for n in names:
        by_norm.setdefault(norm(n), n)
        by_tokens.setdefault(tokens(n), n)

    # Slugs sammeln, die beide Bilder haben
    pairs = {}
    for f in sorted(SRC.iterdir()):
        m = re.match(r"^_*(.+?)_([12])\.png$", f.name)
        if m:
            pairs.setdefault(m.group(1), {})[m.group(2)] = f
    pairs = {k: v for k, v in pairs.items() if "1" in v and "2" in v}

    mapping, unmatched = {}, []

    # Aliase zuerst und ohne Bedingung: sie sind von Hand geprüft, ein unscharfer Treffer darf
    # den Platz also nie vor einem von ihnen besetzen.
    for slug, frames in pairs.items():
        name = ALIASES.get(slug)
        if name and norm(name) in by_norm:
            mapping[norm(by_norm[norm(name)])] = {"slug": slug, "frames": frames}

    aliased_slugs = {info["slug"] for info in mapping.values()}

    for slug, frames in pairs.items():
        if slug in aliased_slugs:
            continue
        target = None
        if True:
            phrase = slug.replace("_", " ")
            if norm(phrase) in by_norm:
                target = by_norm[norm(phrase)]
            else:
                tk = tokens(phrase)
                if tk in by_tokens:
                    target = by_tokens[tk]
                else:
                    # beste Jaccard-Überlappung über der Schwelle
                    best, score = None, 0.0
                    for cand_tokens, cand in by_tokens.items():
                        if not cand_tokens:
                            continue
                        inter = len(tk & cand_tokens)
                        if not inter:
                            continue
                        j = inter / len(tk | cand_tokens)
                        if j > score:
                            best, score = cand, j
                    if score >= 0.75:
                        target = best

        if not target:
            unmatched.append((slug, frames))
            continue
        # der erste Treffer gewinnt, das hält die Ausgabe stabil und verhindert, dass zwei Slugs sich streiten
        mapping.setdefault(norm(target), {"slug": slug, "frames": frames})

    DEST.mkdir(parents=True, exist_ok=True)
    for old in DEST.glob("*.webp"):
        old.unlink()

    written = 0
    out = {}
    for key, info in sorted(mapping.items()):
        slug = info["slug"]
        for n in ("1", "2"):
            written += 1
            render(info["frames"][n], DEST / f"{slug}_{n}.webp")
        out[key] = slug

    # everkinetic-Übungen ohne Treffer haben ein Bild, aber keinen Eintrag in der Bibliothek.
    # Die werden übernommen: sie kosten nichts extra (die Bilder gibt es schon), und jede kommt
    # gleich mit Bild an, und darum geht es ja.
    meta = ek_meta()
    adopted = []
    for slug, frames in unmatched:
        rec = meta.get(slug)
        if not rec:
            continue
        key = norm(rec["n"])
        if key in out or key in {norm(n) for n in names}:
            continue
        for n in ("1", "2"):
            render(frames[n], DEST / f"{slug}_{n}.webp")
            written += 1
        out[key] = slug
        adopted.append(rec)

    adopted.sort(key=lambda r: r["n"])
    (ROOT / "js" / "exercise-extra.js").write_text(
        "// ERZEUGT, bitte nicht von Hand ändern. Neu bauen mit tools/build_exercise_images.py\n"
        "//\n"
        "// Übungen aus everkinetic (CC-BY-SA 4.0), übernommen, weil sie Bilder mitbringen,\n"
        "// aber im Katalog von free-exercise-db kein Gegenstück hatten.\n"
        "// Gleicher Aufbau wie js/exercise-library.js.\n"
        f"export const LIBRARY_EXTRA = {json.dumps(adopted, ensure_ascii=False, separators=(',', ':'))};\n"
    )
    print(f"adopted {len(adopted)} extra exercises -> js/exercise-extra.js")

    (ROOT / "js" / "exercise-images.js").write_text(
        "// ERZEUGT, bitte nicht von Hand ändern. Neu bauen mit tools/build_exercise_images.py\n"
        "//\n"
        "// Bilder zu den Übungen aus everkinetic (CC-BY-SA 4.0).\n"
        "// https://github.com/everkinetic/data\n"
        "//\n"
        "// Ordnet einem normalisierten Übungsnamen seinen Bildnamen zu. Pro Name gibt es\n"
        "// zwei Bilder: <slug>_1.webp (Start) und <slug>_2.webp (Ende).\n"
        "// Die Vorlagen sind schwarze Linien, die App invertiert sie per CSS auf Weiß.\n"
        f"export const EXERCISE_IMAGES = {json.dumps(out, separators=(',', ':'))};\n"
    )

    total = sum(f.stat().st_size for f in DEST.glob("*.webp"))
    print(f"matched {len(out)} of {len(pairs)} everkinetic exercises")
    print(f"wrote {written} webp files, {total // 1024} KB total")
    print(f"unmatched and not adopted: {len(unmatched) - len(adopted)}")


if __name__ == "__main__":
    main()
