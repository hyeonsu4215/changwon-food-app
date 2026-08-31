const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8").replaceAll("\r\n", "\n");
const migration = read("supabase", "migrations", "20260831090000_add_eaten_record_analytics_v1_1.sql");
const precheck = read("docs", "analytics", "eaten-record-v1-1-precheck-readonly.sql");
const postcheck = read("docs", "analytics", "eaten-record-v1-1-postcheck-readonly.sql");
const rollback = read("docs", "analytics", "eaten-record-v1-1-rollback.sql");

const EVENT_NAMES = [
  "session_start",
  "recommendation_shown",
  "recommendation_refresh",
  "menu_card_open",
  "map_open",
  "share_recommendation",
  "recommendation_error",
  "eaten_record_added",
];

function exactLineCount(source, line) {
  const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (source.match(new RegExp(`^${escaped}$`, "gm")) || []).length;
}

function extract(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `${start} must exist`);
  assert.notEqual(endIndex, -1, `${end} must exist after ${start}`);
  return source.slice(startIndex, endIndex);
}

function assertReadOnly(source) {
  const withoutComments = source.replace(/--.*$/gm, "");
  assert.doesNotMatch(withoutComments, /^\s*(CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|MERGE|GRANT|REVOKE)\b/gim);
  assert.match(source, /default_transaction_read_only = on/);
  assert.match(source, /SET TRANSACTION READ ONLY/);
}

test("migration is one fail-closed transaction and only alters the event constraint", () => {
  assert.equal(exactLineCount(migration, "BEGIN;"), 1);
  assert.equal(exactLineCount(migration, "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;"), 1);
  assert.equal(exactLineCount(migration, "COMMIT;"), 1);
  assert.equal((migration.match(/^ALTER TABLE public\.analytics_events$/gm) || []).length, 2);
  assert.equal((migration.match(/^CREATE OR REPLACE FUNCTION public\./gm) || []).length, 2);
  assert.doesNotMatch(migration, /^\s*CREATE (TABLE|INDEX|UNIQUE INDEX|POLICY|TRIGGER)\b/gim);
  assert.doesNotMatch(migration, /^\s*ALTER TABLE public\.analytics_events\s+(ADD|DROP) COLUMN\b/gim);
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY|DISABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /GRANT[^;]+ON TABLE|REVOKE[^;]+ON TABLE/i);
  assert.equal((migration.match(/INSERT INTO public\.analytics_events/g) || []).length, 1);
  assert.doesNotMatch(migration, /^\s*(UPDATE|DELETE|MERGE)\b/gim);
  assert.match(migration, /existing data changed/);
});

