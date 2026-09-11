#!/usr/bin/env python3
"""
Erzeugt js/food-library.js neu aus USDA FoodData Central.

Warum USDA und nicht Open Food Facts, mit dem die App schon redet: Lizenz und CORS, in
dieser Reihenfolge.

  * Lizenz. OFF steht unter ODbL, einen Abzug davon mitzuliefern würde eine abgeleitete
    Datenbank mit Share-alike-Pflichten ergeben. Foundation Foods und SR Legacy aus
    FoodData Central sind Werke der US-Bundesregierung und gemeinfrei, man kann sie also
    einfach mitliefern.
  * CORS. Die Freitextsuche von OFF liegt auf search.openfoodfacts.org, und das schickt
    keinen access-control-allow-origin-Header, ein Browser kann sie also gar nicht
    aufrufen. api/v2/search nimmt einen Parameter `search_terms` an und *ignoriert* ihn
    dann, zurück kommt die ganze Datenbank in beliebiger Reihenfolge. Das sieht aus wie eine
    funktionierende Suche und ist schlimmer als keine. Der Barcode-Endpunkt schickt den
    Header, deshalb funktioniert diese Hälfte der Anbindung und bleibt.

Mitliefern passt außerdem besser zur App: die Suche geht im Flugmodus, und genau da soll die
App funktionieren.

    python3 tools/build_foods.py

Liest die Sammel-CSV von SR Legacy statt der Such-API von FDC: die API braucht einen
Schlüssel (DEMO_KEY ist so stark begrenzt, dass er nutzlos ist, nach einem Dutzend Anfragen
kommt 429), die Sammeldatei braucht nichts. Sie wird unter tools/.cache zwischengespeichert,
der Download passiert also einmal.
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

# Grundnahrungsmittel, keine Marken. Eine Marke gehört auf den Barcode-Weg. Die Anfrage geht
# an FDC, das Label zeigt die App.
STAPLES = [
    # --- Eiweiß: Fleisch, Fisch, Eier ---
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
    # --- Eiweiß: Milchprodukte ---
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
    # --- Eiweiß: pflanzlich ---
    ("Tofu, firm", "tofu firm prepared with calcium sulfate"),
    ("Tempeh", "tempeh"),
    ("Lentils, cooked", "lentils mature seeds cooked boiled without salt"),
    ("Chickpeas, cooked", "chickpeas garbanzo cooked boiled without salt"),
    ("Black beans, cooked", "beans black mature seeds cooked boiled"),
    ("Kidney beans, cooked", "beans kidney red mature seeds cooked boiled"),
    ("Edamame, cooked", "edamame frozen prepared"),
    ("Whey protein powder", "whey protein powder isolate"),
    # --- Kohlenhydrate: Getreide ---
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
    # --- Kohlenhydrate: stärkehaltiges Gemüse ---
    ("Potato, boiled", "potatoes boiled cooked without skin flesh"),
    ("Sweet potato, baked", "sweet potato cooked baked in skin flesh"),
    ("Corn, sweet, cooked", "corn sweet yellow cooked boiled drained"),
    # --- Gemüse ---
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
    # --- Obst ---
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
    # --- Fette, Nüsse, Samen ---
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
    # --- Sonstiges ---
    ("Honey", "honey"),
    ("Sugar, white", "sugars granulated"),
    ("Dark chocolate, 70%", "chocolate dark 70-85% cacao"),
    ("Milk chocolate", "chocolate milk"),
    ("Hummus", "hummus commercial"),
    ("Ketchup", "catsup"),
    ("Mayonnaise", "salad dressing mayonnaise regular"),
    ("Soy sauce", "soy sauce made from soy and wheat shoyu"),

    # --- mehr Eiweiß ---
    ("Chicken, whole, roasted", "chicken broilers or fryers meat only roasted"),
    ("Turkey mince, raw", "turkey ground raw"),
    ("Beef liver, raw", "beef variety meats liver raw"),
    ("Lamb, leg, raw", "lamb leg whole raw"),
    ("Pork mince, raw", "pork ground raw"),
    ("Ham, sliced", "ham sliced regular"),
    ("Salami", "salami dry or hard pork"),
    ("Sausage, pork, raw", "sausage italian pork mild raw"),
    ("Trout, raw", "fish trout rainbow farmed raw"),
    ("Mackerel, raw", "fish mackerel atlantic raw"),
    ("Herring, raw", "fish herring atlantic raw"),
    ("Sardines, canned in oil", "fish sardine atlantic canned in oil drained"),
    ("Tuna, canned in oil", "fish tuna light canned in oil drained"),
    ("Mussels, cooked", "mollusks mussel blue cooked moist heat"),
    ("Squid, raw", "mollusks squid mixed species raw"),
    ("Egg yolk, raw", "egg yolk raw fresh"),
    ("Seitan / wheat gluten", "vital wheat gluten"),
    ("Soy mince, dry", "soy protein concentrate"),

    # --- mehr Milchprodukte ---
    ("Cheese, gouda", "cheese gouda"),
    ("Cheese, emmental", "cheese swiss"),
    ("Cheese, feta", "cheese feta"),
    ("Cheese, camembert", "cheese camembert"),
    ("Cheese, ricotta", "cheese ricotta part skim milk"),
    ("Cheese, halloumi-style", "cheese queso fresco"),
    ("Kefir", "milk buttermilk fluid cultured lowfat"),
    ("Sour cream", "cream sour cultured"),
    ("Whipping cream", "cream fluid heavy whipping"),
    ("Milk, skimmed", "milk nonfat fluid with added vitamin"),
    ("Condensed milk", "milk canned condensed sweetened"),

    # --- mehr Getreide und Stärke ---
    ("Rye flour", "rye flour dark"),
    ("Wheat flour, white", "wheat flour white all-purpose enriched bleached"),
    ("Wheat flour, wholemeal", "wheat flour whole-grain"),
    ("Spelt, cooked", "spelt cooked"),
    ("Barley, cooked", "barley pearled cooked"),
    ("Millet, cooked", "millet cooked"),
    ("Buckwheat, cooked", "buckwheat groats roasted cooked"),
    ("Polenta / cornmeal, dry", "cornmeal degermed enriched yellow"),
    ("Rice cakes", "snacks rice cakes brown rice plain"),
    ("Crispbread", "crackers crispbread rye"),
    ("Pretzels", "snacks pretzels hard plain salted"),
    ("Bagel", "bagels plain enriched"),
    ("Croissant", "croissants butter"),
    ("Granola", "cereals ready-to-eat granola homemade"),
    ("Popcorn, air-popped", "snacks popcorn air-popped"),
    ("Potato, baked with skin", "potatoes baked flesh and skin"),
    ("Potato crisps", "snacks potato chips plain salted"),
    ("Chips / fries, frozen", "potatoes french fried frozen"),

    # --- mehr Gemüse ---
    ("Aubergine, raw", "eggplant raw"),
    ("Asparagus, raw", "asparagus raw"),
    ("Brussels sprouts, raw", "brussels sprouts raw"),
    ("Cabbage, raw", "cabbage raw"),
    ("Red cabbage, raw", "cabbage red raw"),
    ("Sauerkraut", "sauerkraut canned solids and liquids"),
    ("Celery, raw", "celery raw"),
    ("Leek, raw", "leeks bulb and lower leaf portion raw"),
    ("Garlic, raw", "garlic raw"),
    ("Beetroot, raw", "beets raw"),
    ("Radish, raw", "radishes raw"),
    ("Pumpkin, raw", "pumpkin raw"),
    ("Rocket / arugula", "arugula raw"),
    ("Olives, green", "olives pickled canned or bottled green"),
    ("Peppers, chili, raw", "peppers hot chili red raw"),

    # --- mehr Obst ---
    ("Pear", "pears raw"),
    ("Peach", "peaches raw"),
    ("Plum", "plums raw"),
    ("Cherries", "cherries sweet raw"),
    ("Watermelon", "watermelon raw"),
    ("Melon, cantaloupe", "melons cantaloupe raw"),
    ("Grapefruit", "grapefruit raw pink and red and white"),
    ("Lemon", "lemons raw without peel"),
    ("Blackberries", "blackberries raw"),
    ("Apricot, dried", "apricots dried sulfured uncooked"),
    ("Fig, dried", "figs dried uncooked"),
    ("Prunes", "plums dried prunes uncooked"),

    # --- mehr Fette, Nüsse, Samen ---
    ("Hazelnuts", "nuts hazelnuts or filberts"),
    ("Pistachios", "nuts pistachio nuts raw"),
    ("Pecans", "nuts pecans"),
    ("Brazil nuts", "nuts brazilnuts dried unblanched"),
    ("Macadamia nuts", "nuts macadamia nuts raw"),
    ("Pumpkin seeds", "seeds pumpkin and squash seed kernels dried"),
    ("Sesame seeds", "seeds sesame seeds whole dried"),
    ("Tahini", "seeds sesame butter tahini"),
    ("Almond butter", "nuts almond butter plain without salt"),
    ("Sunflower oil", "oil sunflower"),
    ("Butter, unsalted", "butter without salt"),
    ("Margarine", "margarine regular hard soybean"),

    # --- mehr von allem anderen ---
    ("Maple syrup", "syrups maple"),
    ("Jam, strawberry", "jams and preserves"),
    ("Mustard", "mustard prepared yellow"),
    ("Vinegar, balsamic", "vinegar balsamic"),
    ("Coconut milk", "nuts coconut milk canned"),
    ("Coconut, desiccated", "nuts coconut meat dried desiccated sweetened"),
    ("Orange juice", "orange juice raw"),
    ("Apple juice", "apple juice canned or bottled unsweetened"),
    ("Cola", "beverages carbonated cola regular"),
    ("Beer", "alcoholic beverage beer regular all"),
    ("Wine, red", "alcoholic beverage wine table red"),
    ("Coffee, brewed", "beverages coffee brewed prepared with tap water"),
    ("Ice cream, vanilla", "ice creams vanilla"),
    # --- weitere häufige Lebensmittel und Zubereitungen ---
    ("Chicken breast, roasted", "chicken breast meat only cooked roasted"),
    ("Beef steak, grilled", "beef top sirloin steak cooked grilled"),
    ("Salmon, cooked", "salmon atlantic farmed cooked dry heat"),
    ("Egg, whole, boiled", "egg whole cooked hard-boiled"),
    ("Rice, white, dry", "rice white long-grain regular raw enriched"),
    ("Pasta, dry", "pasta dry enriched"),
    ("Potato, raw", "potatoes flesh and skin raw"),
    ("Chickpeas, canned", "chickpeas garbanzo canned drained"),
    ("Kidney beans, canned", "beans kidney canned drained"),
    ("Tomato paste", "tomato products canned paste"),
    ("Passata / tomato purée", "tomato products canned puree"),
    ("Soy milk, unsweetened", "soymilk unsweetened"),
    ("Cocoa powder, unsweetened", "cocoa dry powder unsweetened"),
    ("Wrap, corn tortilla", "tortillas corn ready-to-bake"),
    ("Frozen mixed vegetables, cooked", "vegetables mixed frozen cooked boiled"),
    ("Broccoli, cooked", "broccoli cooked boiled drained"),
    ("Spinach, cooked", "spinach cooked boiled drained"),
]

# Nährstoffnummern von FDC -> die Schlüssel, die die App speichert. Energie wird extra
# behandelt: Foundation Foods haben manchmal die Atwater-Varianten statt 1008.
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
    """Das Sammel-Zip, einmal geladen und zwischengespeichert."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / "sr_legacy.zip"
    if not path.exists():
        print(f"downloading {DATASET} ...")
        req = urllib.request.Request(DATASET, headers={"User-Agent": "LiftLog build script"})
        with urllib.request.urlopen(req, timeout=180) as res:
            path.write_bytes(res.read())
    return zipfile.ZipFile(path)


