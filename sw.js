const CACHE_NAME = "changwon-food-app-v8";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./data.js",
  "./supabase-config.js",
  "./manifest.webmanifest",
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
  "./assets/categories/western.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
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

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
