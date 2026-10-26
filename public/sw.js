const CACHE='career-shell-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./','./style.css','./app.mjs','./src/match.mjs','./icon.svg'])));self.skipWaiting()});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==location.origin||/\/api\/|\/data\//.test(new URL(event.request.url).pathname))return;event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)))});
