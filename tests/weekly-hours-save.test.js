const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const WEEKLY = require("../weekly-hours-admin");
const preview = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "weekly-hours", "initial-migration-preview.json"), "utf8"));

const OLD_TIME = "2026-08-16T01:00:00.000Z";
const NEW_TIME = "2026-08-16T02:00:00.000Z";

function rowsFor(id) {
  return WEEKLY.normalizeWeeklyRows(preview.rows.filter((row) => row.restaurant_id === id), id);
}

function stamped(rows, value = OLD_TIME) {
  return WEEKLY.normalizeWeeklyRows(rows).map((row) => ({ ...row, updated_at: value }));
}

function saveOptions(overrides = {}) {
  const originalRows = stamped(rowsFor("C010"));
  return {
    source: "supabase",
    adminAuthorized: true,
    catalogEditable: true,
    restaurantExists: true,
    restaurantId: "C010",
    selectedRestaurantId: "C010",
    generation: 4,
    currentGeneration: 4,
    saving: false,
    hasSpecialClosure: false,
    originalRows,
    draftRows: WEEKLY.updateDayField(originalRows, 1, "open_time", "11:00"),
    verificationConfirmed: false,
    verifiedAt: null,
    ...overrides,
  };
}

function expectedReadBack(plan) {
  const originalByDay = new Map(plan.originalRows.map((row) => [row.iso_weekday, row]));
  const changed = new Set(plan.changedIsoWeekdays);
  return plan.expectedRows.map((row) => ({
    ...row,
    updated_at: changed.has(row.iso_weekday) ? NEW_TIME : originalByDay.get(row.iso_weekday)?.updated_at || NEW_TIME,
  }));
}

function mockPersistence({ preRead, writtenRows, readBack, writeError } = {}) {
  const calls = { preRead: 0, insert: 0, upsert: 0, readBack: 0 };
  return {
    calls,
    async preRead() {
      calls.preRead += 1;
      return preRead || [];
    },
    async insertRows() {
      calls.insert += 1;
      if (writeError) throw writeError;
      return writtenRows || [];
    },
    async upsertRows() {
      calls.upsert += 1;
      if (writeError) throw writeError;
      return writtenRows || [];
    },
    async readBack() {
      calls.readBack += 1;
      return readBack || [];
    },
  };
}

test("save eligibility allows only an authorized valid dirty Supabase draft", () => {
  assert.equal(WEEKLY.assessWeeklySave(saveOptions()).code, "ready");
  assert.equal(WEEKLY.assessWeeklySave(saveOptions({ source: "static" })).code, "static-source");
  assert.equal(WEEKLY.assessWeeklySave(saveOptions({ adminAuthorized: false })).code, "unauthorized");
  assert.equal(WEEKLY.assessWeeklySave(saveOptions({ catalogEditable: false })).code, "unauthorized");
  assert.equal(WEEKLY.assessWeeklySave(saveOptions({ restaurantExists: false })).code, "restaurant-mismatch");
  assert.equal(WEEKLY.assessWeeklySave(saveOptions({ selectedRestaurantId: "C011" })).code, "restaurant-mismatch");
  assert.equal(WEEKLY.assessWeeklySave(saveOptions({ currentGeneration: 5 })).code, "stale-context");
  assert.equal(WEEKLY.assessWeeklySave(saveOptions({ originalRows: rowsFor("C010").slice(0, 6) })).code, "partial-original");
  assert.equal(WEEKLY.assessWeeklySave(saveOptions({ originalRows: [...rowsFor("C010"), rowsFor("C010")[0]] })).code, "partial-original");
  assert.equal(WEEKLY.assessWeeklySave(saveOptions({ originalRows: rowsFor("C010").map((row, index) => index === 0 ? { ...row, restaurant_id: "C011" } : row) })).code, "restaurant-mismatch");
  assert.equal(WEEKLY.assessWeeklySave(saveOptions({ draftRows: rowsFor("C010").slice(0, 6) })).code, "invalid-draft");
  const clean = stamped(rowsFor("C010"));
  assert.equal(WEEKLY.assessWeeklySave(saveOptions({ originalRows: clean, draftRows: WEEKLY.cloneRows(clean) })).code, "clean");
  assert.equal(WEEKLY.assessWeeklySave(saveOptions({ saving: true })).code, "saving");
  assert.equal(WEEKLY.assessWeeklySave(saveOptions({ restaurantId: "C024", selectedRestaurantId: "C024", originalRows: [], draftRows: WEEKLY.createUnknownDraft("C024"), hasSpecialClosure: true })).code, "special-closure");
});

