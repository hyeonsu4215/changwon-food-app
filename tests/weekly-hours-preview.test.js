const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CLASSIFICATIONS,
  WEEKDAYS,
  buildPreview,
  readCatalog,
  renderMarkdown,
} = require("../scripts/weekly-hours-preview");

const root = path.resolve(__dirname, "..");
const snapshotSha = "21ff41fcdae654a8d2d303af889e4e9e8456a5cb7ac7c4b2bb9d626a4ea6de67";
const preview = buildPreview(readCatalog(path.join(root, "data.js")));

function restaurant(id) {
  const item = preview.restaurants.find((candidate) => candidate.id === id);
  assert.ok(item, `${id} must be present`);
  return item;
}

test("weekly preview covers C001-C029 exactly once", () => {
  const expectedIds = Array.from({ length: 29 }, (_, index) => `C${String(index + 1).padStart(3, "0")}`);
  const actualIds = preview.restaurants.map((item) => item.id);
  assert.deepEqual(actualIds, expectedIds);
  assert.equal(new Set(actualIds).size, 29);
  assert.equal(preview.restaurantCount, 29);
});

test("classification and row-count contracts are exact", () => {
  assert.deepEqual(preview.classifications, {
    [CLASSIFICATIONS.AUTO_SAFE]: 12,
    [CLASSIFICATIONS.UNKNOWN]: 4,
    [CLASSIFICATIONS.CLOSED_UNKNOWN]: 12,
    [CLASSIFICATIONS.CLOSED_RULE]: 1,
  });
  assert.deepEqual(preview.secondaryIssues, {
    BREAK_BLANK_UNCONFIRMED: 2,
    BREAK_UNKNOWN: 23,
    BREAK_SCHEDULED_CLEAR: 4,
  });
  assert.equal(preview.immediatelySafeRows, 112);
  assert.equal(preview.manualReviewRows, 91);
  assert.equal(preview.expectedCompleteWeeklyRows, 203);
  assert.equal(preview.futureRecurringRowsForC024, 2);
});

test("generated rows have unique ISO weekdays 1 through 7", () => {
  for (const item of preview.restaurants) {
    const expectedRows = item.autoMigrate ? 7 : 0;
    assert.equal(item.generatedRows.length, expectedRows, item.id);
    if (!expectedRows) continue;
    assert.deepEqual(item.generatedRows.map((row) => row.isoWeekday), WEEKDAYS.map((day) => day.isoWeekday));
    assert.equal(new Set(item.generatedRows.map((row) => row.isoWeekday)).size, 7);
  }
});

test("AUTO_SAFE maps simple closures without guessing breaks", () => {
  const c001 = restaurant("C001");
  assert.equal(c001.classification, CLASSIFICATIONS.AUTO_SAFE);
  assert.deepEqual(c001.generatedRows[0], {
    restaurantId: "C001",
    isoWeekday: 1,
    closesNextDay: false,
    note: "Legacy break time is unverified.",
    source: "legacy-hours-v1",
    lastVerifiedAt: null,
    dayStatus: "open",
    openTime: "10:00:00",
    closeTime: "20:40:00",
    breakStatus: "unknown",
    breakStart: null,
    breakEnd: null,
  });
  assert.equal(c001.generatedRows[6].dayStatus, "closed");
  assert.equal(c001.generatedRows[6].openTime, null);
  assert.equal(c001.generatedRows[6].breakStatus, "none");
});

test("scheduled breaks and multiple closed days are preserved", () => {
  const c010 = restaurant("C010");
  for (const row of c010.generatedRows.slice(0, 5)) {
    assert.equal(row.dayStatus, "open");
    assert.equal(row.breakStatus, "scheduled");
    assert.equal(row.breakStart, "14:30");
    assert.equal(row.breakEnd, "17:00");
  }
  assert.deepEqual(c010.generatedRows.slice(5).map((row) => row.dayStatus), ["closed", "closed"]);
});

