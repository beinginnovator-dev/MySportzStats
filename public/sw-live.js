const CACHE_NAME = "mysportzstats-live-v2";
const ASSETS = [
  "/live",
  "/live.html",
  "/manifest-live.json",
  "/icon-live-192.png",
  "/icon-live-512.png",
  "/icon-192.png",
  "/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = e.request.url;
  if (
    e.request.method !== "GET" ||
    url.includes("/ws") ||
    url.includes("/api/") ||
    url.includes("/presence") ||
    url.includes("/chat") ||
    url.includes("/floats") ||
    url.includes("/predictions")
  ) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        try {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(e.request, copy)).catch(() => {});
          }
        } catch (_) {}
        return res;
      }).catch(() => cached || new Response("Offline", { status: 503 }));
    })
  );
});
