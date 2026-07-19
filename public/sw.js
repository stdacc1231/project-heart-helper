// GRVPN Panel service worker — offline app shell.
// Strategy:
//  - HTML navigations: network-first, fall back to cached shell.
//  - Static assets under /_build/, /assets/, /favicon.ico, fonts: cache-first.
//  - /api/*, /internal/*: never cached (always network).
const VERSION = "v1";
const SHELL_CACHE = `autoscript-shell-${VERSION}`;
const ASSET_CACHE = `autoscript-assets-${VERSION}`;
const SHELL_URLS = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_URLS).catch(() => null)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("autoscript-") && k !== SHELL_CACHE && k !== ASSET_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isAsset(url) {
  return (
    url.pathname.startsWith("/_build/") ||
    url.pathname.startsWith("/assets/") ||
    url.pathname === "/favicon.ico" ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".woff") ||
    url.pathname.endsWith(".ttf") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".png")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API/auth/websocket traffic.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/internal/") ||
      url.pathname.startsWith("/bot/")) return;

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put("/", fresh.clone()).catch(() => null);
        return fresh;
      } catch {
        const cached = await caches.match("/");
        return cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })());
    return;
  }

  if (isAsset(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(ASSET_CACHE);
        cache.put(req, fresh.clone()).catch(() => null);
        return fresh;
      } catch {
        return cached || Response.error();
      }
    })());
  }
});
