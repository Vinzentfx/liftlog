#!/usr/bin/env python3
"""
Regenerates js/food-library.js from USDA FoodData Central.

Why USDA and not Open Food Facts, which the app already talks to: licensing and
CORS, in that order.

  * Licensing. OFF is ODbL — bundling a dump of it would make this a derived
    database with share-alike obligations. FoodData Central's Foundation Foods
    and SR Legacy are works of the US federal government and are in the public
    domain, so they can simply be shipped.
  * CORS. OFF's free-text search lives on search.openfoodfacts.org, which sends
    no access-control-allow-origin header, so a browser cannot call it at all.
    Its api/v2/search accepts a `search_terms` parameter and then *ignores* it,
    returning the whole database in arbitrary order — which looks like a working
    search and is worse than none. The barcode endpoint does send the header,
    which is why that half of the integration works and stays.

Bundling also happens to fit the app better: search works in flight mode, which
is where the app is supposed to work.

    python3 tools/build_foods.py

Reads the SR Legacy bulk CSV rather than the FDC search API: the API needs a key
(DEMO_KEY is rate-limited to the point of uselessness — it 429s within a dozen
requests) and the bulk file needs nothing. It is cached under tools/.cache, so
the download happens once.
"""
import csv
import io
import json
import pathlib
import re
import sys
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "js" / "food-library.js"
CACHE = ROOT / "tools" / ".cache"
DATASET = "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip"

