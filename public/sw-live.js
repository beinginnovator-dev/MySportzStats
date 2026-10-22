/* Live viewer — do not take over navigation */
self.addEventListener('install', function(e){ self.skipWaiting(); });
self.addEventListener('activate', function(e){
  e.waitUntil(self.registration.unregister().then(function(){ return self.clients.claim(); }));
});
