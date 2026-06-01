const CACHE_NAME = "elite-gym-v2";
const STATIC_ASSETS = ["/", "/index.html", "/manifest.json", "/wave-nav-logo.png", "/icons/icon-192.png", "/icons/icon-512.png"];

// Install : pre-cache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => undefined))
  );
  self.skipWaiting();
});

// Activate : clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch : network first, fallback to cache
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip API calls, browser extensions, and non-GET requests.
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") return caches.match("/index.html");
        return Response.error();
      })
  );
});
