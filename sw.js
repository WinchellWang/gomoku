const CACHE_VERSION = "gomoku-v3";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./about.md",
  "./manifest.webmanifest",
  "./styles.css",
  "./app.js",
  "./assets/gomoku-logo.svg",
  "./assets/black-stone.svg",
  "./assets/white-stone.svg",
  "./assets/gomoku-pwa-icon.svg",
];

const scopePath = new URL("./", self.registration.scope).pathname;

function isOnlineAiAsset(url) {
  return url.pathname === scopePath + "rapfi-worker.js"
    || url.pathname.startsWith(scopePath + "engine/");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      await cache.addAll(CORE_ASSETS);
      await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names
        .filter((name) => name !== CACHE_VERSION)
        .map((name) => caches.delete(name)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // PvE is deliberately network-only. Loading these files only after the user
  // enters PvE prevents an outdated PWA cache from changing engine behavior.
  if (isOnlineAiAsset(url)) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION)
            .then((cache) => cache.put(request, copy))
            .catch((error) => console.warn("Runtime PWA cache failed:", url.pathname, error));
        }
        return response;
      });
    }).catch(() => {
      if (request.mode === "navigate") {
        return caches.match("./index.html", { ignoreSearch: true });
      }
      return Response.error();
    }),
  );
});
