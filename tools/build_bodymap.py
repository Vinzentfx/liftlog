#!/usr/bin/env python3
"""
Erzeugt assets/body-front.svg und body-back.svg aus dem Datensatz body-muscles.

Quelle: https://github.com/vulovix/body-muscles (Apache-2.0). Die Namensnennung steht
in README.md, NOTICE und in den Einstellungen der App.

Das Projekt liefert rund 90 feine Muskelpfade (chest-upper-left, traps-mid-right, ...).
Hier werden sie auf die 15 Regionen zusammengelegt, die die Bewertung benutzt, damit ein
Tipp auf die Karte genau eine bewertete Muskelgruppe trifft.

    curl -sL -o /tmp/mf.ts https://raw.githubusercontent.com/vulovix/body-muscles/main/src/data/muscles.front.ts
    curl -sL -o /tmp/mb.ts https://raw.githubusercontent.com/vulovix/body-muscles/main/src/data/muscles.back.ts
    python3 tools/build_bodymap.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

# Die viewBoxen der Quelle: Vorder- und Rückseite liegen nebeneinander in einem Koordinatenraum.
VIEWBOX = {"front": "0 0 35 93", "back": "37 0 35 93"}

# Präfix der Quell-ID (ohne -left/-right) -> unser Regionsschlüssel.
# Alles, was nicht aufgeführt ist, wird zu body-base ohne Muskel (Kopf, Hände, Füße, Gelenke).
REGION_OF = {
    "chest-upper": "chest", "chest-lower": "chest",
    "shoulder-front": "delts-front", "shoulder-side": "delts-front",
    "deltoid-rear": "delts-rear",
    "traps-upper": "traps", "traps-mid": "traps", "traps-lower": "traps",
    "nape": "traps",
    "lats-upper": "lats", "lats-mid": "lats", "lats-lower": "lats",
    "serratus-anterior": "lats",
    "biceps": "biceps",
    "triceps-long": "triceps", "triceps-lateral": "triceps",
    "forearm": "forearms", "forearm-flexors": "forearms",
    "forearm-extensors": "forearms",
    "abs-upper": "abs", "abs-lower": "abs",
    "obliques": "obliques",
    "lower-back-erectors": "lower-back", "lower-back-ql": "lower-back",
    "spine": "lower-back",
    "gluteus-maximus": "glutes", "gluteus-medius": "glutes",
    "quads": "quads", "adductors": "quads", "hip-flexor": "quads",
    "hamstrings-lateral": "hamstrings", "hamstrings-medial": "hamstrings",
    "calves-gastroc-lateral": "calves", "calves-gastroc-medial": "calves",
    "calves-soleus": "calves", "tibialis-anterior": "calves",
}

ID_RE = re.compile(r'id:\s*"([^"]+)"')
PATH_RE = re.compile(r'path:\s*"([^"]+)"')


def parse(path: Path):
    """
    Zerlegt die Datei in Objektliterale und holt aus jedem id und path.

    Eine einzige Regex über die ganze Datei verliert still Einträge: mehrere Objekte haben
    eine `// Kommentar`-Zeile zwischen `view:` und `path:`, das hat ein Muster zerlegt, das
    von der Reihenfolge der Felder abhing, und die ganze Brust gekostet.
    """
    text = path.read_text()
    out = []
    for chunk in text.split("\n  {"):
        mid = ID_RE.search(chunk)
        d = PATH_RE.search(chunk)
        if not mid or not d:
            continue
        base = re.sub(r"-(left|right)$", "", mid.group(1))
        out.append((mid.group(1), base, REGION_OF.get(base), d.group(1)))
    return out


def build(entries, view: str) -> str:
    base_paths, muscle_paths = [], []
    for mid, base, region, d in entries:
        if region:
            muscle_paths.append(
                f'    <path class="muscle" data-region="{region}" d="{d}"/>'
            )
        else:
            base_paths.append(f'    <path d="{d}"/>')

    label = "Front" if view == "front" else "Back"
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{VIEWBOX[view]}" role="img" aria-label="{label} view muscle map">
  <!--
    ERZEUGT, neu bauen mit tools/build_bodymap.py

    Muskelpfade aus body-muscles (https://github.com/vulovix/body-muscles),
    Lizenz Apache-2.0. Die rund 90 feinen Muskeln sind auf die 15 Regionen
    zusammengelegt, die die Bewertung benutzt.

    Worauf sich die App verlässt:
      * jede Muskelform hat class="muscle" und data-region="<key>"
      * alles, was kein Muskel ist, hat class="body-base"
      * kein fill auf .muscle setzen, die App färbt nach Bewertung
  -->
  <g class="body-base">
{chr(10).join(base_paths)}
  </g>
  <g class="muscles">
{chr(10).join(muscle_paths)}
  </g>
</svg>
"""


def main() -> None:
    front_src, back_src = Path("/tmp/mf.ts"), Path("/tmp/mb.ts")
    if not front_src.exists() or not back_src.exists():
        sys.exit("Quelldateien .ts fehlen, siehe Docstring")

    ASSETS.mkdir(exist_ok=True)
    for view, src in (("front", front_src), ("back", back_src)):
        entries = parse(src)
        if not entries:
            sys.exit(f"parsed no muscle entries from {src}")
        svg = build(entries, view)
        dest = ASSETS / f"body-{view}.svg"
        dest.write_text(svg)

        regions = sorted({r for _, _, r, _ in entries if r})
        unmapped = sorted({b for _, b, r, _ in entries if not r})
        print(f"{view}: {len(entries)} paths -> {dest.name} ({dest.stat().st_size // 1024} KB)")
        print(f"   regions: {', '.join(regions)}")
        print(f"   body-base: {', '.join(unmapped)}")


if __name__ == "__main__":
    main()