test("event constraint contains the exact existing seven plus eaten_record_added", () => {
  const constraint = extract(
    migration,
    "ADD CONSTRAINT analytics_events_event_name_allowed CHECK (",
    "CREATE OR REPLACE FUNCTION public.log_analytics_event",
  );
  const names = [...constraint.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  assert.deepEqual(names, EVENT_NAMES);
});

test("ingestion RPC keeps its 13-argument security contract and exact eaten semantics", () => {
  const rpc = extract(
    migration,
    "CREATE OR REPLACE FUNCTION public.log_analytics_event(",
    "CREATE OR REPLACE FUNCTION public.get_admin_analytics_dashboard()",
  );
  const signature = rpc.slice(0, rpc.indexOf(")\nRETURNS boolean"));
  assert.equal((signature.match(/^\s*p_[a-z_]+/gm) || []).length, 13);
  assert.match(rpc, /RETURNS boolean[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = pg_catalog/);
  const eatenBranch = extract(rpc, "ELSIF p_event_name = 'eaten_record_added' THEN", "ELSIF p_event_name = 'recommendation_error' THEN");
  for (const required of ["p_restaurant_id IS NULL", "p_menu_id IS NULL"]) assert.match(eatenBranch, new RegExp(required));
  for (const forbidden of [
    "p_recommendation_id IS NOT NULL",
    "p_position IS NOT NULL",
    "p_source_context IS NOT NULL",
    "p_error_code IS NOT NULL",
    "p_item_count IS NOT NULL",
    "p_share_method IS NOT NULL",
  ]) assert.match(eatenBranch, new RegExp(forbidden));
  assert.match(rpc, /ELSE[\s\S]*IF p_acquisition_source IS NOT NULL THEN[\s\S]*acquisition source is session-only/);
  assert.match(rpc, /unknown restaurant/);
  assert.match(rpc, /unknown menu/);
  assert.match(rpc, /menu restaurant mismatch/);
  assert.match(rpc, /ON CONFLICT DO NOTHING/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.log_analytics_event[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.log_analytics_event[\s\S]*TO anon, authenticated/);
});

test("existing seven event validation branches remain present", () => {
  for (const eventName of EVENT_NAMES.slice(0, -1)) {
    assert.match(migration, new RegExp(`invalid ${eventName} fields|p_event_name = '${eventName}'`));
  }
  assert.match(migration, /acquisition source is session-only/);
  assert.match(migration, /invalid source context/);
  assert.match(migration, /inconsistent recommendation set/);
});

test("dashboard adds today, seven-day, and restaurant eaten counts after internal-test exclusion", () => {
  const dashboard = extract(
    migration,
    "CREATE OR REPLACE FUNCTION public.get_admin_analytics_dashboard()",
    "REVOKE ALL ON FUNCTION public.get_admin_analytics_dashboard()",
  );
  assert.match(dashboard, /RETURNS jsonb[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = pg_catalog/);
  assert.match(dashboard, /public\.is_admin\(\)/);
  assert.match(dashboard, /internal_test_sessions AS MATERIALIZED[\s\S]*eligible_events AS MATERIALIZED/);
  assert.equal((dashboard.match(/event_name = 'eaten_record_added'/g) || []).length, 3);
  assert.match(dashboard, /'eaten_records', today\.eaten_records/);
  assert.match(dashboard, /'eaten_records', seven_days\.eaten_records/);
  assert.match(dashboard, /'eaten_records', metric\.eaten_records/);
  assert.match(dashboard, /COALESCE\(restaurant\.name, '삭제된 가게'\)/);
});

test("precheck and postcheck are read-only and inspect ACLs without treating PUBLIC as a role", () => {
  for (const source of [precheck, postcheck]) {
    assertReadOnly(source);
    assert.match(source, /pg_catalog\.aclexplode/);
    assert.match(source, /acl_row\.grantee = 0/);
    assert.doesNotMatch(source, /has_function_privilege\('public'/);
    assert.match(source, /'argument_count', function_row\.argument_count/);
    assert.match(source, /'privacy_retention'/);
    assert.match(source, /server_received_at < v_now - interval ''2 years''/);
  }
  assert.match(precheck, /'expected_event_count', 7/);
  assert.match(precheck, /'expected_eaten_present', false/);
  assert.match(postcheck, /'expected_event_count', 8/);
  assert.match(postcheck, /'expected_eaten_present', true/);
});

test("rollback hard-stops on eaten data and restores the seven-event contract without CASCADE", () => {
  assert.equal(exactLineCount(rollback, "BEGIN;"), 1);
  assert.equal(exactLineCount(rollback, "COMMIT;"), 1);
  assert.match(rollback, /WHERE event_name = 'eaten_record_added'[\s\S]*RAISE EXCEPTION/);
  const constraint = extract(
    rollback,
    "ADD CONSTRAINT analytics_events_event_name_allowed CHECK (",
    "CREATE OR REPLACE FUNCTION public.log_analytics_event",
  );
  const names = [...constraint.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  assert.deepEqual(names, EVENT_NAMES.slice(0, -1));
  assert.match(rollback, /v_event_names IS DISTINCT FROM ARRAY\['eaten_record_added', 'map_open'/);
  assert.match(rollback, /v_event_names IS DISTINCT FROM ARRAY\['map_open', 'menu_card_open'/);
  assert.match(rollback, /invalid eaten_record_added fields/);
  assert.match(rollback, /internal_test_sessions AS MATERIALIZED/);
  assert.doesNotMatch(rollback, /\bCASCADE\b/i);
  assert.equal((rollback.match(/INSERT INTO public\.analytics_events/g) || []).length, 1);
  assert.doesNotMatch(rollback, /^\s*(DELETE|UPDATE|MERGE)\b/gim);
  assert.equal((rollback.match(/^CREATE OR REPLACE FUNCTION public\./gm) || []).length, 2);
});

console.log("eaten Analytics v1.1: event, RPC, dashboard, security, and rollback contracts passed");
