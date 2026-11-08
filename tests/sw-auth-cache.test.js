const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { completeOAuthReturn } = require("../community-mvp");

const source = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");

function harness({ offline = false } = {}) {
  const listeners = {}, calls = { fetch: 0, put: 0, match: 0, unsafeKeys: 0 };
  const offlineResponse = { kind: "offline" };
  class MockRequest {
    constructor(input) { Object.assign(this, input); }
  }
  const cache = {
    async put(request) {
      calls.put += 1;
      if (["code", "state", "access_token", "refresh_token", "id_token", "token"].some((key) => new URL(request.url).searchParams.has(key))) calls.unsafeKeys += 1;
    },
    async match() { calls.match += 1; return offlineResponse; },
  };
  const sandbox = {
    URL, Request: MockRequest,
    fetch: async () => {
      calls.fetch += 1;
      if (offline) throw new Error("mock offline");
      return { ok: true, type: "basic", clone() { return this; } };
    },
    caches: { async open() { return cache; } },
    self: {
      location: { origin: "https://preview.invalid" },
      addEventListener(type, callback) { listeners[type] = callback; },
    },
  };
  vm.runInNewContext(source, sandbox, { filename: "sw.js" });
  return {
    calls, offlineResponse,
    async request(url, { method = "GET", mode = "navigate", accept = "text/html" } = {}) {
      let response;
      const request = { url, method, mode, headers: { get() { return accept; } } };
      listeners.fetch({ request, respondWith(value) { response = value; } });
      return { intercepted: Boolean(response), response: response ? await response : null, unchanged: request.url === url };
    },
  };
}

test("ordinary navigation remains network-first and caches its response", async () => {
  const h = harness();
  for (const url of ["https://preview.invalid/?src=share", "https://preview.invalid/?sharedPick=v1&menus=mock"]) {
    assert.equal((await h.request(url)).intercepted, true);
  }
  assert.equal(h.calls.fetch, 2);
  assert.equal(h.calls.put, 2);
  assert.equal(h.calls.unsafeKeys, 0);
});

test("SW bypass and post-exchange cleanup cover the same authentication parameters", () => {
  const communitySource = fs.readFileSync(path.join(__dirname, "..", "community-mvp.js"), "utf8");
  const names = (text, pattern) => [...text.match(pattern)[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(names(source, /const AUTH_QUERY_PARAMETERS = \[([\s\S]*?)\];/), names(communitySource, /const authParameters = \[([\s\S]*?)\];/));
});

test("OAuth callback and error parameters bypass caching without changing the request", async () => {
  const h = harness();
  for (const parameter of ["communityAuth", "code", "state", "access_token", "refresh_token", "id_token", "provider_token", "provider_refresh_token", "token", "token_type", "error", "error_code", "error_description"]) {
    const url = new URL("https://preview.invalid/");
    url.searchParams.set(parameter, "mock-only");
    const result = await h.request(url.href);
    assert.equal(result.intercepted, false, parameter);
    assert.equal(result.unchanged, true, parameter);
  }
  assert.equal(h.calls.fetch, 0);
  assert.equal(h.calls.put, 0);
  assert.equal(h.calls.unsafeKeys, 0);
});

test("the bypassed OAuth callback still reaches the existing exchange before URL cleanup", async () => {
  const h = harness();
  const url = new URL("https://preview.invalid/");
  url.searchParams.set("communityAuth", "1");
  url.searchParams.set("code", "mock-only");
  url.searchParams.set("state", "mock-only");
  url.searchParams.set("access_token", "mock-only");
  url.searchParams.set("src", "share");
  url.hash = "view=community&refresh_token=mock-only";
  const response = await h.request(url.href);
  let exchanged = false, cleaned = false, preserved = false;
  const auth = { async exchangeCodeForSession(value) { exchanged = value === "mock-only"; return { data: {} }; } };
  const result = await completeOAuthReturn(auth, url.href, (next) => {
    const parsed = new URL(next);
    const fragment = new URLSearchParams(parsed.hash.slice(1));
    cleaned = ["code", "communityAuth", "state", "access_token"].every((key) => !parsed.searchParams.has(key)) && !fragment.has("refresh_token");
    preserved = parsed.searchParams.get("src") === "share" && fragment.get("view") === "community";
  });
  assert.equal(response.intercepted, false);
  assert.equal(response.unchanged, true);
  assert.equal(result.handled, true);
  assert.equal(exchanged, true);
  assert.equal(cleaned, true);
  assert.equal(preserved, true);
  assert.equal(h.calls.put, 0);
});

test("ordinary URLs without the community callback marker are never rewritten", async () => {
  let rewritten = false;
  const result = await completeOAuthReturn({}, "https://preview.invalid/?state=ordinary", () => { rewritten = true; });
  assert.equal(result.handled, false);
  assert.equal(rewritten, false);
});

test("sensitive query parameters bypass cache for same-origin non-navigation requests too", async () => {
  const h = harness();
  const url = new URL("https://preview.invalid/resource");
  url.searchParams.set("access_token", "mock-only");
  const result = await h.request(url.href, { mode: "cors" });
  assert.equal(result.intercepted, false);
  assert.equal(result.unchanged, true);
  assert.equal(h.calls.put, 0);
});

test("API, cross-origin, non-GET, and event streams continue to bypass cache", async () => {
  const h = harness();
  const cases = [
    ["https://preview.invalid/api/community-test-config", {}],
    ["https://third-party.invalid/resource", {}],
    ["https://preview.invalid/", { method: "POST" }],
    ["https://preview.invalid/events", { mode: "cors", accept: "text/event-stream" }],
  ];
  for (const [url, options] of cases) assert.equal((await h.request(url, options)).intercepted, false);
  assert.equal(h.calls.fetch, 0);
  assert.equal(h.calls.put, 0);
});

test("offline ordinary navigation still falls back to the cached page", async () => {
  const h = harness({ offline: true });
  const result = await h.request("https://preview.invalid/");
  assert.equal(result.intercepted, true);
  assert.equal(result.response, h.offlineResponse);
  assert.equal(h.calls.fetch, 1);
  assert.equal(h.calls.match, 1);
  assert.equal(h.calls.put, 0);
});

test("OAuth callback bypass does not replace the original request with an offline fallback", async () => {
  const h = harness({ offline: true });
  const url = new URL("https://preview.invalid/");
  url.searchParams.set("communityAuth", "mock-only");
  url.searchParams.set("code", "mock-only");
  const result = await h.request(url.href);
  assert.equal(result.intercepted, false);
  assert.equal(result.unchanged, true);
  assert.equal(h.calls.match, 0);
  assert.equal(h.calls.put, 0);
});
