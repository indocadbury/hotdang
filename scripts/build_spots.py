"""Build HotDang's own spot files from Overture Maps open places data.

Writes data/spots/<lat>_<lng>.json, one file per 1-degree square, each holding
{"v": release, "s": [[lat, lng, name, kind, id], ...]} where kind is
  r = hotdog restaurant, v = hotdog stand / cart / truck,
  c = convenience store or fuel station chain known for roller-grill hotdogs,
  f = warehouse / food court chain with a hotdog deal (Costco, IKEA).
Run by .github/workflows/data.yml. Needs: pip install duckdb, and the aws CLI.
"""
import json, os, re, subprocess, sys, time
import duckdb

OUT = sys.argv[1] if len(sys.argv) > 1 else "data/spots"
BUCKET = "s3://overturemaps-us-west-2/release"
# keep in step with SHELF_BRANDS / FOOD_COURT_BRANDS in app.js
SHELF = "7-Eleven|7-ELEVEn|Circle K|Wawa|Sheetz|QuikTrip|Speedway|Casey's|Kwik Trip|OXXO|FamilyMart|Family Mart|Lawson"
FOOD_COURT = "Costco|IKEA"
HOTDOG_NAME = r"hot ?dog|glizzy|wiener|frankfurt|corn ?dog|hotdog"
MOBILE = re.compile(r"truck|cart|kiosk|stand|van\b|trailer", re.I)
# stricter check for places matched only by name ("Wiener Blut" is a Vienna cafe, "Frankfurt Bar" isn't a hotdog bar)
NAME_OK = re.compile(r"hot ?-?dog|hotdog|corn ?dog|glizzy|frankfurter|wienerschnitzel|\bwieners\b|\bweiners?\b|wiener ?(dog|stand|hut|wagon|works|king|cart|haus)", re.I)

def ls(path):
    out = subprocess.check_output(["aws", "s3", "ls", "--no-sign-request", path]).decode()
    return [l.split()[-1] for l in out.splitlines() if l.strip()]

rel = sys.argv[2] if len(sys.argv) > 2 else sorted(x.strip("/") for x in ls(BUCKET + "/"))[-1]
files = [f for f in ls(f"{BUCKET}/{rel}/theme=places/type=place/") if f.endswith(".parquet")]
print(f"release {rel}, {len(files)} files", flush=True)

con = duckdb.connect()
con.sql("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2'; SET memory_limit='5GB'; SET threads=4; SET preserve_insertion_order=false;")
con.sql("create table p (id varchar, nm varchar, brand varchar, cat varchar, top varchar, conf double, lng double, lat double, st varchar)")
q = lambda s: s.replace("'", "''")
t0 = time.time()
for i, f in enumerate(files):
    con.sql(f"""insert into p select id, names.primary, brand.names.primary, taxonomy.primary, taxonomy.hierarchy[1], confidence,
      (bbox.xmin+bbox.xmax)/2, (bbox.ymin+bbox.ymax)/2, operating_status
      from read_parquet('{BUCKET}/{rel}/theme=places/type=place/{f}')
      where taxonomy.primary ilike '%hot_dog%'
         or regexp_matches(coalesce(brand.names.primary, ''), '^({q(SHELF)}|{q(FOOD_COURT)})', 'i')
         or (taxonomy.hierarchy[1] = 'food_and_drink' and regexp_matches(coalesce(names.primary, ''), '{q(HOTDOG_NAME)}', 'i'))""")
    print(f"  {i + 1}/{len(files)} {round(time.time() - t0)}s rows={con.sql('select count(*) from p').fetchone()[0]}", flush=True)

rows = con.sql("""select id, nm, brand, cat, top, lat, lng from p
  where coalesce(st, 'open') not ilike '%closed%' and coalesce(conf, 1) >= 0.35 and nm is not null""").fetchall()
shelf_re = re.compile(rf"^({SHELF})", re.I)
fc_re = re.compile(rf"^({FOOD_COURT})", re.I)
cells, kinds = {}, {}
for id_, nm, brand, cat, top, lat, lng in rows:
    cat = cat or ""
    if brand and fc_re.match(brand):
        kind = "f"
    elif brand and shelf_re.match(brand):
        if not re.search(r"convenience|gas|fuel|service_station|grocery|market|store", cat):
            continue
        kind = "c"
    else:
        if "hot_dog" not in cat and not NAME_OK.search(nm):
            continue
        kind = "v" if ("truck" in cat or "stand" in cat or "kiosk" in cat or MOBILE.search(nm)) else "r"
    kinds[kind] = kinds.get(kind, 0) + 1
    key = f"{int(lat // 1)}_{int(lng // 1)}"
    if kind == "c" and brand and brand.split()[0].lower().replace("-", "") not in nm.lower().replace("-", ""):
        nm = f"{brand} {nm}"   # chains often list just the branch, e.g. "La Trobe Street"
    cells.setdefault(key, []).append([round(lat, 5), round(lng, 5), nm[:80], kind, id_.replace("-", "")[:12]])

os.makedirs(OUT, exist_ok=True)
for key, spots in cells.items():
    with open(os.path.join(OUT, key + ".json"), "w") as fh:
        json.dump({"v": rel, "s": spots}, fh, ensure_ascii=False, separators=(",", ":"))
with open(os.path.join(OUT, "index.json"), "w") as fh:
    json.dump({"v": rel, "built": time.strftime("%Y-%m-%d"), "cells": len(cells), "spots": sum(map(len, cells.values())), "kinds": kinds}, fh)
print(f"wrote {len(cells)} cells, {sum(map(len, cells.values()))} spots, kinds {kinds}, {round(time.time() - t0)}s")
