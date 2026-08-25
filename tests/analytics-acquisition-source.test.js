const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { extractFunctionSource } = require("../scripts/analyze-food-character.js");
const {
  ACQUISITION_SOURCES,
  getAcquisitionSource,
  createAnalyticsClient,
  buildRpcParameters,
} = require("../analytics-client.js");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const sha256 = (...parts) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, ...parts))).digest("hex");
const migration = read("supabase", "migrations", "20260823160000_add_analytics_acquisition_source.sql");
const rollback = read("docs", "analytics", "acquisition-source-rollback.sql");
const precheck = read("docs", "analytics", "acquisition-source-precheck-readonly.sql");
const postcheck = read("docs", "analytics", "acquisition-source-postcheck-readonly.sql");
const guide = read("docs", "analytics", "acquisition-source-v1.md");
const appSource = read("app.js");
const analyticsSource = read("analytics-client.js");
const foundationMigration = read("supabase", "migrations", "20260822173904_create_analytics_events.sql");

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

function deterministicCrypto() {
  let index = 0;
  return {
    randomUUID() {
      index += 1;
      return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    },
  };
}

function stripSqlLiterals(sql) {
  return sql
    .replace(/--[^\r\n]*/g, "")
    .replace(/'(?:''|[^'])*'/g, "''");
}

const appShareRuntime = new Function(
  "URL",
  "APP_SHARE_URL",
  "ACQUISITION_SOURCE_PARAM",
  "SHARE_ACQUISITION_SOURCE",
  "SHARED_PICK_VERSION_PARAM",
  "SHARED_PICK_VERSION",
  "SHARED_PICK_MENUS_PARAM",
  `${extractFunctionSource(appSource, "buildOfficialShareUrl")};
   ${extractFunctionSource(appSource, "buildSharedPickUrl")};
   return { buildOfficialShareUrl, buildSharedPickUrl };`,
)(
  URL,
  "https://changwon-food-app.vercel.app/",
  "src",
  "share",
  "sharedPick",
  "v1",
  "menus",
);

test("acquisition parser returns only the exact eight-value allowlist", () => {
  assert.deepEqual(ACQUISITION_SOURCES, [
    "direct", "everytime", "kakao", "instagram", "poster_qr", "share", "internal_test", "other",
  ]);
  const cases = [
    ["", "direct"],
    ["?src=everytime", "everytime"],
    ["?src=kakao", "kakao"],
    ["?src=instagram", "instagram"],
    ["?src=poster_qr", "poster_qr"],
    ["?src=share", "share"],
    ["?src=internal_test", "internal_test"],
    ["?src=unknown-raw-value", "other"],
    ["?src=", "other"],
    ["?src=Everytime", "everytime"],
  ];
  cases.forEach(([search, expected]) => assert.equal(getAcquisitionSource({ search }), expected));
  assert.equal(getAcquisitionSource({ href: "https://example.test/?src=KAKAO" }), "kakao");
  assert.equal(getAcquisitionSource({ get search() { throw new Error("blocked"); } }), "direct");
  assert.equal(getAcquisitionSource(null), "direct");
  assert.equal(cases.some(([, expected]) => expected === "unknown-raw-value"), false);
});

test("session_start alone carries the canonical acquisition source", async () => {
  const events = [];
  const client = createAnalyticsClient({
    enabled: false,
    sessionStorage: new MemoryStorage(),
    crypto: deterministicCrypto(),
    now: () => Date.UTC(2026, 7, 23, 8),
    acquisitionSource: "poster_qr",
    onLogicalEvent: (event) => events.push(event),
  });
  await client.initialize();
  await client.recordRecommendationError({
    sourceContext: "discovery",
    errorCode: "unknown",
    itemCount: 0,
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].eventName, "session_start");
  assert.equal(events[0].acquisitionSource, "poster_qr");
  assert.equal(Object.hasOwn(events[1], "acquisitionSource"), false);
  assert.equal(buildRpcParameters(events[0]).p_acquisition_source, "poster_qr");
  assert.equal(Object.hasOwn(buildRpcParameters(events[1]), "p_acquisition_source"), false);
});

