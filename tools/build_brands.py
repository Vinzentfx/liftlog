#!/usr/bin/env python3
"""
Erzeugt js/brand-library.js neu aus Open Food Facts.

Markenprodukte, damit die Suche "Nutella" findet und nicht nur "Haselnusscreme". Geholt
wird hier beim Bauen und nicht aus der App: der Browser kann Open Food Facts gar nicht
durchsuchen (die zwei Gründe stehen in tools/build_foods.py), ein Build-Skript muss sich
um CORS aber nicht kümmern.

LIZENZ, vor dem Erweitern lesen.

Open Food Facts steht unter ODbL v1.0. Live nach einem Barcode zu fragen erzeugt nichts und
löst nichts aus, deshalb ist js/foodlookup.js unbelastet. Diese Datei ist anders: einen
Ausschnitt herauszuziehen und mitzuliefern ergibt eine abgeleitete Datenbank, und für die
gilt dann das Share-alike der ODbL. Das ist in Ordnung und so gewollt, muss aber
eingehalten werden:

  * die herausgezogene Datenbank steht unter ODbL v1.0, so steht es in NOTICE und in den
    Credits der App;
  * Open Food Facts wird überall genannt, wo diese Einträge zu sehen sind;
  * es bleiben reine Daten. Keine Produktbilder (die sind CC-BY-SA und eigens lizenziert),
    und kein Inhalt von OFF wird mit dem eigenen Code der App vermischt.

Der Quellcode der App ist davon nicht betroffen, die ODbL gilt für die Datenbank, nicht für
das Programm, das sie liest.

Abgefragt wird über Kategorie-Facetten statt über Freitext oder Beliebtheit: nach
unique_scans_n zu sortieren lässt die API mit 503 antworten, und nach Kategorie zu fragen
ergibt eine Streuung über das ganze Regal, und genau das will eine Suchbibliothek.

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

# Ein deutsches Regal. Jeder Eintrag ist eine Kategorie-Facette von Open Food Facts, der
# Länderfilter hält es bei Produkten, die hier wirklich verkauft werden, statt beim Weltkatalog.
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

# Nährwertschlüssel von OFF -> was die App speichert. Dieselben, die der Barcode-Weg liest,
# ein Produkt von hier und eins, das später gescannt wird, haben also dieselbe Form.
FIELDS = {
    "proteins_100g": "protein",
    "carbohydrates_100g": "carbs",
    "sugars_100g": "sugars",
    "fat_100g": "fat",
    "saturated-fat_100g": "satFat",
    "fiber_100g": "fibre",
    "sodium_100g": "sodium",       # OFF liefert Gramm, wird unten umgerechnet
    "salt_100g": None,             # nur als Ersatz für Natrium gelesen
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
    # Namen von OFF schleppen allerlei Müll mit: Größen, NUR GROSSBUCHSTABEN, doppelte Leerzeichen.
    name = re.sub(r"\s+", " ", name)
    if len(name) < 3 or len(name) > 60:
        return None
    # Felder aus der Community sammeln Tastaturgehämmer. Ein Name ohne Vokal ist kein Produkt
    # ("ghgh" kam unter Haribo an). Kurze echte wie "Eier", "Pils" und "Skyr" haben alle
    # einen, mehr Filter braucht es also nicht.
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
    # Schutz gegen Müll: nichts Essbares hat 900+ kcal pro 100 g außer reinem Fett, und eine
    # Zeile ohne Energie, aber mit Eiweiß, ist ein kaputter Datensatz und kein Lebensmittel.
    if kcal is None or kcal > 950 or (kcal == 0 and num(n.get("proteins_100g"))):
        return None

    per100 = {"kcal": round(kcal)}
    for key, target in FIELDS.items():
        if target is None:
            continue
        v = num(n.get(key))
        if v is None:
            continue
        # OFF liefert Natrium in Gramm, die App speichert Milligramm.
        per100[target] = round(v * 1000) if target == "sodium" else round(v, 2)

    if "sodium" not in per100:
        salt = num(n.get("salt_100g"))
        if salt is not None:
            per100["sodium"] = round(salt * 400)      # Salz g -> Natrium mg

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
        time.sleep(3)                                  # höflich bleiben

    rows.sort(key=lambda r: r["name"].lower())
    body = ",\n".join("  " + json.dumps(r, ensure_ascii=False, sort_keys=True) for r in rows)
    OUT.write_text(
        "// ERZEUGT von tools/build_brands.py, bitte nicht von Hand ändern.\n"
        "//\n"
        "// Markenprodukte aus Open Food Facts, gefiltert auf Artikel, die in Deutschland\n"
        "// verkauft werden. Werte pro 100 g oder 100 ml, so wie sie eingetragen wurden.\n"
        "//\n"
        "// LIZENZ: dieser Auszug steht unter der Open Database License (ODbL) v1.0, weil\n"
        "// er eine abgeleitete Datenbank von Open Food Facts ist. Quellenangabe und die\n"
        "// vollständigen Bedingungen stehen in NOTICE. Der Quellcode der App ist davon\n"
        "// nicht betroffen, die ODbL gilt für die Datenbank und nicht für das Programm, das sie liest.\n"
        "//\n"
        "// Von der Community eingetragen, ein Wert ist also nur so gut wie die Person, die\n"
        "// ihn abgetippt hat. Genau deshalb sagt die Oberfläche, woher jede Zahl kommt.\n"
        f"\nexport const BRAND_LIBRARY = [\n{body},\n];\n",
        encoding="utf-8",
    )
    print(f"\nwrote {len(rows)} branded products to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
