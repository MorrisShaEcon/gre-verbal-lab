const CACHE = "gre-verbal-lab-v2-2-alpha1";
const AUDIO_CACHE = "gre-verbal-lab-human-audio-v1";
const APP_ROOT = "/gre-verbal-lab/";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(APP_ROOT)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== AUDIO_CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.hostname === "upload.wikimedia.org" && url.pathname.startsWith("/wikipedia/commons/")) {
    event.respondWith(caches.open(AUDIO_CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      await cache.put(event.request, response.clone());
      return response;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => caches.match(APP_ROOT))),
  );
});