test("session_start retry reuses event identity, timestamp, and acquisition source", async () => {
  const calls = [];
  const client = createAnalyticsClient({
    enabled: true,
    sessionStorage: new MemoryStorage(),
    crypto: deterministicCrypto(),
    now: () => Date.UTC(2026, 7, 23, 8),
    acquisitionSource: "internal_test",
    getSupabaseClient: async () => ({
      rpc(name, params) {
        calls.push({ name, params: { ...params } });
        return calls.length === 1
          ? { data: null, error: new Error("temporary") }
          : { data: true, error: null };
      },
    }),
  });
  assert.equal(await client.initialize(), true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].params.p_acquisition_source, "internal_test");
});

test("official share URLs overwrite src while preserving shared-pick parameters", () => {
  const official = new URL(appShareRuntime.buildOfficialShareUrl("https://changwon-food-app.vercel.app/?src=everytime&keep=1"));
  assert.equal(official.searchParams.get("src"), "share");
  assert.equal(official.searchParams.get("keep"), "1");

  const sharedPick = new URL(appShareRuntime.buildSharedPickUrl(["M001", "M002", "M003"]));
  assert.equal(sharedPick.searchParams.get("src"), "share");
  assert.equal(sharedPick.searchParams.get("sharedPick"), "v1");
  assert.equal(sharedPick.searchParams.get("menus"), "M001,M002,M003");
  assert.equal([...sharedPick.searchParams.keys()].sort().join(","), "menus,sharedPick,src");
  assert.match(appSource, /const shareUrl = buildOfficialShareUrl\(\)/);
  assert.doesNotMatch(extractFunctionSource(appSource, "shareAppLink"), /url:\s*APP_SHARE_URL/);
});