# Generic staples, not brands — a brand belongs to the barcode path. The query
# is what gets sent to FDC; the label is what the app shows.
STAPLES = [
    # --- protein: meat, fish, eggs ---
    ("Chicken breast, raw", "chicken breast boneless skinless raw"),
    ("Chicken thigh, raw", "chicken thigh meat only raw"),
    ("Turkey breast, raw", "turkey breast raw"),
    ("Beef mince, 5% fat, raw", "beef ground 95% lean raw"),
    ("Beef mince, 20% fat, raw", "beef ground 80% lean raw"),
    ("Beef steak, sirloin, raw", "beef top sirloin steak raw"),
    ("Pork loin, raw", "pork loin raw"),
    ("Bacon, cooked", "pork cured bacon cooked"),
    ("Salmon, raw", "salmon atlantic farmed raw"),
    ("Cod, raw", "cod atlantic raw"),
    ("Tuna, canned in water", "tuna light canned in water drained"),
    ("Prawns, raw", "shrimp raw"),
    ("Egg, whole, raw", "egg whole raw fresh"),
    ("Egg white, raw", "egg white raw fresh"),
    # --- protein: dairy ---
    ("Cottage cheese, 1% fat", "cheese cottage lowfat 1% milkfat"),
    ("Greek yoghurt, plain, low fat", "yogurt greek plain lowfat"),
    ("Yoghurt, plain, whole", "yogurt plain whole milk"),
    ("Yoghurt, plain, low fat", "yogurt plain low fat"),
    ("Milk, whole", "milk whole 3.25% milkfat vitamin"),
    ("Milk, semi-skimmed", "milk reduced fat fluid 2% milkfat"),
    ("Cheese, cheddar", "cheese cheddar"),
    ("Cheese, mozzarella", "cheese mozzarella whole milk"),
    ("Cheese, parmesan", "cheese parmesan grated"),
    ("Cream cheese", "cheese cream"),
    ("Butter", "butter salted"),
    # --- protein: plant ---
    ("Tofu, firm", "tofu firm prepared with calcium sulfate"),
    ("Tempeh", "tempeh"),
    ("Lentils, cooked", "lentils mature seeds cooked boiled without salt"),
    ("Chickpeas, cooked", "chickpeas garbanzo cooked boiled without salt"),
    ("Black beans, cooked", "beans black mature seeds cooked boiled"),
    ("Kidney beans, cooked", "beans kidney red mature seeds cooked boiled"),
    ("Edamame, cooked", "edamame frozen prepared"),
    ("Whey protein powder", "whey protein powder isolate"),
    # --- carbs: grains ---
    ("Oats, dry", "oats"),
    ("Rice, white, cooked", "rice white long grain regular cooked"),
    ("Rice, brown, cooked", "rice brown long grain cooked"),
    ("Pasta, cooked", "pasta cooked enriched without added salt"),
    ("Pasta, wholemeal, cooked", "pasta whole-wheat cooked"),
    ("Bread, wholemeal", "bread whole wheat commercially prepared"),
    ("Bread, white", "bread white commercially prepared"),
    ("Rye bread", "bread rye"),
    ("Couscous, cooked", "couscous cooked"),
    ("Quinoa, cooked", "quinoa cooked"),
    ("Bulgur, cooked", "bulgur cooked"),
    ("Cornflakes", "cereals ready-to-eat corn flakes"),
    ("Tortilla, wheat", "tortillas flour shelf stable"),
    # --- carbs: starchy veg ---
    ("Potato, boiled", "potatoes boiled cooked without skin flesh"),
    ("Sweet potato, baked", "sweet potato cooked baked in skin flesh"),
    ("Corn, sweet, cooked", "corn sweet yellow cooked boiled drained"),
    # --- vegetables ---
    ("Broccoli, raw", "broccoli raw"),
    ("Spinach, raw", "spinach raw"),
    ("Kale, raw", "kale raw"),
    ("Carrot, raw", "carrots raw"),
    ("Tomato, raw", "tomatoes red ripe raw"),
    ("Cucumber, raw", "cucumber with peel raw"),
    ("Bell pepper, raw", "peppers sweet red raw"),
    ("Onion, raw", "onions raw"),
    ("Courgette, raw", "squash summer zucchini includes skin raw"),
    ("Mushrooms, raw", "mushrooms white raw"),
    ("Cauliflower, raw", "cauliflower raw"),
    ("Green beans, cooked", "beans snap green cooked boiled drained"),
    ("Peas, cooked", "peas green frozen cooked boiled drained"),
    ("Lettuce", "lettuce romaine raw"),
    ("Avocado", "avocados raw all commercial varieties"),
    # --- fruit ---
    ("Banana", "bananas raw"),
    ("Apple", "apples raw with skin"),
    ("Orange", "oranges raw all commercial varieties"),
    ("Strawberries", "strawberries raw"),
    ("Blueberries", "blueberries raw"),
    ("Raspberries", "raspberries raw"),
    ("Grapes", "grapes red or green raw"),
    ("Pineapple", "pineapple raw all varieties"),
    ("Mango", "mangos raw"),
    ("Kiwi", "kiwifruit green raw"),
    ("Dates, dried", "dates medjool"),
    ("Raisins", "raisins seedless"),
    # --- fats, nuts, seeds ---
    ("Almonds", "nuts almonds"),
    ("Walnuts", "nuts walnuts english"),
    ("Cashews", "nuts cashew nuts raw"),
    ("Peanuts", "peanuts all types raw"),
    ("Peanut butter", "peanut butter smooth style without salt"),
    ("Chia seeds", "seeds chia seeds dried"),
    ("Flaxseed", "seeds flaxseed"),
    ("Sunflower seeds", "seeds sunflower seed kernels dried"),
    ("Olive oil", "oil olive salad or cooking"),
    ("Rapeseed oil", "oil canola"),
    ("Coconut oil", "oil coconut"),
    # --- other ---
    ("Honey", "honey"),
    ("Sugar, white", "sugars granulated"),
    ("Dark chocolate, 70%", "chocolate dark 70-85% cacao"),
    ("Milk chocolate", "chocolate milk"),
    ("Hummus", "hummus commercial"),
    ("Ketchup", "catsup"),
    ("Mayonnaise", "salad dressing mayonnaise regular"),
    ("Soy sauce", "soy sauce made from soy and wheat shoyu"),
]

# FDC nutrient numbers -> the keys the app stores. Energy is handled separately:
# Foundation foods sometimes carry the Atwater variants instead of 1008.
NUTRIENTS = {
    "1003": "protein",
    "1005": "carbs",
    "2000": "sugars",
    "1004": "fat",
    "1258": "satFat",
    "1079": "fibre",
    "1093": "sodium",
    "1087": "calcium",
    "1089": "iron",
    "1090": "magnesium",
    "1092": "potassium",
    "1095": "zinc",
    "1162": "vitaminC",
    "1114": "vitaminD",
    "1178": "vitaminB12",
    "1253": "cholesterol",
}
ENERGY_IDS = ("1008", "2047", "2048")


