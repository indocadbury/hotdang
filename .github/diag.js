const SHELF="7-Eleven|Circle K|Wawa|Sheetz|QuikTrip|Speedway|Casey's|Kwik Trip|Holiday|OXXO|FamilyMart|Lawson";
const V={
 simple:(a)=>`[out:json][timeout:20];node["shop"="convenience"]${a};out 5;`,
 brandExact:(a)=>`[out:json][timeout:20];(nwr["shop"="convenience"]["brand"~"^(${SHELF})$"]${a};nwr["amenity"="fuel"]["brand"~"^(${SHELF})$"]${a};);out center tags 300;`,
 cuisine:(a)=>`[out:json][timeout:20];nwr["cuisine"~"hot_?dog"]${a};out center tags 300;`,
 nameAmenity:(a)=>`[out:json][timeout:20];nwr["amenity"~"^(fast_food|restaurant|food_court|cafe)$"]["name"~"hot ?dog|frankfurt|wiener|corn ?dog",i]${a};out center tags 300;`,
 combinedLight:(a)=>`[out:json][timeout:20];(nwr["cuisine"~"hot_?dog"]${a};nwr["amenity"~"^(fast_food|restaurant|food_court|cafe)$"]["name"~"hot ?dog|frankfurt|wiener|corn ?dog",i]${a};nwr["shop"="convenience"]["brand"~"^(${SHELF})$"]${a};nwr["amenity"="fuel"]["brand"~"^(${SHELF})$"]${a};);out center tags 300;`,
};
const EPS=["https://overpass-api.de/api/interpreter","https://overpass.private.coffee/api/interpreter"];
(async()=>{for(const ep of EPS)for(const [k,f] of Object.entries(V)){const a='(around:3000,-37.8136,144.9631)';const t=Date.now();try{const ctl=new AbortController();setTimeout(()=>ctl.abort(),30000);const res=await fetch(ep,{method:"POST",body:new URLSearchParams({data:f(a)}),signal:ctl.signal,headers:{"User-Agent":"HotDang diag (github.com/indocadbury/hotdang)"}});const txt=await res.text();let n;try{n=JSON.parse(txt).elements.length}catch(e){n='nonjson:'+txt.slice(0,100).replace(/\s+/g,' ')}console.log('R',ep.split('/')[2],k,res.status,n,(Date.now()-t)+'ms');}catch(e){console.log('R',ep.split('/')[2],k,'ERR',e.message,(Date.now()-t)+'ms')}}
 // also GET style
 const t=Date.now();try{const res=await fetch("https://overpass-api.de/api/status");console.log('R status',res.status,(await res.text()).slice(0,300).replace(/\n/g,' | '),(Date.now()-t)+'ms')}catch(e){console.log('R status ERR',e.message)}})();
