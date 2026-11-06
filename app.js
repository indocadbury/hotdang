/* HotDang! Find the closest hotdog to you, anywhere.
 *
 * Data: OpenStreetMap via the Overpass API (free, global).
 *   - Street vendors and restaurants tagged cuisine=hot_dog (or named like one)
 *   - "Likely" shelf spots: convenience chains known for roller-grill hotdogs
 *   - Food courts known for hotdogs (Costco, IKEA)
 * Your counter, reviews, "still here" checks and added spots are saved on this
 * device for now. A shared backend (accounts, global leaderboard) comes next.
 */
"use strict";

const DEFAULT_CENTRE = { lat: -33.8688, lng: 151.2093 }; // Sydney, used when GPS is unavailable
const WALK_M_PER_MIN = 80;
const DAY = 864e5;
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const SHELF_BRANDS = "7-Eleven|Circle K|Wawa|Sheetz|QuikTrip|Speedway|Casey's|Kwik Trip|Holiday|OXXO|FamilyMart|Lawson";
const FOOD_COURT_BRANDS = "Costco|IKEA";
const TYPES = { stand: "Street vendor", restaurant: "Restaurant", shelf: "Convenience store" };
const ALERT_M = 400;           // "within walking distance" for alerts
const ALERT_REPEAT_MS = 6 * 3600e3; // don't re-alert the same spot for 6 hours
const ARRIVE_M = 30;
const ROUTER = "https://routing.openstreetmap.de/routed-foot/route/v1/foot";

/* ---------- storage (this device only, for now) ---------- */
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

const state = {
  me: null, gps: false,
  spots: [], loading: false, error: null, searchedRadius: 0,
  filter: "all", selected: null, mode: "browse", draft: null,
  tab: "spots", reviewing: false, pick: 0,
  eaten: store.get("hd.eaten", []),     // [{id, name, type, t}]
  reviews: store.get("hd.reviews", {}), // {spotId: [{stars, text, t}]}
  seen: store.get("hd.seen", {}),       // {spotId: time}
  mine: store.get("hd.mine", []),       // spots you added
  alerts: store.get("hd.alerts", false),
  alerted: store.get("hd.alerted", {}),
  dogTags: store.get("hd.dogs", {}),    // {spotId: ["cheese", ...]} what you've seen on the menu
  editingDogs: false,
  nav: null,       // {spot, coords, steps, total, idx, arrived, straight}
  follow: true,    // map follows you while navigating
  lastLoad: null,  // where spots were last loaded
};
const saveDogs = () => store.set("hd.dogs", state.dogTags);
const saveAll = () => { store.set("hd.eaten", state.eaten); store.set("hd.reviews", state.reviews); store.set("hd.seen", state.seen); store.set("hd.mine", state.mine); };

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const OFFLINE_NOTE = "Photos, comments and the worldwide leaderboard can't connect right now. Your own hotdogs are still saved on this phone.";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function metres(a, b) {
  const R = 6371e3, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const dist = (s) => (state.me ? metres(state.me, s) : 0);
const fmtDist = (m) => (m < 1000 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(m < 10000 ? 1 : 0) + " km");
const mins = (m) => Math.max(1, Math.round(m / WALK_M_PER_MIN));
function ago(t) { const h = (Date.now() - t) / 3600e3; if (h < 1) return "just now"; if (h < 24) return Math.round(h) + "h ago"; return Math.round(h / 24) + "d ago"; }
const starStr = (v) => { const f = Math.round(v); return "★★★★★".slice(0, f) + "☆☆☆☆☆".slice(0, 5 - f); };
const allSpots = () => [...state.spots, ...state.mine];
/* ---------- special dogs ---------- */
const SPECIALS = [
  { key: "cheese", label: "Cheese dog", re: /chee[sz]e/i },
  { key: "chilli", label: "Chilli dog", re: /chil(l)?i|chili/i },
  { key: "footlong", label: "Footlong", re: /foot ?long/i },
  { key: "loaded", label: "Loaded dog", re: /loaded|supreme/i },
  { key: "corndog", label: "Corn dog", re: /corn ?dog|korean/i },
  { key: "chicago", label: "Chicago dog", re: /chicago/i },
  { key: "brat", label: "Bratwurst", re: /\bbrat|wurst/i },
  { key: "veggie", label: "Veggie dog", re: /vegan|vegetarian|veggie|plant/i },
];
const SPECIAL_BY_KEY = Object.fromEntries(SPECIALS.map((x) => [x.key, x]));
function specialsOf(s) {
  const set = new Set(s.osmSpecials || []);
  (state.dogTags[s.id] || []).forEach((k) => set.add(k));
  return SPECIALS.filter((x) => set.has(x.key));
}
const specialsText = (s, n = 3) => specialsOf(s).slice(0, n).map((x) => x.label).join(" · ");
const visible = () => allSpots().filter((s) => state.filter === "all" || (state.filter === "special" ? specialsOf(s).length > 0 : s.type === state.filter)).sort((a, b) => dist(a) - dist(b));
const findSpot = (id) => allSpots().find((s) => s.id === id);
function ratingOf(id) { const rs = state.reviews[id] || []; return { n: rs.length, avg: rs.length ? rs.reduce((a, r) => a + r.stars, 0) / rs.length : 0 }; }
const mapsUrl = (s) => `https://www.google.com/maps/dir/?api=1${state.me ? `&origin=${state.me.lat},${state.me.lng}` : ""}&destination=${s.lat},${s.lng}&travelmode=walking`;
let toastTimer;
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2400); }

/* ---------- opening hours ----------
 * A small parser for the common OpenStreetMap opening_hours formats, e.g.
 * "24/7", "Mo-Fr 08:00-20:00; Sa 09:00-14:00", "Mo-Su 18:00-02:00", "Su off".
 * Anything it can't read safely (holidays, sunrise, months...) is "unknown".
 */