def dataset():
    """The bulk zip, downloaded once and cached."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / "sr_legacy.zip"
    if not path.exists():
        print(f"downloading {DATASET} ...")
        req = urllib.request.Request(DATASET, headers={"User-Agent": "LiftLog build script"})
        with urllib.request.urlopen(req, timeout=180) as res:
            path.write_bytes(res.read())
    return zipfile.ZipFile(path)


def read_csv(zf, name):
    # Exact basename: `endswith("food.csv")` also matches sr_legacy_food.csv,
    # which is a two-column id mapping and silently has no descriptions.
    inner = next(n for n in zf.namelist() if n.rsplit("/", 1)[-1] == name)
    with zf.open(inner) as fh:
        yield from csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig"))


def best_match(descriptions, query):
    """
    Every query word must appear as a *word*, then the shortest description wins.

    SR Legacy descriptions read "Chicken, broilers or fryers, breast, meat only,
    raw" — comma-separated qualifiers that grow more specific to the right. The
    shortest full match is therefore the most generic food that satisfies the
    query, which is what a staples list wants.

    Word boundaries are load-bearing, not tidiness: a plain substring test
    matches "oats" inside "Buckwheat groats", and the shortest-wins rule then
    confidently files roasted buckwheat under Oats. Nothing downstream would
    ever have caught that.
    """
    # Word boundaries only make sense around alphanumeric tokens: "\b95%\b"
    # never matches, because there is no word character after the percent sign.
    words = [
        re.compile(rf"\b{re.escape(w)}\b" if w.isalnum() else re.escape(w))
        for w in query.lower().split()
    ]
    best = None
    for fdc_id, desc in descriptions:
        low = desc.lower()
        if not all(w.search(low) for w in words):
            continue
        if best is None or len(desc) < len(best[1]):
            best = (fdc_id, desc)
    return best


def main():
    zf = dataset()

    # Units come out of the dataset rather than being assumed here: milligrams
    # and micrograms are easy to mix up and the app prints them next to a number.
    print("reading nutrient.csv ...")
    units = {row["id"]: row["unit_name"].lower() for row in read_csv(zf, "nutrient.csv")}

    print("reading food.csv ...")
    descriptions = [
        (row["fdc_id"], row["description"])
        for row in read_csv(zf, "food.csv")
    ]

    wanted = {}
    for label, query in STAPLES:
        hit = best_match(descriptions, query)
        if not hit:
            print(f"  !! {label}: nothing matches {query!r}", file=sys.stderr)
            continue
        wanted[hit[0]] = {"name": label, "fdcId": int(hit[0]), "usda": hit[1], "per100": {}}

    print("reading food_nutrient.csv ...")
    for row in read_csv(zf, "food_nutrient.csv"):
        target = wanted.get(row["fdc_id"])
        if not target:
            continue
        num = row["nutrient_id"]
        amount = row.get("amount")
        if amount in (None, ""):
            continue
        # The bulk file keys by nutrient_id, which for SR Legacy matches the
        # published nutrient numbers used below.
        if num in NUTRIENTS:
            target["per100"][NUTRIENTS[num]] = round(float(amount), 3)
        elif num in ENERGY_IDS and "kcal" not in target["per100"]:
            target["per100"]["kcal"] = round(float(amount))

    rows = []
    for entry in wanted.values():
        per100 = entry["per100"]
        if "kcal" not in per100 or "protein" not in per100:
            print(f"  !! {entry['name']}: missing energy or protein, skipped", file=sys.stderr)
            continue
        rows.append(entry)
        print(f"  {entry['name']}  <-  {entry['usda']}")

    seen_units = {NUTRIENTS[k]: units.get(k) for k in NUTRIENTS if k in units}
    seen_units["kcal"] = "kcal"
    print("\nunits from the dataset:", json.dumps(seen_units, sort_keys=True))

    body = ",\n".join(
        "  " + json.dumps(r, ensure_ascii=False, sort_keys=True) for r in rows
    )
    OUT.write_text(
        "// GENERATED by tools/build_foods.py — do not hand-edit.\n"
        "//\n"
        "// Generic foods from USDA FoodData Central (Foundation Foods and SR\n"
        "// Legacy), which are works of the US federal government and therefore in\n"
        "// the public domain. Values are per 100 g. `usda` records the exact source\n"
        "// row so any number here can be traced back.\n"
        "//\n"
        "// Branded products are deliberately absent — that is what the barcode\n"
        "// lookup is for. These are the raw ingredients a meal is built from.\n"
        f"\nexport const FOOD_LIBRARY = [\n{body},\n];\n",
        encoding="utf-8",
    )
    print(f"\nwrote {len(rows)} foods to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
