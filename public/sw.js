/* MySportzStats scorer SW */
const CACHE = 'mysportz-scorer-v1';
const ASSETS = ['/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CACHE).then(function(c) { return c.addAll(ASSETS).catch(function(){}); }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener('activate', function(e) {
  e.waitUntil(caches.keys().then(function(keys) {
    return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);
  // Never intercept live viewer or API
  if (url.pathname.indexOf('live.html') >= 0 || url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/m/') === 0) {
    return;
  }
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(function(r) {
      try {
        var copy = r.clone();
        caches.open(CACHE).then(function(c){ c.put(e.request, copy); });
      } catch(err){}
      return r;
    }).catch(function(){ return caches.match(e.request); })
  );
});
