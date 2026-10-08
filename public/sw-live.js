/* Live viewer SW – register with scope /live only */
const CACHE_NAME = "mysportzstats-live-v5";
const ASSETS = [
  "/live",
  "/live.html",
  "/manifest-live.json",
  "/icon-live-192.png",
  "/icon-live-512.png"
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
      Promise.all(
        keys
          .filter((k) => k.startsWith("mysportzstats-live") && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (
    e.request.method !== "GET" ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/ws" ||
    url.pathname.startsWith("/presence") ||
    url.pathname.startsWith("/chat") ||
    url.pathname.startsWith("/floats") ||
    url.pathname.startsWith("/predictions")
  ) {
    return;
  }

  // Always prefer network for HTML so viewers never stick on old live.html
  if (e.request.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname === "/live") {
    e.respondWith(
      fetch(e.request).then((res) => {
        try {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(e.request, copy)).catch(() => {});
          }
        } catch (_) {}
        return res;
      }).catch(() => caches.match(e.request).then((c) => c || caches.match("/live.html")))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request)
        .then((res) => {
          try {
            if (res && res.ok && res.type === "basic") {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(e.request, copy)).catch(() => {});
            }
          } catch (_) {}
          return res;
        })
        .catch(() => cached || new Response("Offline", { status: 503 }));
    })
  );
});
