// Hand-rolled, not next-pwa: checked (npm view next-pwa peerDependencies /
// time.modified) before writing this — last published 2022-08, predates
// the current Next.js major by years and has no confirmed App Router
// compatibility. A ~60-line service worker covering the one thing that
// actually matters here (don't show a blank white screen if the network
// drops) is safer than pulling in an unmaintained dependency against a
// framework version it was never tested with.
const CACHE_NAME = "habeshalive-shell-v1";
const OFFLINE_URL = "/offline.html";
const APP_SHELL = [OFFLINE_URL, "/manifest.webmanifest", "/icons/192", "/icons/512"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API traffic — this is dynamic, often authenticated data
  // (wallet balance, chat, admin queues), not the kind of thing a service
  // worker should be silently serving stale.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network first (so live streams/search are always fresh
  // when online), fall back to the offline page when the network fails —
  // this is the actual point of this service worker, avoiding a blank
  // browser error screen.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((res) => res ?? Response.error()))
    );
    return;
  }

  // Static assets (_next/static, icons, fonts): cache-first, since these
  // are content-hashed and immutable — a cache hit is always correct.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return res;
        })
    )
  );
});
