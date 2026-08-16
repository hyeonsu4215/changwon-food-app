const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  AUTO_SAFE_IDS,
  EXCLUDED_IDS,
  MIGRATION_NAME,
  TARGET_IDS,
  UNKNOWN_IDS,
  buildInitialMigration,
  renderCanonicalMigration,
  renderExecutionTransaction,
  renderHumanPreview,
  renderJson,
  renderPostcheck,
  renderRollback,
} = require("../scripts/weekly-hours-initial-migration");
const { readCatalog } = require("../scripts/weekly-hours-preview");

const root = path.resolve(__dirname, "..");
const result = buildInitialMigration(readCatalog(path.join(root, "data.js")));
const canonicalPath = path.join(root, "supabase", "migrations", MIGRATION_NAME);
const executionPath = path.join(root, "docs", "weekly-hours", "initial-migration-execution-transaction.sql");
const jsonPath = path.join(root, "docs", "weekly-hours", "initial-migration-preview.json");
const markdownPath = path.join(root, "docs", "weekly-hours", "initial-migration-preview.md");
const postcheckPath = path.join(root, "docs", "weekly-hours", "initial-migration-postcheck-readonly.sql");
const rollbackPath = path.join(root, "docs", "weekly-hours", "initial-migration-rollback-preview.sql");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8").replaceAll("\r\n", "\n");
}

function extractEffect(sql) {
  const startMarker = "-- BEGIN CANONICAL DATA EFFECT";
  const endMarker = "-- END CANONICAL DATA EFFECT";
  const start = sql.indexOf(startMarker);
  const end = sql.indexOf(endMarker);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return sql.slice(start + startMarker.length, end).trim();
}

function exactLineCount(sql, line) {
  const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (sql.match(new RegExp(`^${escaped}$`, "gm")) || []).length;
}

function statementCount(sql, keyword) {
  return (sql.match(new RegExp(`^\\s*${keyword}\\b`, "gim")) || []).length;
}

function rowsFor(id) {
  return result.rows.filter((row) => row.restaurant_id === id);
}

test("initial migration contains exactly 16 restaurants and 112 complete weeks", () => {
  assert.deepEqual(result.targetIds, TARGET_IDS);
  assert.deepEqual(TARGET_IDS, [...AUTO_SAFE_IDS, ...UNKNOWN_IDS].sort());
  assert.equal(result.rowCount, 112);
  assert.equal(result.restaurantCount, 16);
  assert.equal(new Set(result.rows.map((row) => row.restaurant_id)).size, 16);
  for (const id of TARGET_IDS) {
    assert.deepEqual(rowsFor(id).map((row) => row.iso_weekday), [1, 2, 3, 4, 5, 6, 7]);
  }
  for (const id of EXCLUDED_IDS) assert.equal(rowsFor(id).length, 0, id);
  assert.equal(rowsFor("C024").length, 0);
});

test("aggregate and migration metadata contracts are exact", () => {
  assert.deepEqual(result.statusCounts, { open: 69, closed: 15, unknown: 28 });
  assert.equal(result.breakCounts.scheduled, 11);
  assert.equal(result.breakCounts.none, 15);
  assert.equal(result.breakCounts.unknown, 86);
  assert.equal(result.rows.filter((row) => row.source === "legacy_migration").length, 112);
  assert.equal(result.rows.filter((row) => row.last_verified_at === null).length, 112);
  assert.equal(result.rows.filter((row) => row.note === null).length, 112);
  assert.equal(result.rows.filter((row) => row.closes_next_day === false).length, 112);
});

test("scheduled breaks and Saturday-only closures preserve legacy meaning", () => {
  const c010 = rowsFor("C010");
  assert.equal(c010.filter((row) => row.break_status === "scheduled").length, 5);
  assert.ok(c010.slice(0, 5).every((row) => row.break_start === "14:30:00" && row.break_end === "17:00:00"));
  assert.ok(c010.slice(5).every((row) => row.day_status === "closed" && row.break_status === "none"));

  const c027 = rowsFor("C027");
  assert.equal(c027.filter((row) => row.break_status === "scheduled").length, 6);
  assert.ok(c027.slice(0, 6).every((row) => row.break_start === "15:00:00" && row.break_end === "16:00:00"));
  assert.equal(c027[6].day_status, "closed");

  for (const id of ["C015", "C023"]) {
    const rows = rowsFor(id);
    assert.equal(rows[5].day_status, "closed", id);
    assert.equal(rows[6].day_status, "open", id);
    assert.equal(rows.filter((row) => row.day_status === "closed").length, 1, id);
  }
});

