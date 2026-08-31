const CACHE_PREFIX = "changwon-food-app-";
const CACHE_NAME = `${CACHE_PREFIX}v59`;
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./data.js",
  "./catalog-policy.js",
  "./analytics-client.js",
  "./manifest.webmanifest",
];
const MUKJJI_CORE_ASSETS = [
  "./assets/mukjji/01_mukjji_hero_bowl_1024.webp",
  "./assets/mukjji/02_mukjji_greeting_512.webp",
  "./assets/mukjji/03_mukjji_searching_512.webp",
  "./assets/mukjji/04_mukjji_thinking_512.webp",
  "./assets/mukjji/05_mukjji_recommend_bowl_512.webp",
  "./assets/mukjji/07_mukjji_best_pick_512.webp",
];
const STATIC_ASSETS = [
  "./admin.html",
  "./admin.css",
  "./admin.js",
  "./food-character-admin.js",
  "./weekly-hours-admin.js",
  "./supabase-config.js",
  "./assets/icons/apple-touch-icon-180.png",
  "./assets/icons/favicon-32.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
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
const PRECACHE_ASSETS = [...CORE_ASSETS, ...MUKJJI_CORE_ASSETS, ...STATIC_ASSETS];
const NETWORK_FIRST_PATHS = new Set(["/", "/index.html", "/app.js", "/analytics-client.js", "/styles.css", "/data.js", "/manifest.webmanifest"]);

function outdatedAppCacheNames(cacheNames) {
  return cacheNames.filter((cacheName) => cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME);
}

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
      .then((keys) => Promise.all(outdatedAppCacheNames(keys).map((key) => caches.delete(key)))),
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