test("migration is fail-closed and leaves exactly one secured RPC overload", () => {
  assert.equal((migration.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((migration.match(/^COMMIT;$/gm) || []).length, 1);
  assert.match(migration, /SET TRANSACTION ISOLATION LEVEL SERIALIZABLE/);
  assert.match(migration, /ADD COLUMN acquisition_source text NULL/);
  assert.match(migration, /ADD CONSTRAINT analytics_events_acquisition_source_semantics CHECK/);
  const constraintSources = migration.match(
    /ADD CONSTRAINT analytics_events_acquisition_source_semantics CHECK \([\s\S]*?acquisition_source IN \(\s*([\s\S]*?)\s*\)\s*\)\s*OR/,
  );
  assert.ok(constraintSources);
  assert.deepEqual(
    [...constraintSources[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]),
    ACQUISITION_SOURCES,
  );
  const rpcSources = migration.match(/p_acquisition_source NOT IN \(\s*([\s\S]*?)\s*\) THEN/);
  assert.ok(rpcSources);
  assert.deepEqual(
    [...rpcSources[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]),
    ACQUISITION_SOURCES,
  );
  assert.match(migration, /event_name = 'session_start'[\s\S]*acquisition_source IN/);
  assert.match(migration, /event_name <> 'session_start'[\s\S]*acquisition_source IS NULL/);
  assert.match(migration, /DROP FUNCTION public\.log_analytics_event\([\s\S]*smallint, text\s*\);/);
  assert.match(migration, /p_acquisition_source text DEFAULT NULL/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.log_analytics_event[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.log_analytics_event[\s\S]*TO anon, authenticated/);
  assert.match(migration, /old RPC signature|current RPC signature|RPC overload contract/);
  assert.doesNotMatch(migration, /\bCASCADE\b|\bTRUNCATE\b/);
  assert.doesNotMatch(migration, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(?:restaurants|menus|restaurant_weekly_hours)/i);
  assert.doesNotMatch(migration, /CREATE POLICY|ALTER POLICY|DROP POLICY/);
});

test("precheck and postcheck are read-only and rollback is narrowly guarded", () => {
  const mutation = /\b(?:BEGIN|COMMIT|ALTER|CREATE|DROP|TRUNCATE|MERGE|GRANT|REVOKE)\b/i;
  assert.doesNotMatch(stripSqlLiterals(precheck), mutation);
  assert.doesNotMatch(stripSqlLiterals(postcheck), mutation);
  assert.match(precheck, /analytics_rpc_signatures/);
  assert.match(postcheck, /session_start_missing_source/);
  assert.match(rollback, /analytics history is not empty/);
  assert.match(rollback, /DROP COLUMN acquisition_source/);
  assert.match(rollback, /DROP CONSTRAINT analytics_events_acquisition_source_semantics/);
  assert.match(rollback, /p_share_method text DEFAULT NULL\s*\)\s*RETURNS boolean/);
  assert.doesNotMatch(rollback, /\bCASCADE\b|\bTRUNCATE\b/);
  assert.doesNotMatch(rollback, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(?:restaurants|menus|restaurant_weekly_hours)/i);
  const rpcPattern = /CREATE FUNCTION public\.log_analytics_event\([\s\S]*?\n\$analytics_rpc\$;/;
  assert.equal(
    rollback.match(rpcPattern)?.[0],
    foundationMigration.match(rpcPattern)?.[0],
    "rollback must restore the byte-identical Stage 5A RPC definition",
  );
});

test("PUBLIC execute checks use function ACL semantics instead of a pseudo-role lookup", () => {
  const acquisitionSqlFiles = [migration, precheck, postcheck];
  const publicAclPattern = /pg_catalog\.aclexplode\(\s*COALESCE\(\s*[a-z_]+\.proacl,\s*pg_catalog\.acldefault\('f',\s*[a-z_]+\.proowner\)\s*\)\s*\) AS acl[\s\S]*?acl\.grantee = 0[\s\S]*?acl\.privilege_type = 'EXECUTE'/g;

  acquisitionSqlFiles.forEach((sql) => {
    assert.doesNotMatch(sql, /has_function_privilege\(\s*'PUBLIC'/);
    assert.ok((sql.match(publicAclPattern) || []).length >= 1);
    assert.match(sql, /has_function_privilege\('anon'/);
    assert.match(sql, /has_function_privilege\('authenticated'/);
  });
  assert.equal((migration.match(publicAclPattern) || []).length, 2);
});

test("Stage 5A canonical files remain byte-identical", () => {
  assert.equal(sha256("supabase", "migrations", "20260822173904_create_analytics_events.sql"), "dd29eb953bf858ac83f02e9fb5b875cc6f64603ea47b6e0b49c39ac63297b78b");
  assert.equal(sha256("docs", "analytics", "analytics-foundation-rollback.sql"), "cd58512507c5c972db3ab0deaa62291eb54b8124f081e79479d252bff7af89cb");
  assert.equal(sha256("docs", "analytics", "analytics-foundation-precheck-readonly.sql"), "63ff5d6bd2f2d9403c7d4f93a6d63fdb07ce003ac8b470da9a2cac66f4becb0f");
  assert.equal(sha256("docs", "analytics", "analytics-foundation-postcheck-readonly.sql"), "f34c72a74f32fb91cf169e8e1714c224d1e99a1e5a2c1eda8fba33723dc01e16");
});

test("marketing links and privacy boundary are documented", () => {
  ["everytime", "kakao", "instagram", "poster_qr", "internal_test"].forEach((source) => {
    assert.match(guide, new RegExp(`https://changwon-food-app\\.vercel\\.app/\\?src=${source}`));
  });
  assert.match(guide, /Raw query strings, raw source values, referrers, URLs, UTM values, and free text are never stored/);
  assert.doesNotMatch(analyticsSource, /localStorage|indexedDB|document\.cookie|client_id|user_id|raw_src|raw_query|referrer|user_agent/i);
});
