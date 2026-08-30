const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const migration = read("supabase", "migrations", "20260828120000_create_privacy_retention_foundation.sql");
const precheck = read("docs", "privacy", "privacy-retention-precheck-readonly.sql");
const postcheck = read("docs", "privacy", "privacy-retention-postcheck-readonly.sql");
const preview = read("docs", "privacy", "privacy-retention-preview-readonly.sql");
const backup = read("docs", "privacy", "privacy-retention-backup-readonly.sql");
const deletion = read("docs", "privacy", "privacy-retention-delete-transaction.sql");
const rollback = read("docs", "privacy", "privacy-retention-rollback.sql");
const operations = read("docs", "privacy", "privacy-retention-operations.md");
const app = read("app.js");
const admin = read("admin.js");

const FINAL_STATUSES = new Set(["done", "rejected"]);

function nextCompletedAt(oldStatus, oldCompletedAt, nextStatus, now) {
  if (!FINAL_STATUSES.has(nextStatus)) return null;
  if (!FINAL_STATUSES.has(oldStatus)) return now;
  return oldCompletedAt;
}

function insertedCompletedAt(status, now) {
  return FINAL_STATUSES.has(status) ? now : null;
}

function isOlderThan(value, cutoff) {
  return new Date(value).getTime() < new Date(cutoff).getTime();
}

test("migration adds nullable completed_at without backfill or data writes", () => {
  assert.match(migration, /ALTER TABLE public\.info_reports\s+ADD COLUMN completed_at timestamptz NULL;/);
  assert.doesNotMatch(migration, /ADD COLUMN completed_at[^;]*DEFAULT/i);
  assert.doesNotMatch(migration, /^\s*(?:INSERT INTO|UPDATE\s+public\.|DELETE FROM)\b/im);
  assert.match(migration, /existing reports were backfilled/);
});

test("completed_at trigger encodes terminal and reopened transitions", () => {
  assert.match(migration, /CREATE FUNCTION public\.set_info_report_completed_at\(\)/);
  assert.match(migration, /NEW\.status IN \('done', 'rejected'\)/);
  assert.match(migration, /OLD\.status NOT IN \('done', 'rejected'\)/);
  assert.match(migration, /NEW\.completed_at := current_timestamp/);
  assert.match(migration, /NEW\.completed_at := OLD\.completed_at/);
  assert.match(migration, /NEW\.completed_at := NULL/);
  assert.match(migration, /BEFORE INSERT OR UPDATE ON public\.info_reports/);

  const firstDone = "2026-08-28T01:00:00.000Z";
  const secondDone = "2026-08-29T01:00:00.000Z";
  assert.equal(nextCompletedAt("pending", null, "checking", firstDone), null);
  assert.equal(nextCompletedAt("checking", null, "done", firstDone), firstDone);
  assert.equal(nextCompletedAt("checking", null, "rejected", firstDone), firstDone);
  assert.equal(nextCompletedAt("done", firstDone, "done", secondDone), firstDone);
  assert.equal(nextCompletedAt("done", firstDone, "checking", secondDone), null);
  assert.equal(nextCompletedAt("checking", null, "done", secondDone), secondDone);
});