test("one existing-day edit produces one exact weekly row and excludes legacy restaurant fields", () => {
  const plan = WEEKLY.buildWeeklySavePlan(saveOptions());
  assert.equal(plan.mode, "upsert");
  assert.deepEqual(plan.changedIsoWeekdays, [1]);
  assert.equal(plan.changedRows.length, 1);
  assert.deepEqual(Object.keys(plan.changedRows[0]).sort(), [...WEEKLY.DB_WRITE_FIELDS].sort());
  assert.equal(plan.changedRows[0].open_time, "11:00:00");
  assert.equal(plan.changedRows[0].last_verified_at, null);
  assert.equal(plan.changedRows[0].source, "admin_manual");
  ["name", "address", "map_search_keyword", "open_time_legacy", "closed_days"].forEach((field) => {
    assert.equal(Object.hasOwn(plan.changedRows[0], field), false);
  });
});

test("C027 break edit remains a one-row upsert candidate", () => {
  const originalRows = stamped(rowsFor("C027"));
  const draftRows = WEEKLY.updateDayField(originalRows, 2, "break_end", "16:20");
  const plan = WEEKLY.buildWeeklySavePlan({ restaurantId: "C027", originalRows, draftRows });
  assert.deepEqual(plan.changedIsoWeekdays, [2]);
  assert.equal(plan.changedRows[0].break_end, "16:20:00");
});

