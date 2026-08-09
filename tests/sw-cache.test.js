const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "..", "sw.js"), "utf8");
const cacheNames = [
  "changwon-food-app-v46",
  "changwon-food-app-v47",
  "changwon-food-app-v48",
  "unrelated-cache",
  "other-feature-cache",
  "third-party-cache",
];
const deletedCaches = [];
const precachedAssets = [];
const listeners = {};

class MockRequest {
  constructor(input) {
    this.url = String(input);
  }
}

const sandbox = {
  URL,
  Request: MockRequest,
  caches: {
    async open() {
      return {
        async addAll(assets) {
          precachedAssets.push(...assets.map((asset) => asset.url));
        },
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
  fetch: async () => ({ ok: true }),
  self: {
    location: { origin: "https://example.test" },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
  },
};

vm.runInNewContext(source, sandbox, { filename: "sw.js" });

function runExtendableEvent(listener) {
  let pending;
  listener({
    waitUntil(promise) {
      pending = promise;
    },
  });
  return pending;
}

(async () => {
  await runExtendableEvent(listeners.install);
  await runExtendableEvent(listeners.activate);

  assert.ok(
    precachedAssets.includes("./food-character-admin.js"),
    "FC-1 관리자 의존 파일은 계속 precache되어야 한다",
  );
  assert.deepEqual(deletedCaches, ["changwon-food-app-v46", "changwon-food-app-v47"]);
  assert.ok(!deletedCaches.includes("changwon-food-app-v48"));
  assert.ok(!deletedCaches.includes("unrelated-cache"));
  assert.ok(!deletedCaches.includes("other-feature-cache"));
  assert.ok(!deletedCaches.includes("third-party-cache"));

  console.log("changwon-food-app-v46: deleted");
  console.log("changwon-food-app-v47: deleted");
  console.log("changwon-food-app-v48: preserved");
  console.log("unrelated-cache: preserved");
  console.log("other-feature-cache: preserved");
  console.log("third-party-cache: preserved");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
