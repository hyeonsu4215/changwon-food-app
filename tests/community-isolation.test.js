const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const configSource = fs.readFileSync(path.join(root, "supabase-config.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const sql = fs.readFileSync(path.join(root, "docs", "community", "community-posts-test-only.sql"), "utf8");

function configContext(hostname, fetch) {
  const window = { location: { hostname } };
  vm.runInNewContext(configSource, { window, fetch, URL }, { filename: "supabase-config.js" });
  return window;
}

test("Preview config fails closed without isolated test config", async () => {
  const window = configContext("feature-example.vercel.app", async () => ({ ok: false }));
  await window.CHANGWON_SUPABASE_CONFIG_READY;
  assert.equal(window.CHANGWON_SUPABASE_CONFIG.enabled, false);
  assert.equal(window.CHANGWON_COMMUNITY_PREVIEW_ENABLED, false);
  assert.equal(window.CHANGWON_IS_SUPABASE_CONFIG_ALLOWED({ enabled: true, url: "https://poxvxxwtrblkjfrqqnrw.supabase.co", anonKey: "sb_publishable_test" }), false);
});

test("Preview accepts only a separate Supabase project with a public key", async () => {
  const config = { enabled: true, url: "https://isolated-test.supabase.co", anonKey: "sb_publishable_test" };
  const window = configContext("feature-example.vercel.app", async () => ({ ok: true, json: async () => config }));
  await window.CHANGWON_SUPABASE_CONFIG_READY;
  assert.equal(window.CHANGWON_COMMUNITY_PREVIEW_ENABLED, true);
  assert.equal(window.CHANGWON_SUPABASE_CONFIG.url, config.url);
  assert.equal(window.CHANGWON_IS_SUPABASE_CONFIG_ALLOWED({ ...config, anonKey: "sb_secret_test" }), false);
});

test("Production config remains on the existing project and community stays disabled", async () => {
  let fetched = false;
  const window = configContext("changwon-food-app.vercel.app", async () => { fetched = true; });
  await window.CHANGWON_SUPABASE_CONFIG_READY;
  assert.equal(fetched, false);
  assert.equal(window.CHANGWON_SUPABASE_CONFIG.url, "https://poxvxxwtrblkjfrqqnrw.supabase.co");
  assert.equal(window.CHANGWON_COMMUNITY_PREVIEW_ENABLED, false);
});

test("server endpoint refuses missing, Production and secret credentials", () => {
  const endpoint = require("../api/community-test-config");
  const original = { ...process.env };
  try {
    process.env.VERCEL_ENV = "preview";
    delete process.env.MUKJJI_TEST_SUPABASE_URL;
    delete process.env.MUKJJI_TEST_SUPABASE_PUBLISHABLE_KEY;
    assert.equal(endpoint.testConfig(), null);
    process.env.MUKJJI_TEST_SUPABASE_URL = "https://poxvxxwtrblkjfrqqnrw.supabase.co";
    process.env.MUKJJI_TEST_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    assert.equal(endpoint.testConfig(), null);
    process.env.MUKJJI_TEST_SUPABASE_URL = "https://isolated-test.supabase.co";
    process.env.MUKJJI_TEST_SUPABASE_PUBLISHABLE_KEY = "sb_secret_test";
    assert.equal(endpoint.testConfig(), null);
    process.env.MUKJJI_TEST_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    assert.equal(endpoint.testConfig().enabled, true);
    process.env.VERCEL_ENV = "production";
    assert.equal(endpoint.testConfig(), null);
  } finally {
    process.env = original;
  }
});

test("OAuth callback precedes anonymous sign-in and no local user data is cleared", () => {
  assert.ok(appSource.indexOf("completeOAuthReturn") < appSource.indexOf("state.supabase.auth.signInAnonymously"));
  assert.match(appSource, /CHANGWON_IS_SUPABASE_CONFIG_ALLOWED\?\.\(config\)/);
  assert.match(appSource, /await window\.CHANGWON_SUPABASE_CONFIG_READY/);
  assert.match(appSource, /data-open-community/);
  assert.match(html, /id="communityTab"/);
  assert.doesNotMatch(sql, /delete from|truncate|drop table/i);
  assert.match(sql, /is_anonymous/);
  assert.match(sql, /author_id = \(select auth\.uid\(\)\)/);
});

test("community controls have unique HTML IDs and matching app references", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["communityTab", "communityBack", "communityLogin", "communityLoginOther", "communityLogout", "communityForm", "communityList", "communityDetail", "communityDeleteDialog"]) {
    assert.ok(ids.includes(id), id);
    assert.ok(appSource.includes(`"${id}"`) || id === "communityTab", id);
  }
  assert.ok(html.indexOf("community-mvp.js") < html.indexOf("app.js"));
  assert.match(html, /id="communityLogin"[^>]*>카카오로 계속하기<\/button>/);
  assert.match(html, /id="communityLoginOther"[^>]*>다른 카카오 계정으로 로그인<\/button>/);
});
