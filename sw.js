/* HotDang service worker: lets the app be installed and show hotdog alerts. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.length) { await wins[0].focus(); if (id) wins[0].postMessage({ go: id }); return; }
    await self.clients.openWindow(id ? `./?go=${encodeURIComponent(id)}` : "./");
  })());
});