test("official report inserts are pending and terminal inserts remain covered", () => {
  assert.equal((app.match(/supabaseRest\("\/info_reports"/g) || []).length, 1);
  assert.match(app, /supabaseRest\("\/info_reports",\s*\{[\s\S]*?method:\s*"POST"[\s\S]*?status:\s*"pending"/);
  assert.doesNotMatch(admin, /from\("info_reports"\)\.(?:insert|upsert)\(/);
  assert.match(migration, /IF TG_OP = 'INSERT'/);

  const now = "2026-08-28T01:00:00.000Z";
  assert.equal(insertedCompletedAt("pending", now), null);
  assert.equal(insertedCompletedAt("checking", now), null);
  assert.equal(insertedCompletedAt("done", now), now);
  assert.equal(insertedCompletedAt("rejected", now), now);
});

test("preview uses strict server and completed timestamps", () => {
  assert.match(migration, /server_received_at < [^\n;]*interval '2 years'/);
  assert.match(migration, /completed_at < [^\n;]*interval '6 months'/);
  assert.match(preview, /current_timestamp - interval '2 years' AS analytics_cutoff/);
  assert.match(preview, /server_received_at < bounds\.analytics_cutoff/);
  assert.match(preview, /current_timestamp - interval '6 months' AS report_cutoff/);
  assert.match(preview, /completed_at < bounds\.report_cutoff/);
  for (const sql of [migration, preview]) {
    assert.match(sql, /status IN \('done', 'rejected'\)/);
    assert.match(sql, /completed_at IS NOT NULL/);
  }

  const analyticsCutoff = "2024-08-28T00:00:00.000Z";
  assert.equal(isOlderThan("2025-08-28T00:00:00.000Z", analyticsCutoff), false);
  assert.equal(isOlderThan(analyticsCutoff, analyticsCutoff), false);
  assert.equal(isOlderThan("2024-08-27T23:59:59.999Z", analyticsCutoff), true);

  const reportCutoff = "2026-02-28T00:00:00.000Z";
  assert.equal(isOlderThan("2026-03-01T00:00:00.000Z", reportCutoff), false);
  assert.equal(isOlderThan("2026-02-27T23:59:59.999Z", reportCutoff), true);
});

test("non-terminal reports never qualify for deletion", () => {
  assert.match(deletion, /status IN \('done', 'rejected'\)/);
  assert.doesNotMatch(deletion, /status IN \('pending', 'checking'\)/);
  for (const status of ["pending", "checking"]) {
    assert.equal(FINAL_STATUSES.has(status) && isOlderThan("2025-01-01", "2026-02-28"), false);
  }
});

test("backup and delete templates use the same strict retention predicates", () => {
  for (const sql of [backup, deletion]) {
    assert.match(sql, /server_received_at < (?:current_timestamp|v_now) - interval '2 years'/);
    assert.match(sql, /status IN \('done', 'rejected'\)/);
    assert.match(sql, /completed_at IS NOT NULL/);
    assert.match(sql, /completed_at < (?:current_timestamp|v_now) - interval '6 months'/);
  }
  assert.doesNotMatch(backup, /occurred_at\s*</);
  assert.doesNotMatch(deletion, /occurred_at\s*</);
});

test("admin preview RPC is read-only and access-restricted", () => {
  assert.match(migration, /CREATE FUNCTION public\.get_admin_privacy_retention_preview\(\)/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = pg_catalog/);
  assert.match(migration, /public\.is_admin\(\) IS DISTINCT FROM true/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_admin_privacy_retention_preview\(\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_admin_privacy_retention_preview\(\) TO authenticated/);
});

test("precheck and postcheck expose the complete read-only execution contract", () => {
  for (const sql of [precheck, postcheck]) {
    assert.doesNotMatch(sql, /^\s*(?:BEGIN|ALTER|CREATE|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE)\b/im);
    assert.match(sql, /public\.analytics_events/);
    assert.match(sql, /public\.info_reports/);
    assert.match(sql, /public\.restaurants/);
    assert.match(sql, /public\.menus/);
    assert.match(sql, /public\.restaurant_weekly_hours/);
    assert.match(sql, /relrowsecurity/);
    assert.match(sql, /relacl/);
    assert.match(sql, /pg_catalog\.pg_policies/);
  }

  assert.match(precheck, /server_received_at/);
  assert.match(precheck, /column_default/);
  assert.match(precheck, /info_reports_status_check/);
  assert.match(precheck, /set_info_report_completed_at/);
  assert.match(precheck, /get_admin_privacy_retention_preview/);
  assert.match(precheck, /info_reports_completed_at/);
  assert.match(precheck, /public\.is_admin\(\)/);

  assert.match(postcheck, /to_regprocedure\('public\.set_info_report_completed_at\(\)'\)/);
  assert.match(postcheck, /to_regprocedure\('public\.get_admin_privacy_retention_preview\(\)'\)/);
  assert.match(postcheck, /'insert', bool_and\(\(tgtype & 4\) <> 0\)/);
  assert.match(postcheck, /'update', bool_and\(\(tgtype & 16\) <> 0\)/);
  assert.match(postcheck, /pg_catalog\.aclexplode/);
  assert.match(postcheck, /acl_row\.grantee = 0/);
  assert.match(postcheck, /'anon_execute'/);
  assert.match(postcheck, /'authenticated_execute'/);
  assert.match(postcheck, /'admin_guard'/);
  assert.match(postcheck, /'analytics_cutoff'/);
  assert.match(postcheck, /'info_report_cutoff'/);
});

test("manual deletion template is fail-closed and only targets approved tables", () => {
  assert.match(deletion, /^-- BLOCKED BY DEFAULT/);
  assert.equal((deletion.match(/\bBEGIN;/g) || []).length, 1);
  assert.equal((deletion.match(/\bCOMMIT;/g) || []).length, 1);
  assert.match(deletion, /SERIALIZABLE/);
  assert.match(deletion, /v_expected_analytics_count bigint := -1/);
  assert.match(deletion, /v_expected_report_ids uuid\[\] := NULL/);
  assert.match(deletion, /v_confirmation text := 'NOT APPROVED'/);
  assert.match(deletion, /current_user = 'postgres' AND session_user = 'postgres'/);
  assert.match(deletion, /public\.is_admin\(\) IS DISTINCT FROM true/);
  assert.match(deletion, /preview targets changed/);
  assert.match(deletion, /v_actual_report_ids IS DISTINCT FROM v_expected_report_ids/);
  assert.match(deletion, /report_row\.id = ANY\(v_expected_report_ids\)/);
  assert.equal((deletion.match(/DELETE FROM public\.analytics_events/g) || []).length, 1);
  assert.equal((deletion.match(/DELETE FROM public\.info_reports/g) || []).length, 1);
  assert.doesNotMatch(deletion, /DELETE FROM public\.(?:restaurants|menus|menu_reviews|menu_taste_votes|restaurant_weekly_hours|admin_users)/);
  assert.doesNotMatch(deletion, /\b(?:INSERT INTO|UPDATE|UPSERT|ALTER TABLE|DROP TABLE|TRUNCATE)\b/i);
});

test("backup and rollback remain separate and fail closed", () => {
  assert.doesNotMatch(backup, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
  assert.match(rollback, /completed_at contains operational data/);
  assert.match(rollback, /DROP FUNCTION public\.get_admin_privacy_retention_preview\(\)/);
  assert.match(rollback, /DROP COLUMN completed_at/);
  assert.doesNotMatch(rollback, /DROP TABLE|CASCADE/i);
});

test("operations document preserves the approved manual sequence and contact", () => {
  assert.match(operations, /Preview/);
  assert.match(operations, /Backup/);
  assert.match(operations, /재확인/);
  assert.match(operations, /승인/);
  assert.match(operations, /Delete/);
  assert.match(operations, /즉시 파기하고, 늦어도 7일 이내/);
  assert.doesNotMatch(operations, /최대 30일 이내/);
  assert.match(operations, /mukjji26@naver\.com/);
  assert.match(operations, /기존 `done` 또는 `rejected` 행 중 `completed_at IS NULL`/);
  assert.match(operations, /`created_at`이나 `updated_at`을 완료 시각으로 자동 간주하지 않는다/);
  assert.match(operations, /menu_reviews\.user_id uuid NOT NULL[\s\S]*ON DELETE CASCADE/);
  assert.match(operations, /menu_taste_votes\.user_id uuid NOT NULL[\s\S]*ON DELETE CASCADE/);
  assert.match(operations, /info_reports\.user_id uuid NULL[\s\S]*ON DELETE SET NULL/);
  assert.match(operations, /Supabase Auth의 `auth\.users` 테이블/);
  assert.match(operations, /`session_id`는 Auth UID가 아니다/);
});
