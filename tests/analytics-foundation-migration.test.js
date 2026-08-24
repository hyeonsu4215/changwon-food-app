const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const migrationPath = path.join(
  root,
  "supabase",
  "migrations",
  "20260822173904_create_analytics_events.sql",
);
const docsRoot = path.join(root, "docs", "analytics");
const rollbackPath = path.join(docsRoot, "analytics-foundation-rollback.sql");
const precheckPath = path.join(docsRoot, "analytics-foundation-precheck-readonly.sql");
const postcheckPath = path.join(docsRoot, "analytics-foundation-postcheck-readonly.sql");
const previewPath = path.join(docsRoot, "migration-preview.md");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8").replaceAll("\r\n", "\n");
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function statementCount(sql, keyword) {
  return (sql.match(new RegExp(`^\\s*${keyword}\\b`, "gim")) || []).length;
}

function exactLineCount(sql, line) {
  const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (sql.match(new RegExp(`^${escaped}$`, "gm")) || []).length;
}

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.notEqual(start, -1, `${startMarker} must exist`);
  assert.notEqual(end, -1, `${endMarker} must exist`);
  assert.ok(end > start, "markers must be ordered");
  return source.slice(start + startMarker.length, end).trim();
}

function assertReadOnly(sql) {
  const withoutComments = sql.replace(/--.*$/gm, "");
  const starts = withoutComments
    .split(";")
    .map((statement) => statement.trim().match(/^([a-z]+)/i)?.[1]?.toUpperCase())
    .filter(Boolean);
  const forbidden = new Set([
    "CREATE", "ALTER", "DROP", "TRUNCATE", "INSERT", "UPDATE", "DELETE",
    "MERGE", "GRANT", "REVOKE", "COMMENT",
  ]);
  assert.equal(starts.filter((start) => forbidden.has(start)).length, 0);
  assert.match(sql, /default_transaction_read_only = on/);
  assert.match(sql, /SET TRANSACTION READ ONLY/);
}

const migration = read(migrationPath);
const rollback = read(rollbackPath);
const precheck = read(precheckPath);
const postcheck = read(postcheckPath);
const preview = read(previewPath);
const rpc = extractBetween(migration, "-- BEGIN INGESTION RPC", "-- END INGESTION RPC");

test("migration is one fail-closed transaction with collision and fingerprint guards", () => {
  assert.equal(exactLineCount(migration, "BEGIN;"), 1);
  assert.equal(exactLineCount(migration, "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;"), 1);
  assert.equal(exactLineCount(migration, "COMMIT;"), 1);
  assert.equal(exactLineCount(migration, "ROLLBACK;"), 0);
  assert.match(migration, /public\.analytics_events already exists/);
  assert.match(migration, /public\.log_analytics_event already exists/);
  assert.match(migration, /constraint_row\.confdeltype = 'c'/);
  assert.match(migration, /ARRAY\['restaurant_id'\]::name\[\]/);
  assert.match(migration, /ARRAY\['id'\]::name\[\]/);
  assert.match(migration, /existing catalog data changed/);
  assert.match(migration, /analytics_restaurants_fingerprint/);
  assert.match(migration, /analytics_menus_fingerprint/);
  assert.match(migration, /analytics_weekly_hours_fingerprint/);
});

