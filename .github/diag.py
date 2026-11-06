import duckdb, subprocess, time
rel = subprocess.check_output("aws s3 ls --no-sign-request s3://overturemaps-us-west-2/release/ | awk '{print $2}' | tail -1", shell=True).decode().strip().strip('/')
print("R release", rel)
con = duckdb.connect()
con.sql("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
src = f"read_parquet('s3://overturemaps-us-west-2/release/{rel}/theme=places/type=place/*', hive_partitioning=1)"
t=time.time()
q=f"""
select categories.primary as cat, brand.names.primary as brand, count(*) n
from {src}
where bbox.xmin between 144.85 and 145.05 and bbox.ymin between -37.9 and -37.75
  and (categories.primary ilike '%hot_dog%' or categories.primary in ('convenience_store','gas_station') or brand.names.primary ilike '7-eleven%')
group by all order by n desc limit 25
"""
for r in con.sql(q).fetchall(): print("R", r)
print("R secs", round(time.time()-t))
t=time.time()
q=f"""select count(*) filter (where categories.primary ilike '%hot_dog%') hd,
 count(*) filter (where brand.names.primary ilike '7-eleven%' or names.primary ilike '7-eleven%') s711,
 count(*) total from {src}"""
print("R global", con.sql(q).fetchall(), round(time.time()-t))
