import duckdb, subprocess, time
rel = subprocess.check_output("aws s3 ls --no-sign-request s3://overturemaps-us-west-2/release/ | awk '{print $2}' | tail -1", shell=True).decode().strip().strip('/')
con = duckdb.connect()
con.sql("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
src = f"read_parquet('s3://overturemaps-us-west-2/release/{rel}/theme=places/type=place/*', hive_partitioning=1)"
t=time.time()
con.sql(f"""create table p as select id, names.primary name, brand.names.primary brand, taxonomy.primary cat, basic_category bcat, confidence,
 (bbox.xmin+bbox.xmax)/2 lng, (bbox.ymin+bbox.ymax)/2 lat, addresses[1].country cc, operating_status st
 from {src}
 where taxonomy.primary ilike '%hot_dog%' or basic_category ilike '%hot_dog%' or 'hot_dog_restaurant' = any(taxonomy.alternates)
   or regexp_matches(coalesce(brand.names.primary,''), '^(7-Eleven|7-ELEVEn|Circle K|Wawa|Sheetz|QuikTrip|Speedway|Casey''s|Kwik Trip|OXXO|FamilyMart|Lawson|Costco|IKEA)', 'i')
   or regexp_matches(coalesce(names.primary,''), 'hot ?dog|glizzy|wiener|frankfurt', 'i')""")
print("R build secs", round(time.time()-t))
for r in con.sql("select cat, count(*) n from p group by 1 order by n desc limit 15").fetchall(): print("R cat", r)
for r in con.sql("select brand, count(*) n from p group by 1 order by n desc limit 15").fetchall(): print("R brand", r)
print("R total", con.sql("select count(*) from p").fetchall())
for r in con.sql("select name,brand,cat,round(lat,4),round(lng,4),st from p where lng between 144.9 and 145.0 and lat between -37.85 and -37.78 limit 15").fetchall(): print("R mel", r)
for r in con.sql("select cc, count(*) n from p group by 1 order by n desc limit 10").fetchall(): print("R cc", r)