test("analytics table has the exact privacy-minimized column contract", () => {
  const tableSql = migration.slice(
    migration.indexOf("CREATE TABLE public.analytics_events"),
    migration.indexOf("CREATE UNIQUE INDEX analytics_events_recommendation_position_unique"),
  );
  assert.equal(statementCount(migration, "CREATE TABLE"), 1);
  assert.match(migration, /CREATE TABLE public\.analytics_events/);
  for (const column of [
    "event_id uuid NOT NULL",
    "event_name text NOT NULL",
    "occurred_at timestamptz NOT NULL",
    "server_received_at timestamptz NOT NULL DEFAULT now()",
    "session_id uuid NOT NULL",
    "recommendation_id uuid NULL",
    "restaurant_id text NULL",
    "menu_id text NULL",
    "position smallint NULL",
    "source_context text NULL",
    "event_version smallint NOT NULL DEFAULT 1",
    "error_code text NULL",
    "item_count smallint NULL",
    "share_method text NULL",
  ]) assert.match(migration, new RegExp(column.replace(/[()]/g, "\\$&")));
  assert.match(migration, /CONSTRAINT analytics_events_pkey PRIMARY KEY \(event_id\)/);
  assert.doesNotMatch(migration, /\b(client_id|user_id|metadata|updated_at)\b/i);
  assert.doesNotMatch(tableSql, /FOREIGN KEY/i);
  assert.doesNotMatch(migration, /CREATE TRIGGER[\s\S]*analytics_events/i);
});

test("basic checks contain only the approved v1 allowlists and ranges", () => {
  for (const eventName of [
    "session_start", "recommendation_shown", "recommendation_refresh",
    "menu_card_open", "map_open", "share_recommendation", "recommendation_error",
  ]) assert.match(migration, new RegExp(`'${eventName}'`));
  assert.match(migration, /source_context IN \('discovery', 'personalized', 'shared_pick', 'search'\)/);
  assert.match(migration, /position IS NULL OR position BETWEEN 1 AND 3/);
  assert.match(migration, /event_version = 1/);
  assert.match(migration, /item_count IS NULL OR item_count BETWEEN 0 AND 3/);
  assert.match(migration, /error_code IN \('insufficient_candidates', 'invalid_result', 'data_unavailable', 'unknown'\)/);
  assert.match(migration, /share_method IS NULL OR share_method IN \('web_share', 'clipboard'\)/);
  assert.equal((migration.match(/CONSTRAINT analytics_events_/g) || []).length, 8);
});

test("indexes protect recommendation integrity without over-indexing", () => {
  assert.match(migration, /CREATE UNIQUE INDEX analytics_events_recommendation_position_unique[\s\S]*\(recommendation_id, position\)[\s\S]*event_name = 'recommendation_shown'/);
  assert.match(migration, /CREATE UNIQUE INDEX analytics_events_recommendation_menu_unique[\s\S]*\(recommendation_id, menu_id\)[\s\S]*event_name = 'recommendation_shown'/);
  assert.match(migration, /CREATE INDEX analytics_events_event_received_at_idx[\s\S]*\(event_name, server_received_at\)/);
  assert.match(migration, /CREATE INDEX analytics_events_restaurant_event_received_at_idx[\s\S]*\(restaurant_id, event_name, server_received_at\)[\s\S]*WHERE restaurant_id IS NOT NULL/);
  assert.equal(statementCount(migration, "CREATE INDEX"), 2);
  assert.equal(statementCount(migration, "CREATE UNIQUE INDEX"), 2);
  assert.doesNotMatch(migration, /CREATE (?:UNIQUE )?INDEX[^;]+\(session_id\)/i);
});

