#!/usr/bin/env python3
"""
Generate assets/body-front.svg + body-back.svg from the body-muscles dataset.

Source: https://github.com/vulovix/body-muscles (Apache-2.0). Attribution lives
in README.md, NOTICE and the app's Settings sheet.

That project ships ~90 fine-grained muscle paths (chest-upper-left,
traps-mid-right, ...). They are collapsed here onto the 15 regions the rating
engine uses, so one tap on the map maps to one rated muscle group.

    curl -sL -o /tmp/mf.ts https://raw.githubusercontent.com/vulovix/body-muscles/main/src/data/muscles.front.ts
    curl -sL -o /tmp/mb.ts https://raw.githubusercontent.com/vulovix/body-muscles/main/src/data/muscles.back.ts
    python3 tools/build_bodymap.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

# The source viewBoxes: front and back sit side by side in one coordinate space.
VIEWBOX = {"front": "0 0 35 93", "back": "37 0 35 93"}

# source id prefix (after stripping -left/-right) -> our region key.
# Anything not listed becomes non-muscle body-base (head, hands, feet, joints).
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
    Split into object literals and pull id + path from each.

    A single regex over the whole file silently drops entries: several objects
    carry a `// comment` line between `view:` and `path:`, which broke a
    field-order-sensitive pattern and cost the entire chest group.
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
    GENERATED — rebuild with tools/build_bodymap.py

    Muscle paths from body-muscles (https://github.com/vulovix/body-muscles),
    licensed Apache-2.0. Its ~90 fine-grained muscles are collapsed onto the 15
    regions the rating engine scores.

    Contract the app relies on:
      * every muscle shape carries class="muscle" and data-region="<key>"
      * non-muscle anatomy carries class="body-base"
      * do not set fill on .muscle shapes — the app colours them by rating
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
        sys.exit("source .ts files missing — see the docstring")

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
