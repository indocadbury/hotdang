/* HotDang community features (Supabase):
 * sign in, photo posts with likes / dislikes / comments, global leaderboard,
 * shared reviews and "what dogs they have" tags.
 * The app still works without this: everything falls back to this device.
 */
"use strict";
(function () {
  const cfg = window.HOTDANG_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseKey || !window.supabase) return;

  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" }, // implicit so an emailed link works in whichever browser the mail app opens
  });
  const me = { user: null, profile: null };
  const cache = { photos: {}, reviews: {}, comments: {}, myVotes: {} };
  const openComments = new Set();
  let loadingSpot = null;

  const photoUrl = (path) => sb.storage.from("photos").getPublicUrl(path).data.publicUrl;
  const signedIn = () => !!(me.user && me.profile);
  const loginNeeded = (what) => {
    toast(`Sign in to ${what}`);
    state.tab = "stats"; state.mode = "browse"; render(); if (typeof showPanel === "function") showPanel();
    setTimeout(() => document.getElementById("hd-email")?.focus(), 50);
  };

  /* ---------- account ---------- */
  async function loadProfile() {
    const { data: { session } } = await sb.auth.getSession();
    me.user = session?.user || null; me.profile = null;
    if (me.user) {
      const { data } = await sb.from("profiles").select("*").eq("id", me.user.id).maybeSingle();
      me.profile = data || null;
    }
  }
  function accountHtml() {
    if (me.user && !me.profile) return `<form id="hd-name-form" class="acct">
      <h2>Pick a username</h2>
      <p class="note">This is how you'll show up on the leaderboard and on your photos.</p>
      <label for="hd-username">Username<input type="text" id="hd-username" required minlength="2" maxlength="24" pattern="[A-Za-z0-9_ .-]+" placeholder="e.g. MustardMel"></label>
      <div class="actions"><button class="btn primary" type="submit">Save</button></div></form>`;
    if (signedIn()) return `<div class="acct row-acct"><div><b>Signed in as ${esc(me.profile.username)}</b><div class="note">Your hotdogs, photos and reviews are shared with everyone.</div></div><button class="btn" data-soc="signout">Sign out</button></div>`;
    return `<form id="hd-login-form" class="acct">
      <h2>Join the leaderboard</h2>
      <p class="note">Sign in to post photos, like, comment and compete worldwide. We'll email you a sign-in link, no password needed.</p>
      <label for="hd-email">Email<input type="email" id="hd-email" required autocomplete="email" placeholder="you@example.com"></label>
      <div class="actions"><button class="btn primary" type="submit">Email me a link</button></div>
      <p id="hd-login-status" class="note login-status" role="status" hidden></p></form>`;
  }
  async function sendLink(email) {
    const redirect = location.origin + location.pathname;
    const btn = document.querySelector("#hd-login-form button[type=submit]"), out = document.getElementById("hd-login-status");
    const say = (msg, bad) => { if (out) { out.textContent = msg; out.classList.toggle("bad", !!bad); out.hidden = false; } toast(msg); };
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
    let error;
    try { ({ error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } })); }
    catch (e) { error = e; }
    if (btn) { btn.disabled = false; btn.textContent = "Email me a link"; }
    if (error) say(/rate|limit|seconds/i.test(error.message || "") ? `Too many tries. Wait a few minutes and try again. (${error.message})` : `Couldn't send the link: ${error.message || error}`, true);
    else say(`Sent! Check ${email} for "Your Magic Link" (look in Junk too) and open it on this phone.`);
  }
  async function saveUsername(name) {
    const { error } = await sb.from("profiles").insert({ id: me.user.id, username: name.trim() });
    if (error) { toast(/duplicate|unique/i.test(error.message) ? "That username is taken, try another" : `Couldn't save: ${error.message}`); return; }
    await loadProfile();
    // bring this device's count along the first time
    if (state.eaten.length) {
      await sb.from("eats").insert(state.eaten.map((e) => ({ spot_id: e.id, spot_name: e.name, created_at: new Date(e.t).toISOString() })));
    }
    toast(`Welcome, ${me.profile.username}!`); render();
  }

  /* ---------- leaderboard ---------- */
  async function leaderboardHtml() {
    const { data, error } = await sb.from("leaderboard").select("*").limit(25);
    if (error) return `<div class="soon"><h2>Global leaderboard</h2><p class="note">Couldn't load the leaderboard right now.</p></div>`;
    if (!data.length) return `<div class="soon"><h2>Global leaderboard</h2><p class="note">Nobody's on the board yet. Sign in and log a hotdog to take first place.</p></div>`;
    return `<h2>Global leaderboard</h2><div class="list board">${data.map((r, i) => `<div class="row ${me.user && r.id === me.user.id ? "you" : ""}"><span class="rank">${i + 1}</span><span class="n">${esc(r.username || "Anonymous")}</span><span class="d">${r.eaten}</span></div>`).join("")}</div>`;
  }

  /* ---------- photo posts ---------- */
  async function fetchPosts(spotId) {
    let q = sb.from("post_feed").select("*").order("created_at", { ascending: false }).limit(spotId ? 20 : 30);
    if (spotId) q = q.eq("spot_id", spotId);
    const { data, error } = await q;
    if (error) throw error;
    if (me.user && data.length) {
      const { data: votes } = await sb.from("post_votes").select("post_id,value").eq("user_id", me.user.id).in("post_id", data.map((p) => p.id));
      (votes || []).forEach((v) => (cache.myVotes[v.post_id] = v.value));
    }
    return data;
  }
  const shown = new Set();
  const buried = (p) => p.dislikes >= 5 && p.dislikes >= p.likes * 2 && !shown.has(p.id);
  function postHtml(p, showSpot) {
    if (buried(p)) return `<article class="post buried" data-post="${p.id}"><div class="post-body"><p class="note">Hidden because lots of people disliked it.</p><div><button class="vote" data-soc="unbury">Show anyway</button></div></div></article>`;
    const mine = cache.myVotes[p.id] || 0;
    const comments = cache.comments[p.id];
    return `<article class="post" data-post="${p.id}">
      <img class="post-img" src="${esc(photoUrl(p.photo_path))}" alt="${esc(p.caption || "Hotdog photo")}" loading="lazy">
      <div class="post-body">
        <div class="meta"><b style="color:var(--ink)">${esc(p.username)}</b><span>${ago(new Date(p.created_at).getTime())}</span></div>
        ${showSpot ? `<div class="post-place">📍 <button class="linkish" data-soc="openspot" data-spot="${esc(p.spot_id)}"${p.lat != null ? ` data-lat="${p.lat}" data-lng="${p.lng}"` : ""}>${esc(p.spot_name || "a hotdog spot")}</button>${p.city ? `<span>${esc(p.city)}</span>` : ""}</div>` : ""}
        ${p.caption ? `<p class="caption">${esc(p.caption)}</p>` : ""}
        <div class="actions votes">
          <button class="vote ${mine === 1 ? "on" : ""}" data-soc="vote" data-v="1" aria-pressed="${mine === 1}" aria-label="Like">👍 <span>${p.likes}</span></button>
          <button class="vote ${mine === -1 ? "on" : ""}" data-soc="vote" data-v="-1" aria-pressed="${mine === -1}" aria-label="Dislike">👎 <span>${p.dislikes}</span></button>
          <button class="vote" data-soc="comments" aria-expanded="${openComments.has(p.id)}">💬 <span>${p.comments}</span></button>
          ${me.user && p.user_id === me.user.id ? `<button class="vote" data-soc="delpost" aria-label="Delete photo">Delete</button>` : ""}
        </div>
        ${openComments.has(p.id) ? `<div class="comments">
          ${comments ? (comments.length ? comments.map((c) => `<div class="comment"><b>${esc(c.profiles?.username || "Someone")}</b> ${esc(c.body)} <span class="note">${ago(new Date(c.created_at).getTime())}</span></div>`).join("") : `<p class="note">No comments yet.</p>`) : `<p class="note">Loading…</p>`}
          <form class="comment-form" data-post="${p.id}"><label class="sr" for="c-${p.id}">Add a comment</label><input type="text" id="c-${p.id}" maxlength="500" placeholder="${signedIn() ? "Add a comment" : "Sign in to comment"}" required><button class="btn" type="submit">Post</button></form>
        </div>` : ""}
      </div></article>`;
  }
  function uploaderHtml(s) {
    return `<form class="uploader" id="hd-upload" data-spot="${esc(s.id)}">
      <label for="hd-photo" class="btn eat">📸 Add your hotdog photo</label>
      <input type="file" id="hd-photo" accept="image/*" class="sr">
      <div id="hd-upload-more" hidden>
        <img id="hd-preview" class="photo" alt="Your photo">
        <label for="hd-caption">Caption<input type="text" id="hd-caption" maxlength="280" placeholder="e.g. Chilli cheese footlong, absolute unit"></label>
        <div class="actions"><button class="btn primary" type="submit">Post photo</button><button class="btn" type="button" data-soc="cancelupload">Cancel</button></div>
      </div></form>`;
  }
  async function uploadPhoto(spot, file, caption) {
    if (!signedIn()) return loginNeeded("post photos");
    toast("Uploading…");
    const dataUrl = await shrinkTo(file, 1280);
    if (!dataUrl) { toast("That photo couldn't be read"); return; }
    const blob = await (await fetch(dataUrl)).blob();
    const path = `${me.user.id}/${Date.now()}.jpg`;
    const up = await sb.storage.from("photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (up.error) { toast(`Upload failed: ${up.error.message}`); return; }
    const row = { spot_id: spot.id, spot_name: spot.name, photo_path: path, caption: caption || null };
    const place = typeof cityOf === "function" ? await cityOf(spot).catch(() => null) : null;
    let { error } = await sb.from("posts").insert({ ...row, city: place ? `${place.city}${place.country ? ", " + place.country : ""}` : null, lat: spot.lat, lng: spot.lng });
    if (error && /city|lat|lng|column/i.test(error.message)) ({ error } = await sb.from("posts").insert(row)); // database not updated yet
    if (error) { toast(`Couldn't post: ${error.message}`); return; }
    delete cache.photos[spot.id]; toast("Photo posted!"); render();
  }
  function shrinkTo(file, max) {
    return new Promise((res) => {
      const r = new FileReader();
      r.onload = () => { const img = new Image(); img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL("image/jpeg", 0.82)); }; img.onerror = () => res(null); img.src = r.result; };
      r.onerror = () => res(null); r.readAsDataURL(file);
    });
  }
  async function vote(postId, value) {
    if (!signedIn()) return loginNeeded("like or dislike photos");
    const cur = cache.myVotes[postId] || 0;
    if (cur === value) { await sb.from("post_votes").delete().eq("post_id", postId).eq("user_id", me.user.id); delete cache.myVotes[postId]; }
    else { await sb.from("post_votes").upsert({ post_id: postId, user_id: me.user.id, value }); cache.myVotes[postId] = value; }
    refreshVisiblePosts();
  }
  async function loadComments(postId) {
    const { data } = await sb.from("post_comments").select("id,body,created_at,profiles(username)").eq("post_id", postId).order("created_at");
    cache.comments[postId] = data || [];
  }
  async function addComment(postId, body) {
    if (!signedIn()) return loginNeeded("comment");
    const { error } = await sb.from("post_comments").insert({ post_id: postId, body });
    if (error) { toast(`Couldn't comment: ${error.message}`); return; }
    await loadComments(postId); refreshVisiblePosts();
  }
  async function deletePost(postId) {
    const p = Object.values(cache.photos).flat().find((x) => x.id === postId) || (cache.feed || []).find((x) => x.id === postId);
    await sb.from("posts").delete().eq("id", postId);
    if (p) await sb.storage.from("photos").remove([p.photo_path]);
    toast("Photo deleted"); cache.photos = {}; cache.feed = null; render();
  }
  async function refreshVisiblePosts() {
    const box = document.getElementById("hd-photos"), feed = document.getElementById("hd-feed");
    if (box) { delete cache.photos[box.dataset.spot]; await fillPhotos(); }
    if (feed) { cache.feed = null; await fillFeed(); }
  }

  /* ---------- filling the panel ---------- */
  async function fillPhotos() {
    const box = document.getElementById("hd-photos"); if (!box) return;
    const id = box.dataset.spot, s = findSpot(id); if (!s) return;
    try {
      if (!cache.photos[id]) { loadingSpot = id; cache.photos[id] = await fetchPosts(id); }
      const posts = cache.photos[id];
      const el = document.getElementById("hd-photos"); if (!el || el.dataset.spot !== id) return;
      el.innerHTML = uploaderHtml(s) + (posts.length ? `<div class="posts">${posts.map((p) => postHtml(p)).join("")}</div>` : `<p class="note">No photos yet. Be the first to show off this spot's dogs.</p>`);
    } catch (e) { box.innerHTML = `<p class="note">Photos couldn't load right now.</p>`; }
  }
  async function fillFeed() {
    const el = document.getElementById("hd-feed"); if (!el) return;
    try {
      if (!cache.feed) cache.feed = await fetchPosts(null);
      const f = document.getElementById("hd-feed"); if (!f) return;
      f.innerHTML = `<h2>Latest hotdog photos</h2>` + (cache.feed.length ? `<div class="posts">${cache.feed.map((p) => postHtml(p, true)).join("")}</div>` : `<p class="note">No photos yet. Open any spot and tap "Add your hotdog photo".</p>`);
    } catch (e) { el.innerHTML = `<p class="note">Photos couldn't load right now.</p>`; }
  }
  async function fillReviews() {
    const box = document.getElementById("hd-reviews"); if (!box) return;
    const id = box.dataset.spot;
    if (signedIn()) box.nextElementSibling?.classList.contains("reviews") && (box.nextElementSibling.hidden = true);
    if (!cache.reviews[id]) {
      const { data } = await sb.from("reviews").select("id,stars,body,created_at,user_id,profiles(username)").eq("spot_id", id).order("created_at", { ascending: false }).limit(30);
      cache.reviews[id] = data || [];
    }
    const rs = cache.reviews[id];
    const el = document.getElementById("hd-reviews"); if (!el || el.dataset.spot !== id) return;
    el.innerHTML = rs.length ? `<div class="reviews">${rs.map((r) => `<div class="review"><div class="who">${esc(r.profiles?.username || "Someone")} <span class="stars">${starStr(r.stars)}</span><span class="note">${ago(new Date(r.created_at).getTime())}</span></div>${r.body ? `<p>${esc(r.body)}</p>` : ""}</div>`).join("")}</div>` : "";
    if (rs.length && el.nextElementSibling?.classList.contains("reviews") && /No reviews yet/.test(el.nextElementSibling.textContent)) el.nextElementSibling.hidden = true;
  }
  async function fillStats() {
    const acct = document.getElementById("hd-account"), lb = document.getElementById("hd-leaderboard");
    if (acct) acct.innerHTML = accountHtml();
    if (lb) { const html = await leaderboardHtml(); const l = document.getElementById("hd-leaderboard"); if (l) l.innerHTML = html; }
  }
  async function loadSharedDogs() {
    // pull community "what dogs they have" tags for spots on screen
    const ids = visible().slice(0, 60).map((s) => s.id);
    if (!ids.length) return;
    const { data } = await sb.from("spot_dogs").select("spot_id,dog").in("spot_id", ids);
    if (!data) return;
    let changed = false;
    for (const s of allSpots()) {
      const tags = data.filter((d) => d.spot_id === s.id).map((d) => d.dog);
      const merged = [...new Set([...(s.osmSpecials || []), ...tags])];
      if (merged.length !== (s.osmSpecials || []).length) { s.osmSpecials = merged; changed = true; }
    }
    if (changed) render();
  }

  /* ---------- shared spots ---------- */
  const toSpot = (r) => ({ id: "c:" + r.id, src: "community", name: r.name, type: r.type, item: "Hotdogs", lat: r.lat, lng: r.lng, price: r.price, added: new Date(r.created_at).getTime(), by: r.profiles?.username || null });
  let lastSpotsAt = null;
  async function loadCommunitySpots() {
    const c = state.me; if (!c) return;
    if (lastSpotsAt && Math.abs(lastSpotsAt.lat - c.lat) < 0.05 && Math.abs(lastSpotsAt.lng - c.lng) < 0.05) return;
    const d = 0.3; // roughly 30 km around you
    const { data, error } = await sb.from("spots").select("id,name,type,lat,lng,price,created_at,profiles(username)")
      .gte("lat", c.lat - d).lte("lat", c.lat + d).gte("lng", c.lng - d).lte("lng", c.lng + d).limit(300);
    if (error || !data) return;
    lastSpotsAt = { lat: c.lat, lng: c.lng };
    state.community = data.map(toSpot);
    render();
  }
  async function addSpot(s) {
    if (!signedIn()) return null;
    const { data, error } = await sb.from("spots").insert({ name: s.name.slice(0, 80), type: s.type, lat: s.lat, lng: s.lng, price: s.price }).select("id,name,type,lat,lng,price,created_at").single();
    if (error || !data) return null;
    const spot = { ...toSpot(data), by: me.profile.username };
    if (s.photo) { // carry the photo across as the spot's first post
      try {
        const blob = await (await fetch(s.photo)).blob();
        const path = `${me.user.id}/${Date.now()}.jpg`;
        const up = await sb.storage.from("photos").upload(path, blob, { contentType: "image/jpeg" });
        if (!up.error) await sb.from("posts").insert({ spot_id: spot.id, spot_name: spot.name, photo_path: path });
      } catch (e) { /* the spot is still shared */ }
    }
    return spot;
  }

  /* ---------- events ---------- */
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-soc]"); if (!b) return;
    const post = b.closest("[data-post]"); const pid = post ? +post.dataset.post : null;
    switch (b.dataset.soc) {
      case "signout": await sb.auth.signOut(); me.user = null; me.profile = null; toast("Signed out"); render(); break;
      case "vote": vote(pid, +b.dataset.v); break;
      case "comments":
        if (openComments.has(pid)) openComments.delete(pid); else { openComments.add(pid); if (!cache.comments[pid]) { refreshVisiblePostsSoon(); await loadComments(pid); } }
        refreshVisiblePostsSoon(); break;
      case "delpost": deletePost(pid); break;
      case "unbury": shown.add(pid); refreshVisiblePostsSoon(); break;
      case "cancelupload": document.getElementById("hd-upload")?.reset(); document.getElementById("hd-upload-more").hidden = true; break;
      case "openspot": {
        const s = findSpot(b.dataset.spot);
        if (s) { state.tab = "spots"; state.selected = s.id; map.panTo([s.lat, s.lng]); render(); }
        else if (b.dataset.lat) { // a dog somewhere else: go there and look around
          const pt = { lat: +b.dataset.lat, lng: +b.dataset.lng };
          if (typeof flyToPlace === "function") flyToPlace(pt, b.textContent);
        } else toast("That spot isn't near you");
        break;
      }
    }
  });
  let soonTimer;
  function refreshVisiblePostsSoon() { clearTimeout(soonTimer); soonTimer = setTimeout(() => { fillPhotosFromCache(); fillFeedFromCache(); }, 0); }
  function fillPhotosFromCache() { const box = document.getElementById("hd-photos"); if (box && cache.photos[box.dataset.spot]) fillPhotos(); }
  function fillFeedFromCache() { if (document.getElementById("hd-feed") && cache.feed) fillFeed(); }

  document.addEventListener("change", async (e) => {
    if (e.target.id !== "hd-photo") return;
    const file = e.target.files[0]; if (!file) return;
    if (!signedIn()) { e.target.value = ""; return loginNeeded("post photos"); }
    const prev = await shrinkTo(file, 600);
    document.getElementById("hd-preview").src = prev || "";
    document.getElementById("hd-upload-more").hidden = false;
  });
  document.addEventListener("submit", async (e) => {
    const f = e.target;
    if (f.id === "hd-login-form") { e.preventDefault(); sendLink(document.getElementById("hd-email").value.trim()); }
    else if (f.id === "hd-name-form") { e.preventDefault(); saveUsername(document.getElementById("hd-username").value); }
    else if (f.id === "hd-upload") {
      e.preventDefault(); const s = findSpot(f.dataset.spot); const file = document.getElementById("hd-photo").files[0];
      if (s && file) uploadPhoto(s, file, document.getElementById("hd-caption").value.trim());
    } else if (f.classList.contains("comment-form")) {
      e.preventDefault(); const input = f.querySelector("input"); const body = input.value.trim(); if (body) { input.value = ""; addComment(+f.dataset.post, body); }
    }
  }, true);

  /* ---------- hooks called by app.js ---------- */
  window.HDSocial = {
    ready: true,
    afterRender() {
      if (document.getElementById("hd-photos")) { fillPhotos(); fillReviews(); }
      if (document.getElementById("hd-feed")) fillFeed();
      if (document.getElementById("hd-account")) fillStats();
    },
    onEat(s) { if (signedIn()) sb.from("eats").insert({ spot_id: s.id, spot_name: s.name }).then(() => {}); },
    onReview(s, stars, body) {
      if (!signedIn()) return;
      sb.from("reviews").insert({ spot_id: s.id, stars, body: body || null }).then(() => { delete cache.reviews[s.id]; render(); });
    },
    onDog(s, dog, on) {
      if (!signedIn()) return;
      if (on) sb.from("spot_dogs").upsert({ spot_id: s.id, dog }).then(() => {});
      else sb.from("spot_dogs").delete().eq("spot_id", s.id).eq("dog", dog).eq("user_id", me.user.id).then(() => {});
    },
    onSpotsLoaded() { loadSharedDogs(); loadCommunitySpots(); },
    onAddSpot: addSpot,
    postPhoto(spot, file, caption) { return uploadPhoto(spot, file, caption); },
  };

  // supabase-js can deadlock if other calls are awaited inside this callback, so defer the work
  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "INITIAL_SESSION") whenAppReady(() => loadProfile().catch(() => {}).then(() => {
      if (event === "SIGNED_IN" && !me.profile) { state.tab = "stats"; toast("Signed in! Pick a username"); }
      render();
    }));
  });
  // this file loads before app.js, so wait for the app before touching its state
  function whenAppReady(fn) {
    if (typeof render === "function" && typeof state === "object") return setTimeout(fn, 0);
    window.addEventListener("load", () => setTimeout(fn, 0), { once: true });
  }
})();