test("raw table is default-deny and the ingestion RPC is explicit least privilege", () => {
  assert.match(migration, /ALTER TABLE public\.analytics_events ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/);
  assert.equal(statementCount(migration, "CREATE POLICY"), 0);
  assert.match(migration, /REVOKE ALL ON TABLE public\.analytics_events FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /GRANT[^;]+ON TABLE public\.analytics_events/i);
  assert.match(rpc, /SECURITY DEFINER/);
  assert.match(rpc, /SET search_path = pg_catalog/);
  assert.match(rpc, /public\.analytics_events/);
  assert.match(rpc, /public\.restaurants/);
  assert.match(rpc, /public\.menus/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.log_analytics_event[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.log_analytics_event[\s\S]*TO anon, authenticated/);
});

test("RPC owns server fields, semantic validation, catalog checks, and idempotency", () => {
  const signature = migration.slice(
    migration.indexOf("CREATE FUNCTION public.log_analytics_event"),
    migration.indexOf("RETURNS boolean", migration.indexOf("CREATE FUNCTION public.log_analytics_event")),
  );
  assert.doesNotMatch(signature, /server_received_at|event_version/);
  assert.match(rpc, /pg_catalog\.statement_timestamp\(\) - INTERVAL '30 days'/);
  assert.match(rpc, /pg_catalog\.statement_timestamp\(\) \+ INTERVAL '24 hours'/);
  assert.match(rpc, /pg_catalog\.pg_advisory_xact_lock/);
  assert.match(rpc, /inconsistent recommendation set/);
  assert.equal((rpc.match(/p_source_context IS NULL/g) || []).length >= 6, true);
  assert.match(rpc, /FROM public\.restaurants/);
  assert.match(rpc, /FROM public\.menus/);
  assert.match(rpc, /menu restaurant mismatch/);
  assert.match(rpc, /ON CONFLICT DO NOTHING/);
  assert.match(rpc, /GET DIAGNOSTICS v_inserted_count = ROW_COUNT/);
  assert.match(rpc, /RETURN v_inserted_count = 1/);
  assert.doesNotMatch(rpc, /^\s*(UPDATE|DELETE)\b/gim);
});

test("existing production tables cannot be mutation targets", () => {
  assert.doesNotMatch(migration, /INSERT INTO public\.(restaurants|menus|restaurant_weekly_hours)\b/i);
  assert.doesNotMatch(migration, /UPDATE public\.(restaurants|menus|restaurant_weekly_hours)\b/i);
  assert.doesNotMatch(migration, /DELETE FROM public\.(restaurants|menus|restaurant_weekly_hours)\b/i);
  assert.doesNotMatch(migration, /ALTER TABLE public\.(restaurants|menus|restaurant_weekly_hours)\b/i);
});

test("precheck and postcheck remain read-only human-readable reports", () => {
  assertReadOnly(precheck);
  assertReadOnly(postcheck);
  assert.match(precheck, /check_name, expected, actual, passed/);
  assert.match(precheck, /public\.is_admin security contract/);
  assert.match(precheck, /menu restaurant FK delete action/);
  assert.match(postcheck, /check_name, expected, actual, passed/);
  assert.match(postcheck, /PUBLIC RPC execute/);
  assert.match(postcheck, /PUBLIC direct table privilege count/);
  assert.match(postcheck, /analytics expected index names/);
  assert.match(postcheck, /analytics row count/);
  assert.match(postcheck, /same as execution precheck/);
});

test("rollback is narrow, empty-table guarded, and never cascades", () => {
  assert.equal(exactLineCount(rollback, "BEGIN;"), 1);
  assert.equal(exactLineCount(rollback, "COMMIT;"), 1);
  assert.match(rollback, /analytics_events is not empty/);
  assert.match(rollback, /DROP FUNCTION public\.log_analytics_event/);
  assert.match(rollback, /DROP TABLE public\.analytics_events/);
  assert.doesNotMatch(rollback, /\bCASCADE\b/i);
  assert.doesNotMatch(rollback, /DROP (?:TABLE|FUNCTION)[\s\S]*public\.(restaurants|menus|restaurant_weekly_hours)/i);
});

test("preview communicates execution, privacy, and rollback boundaries", () => {
  assert.match(preview, /Execution: not approved and not performed/);
  assert.match(preview, /No existing restaurant, menu, weekly-hours/);
  assert.match(preview, /no hard foreign keys/i);
  assert.match(preview, /PUBLIC EXECUTE/);
  assert.match(preview, /fails if the Analytics table contains any rows/);
  for (const filePath of [migrationPath, rollbackPath, precheckPath, postcheckPath]) {
    assert.match(preview, new RegExp(sha256(filePath)));
  }
});

console.log("analytics foundation: schema, RPC security, idempotency, and rollback safeguards passed");
