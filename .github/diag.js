const fs=require('fs');const src=fs.readFileSync('app.js','utf8');
const pick=(re)=>src.match(re)[1];
const SHELF=pick(/const SHELF_BRANDS = "([^"]+)"/),FC=pick(/const FOOD_COURT_BRANDS = "([^"]+)"/);
const q=(lat,lng,r)=>{const a=`(around:${r},${lat},${lng})`;return `[out:json][timeout:25];
(
  nwr["cuisine"~"hot_?dog",i]${a};
  nwr["name"~"hot ?dog|frankfurt|wiener|weenie|glizzy|corn ?dog",i]["amenity"~"fast_food|restaurant|food_court|cafe|street_vendor|ice_cream"]${a};
  nwr["shop"="convenience"]["brand"~"^(${SHELF})$",i]${a};
  nwr["amenity"="fuel"]["brand"~"^(${SHELF})$",i]${a};
  nwr["brand"~"^(${FC})$",i]["shop"]${a};
);
out center tags 300;`};
const EPS=["https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter","https://maps.mail.ru/osm/tools/overpass/api/interpreter","https://overpass.private.coffee/api/interpreter"];
(async()=>{for(const [name,lat,lng] of [["Melbourne",-37.8136,144.9631],["Bangkok",13.7563,100.5018]])for(const r of [3000,10000])for(const ep of EPS){const t=Date.now();try{const ctl=new AbortController();setTimeout(()=>ctl.abort(),40000);const res=await fetch(ep,{method:"POST",body:new URLSearchParams({data:q(lat,lng,r)}),signal:ctl.signal,headers:{"User-Agent":"HotDang diag (github.com/indocadbury/hotdang)"}});const txt=await res.text();let n='?';try{n=JSON.parse(txt).elements.length}catch(e){n='nonjson:'+txt.slice(0,80).replace(/\s+/g,' ')}console.log(name,r,ep.split('/')[2],res.status,n,(Date.now()-t)+'ms');}catch(e){console.log(name,r,ep.split('/')[2],'ERR',e.message,(Date.now()-t)+'ms')}}})();
