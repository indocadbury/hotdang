import duckdb, subprocess, time
rel = subprocess.check_output("aws s3 ls --no-sign-request s3://overturemaps-us-west-2/release/ | awk '{print $2}' | tail -1", shell=True).decode().strip().strip('/')
files = [l.split()[-1] for l in subprocess.check_output(f"aws s3 ls --no-sign-request s3://overturemaps-us-west-2/release/{rel}/theme=places/type=place/", shell=True).decode().splitlines() if l.endswith('.parquet')]
print("R files", len(files))
con = duckdb.connect()
con.sql("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2'; SET memory_limit='6GB'; SET threads=4; SET preserve_insertion_order=false;")
con.sql("create table p (id varchar, nm varchar, brand varchar, cat varchar, conf double, lng double, lat double, cc varchar, st varchar)")
t=time.time()
for f in files:
    con.sql(f"""insert into p select id, names.primary, brand.names.primary, taxonomy.primary, confidence,
     (bbox.xmin+bbox.xmax)/2, (bbox.ymin+bbox.ymax)/2, addresses[1].country, operating_status
     from read_parquet('s3://overturemaps-us-west-2/release/{rel}/theme=places/type=place/{f}')
     where taxonomy.primary ilike '%hot_dog%'
       or regexp_matches(coalesce(brand.names.primary,''), '^(7-Eleven|7-ELEVEn|Circle K|Wawa|Sheetz|QuikTrip|Speedway|Casey''s|Kwik Trip|OXXO|FamilyMart|Lawson|Costco|IKEA)', 'i')
       or regexp_matches(coalesce(names.primary,''), 'hot ?dog|glizzy|wiener|frankfurt', 'i')""")
    print("R file done", f[-20:], round(time.time()-t), con.sql("select count(*) from p").fetchone()[0], flush=True)
for r in con.sql("select cat, count(*) n from p group by 1 order by n desc limit 20").fetchall(): print("R cat", r)
for r in con.sql("select brand, count(*) n from p group by 1 order by n desc limit 20").fetchall(): print("R brand", r)
for r in con.sql("select nm,brand,cat,round(lat,4),round(lng,4),st from p where lng between 144.9 and 145.0 and lat between -37.85 and -37.78 limit 15").fetchall(): print("R mel", r)
for r in con.sql("select cc, count(*) n from p group by 1 order by n desc limit 10").fetchall(): print("R cc", r)
for r in con.sql("select st, count(*) n from p group by 1").fetchall(): print("R st", r)