const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
function parseHours(str) {
  if (!str) return null;
  const s = str.trim();
  if (/^24\/7$/.test(s)) return "24/7";
  const rules = [];
  for (const part of s.split(";").map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)?\s*(.*)$/);
    if (!m) return null;
    const days = new Set();
    if (!m[1]) DAYS.forEach((_, i) => days.add(i));
    else for (const d of m[1].split(",")) {
      const [a, b] = d.split("-").map((x) => DAYS.indexOf(x));
      if (b === undefined) days.add(a); else for (let i = a; ; i = (i + 1) % 7) { days.add(i); if (i === b) break; }
    }
    const rest = m[2].trim();
    if (/^(off|closed)$/i.test(rest)) { rules.push({ days, ranges: [] }); continue; }
    const ranges = [];
    for (const r of rest.split(",").map((x) => x.trim())) {
      const tm = r.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})\+?$/);
      if (!tm) return null;
      ranges.push([+tm[1] * 60 + +tm[2], +tm[3] * 60 + +tm[4]]);
    }
    rules.push({ days, ranges });
  }
  return rules.length ? rules : null;
}
const hhmm = (mins) => `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
function openStatus(str, now = new Date()) {
  const rules = parseHours(str);
  if (!rules) return { state: "unknown" };
  if (rules === "24/7") return { state: "open", label: "Open 24/7" };
  // later rules override earlier ones for the days they name (OSM semantics)
  const forDay = (d) => { let r = null; for (const rule of rules) if (rule.days.has(d)) r = rule.ranges; return r; };
  const day = now.getDay(), t = now.getHours() * 60 + now.getMinutes();
  const today = forDay(day) || [], yesterday = forDay((day + 6) % 7) || [];
  for (const [a, b] of yesterday) if (b <= a && t < b) return { state: "open", label: `Open until ${hhmm(b)}` };
  for (const [a, b] of today) {
    if (b > a ? t >= a && t < b : t >= a) return { state: "open", label: `Open until ${hhmm(b)}`, soon: b > a && b - t <= 30 };
  }
  const next = today.map(([a]) => a).filter((a) => a > t).sort((x, y) => x - y)[0];
  return { state: "closed", label: next != null ? `Closed · opens ${hhmm(next)}` : "Closed now" };
}
function statusOf(s) {
  if (s.hoursRaw == null) return { state: "unknown", label: "Hours unknown" };
  const st = openStatus(s.hoursRaw);
  return st.state === "unknown" ? { state: "unknown", label: "Hours unknown" } : st;
}
const statusTag = (s) => { const st = statusOf(s); return `<span class="ohtag oh-${st.state}${st.soon ? " oh-soon" : ""}">${st.state === "open" ? (st.soon ? "Closing soon" : "Open") : st.state === "closed" ? "Closed" : "Hours?"}</span>`; };

/* ---------- OpenStreetMap data ---------- */
function overpassQuery({ lat, lng }, r) {
  const around = `(around:${r},${lat},${lng})`;
  return `[out:json][timeout:25];
