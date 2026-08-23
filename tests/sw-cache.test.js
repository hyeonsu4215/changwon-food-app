const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "..", "sw.js"), "utf8");
const listeners = {};
const deletedCaches = [];
const precachedAssets = [];
const cacheNames = [
  "changwon-food-app-v9",
  "changwon-food-app-v46",
  "changwon-food-app-v47",
  "changwon-food-app-v48",
  "changwon-food-app-v49",
  "changwon-food-app-v50",
  "changwon-food-app-v51",
  "changwon-food-app-v52",
  "changwon-food-app-v53",
  "changwon-food-app-v54",
  "unrelated-cache",
  "other-feature-cache",
  "other-app-cache",
  "third-party-cache",
];

class MockRequest {
  constructor(input) {
    this.url = String(input);
  }
}

const sandbox = {
  Request: MockRequest,
  URL,
  fetch: async () => ({ ok: true, type: "basic", clone() { return this; } }),
  caches: {
    async open() {
      return {
        async addAll(requests) { precachedAssets.push(...requests.map((request) => request.url)); },
        async match() { return null; },
        async put() {},
      };
    },
    async keys() {
      return cacheNames;
    },
    async delete(cacheName) {
      deletedCaches.push(cacheName);
      return true;
    },
  },
  self: {
    location: { origin: "https://example.test" },
    clients: { async claim() {} },
    addEventListener(type, handler) { listeners[type] = handler; },
    skipWaiting() {},
  },
  console,
};

vm.runInNewContext(source, sandbox, { filename: "sw.js" });

(async () => {
  let installPromise;
  listeners.install({ waitUntil(promise) { installPromise = promise; } });
  await installPromise;
  assert.ok(precachedAssets.includes("./catalog-policy.js"));
  assert.ok(precachedAssets.includes("./food-character-admin.js"));
  assert.ok(precachedAssets.includes("./weekly-hours-admin.js"));
  assert.ok(precachedAssets.includes("./analytics-client.js"));

  let activatePromise;
  listeners.activate({ waitUntil(promise) { activatePromise = promise; } });
  await activatePromise;
  assert.deepEqual(deletedCaches.sort(), [
    "changwon-food-app-v46",
    "changwon-food-app-v47",
    "changwon-food-app-v48",
    "changwon-food-app-v49",
    "changwon-food-app-v50",
    "changwon-food-app-v51",
    "changwon-food-app-v52",
    "changwon-food-app-v53",
    "changwon-food-app-v9",
  ]);
  [
    "changwon-food-app-v54",
    "unrelated-cache",
    "other-feature-cache",
    "other-app-cache",
    "third-party-cache",
  ].forEach((cacheName) => assert.ok(!deletedCaches.includes(cacheName)));

  cacheNames.forEach((cacheName) => {
    console.log(`${cacheName}: ${deletedCaches.includes(cacheName) ? "deleted" : "preserved"}`);
  });
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
