const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { extractFunctionSource } = require("../scripts/analyze-food-character");
const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const settle = () => new Promise(setImmediate);

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function round(reports = [], label = "public") {
  return {
    menu_taste_summary: { data: [{ menu_id: label, spicy: 2 }] },
    menu_review_summary: { data: [{ menu_id: label, rating: 4 }] },
    menu_reviews: { data: [{ menu_id: label, user_id: "public-user" }] },
    info_reports: { data: reports },
  };
}

function harness(options = {}) {
  const calls = [], renders = [], timers = [], rounds = [];
  let currentRound;
  const state = {
    supabaseUserId: "A", supabaseReady: true, supabaseUserGeneration: 0, remoteSummaryRequestId: 0,
    myReports: [{ id: "private-A" }], pendingReviewRetry: { menuId: "local-menu" },
    syncStatus: "synced", lastSyncAt: "previous-sync", supabaseError: "previous-error",
    publicTasteSummary: { public: {} }, publicReviewSummary: { public: {} }, publicReviews: { public: [] },
    wishlist: ["wish"], history: [{ id: "eaten" }], tasteOverrides: { taste: { spicy: 2 } },
    reviews: { review: { review_text: "local review" } }, categories: new Set(["한식"]), budget: 8000,
    recommendationPreferences: { version: 1, budget: 8000 }, weatherEnabled: true,
  };
  state.supabase = {
    from(table) {
      if (table === "menu_taste_summary") currentRound = rounds.shift() || round([{ id: `private-${state.supabaseUserId}` }]);
      const result = currentRound[table];
      calls.push({ table, uid: state.supabaseUserId });
      return {
        select() { return this; }, order() { return this; }, limit() { return this; },
        eq(key, value) { calls.push({ table, key, value }); return this; },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
      };
    },
  };
  const render = () => renders.push({ uid: state.supabaseUserId, reports: state.myReports.map((row) => row.id), status: state.syncStatus });
  const window = { setTimeout(callback) { timers.push(callback); } };
  const factory = new Function("state", "window", "render", "upsertRemoteReview", "toast", `
    ${extractFunctionSource(app, "handleCommunityAuthChange")}
    async ${extractFunctionSource(app, "loadRemoteSummaries")}
    async ${extractFunctionSource(app, "retryPendingReview")}
    return { handleCommunityAuthChange, loadRemoteSummaries, retryPendingReview };`);
  return {
    state, calls, renders, timers, rounds,
    ...factory(state, window, render, options.upsertRemoteReview || (async () => true), () => {}),
    async drainTimers() { while (timers.length) timers.shift()(); await settle(); },
  };
}

test("A to B account switch clears private cache before rendering and reloads only B reports", async () => {
  const h = harness();
  h.handleCommunityAuthChange({ id: "B" });
  assert.deepEqual(h.state.myReports, []);
  assert.equal(h.state.pendingReviewRetry, null);
  assert.equal(h.state.lastSyncAt, "");
  assert.equal(h.state.supabaseError, "");
  assert.equal(h.state.supabaseUserGeneration, 1);
  assert.deepEqual(h.renders[0], { uid: "B", reports: [], status: "idle" });
  assert.equal(h.calls.length, 0);
  await h.drainTimers();
  assert.deepEqual(h.state.myReports, [{ id: "private-B" }]);
  assert.ok(h.calls.some((call) => call.table === "info_reports" && call.key === "user_id" && call.value === "B"));
});

test("logout clears private data immediately and a later anonymous session reloads its own data", async () => {
  const h = harness();
  h.handleCommunityAuthChange(null);
  assert.equal(h.state.supabaseUserId, null);
  assert.equal(h.state.supabaseReady, false);
  assert.deepEqual(h.state.myReports, []);
  assert.equal(h.timers.length, 0);
  h.handleCommunityAuthChange({ id: "anonymous-C", is_anonymous: true });
  await h.drainTimers();
  assert.deepEqual(h.state.myReports, [{ id: "private-anonymous-C" }]);
});

test("same UID token refresh preserves caches and does not start another reload", () => {
  const h = harness();
  const reports = h.state.myReports;
  const pending = h.state.pendingReviewRetry;
  h.handleCommunityAuthChange({ id: "A" });
  assert.equal(h.state.myReports, reports);
  assert.equal(h.state.pendingReviewRetry, pending);
  assert.equal(h.state.supabaseUserGeneration, 0);
  assert.equal(h.renders.length, 0);
  assert.equal(h.timers.length, 0);
});