(
  nwr["cuisine"~"hot_?dog",i]${around};
  nwr["name"~"hot ?dog|frankfurt|wiener|weenie|glizzy|corn ?dog",i]["amenity"~"fast_food|restaurant|food_court|cafe|street_vendor|ice_cream"]${around};
  nwr["shop"="convenience"]["brand"~"^(${SHELF_BRANDS})$",i]${around};
  nwr["amenity"="fuel"]["brand"~"^(${SHELF_BRANDS})$",i]${around};
  nwr["brand"~"^(${FOOD_COURT_BRANDS})$",i]["shop"]${around};
);
out center tags 300;`;
}
function classify(el) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
  if (lat == null) return null;
  const brand = t.brand || "";
  const text = [t.name, t.description, t.cuisine, t["diet:vegan"] === "yes" || t["diet:vegetarian"] === "yes" ? "veggie" : ""].filter(Boolean).join(" ");
  const osmSpecials = SPECIALS.filter((x) => x.re.test(text)).map((x) => x.key);
  const base = { id: `osm:${el.type}/${el.id}`, lat, lng, src: "osm", osm: `https://www.openstreetmap.org/${el.type}/${el.id}`, hoursRaw: t.opening_hours || null, osmSpecials };
  if (new RegExp(`^(${FOOD_COURT_BRANDS})$`, "i").test(brand)) {
    return { ...base, type: "restaurant", name: t.name || brand, item: "Food court hotdog", likely: true };
  }
  if (new RegExp(`^(${SHELF_BRANDS})$`, "i").test(brand) && (t.shop === "convenience" || t.amenity === "fuel")) {
    const street = t["addr:street"] ? ` ${t["addr:street"]}` : "";
    return { ...base, type: "shelf", name: t.name && t.name !== brand ? t.name : brand + street, item: "Roller-grill hotdog", likely: true };
  }
  const mobile = t.street_vendor === "yes" || t.mobile === "yes" || t.amenity === "street_vendor" || t.shop === "kiosk" || /truck|cart|kiosk|stand/i.test(t.name || "");
  return { ...base, type: mobile ? "stand" : "restaurant", name: t.name || (mobile ? "Hotdog cart" : "Hotdog spot"), item: "Hotdogs", likely: false, hours: t.opening_hours };
}
async function overpass(q) {
  let lastErr;
  for (const url of OVERPASS) {
    try {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 30000);
      const res = await fetch(url, { method: "POST", body: new URLSearchParams({ data: q }), signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
async function loadSpots() {
  if (!state.me) return;
  state.loading = true; state.error = null; render();
  try {
    let found = [];
    for (const r of [3000, 10000, 30000]) {
      const key = `hd.q.${state.me.lat.toFixed(2)},${state.me.lng.toFixed(2)},${r}`;
      let data; try { data = JSON.parse(sessionStorage.getItem(key)); } catch (e) {}
      if (!data) { data = await overpass(overpassQuery(state.me, r)); try { sessionStorage.setItem(key, JSON.stringify(data)); } catch (e) {} }
      const seenIds = new Set();
      found = (data.elements || []).map(classify).filter((s) => s && !seenIds.has(s.id) && seenIds.add(s.id));
      state.searchedRadius = r;
      if (found.length >= 5) break;
    }
    state.spots = found;
  } catch (e) {
    state.error = "Couldn't reach the map data right now. Check your connection and try again.";
  }
  state.loading = false; state.lastLoad = { ...state.me }; render(); if (!state.nav) fitToNearest(); checkAlerts(); openFromLink(); try { social()?.onSpotsLoaded(); } catch (e) { console.error(e); }
}

/* ---------- map ---------- */
const OUT = "#3a2210";
const PIN_FLAG = { stand: "#e0352b", restaurant: "#c47a2c", shelf: "#3f9a3a" };
const hotdogSvg = (flag, live) => `<svg width="64" height="56" viewBox="-32 -52 64 56" aria-hidden="true">
  <ellipse cx="0" cy="2" rx="22" ry="5" fill="rgba(0,0,0,.22)"/>
  <line x1="16" y1="-22" x2="16" y2="-48" stroke="${OUT}" stroke-width="2"/>
  <path d="M16 -48 L33 -43 L16 -38 Z" fill="${flag}" stroke="${OUT}" stroke-width="1.5" stroke-linejoin="round"/>
  <rect x="-22" y="-27" width="44" height="14" rx="7" fill="#f3b960" stroke="${OUT}" stroke-width="2"/>
  <rect x="-29" y="-25" width="58" height="12" rx="6" fill="#c84a2a" stroke="${OUT}" stroke-width="2"/>
  <path d="M-21 -19 q3 -4 6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t5 0" stroke="#ffc61a" stroke-width="2.6" fill="none" stroke-linecap="round"/>
  <rect x="-24" y="-17" width="48" height="14" rx="7" fill="#df9440" stroke="${OUT}" stroke-width="2"/>
  <path d="M-17 -13 h10" stroke="#f8d59a" stroke-width="2.5" stroke-linecap="round"/>
  ${live ? `<rect x="-46" y="-52" width="34" height="15" rx="7.5" fill="#e0352b" stroke="${OUT}" stroke-width="1.5"/><text x="-29" y="-40.5" text-anchor="middle" font-size="10.5" font-weight="700" font-family="Fredoka, sans-serif" fill="#fff">LIVE</text>` : ""}
</svg>`;
const pupSvg = () => {
  const FUR = "#e0a96d", EAR = "#8b5a2b", MUZ = "#f7dfba";
  const eye = (x) => `<ellipse cx="${x}" cy="-9" rx="6.5" ry="5.5" fill="#fff" stroke="${OUT}" stroke-width="2"/><circle cx="${x}" cy="-6.5" r="2.8" fill="${OUT}"/><path d="M${x - 7} -9 A7 6 0 0 1 ${x + 7} -9 Z" fill="${FUR}" stroke="${OUT}" stroke-width="2" stroke-linejoin="round"/>`;
  return `<span class="ring"></span><svg class="pupwrap" width="96" height="96" viewBox="-48 -48 96 96" style="position:relative" aria-hidden="true">
  <ellipse cx="0" cy="30" rx="24" ry="6" fill="rgba(0,0,0,.22)"/>
  <ellipse cx="-27" cy="-2" rx="11" ry="22" fill="${EAR}" stroke="${OUT}" stroke-width="2.5" transform="rotate(22 -27 -2)"/>
  <ellipse cx="27" cy="-2" rx="11" ry="22" fill="${EAR}" stroke="${OUT}" stroke-width="2.5" transform="rotate(-22 27 -2)"/>
  <circle cx="0" cy="-2" r="28" fill="${FUR}" stroke="${OUT}" stroke-width="2.5"/>
  <ellipse cx="-6" cy="-22" rx="9" ry="5" fill="#c98a4f" opacity=".7"/>
  <ellipse cx="0" cy="10" rx="19" ry="14" fill="${MUZ}"/>
  ${eye(-11)}${eye(11)}
  <ellipse cx="0" cy="2" rx="6" ry="4" fill="${OUT}"/><ellipse cx="-1.5" cy="1" rx="2" ry="1.2" fill="#fff" opacity=".6"/>
  <ellipse cx="0" cy="15" rx="12" ry="9" fill="#5a1717" stroke="${OUT}" stroke-width="2"/>
  <path d="M-6.5 15 Q-8 36 0 38 Q8 36 6.5 15 Z" fill="#ff7f9e" stroke="${OUT}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M0 19 V31" stroke="#d9506f" stroke-width="1.8" stroke-linecap="round"/>
  <circle cx="-17" cy="13" r="4.2" fill="#e0352b"/><circle cx="15" cy="23" r="3.2" fill="#e0352b"/><circle cx="-11" cy="26" r="2.6" fill="#e0352b"/><circle cx="20" cy="-14" r="2.2" fill="#e0352b"/>
  <path d="M12 5 q5 -1 8 3 q-2 5 -6 3 Z" fill="#e0352b"/>
  <circle cx="17" cy="9" r="3.4" fill="#ffc61a"/><circle cx="-16" cy="20" r="2.6" fill="#ffc61a"/><circle cx="-21" cy="6" r="2" fill="#ffc61a"/><circle cx="7" cy="27" r="2" fill="#ffc61a"/>
  <path d="M-20 16 q-2 6 1 9" stroke="#ffc61a" stroke-width="2.4" fill="none" stroke-linecap="round"/>
</svg>`;
};

const map = L.map("map", { zoomControl: false, attributionControl: true }).setView([DEFAULT_CENTRE.lat, DEFAULT_CENTRE.lng], 15);
// Map tiles: no API key needed. OpenStreetMap first, then OSM France (HOT style) if it fails.
// (CARTO basemaps now require an API key, so they are not used.)
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const TILE_SOURCES = [
  { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", opts: { maxZoom: 19, attribution: OSM_ATTR } },
  { url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", opts: { maxZoom: 19, subdomains: "abc", attribution: OSM_ATTR + ", tiles by HOT" } },
];
let tileIdx = 0, tiles = null;
function useTiles(i) {
  if (tiles) tiles.remove();
  tileIdx = i; let errors = 0, loaded = 0;
  tiles = L.tileLayer(TILE_SOURCES[i].url, TILE_SOURCES[i].opts)
    .on("tileload", () => loaded++)
    .on("tileerror", () => { if (++errors >= 4 && loaded === 0 && tileIdx + 1 < TILE_SOURCES.length) useTiles(tileIdx + 1); })
    .addTo(map);
}
useTiles(0);
const pinLayer = L.layerGroup().addTo(map);
let meMarker = null, draftMarker = null, line = null;

function drawMap() {
  pinLayer.clearLayers();
  const list = visible();
  list.slice(0, 200).reverse().forEach((s) => {
    const sel = s.id === state.selected;
    const icon = L.divIcon({ className: "hd-pin" + (sel ? " sel" : ""), html: hotdogSvg(PIN_FLAG[s.type], s.live), iconSize: [64, 56], iconAnchor: [32, 52] });
    L.marker([s.lat, s.lng], { icon, title: s.name, keyboard: true, zIndexOffset: sel ? 1000 : 0, alt: s.name })
      .on("click", () => { if (state.mode !== "browse") return; state.selected = s.id; state.tab = "spots"; state.reviewing = false; state.editingDogs = false; render(); })
      .addTo(pinLayer);
  });
  if (line) { line.remove(); line = null; }
  const sel = state.selected && findSpot(state.selected);
  if (state.nav) {
    line = L.layerGroup([
      L.polyline(state.nav.coords, { color: "#ffffff", weight: 10, opacity: 0.9, lineCap: "round", lineJoin: "round" }),
      L.polyline(state.nav.coords, { color: "#2563eb", weight: 6, lineCap: "round", lineJoin: "round", dashArray: state.nav.straight ? "2 12" : null }),
    ]).addTo(map);
  } else if (sel && state.me) line = L.polyline([[state.me.lat, state.me.lng], [sel.lat, sel.lng]], { color: "#2563eb", weight: 4, dashArray: "2 10", lineCap: "round" }).addTo(map);
  if (state.me) {
    if (!meMarker) meMarker = L.marker([state.me.lat, state.me.lng], { icon: L.divIcon({ className: "hd-pup", html: pupSvg(), iconSize: [96, 96], iconAnchor: [48, 48] }), zIndexOffset: 2000, interactive: false, keyboard: false }).addTo(map);
    else meMarker.setLatLng([state.me.lat, state.me.lng]);
  }
  if (draftMarker) { draftMarker.remove(); draftMarker = null; }
  if (state.draft) draftMarker = L.marker([state.draft.lat, state.draft.lng], { icon: L.divIcon({ className: "hd-pin", html: hotdogSvg("#ffc61a"), iconSize: [64, 56], iconAnchor: [32, 52] }), opacity: 0.7 }).addTo(map);
}
function fitToNearest() {
  if (!state.me) return;
  const near = visible().slice(0, 3);
  const pts = [[state.me.lat, state.me.lng], ...near.map((s) => [s.lat, s.lng])];
  if (pts.length > 1) map.fitBounds(pts, { padding: [70, 70], maxZoom: 17 });
  else map.setView(pts[0], 15);
}
map.on("click", (e) => {
  const pt = { lat: e.latlng.lat, lng: e.latlng.lng };
  if (state.mode === "move") { state.me = pt; state.gps = false; state.mode = "browse"; state.selected = null; toast("Got it, that's you"); render(); loadSpots(); }
  else if (state.mode === "add") { state.draft = pt; render(); }
});

/* ---------- location ---------- */
function locate(first) {
  if (!navigator.geolocation) { if (first) useFallback(); return; }
  if (!first) toast("Finding you…");
  navigator.geolocation.getCurrentPosition(
    (p) => { state.me = { lat: p.coords.latitude, lng: p.coords.longitude }; state.gps = true; map.setView([state.me.lat, state.me.lng], 16); render(); loadSpots(); watch(); },
    () => { if (first) useFallback(); else toast("Location is off. Tap Move me and then the map instead."); },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}
let watchId = null, lastPanelRender = 0;
function watch() {
  if (watchId != null || !navigator.geolocation) return;
  watchId = navigator.geolocation.watchPosition(onPosition, () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}
function onPosition(p) {
  state.me = { lat: p.coords.latitude, lng: p.coords.longitude }; state.gps = true;
  if (state.lastLoad && metres(state.lastLoad, state.me) > 1500 && !state.loading) loadSpots();
  if (state.nav) { updateNav(); if (state.follow) map.panTo([state.me.lat, state.me.lng], { animate: true }); }
  checkAlerts();
  // Keep typing safe: only redraw the map while a form is open.
  if (state.reviewing || state.mode !== "browse") { drawMap(); return; }
  if (state.nav || Date.now() - lastPanelRender > 5000) { lastPanelRender = Date.now(); render(); } else drawMap();
}
function useFallback() { state.me = { ...DEFAULT_CENTRE }; state.gps = false; render(); loadSpots(); toast("Showing Sydney. Tap Move me to set where you are."); }

/* ---------- walking directions (in the app) ---------- */
const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
function stepText(s) {
  const m = s.maneuver, onto = s.name ? ` onto ${s.name}` : "";
  if (m.type === "depart") return `Head ${COMPASS[Math.round((m.bearing_after || 0) / 45) % 8]}${s.name ? ` on ${s.name}` : ""}`;
  if (m.type === "arrive") return "Arrive at the hotdog";
  const mod = m.modifier || "";
  if (mod === "uturn") return "Turn around";
  if (/left|right/.test(mod)) return `${mod.startsWith("slight") ? "Bear" : "Turn"} ${mod.replace(/^(slight|sharp) /, "")}${onto}`;
  return `Continue${onto}`;
}
async function getRoute(from, to) {
  try {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 12000);
    const res = await fetch(`${ROUTER}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`, { signal: ctl.signal });
    clearTimeout(timer);
    const j = await res.json(); const r = j.routes && j.routes[0];
    if (!r) throw new Error("no route");
    return {
      coords: r.geometry.coordinates.map(([x, y]) => [y, x]), total: r.distance, straight: false,
      steps: r.legs[0].steps.map((s) => ({ text: stepText(s), at: { lat: s.maneuver.location[1], lng: s.maneuver.location[0] } })),
    };
  } catch (e) {
    return { coords: [[from.lat, from.lng], [to.lat, to.lng]], total: metres(from, to), straight: true, steps: [{ text: `Head towards ${to.name}`, at: from }, { text: "Arrive at the hotdog", at: to }] };
  }
}
async function startNav(s) {
  if (!state.me) { toast("Tap Find me first so we know where you are"); return; }
  state.selected = s.id; state.reviewing = false; state.tab = "spots"; state.follow = true;
  toast("Plotting your walk…");
  const r = await getRoute(state.me, s);
  state.nav = { spot: s, ...r, idx: 0, arrived: false };
  if (!state.gps) toast("Tip: tap Find me so the map can follow you as you walk");
  watch();
  map.fitBounds(state.nav.coords, { padding: [60, 60], maxZoom: 18 });
  updateNav(); render();
}
function stopNav() { state.nav = null; render(); }
function updateNav() {
  const n = state.nav; if (!n || !state.me) return;
  // advance past steps we've reached
  while (n.idx + 1 < n.steps.length && metres(state.me, n.steps[n.idx + 1].at) < 20) n.idx++;
  // remaining distance along the route from the closest point
  let best = 0, bestD = Infinity;
  n.coords.forEach((c, i) => { const d = metres(state.me, { lat: c[0], lng: c[1] }); if (d < bestD) { bestD = d; best = i; } });
  let rem = bestD;
  for (let i = best; i < n.coords.length - 1; i++) rem += metres({ lat: n.coords[i][0], lng: n.coords[i][1] }, { lat: n.coords[i + 1][0], lng: n.coords[i + 1][1] });
  n.remaining = rem;
  if (!n.arrived && metres(state.me, n.spot) <= ARRIVE_M) { n.arrived = true; toast("You made it! Enjoy that hotdog"); if (navigator.vibrate) navigator.vibrate([120, 60, 120]); }
}
function navCard() {
  const n = state.nav, s = n.spot;
  const rem = n.remaining ?? n.total;
  const next = n.steps[Math.min(n.idx + 1, n.steps.length - 1)];
  if (n.arrived) return `<div class="result nav">
    <div class="meta">You made it to</div><div class="name">${esc(s.name)}</div>
    <p class="note" style="color:var(--ink)">Grab your hotdog, then log it.</p>
    <div class="actions"><button class="btn eat" data-act="eat">I ate one!</button><button class="btn" data-act="stopnav">Done</button></div></div>`;
  return `<div class="result nav">
    <div class="meta">Walking to</div>
    <div class="name">${esc(s.name)}</div>
    <div class="meta"><span class="big">${fmtDist(rem)}</span><span>${mins(rem)} min left</span></div>
    <div class="nextstep"><span class="arrow" aria-hidden="true">${arrowFor(next.text)}</span><span>${esc(next.text)}</span></div>
    ${n.straight ? `<p class="note">Couldn't load street directions, so this is a straight line. Follow the streets towards the pin.</p>` : ""}
    <div class="actions">
      ${state.follow ? "" : `<button class="btn" data-act="recenter">Follow me</button>`}
      <button class="btn" data-act="stopnav">Stop</button>
    </div>
  </div>
  <h2>Steps</h2>
  <ol class="steps">${n.steps.map((st, i) => `<li class="${i <= n.idx ? "done" : ""}">${esc(st.text)}</li>`).join("")}</ol>
  <p class="note">Prefer Google Maps? <a href="${mapsUrl(s)}" target="_blank" rel="noopener">Open this walk there</a>.</p>`;
}
const arrowFor = (t) => (/left/i.test(t) ? "⬅" : /right/i.test(t) ? "➡" : /around/i.test(t) ? "⤾" : /Arrive/.test(t) ? "★" : "⬆");
map.on("dragstart", () => { if (state.nav && state.follow) { state.follow = false; render(); } });

/* ---------- hotdog alerts ---------- */
async function enableAlerts() {
  if (!("Notification" in window)) {
    toast(/iPhone|iPad/.test(navigator.userAgent) ? "On iPhone, add HotDang to your Home Screen first, then turn alerts on there" : "This browser can't show alerts");
    return;
  }
  let perm = Notification.permission;
  if (perm === "default") perm = await Notification.requestPermission();
  if (perm !== "granted") { toast("Alerts are blocked. Allow notifications for this site in your settings."); return; }
  state.alerts = true; store.set("hd.alerts", true);
  if (!state.gps) locate(false); else watch();
  toast(`Alerts on. We'll buzz you when a hotdog is within ${ALERT_M} m`);
  render(); checkAlerts();
}
function disableAlerts() { state.alerts = false; store.set("hd.alerts", false); toast("Alerts off"); render(); }
function checkAlerts() {
  if (!state.alerts || !state.gps || !state.me) return;
  const now = Date.now();
  const near = visible().find((s) => dist(s) <= ALERT_M && statusOf(s).state !== "closed" && !(state.alerted[s.id] && now - state.alerted[s.id] < ALERT_REPEAT_MS));
  if (!near) return;
  state.alerted[near.id] = now; store.set("hd.alerted", state.alerted);
  notify(near, dist(near));
}
async function notify(s, d) {
  const sp = specialsText(s, 2);
  const title = sp ? `Hot dang! ${sp} ${fmtDist(d)} away` : `Hot dang! Hotdog ${fmtDist(d)} away`;
  const body = `${s.name}, ${mins(d)} min walk.${sp ? ` They do ${specialsOf(s).map((x) => x.label.toLowerCase()).join(", ")}.` : ""} Tap to go.`;
  const opts = { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "hd-" + s.id, data: { id: s.id }, vibrate: [100, 50, 100] };
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg) await reg.showNotification(title, opts);
    else if (Notification.permission === "granted") new Notification(title, opts).onclick = () => { window.focus(); goTo(s.id); };
  } catch (e) {}
  if (document.visibilityState === "visible") toast(title);
}
function goTo(id) { const s = findSpot(id); if (s) startNav(s); }
let pendingGo = new URLSearchParams(location.search).get("go");
function openFromLink() { if (pendingGo && findSpot(pendingGo)) { const id = pendingGo; pendingGo = null; history.replaceState(null, "", location.pathname); goTo(id); } }
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.go) { pendingGo = e.data.go; openFromLink(); } });
}

/* ---------- panel ---------- */
const panel = $("#panel");
function spotCard(s, heading) {
  const m = dist(s), r = ratingOf(s.id), mine = state.eaten.filter((e) => e.id === s.id).length;
  const seen = state.seen[s.id] || s.added;
  const reviews = (state.reviews[s.id] || []).slice().reverse();
  const status = s.likely
    ? `<span class="badge likely">Usually sells hotdogs</span>`
    : seen ? `<span class="badge ${Date.now() - seen < 7 * DAY ? "ok" : "warn"}">Seen ${ago(seen)}</span>` : `<span class="badge likely">Not checked yet</span>`;
  return `<h2>${heading}</h2>
  <div class="result">
    <div class="meta"><span class="dot t-${s.type}"></span>${TYPES[s.type]} · ${esc(s.item)}${s.price ? ` · $${Number(s.price).toFixed(2)}` : ""}</div>
    <div class="name">${esc(s.name)} ${statusTag(s)}</div>
    <div class="meta"><span class="stars" aria-label="${r.avg.toFixed(1)} out of 5">${starStr(r.avg)}</span><span>${r.n ? `${r.avg.toFixed(1)} · ${r.n} review${r.n === 1 ? "" : "s"}` : "No reviews yet"}</span></div>
    <div class="meta"><span class="big">${fmtDist(m)}</span><span>${m < 5000 ? mins(m) + " min walk" : ""}</span></div>
    <div class="meta">${status}${mine ? `<span>You've had ${mine} here</span>` : ""}</div>
    <div class="meta">${esc(statusOf(s).label)}${s.hoursRaw ? ` · <span title="${esc(s.hoursRaw)}">${esc(s.hoursRaw.length > 40 ? s.hoursRaw.slice(0, 40) + "…" : s.hoursRaw)}</span>` : ""}</div>
    ${s.photo ? `<img class="photo" src="${s.photo}" alt="Photo of ${esc(s.name)}">` : ""}
    <div class="actions">
      <button class="btn eat" data-act="eat">I ate one!</button>
      <button class="btn primary" data-act="go">Take me there</button>
      <button class="btn" data-act="yes">Still here</button>
    </div>
  </div>
  <h2>What dogs they have</h2>
  ${dogsSection(s)}
  <h2>Photos</h2>
  <div id="hd-photos" data-spot="${esc(s.id)}"><p class="note">${social() ? "Loading photos…" : OFFLINE_NOTE}</p></div>
  <h2>Reviews</h2>
  ${state.reviewing ? reviewForm() : `<div><button class="btn" data-act="review">Write a review</button></div>`}
  <div id="hd-reviews" data-spot="${esc(s.id)}"></div>
  <div class="reviews">${reviews.length ? reviews.map((rv) => `<div class="review"><div class="who">You <span class="stars">${starStr(rv.stars)}</span><span class="note">${ago(rv.t)}</span></div><p>${esc(rv.text)}</p></div>`).join("") : `<p class="note">No reviews yet. Be the first.</p>`}</div>
  ${s.osm ? `<p class="note">Spot from <a href="${s.osm}" target="_blank" rel="noopener">OpenStreetMap</a>. Wrong? You can fix it there.</p>` : ""}`;
}
function dogsSection(s) {
  const have = new Set(specialsOf(s).map((x) => x.key));
  if (state.editingDogs) return `<div class="dogpick" role="group" aria-label="Dogs on the menu">
    ${SPECIALS.map((x) => `<button type="button" class="chip" data-dog="${x.key}" aria-pressed="${have.has(x.key)}">${x.label}</button>`).join("")}
    </div><div class="actions"><button class="btn primary" data-act="dogsdone">Done</button></div>`;
  return `${have.size ? `<div class="dogs">${specialsOf(s).map((x) => `<span class="dogchip">${x.label}</span>`).join("")}</div>` : `<p class="note">Just classic dogs as far as we know.</p>`}
    <div><button class="btn" data-act="dogsedit">${have.size ? "Edit" : "Add"} what they have</button></div>`;
}
function reviewForm() {
  return `<form id="reviewForm">
  <div class="starpick" role="group" aria-label="Your rating">${[1, 2, 3, 4, 5].map((i) => `<button type="button" data-star="${i}" class="${i <= state.pick ? "on" : ""}" aria-label="${i} star${i > 1 ? "s" : ""}">★</button>`).join("")}</div>
  <label for="r-text">Your review<textarea id="r-text" placeholder="How was the snap? The bun? The sauce?"></textarea></label>
  <div class="actions"><button class="btn primary" type="submit" ${state.pick ? "" : "disabled"}>Post review</button><button class="btn" type="button" data-act="cancelreview">Cancel</button></div>
</form>`;
}
function statsView() {
  const me = state.eaten.length;
  const week = state.eaten.filter((e) => Date.now() - e.t < 7 * DAY).length;
  const places = new Set(state.eaten.map((e) => e.id)).size;
  const recent = state.eaten.slice(-8).reverse().map((e) => `<div class="row"><span class="dot t-${e.type || "stand"}"></span><span class="n">${esc(e.name)}</span><span class="d muted">${ago(e.t)}</span></div>`).join("");
  return `<div class="mycount"><div class="num">${me}</div><div><b>hotdogs eaten</b><div class="note">${week} this week · ${places} different spot${places === 1 ? "" : "s"}</div></div></div>
  ${recent ? `<h2>Your recent dogs</h2><div class="list">${recent}</div>` : `<p class="note">Tap "I ate one!" on any spot to start counting.</p>`}
  <div id="hd-account"></div>
  <div id="hd-leaderboard"><div class="soon"><h2>Global leaderboard</h2><p class="note">${social() ? "Loading…" : OFFLINE_NOTE}</p></div></div>`;
}
function social() { return window.HDSocial && window.HDSocial.ready ? window.HDSocial : null; }
function render() { renderCore(); try { social()?.afterRender(); } catch (e) { console.error(e); } }
function renderCore() {
  drawMap();
  $("#count").textContent = state.eaten.length;
  $("#addBtn").setAttribute("aria-pressed", state.mode === "add");
  $("#moveBtn").setAttribute("aria-pressed", state.mode === "move");
  const hint = $("#hint");
  hint.hidden = state.mode === "browse";
  hint.textContent = state.mode === "move" ? "Tap the map to set where you are." : state.draft ? "Now fill in the details." : "Tap the map where the hotdog is.";
  const tabs = `<div class="tabs" role="tablist"><button class="tab" role="tab" data-tab="spots" aria-selected="${state.tab === "spots"}">Find hotdogs</button><button class="tab" role="tab" data-tab="feed" aria-selected="${state.tab === "feed"}">Photos</button><button class="tab" role="tab" data-tab="stats" aria-selected="${state.tab === "stats"}">My hotdogs</button></div>`;
  if (state.tab === "stats" && state.mode === "browse") { panel.innerHTML = tabs + statsView(); return; }
  if (state.tab === "feed" && state.mode === "browse") { panel.innerHTML = tabs + `<div id="hd-feed"><h2>Latest hotdog photos</h2><p class="note">${social() ? "Loading the latest hotdog photos…" : OFFLINE_NOTE}</p></div>`; return; }
  const list = visible();
  const filters = [["all", "All"], ["stand", "Street vendors"], ["restaurant", "Restaurants"], ["shelf", "Convenience stores"], ["special", "Specialty dogs"]]
    .map(([k, l]) => `<button class="chip" data-filter="${k}" aria-pressed="${state.filter === k}">${k !== "all" && k !== "special" ? `<span class="dot t-${k}"></span>` : ""}${l}</button>`).join("");
  let top;
  if (state.mode === "add") {
    top = `<h2>Add a hotdog spot</h2>
    <form id="addForm">
      ${state.draft ? "" : `<p class="note">First tap the map to drop a pin.</p>`}
      <label for="f-name">Place name<input type="text" id="f-name" required placeholder="e.g. Sam's Sausage Sizzle"></label>
      <div class="two">
        <label for="f-type">Kind<select id="f-type"><option value="stand">Street vendor</option><option value="restaurant">Restaurant</option><option value="shelf">Convenience store</option></select></label>
        <label for="f-price">Price<input type="number" id="f-price" min="0" step="0.1" placeholder="5.00"></label>
      </div>
      <label for="f-photo">Photo<input type="file" id="f-photo" accept="image/*"></label>
      <div class="actions"><button class="btn primary" type="submit" ${state.draft ? "" : "disabled"}>Add spot</button><button class="btn" type="button" data-act="cancel">Cancel</button></div>
      <p class="note">Saved on this phone for now. Sharing spots with everyone comes with accounts.</p>
    </form>`;
  } else if (state.nav) {
    top = navCard();
  } else if (state.loading && !list.length) {
    top = `<div class="status"><h2>Sniffing out hotdogs…</h2><p class="note">Checking street vendors, restaurants and stores near you.</p></div>`;
  } else if (state.error && !list.length) {
    top = `<div class="status"><h2>No signal from the hotdog radar</h2><p class="note">${esc(state.error)}</p><div><button class="btn primary" data-act="retry">Try again</button></div></div>`;
  } else if (!list.length) {
    top = `<div class="status"><h2>No hotdogs found nearby</h2><p class="note">We searched ${fmtDist(state.searchedRadius)} around you. Know a spot? Add it so the next hungry person finds it.</p><div><button class="btn primary" data-act="add">+ Add a spot</button></div></div>`;
  } else {
    const s = findSpot(state.selected) || list[0];
    top = spotCard(s, s.id === list[0]?.id ? "Your closest hotdog" : "Selected spot");
  }
  const rows = list.slice(0, 40).map((s) => { const r = ratingOf(s.id); return `<button class="row" data-id="${esc(s.id)}" aria-current="${s.id === state.selected}">
    <span class="dot t-${s.type}"></span><span class="n"><span class="nm">${esc(s.name)}</span> ${statusTag(s)}<span class="sub">${specialsOf(s).length ? `<b class="spec">${esc(specialsText(s))}</b>` : s.likely ? "Usually sells hotdogs" : r.n ? "★ " + r.avg.toFixed(1) : TYPES[s.type]}</span></span><span class="d">${fmtDist(dist(s))}</span></button>`; }).join("");
  const alertRow = `<div class="alertrow"><div><b>Hotdog alerts</b><div class="note">${state.alerts ? `On. We'll let you know when one is within ${ALERT_M} m.` : `Get a buzz when a hotdog is within ${ALERT_M} m.`}</div></div>
    <button class="switch" role="switch" aria-checked="${state.alerts}" data-act="${state.alerts ? "alertsoff" : "alertson"}" aria-label="Hotdog alerts"><span></span></button></div>`;
  panel.innerHTML = `${tabs}${state.nav ? "" : `<div class="filters" role="group" aria-label="Filter spots">${filters}</div>`}${top}${state.nav ? "" : alertRow}
    ${rows ? `<h2>Nearby</h2><div class="list">${rows}</div>` : ""}
    <p class="note">${state.gps ? "Using your location." : "Location not shared. Tap Find me or Move me."} Map data from OpenStreetMap.</p>`;
}

/* ---------- events ---------- */
panel.addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.tab) { state.tab = b.dataset.tab; state.reviewing = false; render(); return; }
  if (b.dataset.star) {
    state.pick = +b.dataset.star;
    panel.querySelectorAll("[data-star]").forEach((x) => x.classList.toggle("on", +x.dataset.star <= state.pick));
    panel.querySelector("#reviewForm [type=submit]").disabled = false; return;
  }
  if (b.dataset.dog) {
    const s = findSpot(state.selected) || visible()[0]; if (!s) return;
    const cur = new Set(state.dogTags[s.id] || []);
    const on = b.getAttribute("aria-pressed") !== "true";
    if (on) cur.add(b.dataset.dog); else { cur.delete(b.dataset.dog); if ((s.osmSpecials || []).includes(b.dataset.dog)) s.osmSpecials = s.osmSpecials.filter((k) => k !== b.dataset.dog); }
    state.dogTags[s.id] = [...cur]; saveDogs(); b.setAttribute("aria-pressed", String(on)); social()?.onDog(s, b.dataset.dog, on); return;
  }
  if (b.dataset.filter) { state.filter = b.dataset.filter; state.selected = null; state.reviewing = false; render(); return; }
  if (b.dataset.id) { state.selected = b.dataset.id; state.reviewing = false; state.editingDogs = false; const s = findSpot(b.dataset.id); if (s) map.panTo([s.lat, s.lng]); render(); return; }
  const s = (state.nav && state.nav.spot) || findSpot(state.selected) || visible()[0];
  switch (b.dataset.act) {
    case "retry": loadSpots(); break;
    case "go": startNav(s); break;
    case "stopnav": stopNav(); break;
    case "recenter": state.follow = true; if (state.me) map.panTo([state.me.lat, state.me.lng]); render(); break;
    case "alertson": enableAlerts(); break;
    case "alertsoff": disableAlerts(); break;
    case "dogsedit": state.editingDogs = true; render(); break;
    case "dogsdone": state.editingDogs = false; toast("Thanks! Menu updated"); render(); break;
    case "add": startAdd(); break;
    case "cancel": state.mode = "browse"; state.draft = null; render(); break;
    case "yes": state.seen[s.id] = Date.now(); saveAll(); toast("Thanks for checking!"); render(); break;
    case "eat": {
      social()?.onEat(s);
      state.selected = s.id; state.eaten.push({ id: s.id, name: s.name, type: s.type, t: Date.now() }); saveAll();
      toast(`Hot dang! That's hotdog #${state.eaten.length}`); render();
      const c = $("#counter"); c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump"); break;
    }
    case "review": state.selected = s.id; state.reviewing = true; state.pick = 0; render(); $("#r-text")?.focus(); break;
    case "cancelreview": state.reviewing = false; render(); break;
  }
});
panel.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (e.target.id === "reviewForm") {
    const s = findSpot(state.selected) || visible()[0];
    if (!state.pick || !s) return;
    (state.reviews[s.id] ||= []).push({ stars: state.pick, text: $("#r-text").value.trim() || "No words, just vibes.", t: Date.now() });
    social()?.onReview(s, state.pick, $("#r-text").value.trim());
    state.reviewing = false; saveAll(); toast("Review posted"); render(); return;
  }
  if (!state.draft) return;
  const file = $("#f-photo").files[0];
  const photo = file ? await shrink(file) : null;
  const s = { id: "me:" + Date.now(), src: "you", name: $("#f-name").value.trim() || "Unnamed spot", type: $("#f-type").value, item: "Hotdogs",
    lat: state.draft.lat, lng: state.draft.lng, price: parseFloat($("#f-price").value) || null, added: Date.now(), photo };
  state.mine.push(s); state.selected = s.id; state.mode = "browse"; state.draft = null; saveAll(); toast("Spot added!"); render();
});
function shrink(file) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => { const img = new Image(); img.onload = () => { const c = document.createElement("canvas"); const k = Math.min(1, 480 / img.width); c.width = img.width * k; c.height = img.height * k; c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL("image/jpeg", 0.7)); }; img.onerror = () => res(null); img.src = r.result; };
    r.onerror = () => res(null); r.readAsDataURL(file);
  });
}
function startAdd() { state.mode = "add"; state.draft = null; state.tab = "spots"; render(); }
$("#counter").addEventListener("click", () => { state.tab = "stats"; state.mode = "browse"; state.draft = null; render(); });
$("#find").addEventListener("click", () => {
  state.mode = "browse"; state.draft = null; state.tab = "spots"; state.reviewing = false;
  const n = visible().find((s) => statusOf(s).state !== "closed") || visible()[0];
  if (n) { state.selected = n.id; map.flyTo([n.lat, n.lng], Math.max(map.getZoom(), 16)); toast(`${n.name}, ${fmtDist(dist(n))} away`); }
  else toast(state.loading ? "Still sniffing…" : "No hotdogs found yet");
  render();
});
$("#addBtn").addEventListener("click", () => (state.mode === "add" ? ((state.mode = "browse"), (state.draft = null), render()) : startAdd()));
$("#moveBtn").addEventListener("click", () => { state.mode = state.mode === "move" ? "browse" : "move"; state.draft = null; render(); });
$("#locateBtn").addEventListener("click", () => locate(false));

render();
locate(true);