test("valid zero-row draft creates exactly seven insert candidates while incomplete draft is blocked", () => {
  const draftRows = WEEKLY.createUnknownDraft("C005");
  const plan = WEEKLY.buildWeeklySavePlan({ restaurantId: "C005", originalRows: [], draftRows });
  assert.equal(plan.mode, "insert");
  assert.equal(plan.changedRows.length, 7);
  assert.deepEqual(plan.changedIsoWeekdays, [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(plan.changedRows.every((row) => row.source === "admin_manual" && row.last_verified_at === null));
  assert.throws(
    () => WEEKLY.buildWeeklySavePlan({ restaurantId: "C005", originalRows: [], draftRows: draftRows.slice(0, 6) }),
    (error) => error.code === "invalid-draft",
  );
});

test("verification checked applies one timestamp and admin_manual to all seven rows", () => {
  const options = saveOptions({ verificationConfirmed: true, verifiedAt: NEW_TIME });
  const plan = WEEKLY.buildWeeklySavePlan(options);
  assert.equal(plan.changedRows.length, 7);
  assert.ok(plan.expectedRows.every((row) => row.last_verified_at === NEW_TIME));
  assert.ok(plan.expectedRows.every((row) => row.source === "admin_manual"));
});

test("unchecked schedule edits clear only changed verification while note-only preserves it", () => {
  const verified = stamped(rowsFor("C010")).map((row) => ({ ...row, source: "legacy_migration", last_verified_at: OLD_TIME }));
  const scheduleDraft = WEEKLY.updateDayField(verified, 1, "close_time", "20:30");
  const schedulePlan = WEEKLY.buildWeeklySavePlan({ restaurantId: "C010", originalRows: verified, draftRows: scheduleDraft });
  assert.equal(schedulePlan.changedRows[0].last_verified_at, null);
  assert.equal(schedulePlan.expectedRows[1].last_verified_at, OLD_TIME);
  assert.equal(schedulePlan.expectedRows[1].source, "legacy_migration");

  const noteDraft = WEEKLY.updateDayField(verified, 2, "note", "전화 확인 필요");
  const notePlan = WEEKLY.buildWeeklySavePlan({ restaurantId: "C010", originalRows: verified, draftRows: noteDraft });
  assert.equal(notePlan.changedRows.length, 1);
  assert.equal(notePlan.changedRows[0].last_verified_at, OLD_TIME);
  assert.equal(notePlan.changedRows[0].source, "admin_manual");
});

test("payload canonicalizes 24:00 and preserves 20:40 and 21:10", () => {
  let draftRows = WEEKLY.createUnknownDraft("LOCAL");
  draftRows = WEEKLY.updateDayField(draftRows, 1, "day_status", "open");
  draftRows = WEEKLY.updateAdminTimeField(draftRows, 1, "open_time", "20", "40");
  draftRows = WEEKLY.updateAdminTimeField(draftRows, 1, "close_time", "24", "00");
  draftRows = WEEKLY.updateDayField(draftRows, 2, "day_status", "open");
  draftRows = WEEKLY.updateAdminTimeField(draftRows, 2, "open_time", "11", "00");
  draftRows = WEEKLY.updateAdminTimeField(draftRows, 2, "close_time", "21", "10");
  const plan = WEEKLY.buildWeeklySavePlan({ restaurantId: "LOCAL", originalRows: [], draftRows });
  assert.deepEqual(
    [plan.expectedRows[0].open_time, plan.expectedRows[0].close_time, plan.expectedRows[0].closes_next_day],
    ["20:40:00", "00:00:00", true],
  );
  assert.equal(plan.expectedRows[1].close_time, "21:10:00");
});

test("missing runtime permission performs zero pre-read and zero DML calls", async () => {
  const plan = WEEKLY.buildWeeklySavePlan(saveOptions());
  const persistence = mockPersistence();
  await assert.rejects(
    WEEKLY.executeWeeklyHoursSave({ permissionGranted: false, persistence, plan }),
    (error) => error.code === "unauthorized",
  );
  assert.deepEqual(persistence.calls, { preRead: 0, insert: 0, upsert: 0, readBack: 0 });
});

test("stale existing snapshot and zero-row drift stop before write", async () => {
  const existingPlan = WEEKLY.buildWeeklySavePlan(saveOptions());
  const drifted = WEEKLY.updateDayField(existingPlan.originalRows, 3, "note", "다른 관리자 변경");
  const existingPersistence = mockPersistence({ preRead: drifted });
  await assert.rejects(
    WEEKLY.executeWeeklyHoursSave({ permissionGranted: true, persistence: existingPersistence, plan: existingPlan }),
    (error) => error.code === "stale-data",
  );
  assert.equal(existingPersistence.calls.upsert, 0);

  const zeroPlan = WEEKLY.buildWeeklySavePlan({ restaurantId: "C005", originalRows: [], draftRows: WEEKLY.createUnknownDraft("C005") });
  const zeroPersistence = mockPersistence({ preRead: [{ ...zeroPlan.expectedRows[0], updated_at: NEW_TIME }] });
  await assert.rejects(
    WEEKLY.executeWeeklyHoursSave({ permissionGranted: true, persistence: zeroPersistence, plan: zeroPlan }),
    (error) => error.code === "stale-data",
  );
  assert.equal(zeroPersistence.calls.insert, 0);
});

test("generation/source race and saving guard block duplicate writes", async () => {
  assert.equal(WEEKLY.assessWeeklySave(saveOptions({ saving: true })).code, "saving");
  const plan = WEEKLY.buildWeeklySavePlan(saveOptions());
  const persistence = mockPersistence({ preRead: plan.originalRows });
  let checks = 0;
  await assert.rejects(
    WEEKLY.executeWeeklyHoursSave({
      permissionGranted: true,
      persistence,
      plan,
      isCurrent: () => ++checks === 1,
    }),
    (error) => error.code === "stale-context",
  );
  assert.equal(persistence.calls.upsert, 0);
});

test("exact read-back succeeds and mismatch/failure never mutates original draft inputs", async () => {
  const options = saveOptions();
  const originalSnapshot = WEEKLY.cloneRows(options.originalRows);
  const draftSnapshot = WEEKLY.cloneRows(options.draftRows);
  const plan = WEEKLY.buildWeeklySavePlan(options);
  const success = mockPersistence({
    preRead: plan.originalRows,
    writtenRows: plan.changedRows.map((row) => ({ ...row, updated_at: NEW_TIME })),
    readBack: expectedReadBack(plan),
  });
  const result = await WEEKLY.executeWeeklyHoursSave({ permissionGranted: true, persistence: success, plan });
  assert.equal(result.length, 7);
  assert.deepEqual(success.calls, { preRead: 1, insert: 0, upsert: 1, readBack: 1 });

  const mismatchRows = expectedReadBack(plan).map((row) => row.iso_weekday === 1 ? { ...row, open_time: "12:00:00" } : row);
  const mismatch = mockPersistence({
    preRead: plan.originalRows,
    writtenRows: plan.changedRows.map((row) => ({ ...row, updated_at: NEW_TIME })),
    readBack: mismatchRows,
  });
  await assert.rejects(
    WEEKLY.executeWeeklyHoursSave({ permissionGranted: true, persistence: mismatch, plan }),
    (error) => error.code === "readback-mismatch",
  );
  assert.deepEqual(options.originalRows, originalSnapshot);
  assert.deepEqual(options.draftRows, draftSnapshot);

  const failed = mockPersistence({ preRead: plan.originalRows, writeError: new Error("network down") });
  await assert.rejects(WEEKLY.executeWeeklyHoursSave({ permissionGranted: true, persistence: failed, plan }), /network down/);
  assert.deepEqual(options.draftRows, draftSnapshot);
});

test("authorized one-day workflow becomes ready, writes one row, reads back, and becomes clean", async () => {
  const options = saveOptions();
  const assessment = WEEKLY.assessWeeklySave(options);
  assert.equal(assessment.canSave, true);
  assert.equal(assessment.plan.changedRows.length, 1);
  const persistence = mockPersistence({
    preRead: assessment.plan.originalRows,
    writtenRows: assessment.plan.changedRows.map((row) => ({ ...row, updated_at: NEW_TIME })),
    readBack: expectedReadBack(assessment.plan),
  });
  const readBackRows = await WEEKLY.executeWeeklyHoursSave({
    permissionGranted: assessment.canSave,
    persistence,
    plan: assessment.plan,
  });
  assert.deepEqual(persistence.calls, { preRead: 1, insert: 0, upsert: 1, readBack: 1 });
  const cleanAssessment = WEEKLY.assessWeeklySave(saveOptions({
    originalRows: readBackRows,
    draftRows: WEEKLY.cloneRows(readBackRows),
  }));
  assert.equal(cleanAssessment.code, "clean");
});

test("persistence targets only restaurant_weekly_hours with exact insert/upsert payloads", async () => {
  const calls = [];
  const responses = [
    { data: [], error: null },
    { data: [{ restaurant_id: "C005", iso_weekday: 1 }], error: null },
    { data: [{ restaurant_id: "C010", iso_weekday: 1 }], error: null },
  ];
  const client = {
    from(table) {
      calls.push({ type: "from", table });
      const builder = {
        select(columns) { calls.push({ type: "select", columns }); return builder; },
        eq(field, value) { calls.push({ type: "eq", field, value }); return builder; },
        order(field) { calls.push({ type: "order", field }); return builder; },
        insert(rows) { calls.push({ type: "insert", rows }); return builder; },
        upsert(rows, options) { calls.push({ type: "upsert", rows, options }); return builder; },
        then(resolve, reject) { return Promise.resolve(responses.shift()).then(resolve, reject); },
      };
      return builder;
    },
  };
  const persistence = WEEKLY.createWeeklyHoursPersistence(client);
  await persistence.preRead("C005");
  await persistence.insertRows([{ restaurant_id: "C005", iso_weekday: 1 }]);
  await persistence.upsertRows([{ restaurant_id: "C010", iso_weekday: 1 }]);
  assert.ok(calls.filter((call) => call.type === "from").every((call) => call.table === "restaurant_weekly_hours"));
  assert.equal(calls.filter((call) => call.type === "insert").length, 1);
  assert.equal(calls.filter((call) => call.type === "upsert").length, 1);
  assert.deepEqual(calls.find((call) => call.type === "upsert").options, { onConflict: "restaurant_id,iso_weekday" });
});

console.log("weekly hours admin 3D-2: permission eligibility, stale checks, payload, and read-back guards passed");
