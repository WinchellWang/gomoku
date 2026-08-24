const CACHE_VERSION = "gomoku-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./about.md",
  "./manifest.webmanifest",
  "./styles.css",
  "./app.js",
  "./rapfi-worker.js",
  "./engine/rapfi-single.js",
  "./engine/rapfi-single.wasm",
  "./engine/rapfi.data",
  "./assets/gomoku-logo.svg",
  "./assets/black-stone.svg",
  "./assets/white-stone.svg",
  "./assets/gomoku-pwa-icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
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
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
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
