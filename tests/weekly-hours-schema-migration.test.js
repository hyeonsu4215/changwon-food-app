const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const migrationPath = path.join(
  root,
  "supabase",
  "migrations",
  "20260816200034_create_restaurant_weekly_hours.sql",
);
const executionPath = path.join(root, "docs", "weekly-hours", "schema-execution-transaction.sql");
const previewPath = path.join(root, "docs", "weekly-hours", "schema-preview.sql");
const postcheckPath = path.join(root, "docs", "weekly-hours", "schema-postcheck-readonly.sql");
const rollbackPath = path.join(root, "docs", "weekly-hours", "schema-rollback-preview.sql");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8").replaceAll("\r\n", "\n");
}

function extractSchemaEffect(sql) {
  const startMarker = "-- BEGIN CANONICAL SCHEMA EFFECT";
  const endMarker = "-- END CANONICAL SCHEMA EFFECT";
  const start = sql.indexOf(startMarker);
  const end = sql.indexOf(endMarker);
  assert.notEqual(start, -1, "canonical effect start marker must exist");
  assert.notEqual(end, -1, "canonical effect end marker must exist");
  assert.ok(end > start, "canonical effect markers must be ordered");
  return sql.slice(start + startMarker.length, end).trim();
}

function statementCount(sql, keyword) {
  return (sql.match(new RegExp(`^\\s*${keyword}\\b`, "gim")) || []).length;
}

function exactLineCount(sql, line) {
  const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (sql.match(new RegExp(`^${escaped}$`, "gm")) || []).length;
}

const migration = read(migrationPath);
const execution = read(executionPath);
const preview = read(previewPath);
const postcheck = read(postcheckPath);
const rollback = read(rollbackPath);

test("canonical migration creates only the empty weekly-hours schema", () => {
  assert.equal(statementCount(migration, "CREATE TABLE"), 1);
  assert.match(migration, /^CREATE TABLE public\.restaurant_weekly_hours/m);
  assert.equal(statementCount(migration, "INSERT"), 0);
  assert.equal(statementCount(migration, "UPDATE"), 0);
  assert.equal(statementCount(migration, "DELETE"), 0);
  assert.equal(statementCount(migration, "UPSERT"), 0);
  assert.doesNotMatch(migration, /ALTER TABLE public\.restaurants\b/);
  assert.doesNotMatch(migration, /DROP\s+(?:COLUMN|TABLE)\b/i);
  assert.doesNotMatch(migration, /restaurant_recurring_closures|restaurant_hours_exceptions/);
  assert.doesNotMatch(migration, /owner/i);
  assert.equal(statementCount(migration, "BEGIN"), 0);
  assert.equal(statementCount(migration, "COMMIT"), 0);
});

test("column, state, key, and metadata contracts are exact", () => {
  assert.match(migration, /restaurant_id text NOT NULL/);
  assert.match(migration, /iso_weekday smallint NOT NULL/);
  assert.match(migration, /CHECK \(iso_weekday BETWEEN 1 AND 7\)/);
  assert.match(migration, /day_status IN \('open', 'closed', 'unknown'\)/);
  assert.match(migration, /break_status IN \('scheduled', 'none', 'unknown'\)/);
  assert.match(migration, /day_status = 'closed'[\s\S]*break_status = 'none'/);
  assert.match(migration, /day_status = 'unknown'[\s\S]*break_status = 'unknown'/);
  assert.match(migration, /break_status = 'scheduled'[\s\S]*day_status = 'open'/);
  assert.match(migration, /PRIMARY KEY \(restaurant_id, iso_weekday\)/);
  assert.match(migration, /REFERENCES public\.restaurants \(id\)\s+ON DELETE RESTRICT/);
  assert.match(migration, /source text NULL/);
  assert.match(migration, /last_verified_at timestamptz NULL/);
  assert.doesNotMatch(migration, /CHECK \(source\b/);
});

test("RLS, grants, and trigger are least-privilege and reusable", () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.restaurant_weekly_hours TO anon/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.restaurant_weekly_hours TO authenticated/);
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE)[^;]* TO anon/);
  assert.match(migration, /restaurant\.id = restaurant_weekly_hours\.restaurant_id\s+AND restaurant\.active = true/);
  assert.match(migration, /FOR ALL\s+TO authenticated\s+USING \(public\.is_admin\(\)\)\s+WITH CHECK \(public\.is_admin\(\)\)/);
  assert.match(migration, /CREATE TRIGGER restaurant_weekly_hours_updated_at\s+BEFORE UPDATE/);
  assert.match(migration, /EXECUTE FUNCTION public\.set_updated_at\(\)/);
  assert.equal((migration.match(/CREATE POLICY/g) || []).length, 2);
});

test("manual transaction and preview use the exact canonical schema effect", () => {
  const canonical = migration.trim();
  assert.equal(extractSchemaEffect(execution), canonical);
  assert.equal(extractSchemaEffect(preview), canonical);
  assert.equal(exactLineCount(execution, "BEGIN;"), 1);
  assert.equal(exactLineCount(execution, "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;"), 1);
  assert.equal(exactLineCount(execution, "COMMIT;"), 1);
  assert.equal(exactLineCount(execution, "ROLLBACK;"), 0);
  assert.match(execution, /expected restaurants=29 menus=100/);
  assert.match(execution, /target table already exists/);
  assert.match(execution, /public\.set_updated_at\(\) is missing/);
  assert.match(execution, /public\.set_updated_at\(\) contract changed/);
  assert.match(execution, /pg_get_functiondef\('public\.set_updated_at\(\)'::regprocedure\)/);
  assert.match(execution, /public\.is_admin\(\) is missing/);
  assert.match(execution, /existing restaurant data changed/);
  assert.match(execution, /expected weekly=0 restaurants=29 menus=100/);
  assert.equal(statementCount(execution, "INSERT"), 0);
  assert.equal(statementCount(execution, "DELETE"), 0);
});

test("post-check is read-only and rollback remains a non-executing preview", () => {
  assert.equal(postcheck.split("\n", 1)[0], "-- READ ONLY POST-CHECK.");
  assert.equal(exactLineCount(postcheck, "BEGIN;"), 1);
  assert.equal(exactLineCount(postcheck, "SET TRANSACTION READ ONLY;"), 1);
  assert.equal(exactLineCount(postcheck, "COMMIT;"), 1);
  assert.equal(statementCount(postcheck, "INSERT"), 0);
  assert.equal(statementCount(postcheck, "UPDATE"), 0);
  assert.equal(statementCount(postcheck, "DELETE"), 0);
  assert.equal(statementCount(postcheck, "ALTER"), 0);
  assert.equal(rollback.split("\n", 1)[0], "-- ROLLBACK PREVIEW ONLY. DO NOT EXECUTE WITHOUT EXPLICIT APPROVAL.");
  assert.equal(exactLineCount(rollback, "ROLLBACK;"), 1);
  assert.equal(exactLineCount(rollback, "COMMIT;"), 0);
  assert.match(rollback, /target table is not empty/);
  assert.match(rollback, /DROP TABLE public\.restaurant_weekly_hours/);
  assert.doesNotMatch(rollback, /public\.restaurants|open_time|close_time|break_time|closed_days/);
});

console.log("weekly hours schema: canonical parity, fail-closed transaction, and read-only checks passed");
