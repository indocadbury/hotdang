import duckdb, subprocess, time
rel = subprocess.check_output("aws s3 ls --no-sign-request s3://overturemaps-us-west-2/release/ | awk '{print $2}' | tail -1", shell=True).decode().strip().strip('/')
print("R release", rel)
con = duckdb.connect()
con.sql("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
src = f"read_parquet('s3://overturemaps-us-west-2/release/{rel}/theme=places/type=place/*', hive_partitioning=1)"
for r in con.sql(f"describe select * from {src} limit 1").fetchall(): print("R col", r[0], r[1][:300])
for r in con.sql(f"select * from {src} where bbox.xmin between 144.95 and 144.97 and bbox.ymin between -37.82 and -37.81 limit 2").fetchall(): print("R row", str(r)[:1500])
