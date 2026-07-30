#!/usr/bin/env python3
"""
Regenerates js/brand-library.js from Open Food Facts.

Branded products, so the search box can find "Nutella" and not just "hazelnut
spread". Fetched here, at build time, rather than from the app — the browser
cannot search Open Food Facts at all (see tools/build_foods.py for the two
separate reasons), but a build script has no CORS to worry about.

LICENSING — read before extending this.

Open Food Facts is ODbL v1.0. Querying it live for one barcode creates nothing
and triggers nothing, which is why js/foodlookup.js is unencumbered. *This* file
is different: extracting a subset and shipping it makes a derived database, and
ODbL's share-alike then applies to it. That is fine and intended, but it has to
be honoured:

  * the extracted database is licensed ODbL v1.0, stated in NOTICE and in the
    app's credits;
  * Open Food Facts is attributed wherever these entries are shown;
  * it stays data-only. No product images (those are CC-BY-SA and separately
    licensed), and no OFF content is mixed into the app's own code.

The app's source code is unaffected — ODbL covers the database, not the program
that reads it.

Category facets are used rather than a free-text or popularity sort: sorting by
unique_scans_n makes the API return 503, and querying by category gives a spread
across the shelf, which is what a search library wants.

    python3 tools/build_brands.py [--per-category N]
"""
import argparse
import json
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "js" / "brand-library.js"
API = "https://world.openfoodfacts.org/api/v2/search"

# A German shelf. Each is an Open Food Facts category facet; the country filter
# keeps it to products actually sold here rather than the global catalogue.
CATEGORIES = [
    "yogurts", "cheeses", "milks", "plant-based-milk-alternatives", "creams",
    "butters", "quark", "breads", "breakfast-cereals", "mueslis",
    "chocolates", "biscuits", "sweet-snacks", "salty-snacks", "crisps",
    "protein-bars", "cereal-bars", "nuts", "dried-fruits", "spreads",
    "hazelnut-spreads", "jams", "honeys", "pastas", "rices",
    "sauces", "tomato-sauces", "soups", "pizzas", "ready-meals",
    "hams", "sausages", "poultry", "fishes", "canned-fishes",
    "legumes", "frozen-vegetables", "fruit-juices", "sodas", "waters",
    "beers", "coffees", "teas", "ice-creams", "desserts",
    "eggs", "olive-oils", "vegetable-oils", "vinegars", "mustards",
]

# OFF nutriment keys -> what the app stores. Same set the barcode path reads, so
# a product added from here and one scanned later are the same shape.
FIELDS = {
    "proteins_100g": "protein",
    "carbohydrates_100g": "carbs",
    "sugars_100g": "sugars",
    "fat_100g": "fat",
    "saturated-fat_100g": "satFat",
    "fiber_100g": "fibre",
    "sodium_100g": "sodium",       # OFF reports grams; converted below
    "salt_100g": None,             # read for sodium fallback only
}

REQUIRED = ("energy-kcal_100g", "proteins_100g", "carbohydrates_100g", "fat_100g")


def fetch(category, per_category, attempt=0):
    url = API + "?" + urllib.parse.urlencode({
        "categories_tags_en": category,
        "countries_tags_en": "germany",
        "page_size": per_category,
        "fields": "code,product_name,product_name_de,brands,quantity,serving_quantity,nutriments",
    })
    req = urllib.request.Request(url, headers={"User-Agent": "LiftLog build script (personal project)"})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.load(res).get("products", [])
    except Exception as err:                              # noqa: BLE001
        if attempt < 2:
            time.sleep(8 * (attempt + 1))
            return fetch(category, per_category, attempt + 1)
        print(f"  !! {category}: {err}", file=sys.stderr)
        return []


def num(v):
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float("inf") else None


def clean_name(product):
    name = (product.get("product_name_de") or product.get("product_name") or "").strip()
    # OFF names carry all sorts of debris: sizes, ALL CAPS, doubled whitespace.
    name = re.sub(r"\s+", " ", name)
    if len(name) < 3 or len(name) > 60:
        return None
    # Crowd-sourced fields collect keyboard mashing. A name with no vowel in it
    # is not a product ("ghgh" arrived under Haribo); short real ones like
    # "Eier", "Pils" and "Skyr" all have one, so this is the only filter needed.
    if not re.search(r"[aeiouyäöü]", name, re.IGNORECASE):
        return None
    if name.isupper() and len(name) > 12:
        name = name.title()
    return name


def to_entry(product):
    name = clean_name(product)
    if not name:
        return None

    n = product.get("nutriments") or {}
    if any(num(n.get(k)) is None for k in REQUIRED):
        return None

    kcal = num(n.get("energy-kcal_100g"))
    # Junk guard: nothing edible is 900+ kcal per 100 g except pure fat, and a
    # zero-energy row with protein in it is a broken record, not a food.
    if kcal is None or kcal > 950 or (kcal == 0 and num(n.get("proteins_100g"))):
        return None

    per100 = {"kcal": round(kcal)}
    for key, target in FIELDS.items():
        if target is None:
            continue
        v = num(n.get(key))
        if v is None:
            continue
        # OFF reports sodium in grams; the app stores milligrams.
        per100[target] = round(v * 1000) if target == "sodium" else round(v, 2)

    if "sodium" not in per100:
        salt = num(n.get("salt_100g"))
        if salt is not None:
            per100["sodium"] = round(salt * 400)      # salt g -> sodium mg

    brand = (product.get("brands") or "").split(",")[0].strip()
    entry = {
        "code": str(product.get("code") or ""),
        "name": name,
        "per100": per100,
    }
    if brand and brand.lower() not in name.lower():
        entry["brand"] = brand[:28]
    grams = num(product.get("serving_quantity"))
    if grams and 1 <= grams <= 1000:
        entry["serving"] = round(grams)
    return entry


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-category", type=int, default=14)
    args = ap.parse_args()

    seen = set()
    rows = []
    for category in CATEGORIES:
        kept = 0
        for product in fetch(category, args.per_category):
            entry = to_entry(product)
            if not entry:
                continue
            key = (entry["name"].lower(), entry.get("brand", "").lower())
            if key in seen:
                continue
            seen.add(key)
            rows.append(entry)
            kept += 1
        print(f"  {category:<32} {kept}")
        time.sleep(3)                                  # be a good citizen

    rows.sort(key=lambda r: r["name"].lower())
    body = ",\n".join("  " + json.dumps(r, ensure_ascii=False, sort_keys=True) for r in rows)
    OUT.write_text(
        "// GENERATED by tools/build_brands.py — do not hand-edit.\n"
        "//\n"
        "// Branded products from Open Food Facts, filtered to items sold in Germany.\n"
        "// Values are per 100 g or 100 ml as the contributor entered them.\n"
        "//\n"
        "// LICENCE: this extracted database is licensed under the Open Database\n"
        "// License (ODbL) v1.0, because it is a derived database of Open Food Facts.\n"
        "// Attribution and the full terms are in NOTICE. The app's own source code is\n"
        "// not affected — ODbL covers the database, not the program reading it.\n"
        "//\n"
        "// Crowd-sourced, so a value is only as good as the contributor who typed it.\n"
        "// The UI says where each number came from for exactly this reason.\n"
        f"\nexport const BRAND_LIBRARY = [\n{body},\n];\n",
        encoding="utf-8",
    )
    print(f"\nwrote {len(rows)} branded products to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
