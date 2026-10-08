/* Scorer PWA – navigation to / always opens scorer */
const CACHE_NAME = "mysportzstats-scorer-v5";
const ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
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
    url.pathname.startsWith("/predictions") ||
    url.pathname.startsWith("/admin/")
  ) {
    return;
  }

  if (e.request.mode === "navigate") {
    const path = url.pathname;
    if (path === "/" || path === "/index.html" || path === "") {
      e.respondWith(
        fetch(e.request)
          .then((res) => {
            try {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put("/index.html", copy)).catch(() => {});
            } catch (_) {}
            return res;
          })
          .catch(() =>
            caches.match("/index.html").then((c) => c || caches.match("/"))
          )
      );
      return;
    }
    if (path === "/live" || path === "/live.html") {
      e.respondWith(fetch(e.request).catch(() => caches.match("/live.html")));
      return;
    }
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
