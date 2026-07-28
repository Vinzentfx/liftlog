#!/usr/bin/env python3
"""Generate LiftLog app icons. Run: python3 tools/make_icons.py"""
from PIL import Image, ImageDraw
from pathlib import Path

BG = (10, 14, 26)
FG = (74, 143, 255)
OUT = Path(__file__).resolve().parent.parent / "icons"


def barbell(size: int, bg=BG, fg=FG, scale=1.0) -> Image.Image:
    # 4x supersample, then downscale — gives clean edges without antialias flags.
    s = size * 4
    img = Image.new("RGBA", (s, s), bg + (255,))
    d = ImageDraw.Draw(img)
    c = s / 2
    k = scale

    def rr(cx, cy, w, h, r):
        d.rounded_rectangle(
            [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], radius=r, fill=fg
        )

    bar_h = s * 0.075 * k
    rr(c, c, s * 0.60 * k, bar_h, bar_h / 2)                    # bar

    for sign in (-1, 1):
        rr(c + sign * s * 0.215 * k, c, s * 0.085 * k, s * 0.40 * k, s * 0.030 * k)  # inner plate
        rr(c + sign * s * 0.315 * k, c, s * 0.070 * k, s * 0.25 * k, s * 0.026 * k)  # outer plate

    return img.resize((size, size), Image.LANCZOS).convert("RGB")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for size in (180, 192, 512):
        barbell(size).save(OUT / f"icon-{size}.png")
    # Maskable: same mark inset so Android's safe-zone crop can't clip it.
    barbell(512, scale=0.72).save(OUT / "icon-maskable-512.png")
    print("wrote:", ", ".join(sorted(p.name for p in OUT.glob("*.png"))))


if __name__ == "__main__":
    main()