test("unknown legacy hours create seven explicit unknown rows", () => {
  const c003 = restaurant("C003");
  assert.equal(c003.classification, CLASSIFICATIONS.UNKNOWN);
  assert.equal(c003.generatedRows.length, 7);
  for (const row of c003.generatedRows) {
    assert.equal(row.dayStatus, "unknown");
    assert.equal(row.openTime, null);
    assert.equal(row.closeTime, null);
    assert.equal(row.breakStatus, "unknown");
  }
});

test("closed-day uncertainty produces no misleading weekly rows", () => {
  const c004 = restaurant("C004");
  assert.equal(c004.classification, CLASSIFICATIONS.CLOSED_UNKNOWN);
  assert.equal(c004.autoMigrate, false);
  assert.equal(c004.generatedRows.length, 0);
  assert.ok(c004.proposedAfter.every((day) => day.action === "no-row"));
});

test("C024 is never converted to every-Sunday closure", () => {
  const c024 = restaurant("C024");
  assert.equal(c024.classification, CLASSIFICATIONS.CLOSED_RULE);
  assert.equal(c024.autoMigrate, false);
  assert.equal(c024.generatedRows.length, 0);
  assert.ok(c024.proposedAfter.every((day) => day.action === "no-row"));
  assert.equal(c024.legacyBefore.closedDays, "2,4번째 일요일");
});

test("preview output is deterministic and matches the checked-in document", () => {
  const second = buildPreview(readCatalog(path.join(root, "data.js")));
  assert.equal(JSON.stringify(second), JSON.stringify(preview));
  const rendered = renderMarkdown(preview, { snapshotSha });
  const checkedIn = fs.readFileSync(path.join(root, "docs", "weekly-hours", "migration-preview.md"), "utf8");
  assert.equal(checkedIn, rendered);
  for (const item of preview.restaurants) {
    const tableRowPattern = new RegExp(`^\\| ${item.id} \\|`, "gm");
    assert.equal((checkedIn.match(tableRowPattern) || []).length, 1, item.id);
  }
});

test("schema preview is rollback-only and least-privilege by design", () => {
  const schemaPath = path.join(root, "docs", "weekly-hours", "schema-preview.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  const lines = sql.trimEnd().split(/\r?\n/);
  assert.equal(lines[0], "-- PREVIEW ONLY. DO NOT EXECUTE WITHOUT EXPLICIT APPROVAL.");
  assert.equal(lines.at(-1), "ROLLBACK;");
  assert.match(sql, /CREATE TABLE public\.restaurant_weekly_hours/);
  assert.match(sql, /PRIMARY KEY \(restaurant_id, iso_weekday\)/);
  assert.match(sql, /REFERENCES public\.restaurants \(id\)\s+ON DELETE RESTRICT/);
  assert.match(sql, /CHECK \(iso_weekday BETWEEN 1 AND 7\)/);
  assert.match(sql, /day_status IN \('open', 'closed', 'unknown'\)/);
  assert.match(sql, /break_status IN \('scheduled', 'none', 'unknown'\)/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.restaurant_weekly_hours TO anon/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.restaurant_weekly_hours TO authenticated/);
  assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE|DELETE)[^;]* TO anon/);
  assert.match(sql, /USING \(public\.is_admin\(\)\)/);
  assert.match(sql, /WITH CHECK \(public\.is_admin\(\)\)/);
  assert.match(sql, /CREATE TRIGGER restaurant_weekly_hours_updated_at/);
  assert.match(sql, /EXECUTE FUNCTION public\.set_updated_at\(\)/);
  assert.doesNotMatch(sql, /CREATE TABLE public\.restaurant_recurring_closures/);
  assert.doesNotMatch(sql, /CREATE TABLE public\.restaurant_hours_exceptions/);
  assert.doesNotMatch(sql, /\bCOMMIT\s*;/);
  assert.doesNotMatch(sql, /\b(?:INSERT INTO|UPDATE public\.|DELETE FROM)\b/);
});

console.log("weekly hours preview: 29 classifications, 112 safe rows, schema and C024 safeguards passed");