def read_csv(zf, name):
    # Genauer Dateiname: `endswith("food.csv")` passt auch auf sr_legacy_food.csv, und das ist
    # eine Zuordnung mit zwei Spalten ohne Beschreibungen, still.
    inner = next(n for n in zf.namelist() if n.rsplit("/", 1)[-1] == name)
    with zf.open(inner) as fh:
        yield from csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig"))


def best_match(descriptions, query):
    """
    Jedes Wort der Anfrage muss als *Wort* vorkommen, dann gewinnt die kürzeste Beschreibung.

    Beschreibungen in SR Legacy lesen sich wie "Chicken, broilers or fryers, breast, meat
    only, raw": durch Kommas getrennte Zusätze, die nach rechts genauer werden. Der kürzeste
    volle Treffer ist also das allgemeinste Lebensmittel, das zur Anfrage passt, und das
    will eine Liste von Grundnahrungsmitteln.

    Die Wortgrenzen tragen Last und sind keine Kosmetik: ein einfacher Teilstring-Test findet
    "oats" in "Buckwheat groats", und die Regel "der kürzeste gewinnt" legt dann gerösteten
    Buchweizen selbstbewusst unter Haferflocken ab. Nichts danach hätte das je bemerkt.
    """
    # Wortgrenzen ergeben nur um alphanumerische Tokens Sinn: "\b95%\b" passt nie, weil nach
    # dem Prozentzeichen kein Wortzeichen kommt.
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

    # Einheiten kommen aus dem Datensatz und werden hier nicht angenommen: Milligramm und
    # Mikrogramm verwechselt man leicht, und die App druckt sie neben eine Zahl.
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
        # Die Sammeldatei ist nach nutrient_id geordnet, und das passt bei SR Legacy zu den
        # veröffentlichten Nährstoffnummern, die unten benutzt werden.
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
        "// ERZEUGT von tools/build_foods.py, bitte nicht von Hand ändern.\n"
        "//\n"
        "// Allgemeine Lebensmittel aus USDA FoodData Central (Foundation Foods und SR\n"
        "// Legacy). Das sind Werke der US-Bundesregierung und damit gemeinfrei. Werte pro\n"
        "// 100 g. `usda` hält die genaue Quellzeile fest, damit sich jede Zahl hier\n"
        "// zurückverfolgen lässt.\n"
        "//\n"
        "// Markenprodukte fehlen mit Absicht, dafür gibt es die Barcode-Abfrage. Das hier\n"
        "// sind die Grundzutaten, aus denen eine Mahlzeit besteht.\n"
        f"\nexport const FOOD_LIBRARY = [\n{body},\n];\n",
        encoding="utf-8",
    )
    print(f"\nwrote {len(rows)} foods to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
