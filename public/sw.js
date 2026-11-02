const CACHE_NAME = "rutina-bruno-v3";
const CACHE_PREFIX = "rutina-bruno-";
const OFFLINE_URL = "/";

// No skipWaiting: an update waits until all clients of the previous worker close.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([OFFLINE_URL, "/manifest.json"]).catch(() => {})
    )
  );
});

// Do not claim open pages or reload them. Only clean up caches owned by this app.
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)))
  ));
});

function remember(request, response) {
  return caches.open(CACHE_NAME).then((cache) => cache.put(request, response)).catch(() => {});
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).then((response) => {
      if (response.ok && response.headers.get("content-type")?.includes("text/html")) {
        event.waitUntil(remember(req, response.clone()));
      }
      return response;
    }).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match(req) || await cache.match(OFFLINE_URL) || new Response("Sin conexión. Volvé a intentar cuando tengas conexión.", {status:503, headers:{"Content-Type":"text/plain; charset=utf-8"}});
    }));
    return;
  }

  // Cache only immutable build assets and public icons/manifest. Never cache Next's
  // route/RSC responses under the same URL as HTML or serve mixed cached route data.
  if (!url.pathname.startsWith("/_next/static/") && !url.pathname.startsWith("/icons/") && url.pathname !== "/manifest.json") return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;
    const response = await fetch(req);
    if (response.ok) event.waitUntil(remember(req, response.clone()));
    return response;
  })());
});