test("all four unknown restaurants remain unknown for seven days", () => {
  for (const id of UNKNOWN_IDS) {
    assert.ok(rowsFor(id).every((row) => row.day_status === "unknown"
      && row.open_time === null
      && row.close_time === null
      && row.break_status === "unknown"
      && row.break_start === null
      && row.break_end === null), id);
  }
});

test("machine and human previews are deterministic", () => {
  assert.equal(read(jsonPath), renderJson(result));
  assert.equal(read(markdownPath), renderHumanPreview(result));
  const machine = JSON.parse(read(jsonPath));
  assert.equal(machine.row_count, 112);
  assert.equal(machine.rows.length, 112);
  for (const id of TARGET_IDS) {
    assert.match(read(markdownPath), new RegExp(`^## ${id} `, "m"));
  }
});

test("canonical migration inserts only the deterministic 112-row dataset", () => {
  const canonical = read(canonicalPath);
  assert.equal(canonical, renderCanonicalMigration(result));
  assert.equal(statementCount(canonical, "INSERT"), 1);
  assert.equal(statementCount(canonical, "UPDATE"), 0);
  assert.equal(statementCount(canonical, "DELETE"), 0);
  assert.equal(statementCount(canonical, "ALTER"), 0);
  assert.equal(statementCount(canonical, "CREATE"), 0);
  assert.equal((canonical.match(/^  \(/gm) || []).length, 112);
  for (const id of EXCLUDED_IDS) assert.doesNotMatch(canonical, new RegExp(`'${id}'`), id);
  assert.doesNotMatch(canonical, /ON CONFLICT|UPSERT/i);
});

test("manual transaction has canonical parity and fail-closed assertions", () => {
  const execution = read(executionPath);
  assert.equal(execution, renderExecutionTransaction(result));
  assert.equal(extractEffect(execution), read(canonicalPath).trim());
  assert.equal(exactLineCount(execution, "BEGIN;"), 1);
  assert.equal(exactLineCount(execution, "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;"), 1);
  assert.equal(exactLineCount(execution, "COMMIT;"), 1);
  assert.equal(exactLineCount(execution, "ROLLBACK;"), 0);
  assert.match(execution, /expected restaurants=29 menus=100 weekly=0/);
  assert.match(execution, /16-target legacy baseline changed/);
  assert.match(execution, /C024 special closure changed/);
  assert.match(execution, /exact expected rows differ/);
  assert.match(execution, /existing catalog changed/);
  assert.doesNotMatch(extractEffect(execution), /C024/);
});

test("post-check is read-only and rollback targets only the exact expected set", () => {
  const postcheck = read(postcheckPath);
  const rollback = read(rollbackPath);
  assert.equal(postcheck, renderPostcheck(result));
  assert.equal(postcheck.split("\n", 1)[0], "-- READ ONLY POST-CHECK.");
  assert.equal(exactLineCount(postcheck, "SET TRANSACTION READ ONLY;"), 1);
  assert.equal(statementCount(postcheck, "INSERT"), 0);
  assert.equal(statementCount(postcheck, "UPDATE"), 0);
  assert.equal(statementCount(postcheck, "DELETE"), 0);
  assert.equal(statementCount(postcheck, "ALTER"), 0);
  assert.equal(rollback, renderRollback(result));
  assert.equal(rollback.split("\n", 1)[0], "-- ROLLBACK PREVIEW ONLY. DO NOT EXECUTE WITHOUT EXPLICIT APPROVAL.");
  assert.equal(exactLineCount(rollback, "ROLLBACK;"), 1);
  assert.equal(exactLineCount(rollback, "COMMIT;"), 0);
  assert.match(rollback, /exact migration rows changed/);
  assert.match(rollback, /IS NOT DISTINCT FROM/);
  assert.match(rollback, /expected exactly 112 deletions/);
  assert.doesNotMatch(rollback, /^\+/m);
  assert.doesNotMatch(rollback, /DELETE\s+FROM[^;]+WHERE\s+source\s*=\s*'legacy_migration'/is);
});

console.log("initial weekly migration: 112 exact rows, canonical parity, and rollback guards passed");
