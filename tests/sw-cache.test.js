const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "..", "sw.js"), "utf8");
const listeners = {};
const deletedCaches = [];
const precachedAssets = [];

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
      return ["changwon-food-app-v48", "changwon-food-app-v47", "changwon-food-app-v9", "unrelated-cache", "other-app-v1"];
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

  let activatePromise;
  listeners.activate({ waitUntil(promise) { activatePromise = promise; } });
  await activatePromise;
  assert.deepEqual(deletedCaches.sort(), ["changwon-food-app-v47", "changwon-food-app-v9"]);
  assert.ok(!deletedCaches.includes("changwon-food-app-v48"));
  assert.ok(!deletedCaches.includes("unrelated-cache"));
  assert.ok(!deletedCaches.includes("other-app-v1"));
  console.log("service worker cache scope: passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
