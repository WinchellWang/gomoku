const CACHE_VERSION = "gomoku-v2";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./about.md",
  "./manifest.webmanifest",
  "./styles.css",
  "./app.js",
  "./rapfi-worker.js",
  "./assets/gomoku-logo.svg",
  "./assets/black-stone.svg",
  "./assets/white-stone.svg",
  "./assets/gomoku-pwa-icon.svg",
];

const ENGINE_ASSETS = [
  "./engine/rapfi-single.js",
  "./engine/rapfi-single.wasm",
  "./engine/rapfi.data",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      // The small app shell is required for offline startup.
      await cache.addAll(CORE_ASSETS);

      // The AI data file is about 39 MB. Some browsers enforce a smaller
      // Cache Storage quota, so a failure here must not abort SW installation.
      await Promise.all(ENGINE_ASSETS.map(async (asset) => {
        try {
          await cache.add(asset);
        } catch (error) {
          console.warn("Optional PWA cache failed:", asset, error);
        }
      }));

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