test("late A request cannot overwrite B data, public summaries, or sync state", async () => {
  const h = harness();
  const gate = deferred();
  h.rounds.push({ ...round([], "old-A-public"), info_reports: gate.promise });
  const oldRequest = h.loadRemoteSummaries();
  h.handleCommunityAuthChange({ id: "B" });
  await h.drainTimers();
  const latestReports = h.state.myReports;
  const latestSync = h.state.lastSyncAt;
  gate.resolve({ data: [{ id: "late-private-A" }] });
  await oldRequest;
  assert.equal(h.state.myReports, latestReports);
  assert.equal(h.state.lastSyncAt, latestSync);
  assert.equal(h.state.syncStatus, "synced");
  assert.equal(h.state.publicTasteSummary["old-A-public"], undefined);
});

test("generation check rejects old A response even after A to B to A", async () => {
  const h = harness();
  const gate = deferred();
  h.rounds.push({ ...round(), info_reports: gate.promise });
  const oldRequest = h.loadRemoteSummaries();
  h.handleCommunityAuthChange({ id: "B" });
  h.handleCommunityAuthChange({ id: "A" });
  await h.drainTimers();
  gate.resolve({ data: [{ id: "stale-first-A" }] });
  await oldRequest;
  assert.deepEqual(h.state.myReports, [{ id: "private-A" }]);
});

test("latest same-user reload wins if earlier request finishes last", async () => {
  const h = harness();
  const gate = deferred();
  h.rounds.push({ ...round(), info_reports: gate.promise }, round([{ id: "latest-A" }]));
  const oldRequest = h.loadRemoteSummaries();
  await h.loadRemoteSummaries();
  gate.resolve({ data: [{ id: "older-A" }] });
  await oldRequest;
  assert.deepEqual(h.state.myReports, [{ id: "latest-A" }]);
});

test("failed new account reload never restores old reports", async () => {
  const h = harness();
  h.rounds.push({ ...round(), info_reports: { error: { message: "denied" } } });
  h.handleCommunityAuthChange({ id: "B" });
  await h.drainTimers();
  assert.deepEqual(h.state.myReports, []);
  assert.equal(h.state.syncStatus, "failed");
  assert.equal(h.state.lastSyncAt, "");
});

test("late failed review retry cannot recreate another account's retry state", async () => {
  const gate = deferred();
  const h = harness({ upsertRemoteReview: () => gate.promise });
  const retry = h.retryPendingReview();
  h.handleCommunityAuthChange({ id: "B" });
  gate.resolve(false);
  await retry;
  assert.equal(h.state.pendingReviewRetry, null);
  assert.equal(h.state.syncStatus, "idle");
});

test("account cache isolation preserves device data and condition settings", async () => {
  const h = harness();
  const keys = ["wishlist", "history", "tasteOverrides", "reviews", "categories", "recommendationPreferences"];
  const references = Object.fromEntries(keys.map((key) => [key, h.state[key]]));
  const deviceSnapshot = () => JSON.stringify(Object.fromEntries(keys.map((key) => [key, key === "categories" ? [...h.state[key]] : h.state[key]])));
  const before = deviceSnapshot();
  h.handleCommunityAuthChange(null);
  h.handleCommunityAuthChange({ id: "B" });
  await h.drainTimers();
  for (const key of keys) assert.equal(h.state[key], references[key]);
  assert.equal(deviceSnapshot(), before);
  assert.equal(h.state.budget, 8000);
  assert.equal(h.state.weatherEnabled, true);
});

test("raw write is not sent if account changes while its session lookup is pending", async () => {
  const gate = deferred();
  let requests = 0;
  const state = { supabaseUserGeneration: 1, supabaseUserId: "A", supabase: { auth: { getSession: () => gate.promise } } };
  const window = { CHANGWON_SUPABASE_CONFIG: { url: "https://test.invalid", anonKey: "public" }, CHANGWON_IS_SUPABASE_CONFIG_ALLOWED: () => true };
  const factory = new Function("state", "window", "fetch", `async ${extractFunctionSource(app, "supabaseRest")}; return supabaseRest;`);
  const request = factory(state, window, () => { requests += 1; })("/info_reports", { method: "POST" });
  await settle();
  state.supabaseUserGeneration += 1;
  state.supabaseUserId = "B";
  gate.resolve({ data: { session: { access_token: "old-A-token" } } });
  const result = await request;
  assert.equal(result.ok, false);
  assert.equal(requests, 0);
});
