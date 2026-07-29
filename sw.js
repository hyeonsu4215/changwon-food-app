const CACHE_NAME = "changwon-food-app-v31";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./data.js",
  "./manifest.webmanifest",
];
const STATIC_ASSETS = [
  "./admin.html",
  "./admin.css",
  "./admin.js",
  "./supabase-config.js",
  "./assets/campus-food-banner.png",
  "./assets/splash-logo.png",
  "./assets/app-icon-180.png",
  "./assets/app-icon-192.png",
  "./assets/app-icon-512.png",
  "./assets/categories/asian.png",
  "./assets/categories/bunsik.png",
  "./assets/categories/burger.png",
  "./assets/categories/chinese.png",
  "./assets/categories/dosirak.png",
  "./assets/categories/hotpot.png",
  "./assets/categories/japanese.png",
  "./assets/categories/korean.png",
  "./assets/categories/western.png",
];
const PRECACHE_ASSETS = [...CORE_ASSETS, ...STATIC_ASSETS];
const NETWORK_FIRST_PATHS = new Set(["/", "/index.html", "/app.js", "/styles.css", "/data.js", "/manifest.webmanifest"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(PRECACHE_ASSETS.map((asset) => new Request(asset, { cache: "reload" }))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function shouldBypassCache(request, url) {
  if (request.method !== "GET") return true;
  if (!["http:", "https:"].includes(url.protocol)) return true;
  if (!isSameOrigin(url)) return true;
  if (url.pathname.startsWith("/api/")) return true;
  if (url.searchParams.has("_vercel_share")) return true;
  if (request.headers.get("accept")?.includes("text/event-stream")) return true;
  return false;
}

function isNetworkFirstRequest(request, url) {
  if (request.mode === "navigate") return true;
  return NETWORK_FIRST_PATHS.has(url.pathname);
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(new Request(request, { cache: "reload" }));
    if (response && response.ok && response.type === "basic") {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return (await cache.match(request)) || (await cache.match("./index.html"));
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const update = fetch(new Request(request, { cache: "reload" }))
    .then((response) => {
      if (response && response.ok && response.type === "basic") cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  return (await update) || (await cache.match("./index.html"));
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (shouldBypassCache(event.request, url)) return;

  if (isNetworkFirstRequest(event.request, url)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(staleWhileRevalidate(event.request));
});
