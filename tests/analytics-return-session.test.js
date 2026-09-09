const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  ACQUISITION_SOURCES,
  RETURN_GAPS,
  SESSION_TIMEOUT_MS,
  VISIT_HISTORY_KEY,
  buildRpcParameters,
  calendarDayDifference,
  classifyReturnGap,
  createAnalyticsClient,
  getSeoulDateString,
  prepareVisitHistory,
} = require("../analytics-client.js");

const root = path.resolve(__dirname, "..");
const analyticsSource = fs.readFileSync(path.join(root, "analytics-client.js"), "utf8");

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.setCalls = [];
  }
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    this.setCalls.push({ key, value: String(value) });
    this.values.set(key, String(value));
  }
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

function storedHistory(storage) {
  return JSON.parse(storage.getItem(VISIT_HISTORY_KEY));
}

const unmeasured = {
  isReturning: null,
  returnGap: null,
  firstAcquisitionSource: null,
};

test("Seoul calendar dates and calendar-day differences ignore UTC date boundaries", () => {
  assert.equal(getSeoulDateString(new Date("2026-09-08T14:59:59.000Z")), "2026-09-08");
  assert.equal(getSeoulDateString(new Date("2026-09-08T15:30:00.000Z")), "2026-09-09");
  assert.equal(calendarDayDifference("2026-09-08", "2026-09-08"), 0);
  assert.equal(calendarDayDifference("2026-09-08", "2026-09-09"), 1);
  assert.equal(calendarDayDifference("2026-09-05", "2026-09-08"), 3);
  assert.equal(calendarDayDifference("2026-08-08", "2026-09-08"), 31);
  assert.equal(calendarDayDifference("2026-02-30", "2026-03-01"), null);
});

test("return gaps use the exact approved buckets", () => {
  assert.deepEqual(RETURN_GAPS, ["same_day", "1d", "2_3d", "4_7d", "8_30d", "31d_plus"]);
  [
    [0, "same_day"],
    [1, "1d"],
    [2, "2_3d"],
    [3, "2_3d"],
    [4, "4_7d"],
    [7, "4_7d"],
    [8, "8_30d"],
    [30, "8_30d"],
    [31, "31d_plus"],
    [400, "31d_plus"],
  ].forEach(([days, expected]) => assert.equal(classifyReturnGap(days), expected));
  assert.equal(classifyReturnGap(-1), null);
  assert.equal(classifyReturnGap(1.5), null);
});

test("first measured visit stores only the three approved local fields", () => {
  const storage = new MemoryStorage();
  assert.deepEqual(prepareVisitHistory(storage, "poster_qr", "2026-09-08"), {
    isReturning: false,
    returnGap: null,
    firstAcquisitionSource: "poster_qr",
  });
  assert.deepEqual(storedHistory(storage), {
    firstVisitDate: "2026-09-08",
    lastVisitDate: "2026-09-08",
    firstAcquisitionSource: "poster_qr",
  });
  assert.deepEqual(Object.keys(storedHistory(storage)).sort(), [
    "firstAcquisitionSource", "firstVisitDate", "lastVisitDate",
  ]);
});

test("same-day and later returns preserve the first acquisition source", () => {
  const storage = new MemoryStorage({
    [VISIT_HISTORY_KEY]: JSON.stringify({
      firstVisitDate: "2026-09-01",
      lastVisitDate: "2026-09-08",
      firstAcquisitionSource: "everytime",
    }),
  });
  assert.deepEqual(prepareVisitHistory(storage, "direct", "2026-09-08"), {
    isReturning: true,
    returnGap: "same_day",
    firstAcquisitionSource: "everytime",
  });
  assert.deepEqual(prepareVisitHistory(storage, "kakao", "2026-09-10"), {
    isReturning: true,
    returnGap: "2_3d",
    firstAcquisitionSource: "everytime",
  });
  assert.deepEqual(prepareVisitHistory(storage, "share", "2026-10-12"), {
    isReturning: true,
    returnGap: "31d_plus",
    firstAcquisitionSource: "everytime",
  });
  assert.deepEqual(storedHistory(storage), {
    firstVisitDate: "2026-09-01",
    lastVisitDate: "2026-10-12",
    firstAcquisitionSource: "everytime",
  });
});

test("every gap boundary is derived from the previous visit date", () => {
  const cases = [
    ["2026-09-07", "1d"],
    ["2026-09-06", "2_3d"],
    ["2026-09-05", "2_3d"],
    ["2026-09-04", "4_7d"],
    ["2026-09-01", "4_7d"],
    ["2026-08-31", "8_30d"],
    ["2026-08-09", "8_30d"],
    ["2026-08-08", "31d_plus"],
  ];
  cases.forEach(([lastVisitDate, expected]) => {
    const storage = new MemoryStorage({
      [VISIT_HISTORY_KEY]: JSON.stringify({
        firstVisitDate: "2026-01-01",
        lastVisitDate,
        firstAcquisitionSource: "poster_qr",
      }),
    });
    assert.equal(prepareVisitHistory(storage, "direct", "2026-09-08").returnGap, expected);
  });
});

test("malformed histories are unmeasured once and replaced with a safe baseline", () => {
  const malformedValues = [
    "{bad json",
    JSON.stringify({ firstVisitDate: "2026-09-01" }),
    JSON.stringify({ firstVisitDate: "2026-02-30", lastVisitDate: "2026-09-01", firstAcquisitionSource: "direct" }),
    JSON.stringify({ firstVisitDate: "2026-09-01", lastVisitDate: "2026-09-09", firstAcquisitionSource: "direct" }),
    JSON.stringify({ firstVisitDate: "2026-09-07", lastVisitDate: "2026-09-06", firstAcquisitionSource: "direct" }),
    JSON.stringify({ firstVisitDate: "2026-09-01", lastVisitDate: "2026-09-07", firstAcquisitionSource: "unknown" }),
  ];
  malformedValues.forEach((raw) => {
    const storage = new MemoryStorage({ [VISIT_HISTORY_KEY]: raw });
    assert.deepEqual(prepareVisitHistory(storage, "kakao", "2026-09-08"), unmeasured);
    assert.deepEqual(storedHistory(storage), {
      firstVisitDate: "2026-09-08",
      lastVisitDate: "2026-09-08",
      firstAcquisitionSource: "kakao",
    });
  });
});

test("storage access failures leave return metadata unmeasured without throwing", () => {
  const readFailure = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  const writeFailure = {
    getItem() { return null; },
    setItem() { throw new Error("quota"); },
  };
  assert.deepEqual(prepareVisitHistory(readFailure, "direct", "2026-09-08"), unmeasured);
  assert.deepEqual(prepareVisitHistory(writeFailure, "direct", "2026-09-08"), unmeasured);
  assert.deepEqual(prepareVisitHistory(null, "direct", "2026-09-08"), unmeasured);
});

test("session_start sends return metadata once per new session and other events omit it", async () => {
  let now = Date.parse("2026-09-08T03:00:00.000Z");
  const sessionStorage = new MemoryStorage();
  const localStorage = new MemoryStorage();
  const events = [];
  const calls = [];
  const client = createAnalyticsClient({
    enabled: true,
    sessionStorage,
    localStorage,
    crypto: deterministicCrypto(),
    now: () => now,
    acquisitionSource: "poster_qr",
    onLogicalEvent: (event) => events.push(event),
    getSupabaseClient: async () => ({
      rpc(name, params) {
        calls.push({ name, params: { ...params } });
        return { data: true, error: null };
      },
    }),
  });

  assert.equal(await client.initialize(), true);
  assert.equal(calls[0].params.p_acquisition_source, "poster_qr");
  assert.equal(calls[0].params.p_is_returning, false);
  assert.equal(calls[0].params.p_return_gap, null);
  assert.equal(calls[0].params.p_first_acquisition_source, "poster_qr");
  assert.equal(localStorage.setCalls.length, 1);

  await client.recordRecommendationError({ sourceContext: "discovery", errorCode: "unknown", itemCount: 0 });
  const ordinaryParams = calls.at(-1).params;
  ["p_is_returning", "p_return_gap", "p_first_acquisition_source"].forEach((key) => {
    assert.equal(Object.hasOwn(ordinaryParams, key), false);
  });
  assert.equal(localStorage.setCalls.length, 1, "activity in the same session must not rewrite visit history");

  now += SESSION_TIMEOUT_MS + 1;
  await client.recordRecommendationError({ sourceContext: "discovery", errorCode: "unknown", itemCount: 0 });
  const secondStart = events.filter((event) => event.eventName === "session_start").at(-1);
  assert.equal(secondStart.isReturning, true);
  assert.equal(secondStart.returnGap, "same_day");
  assert.equal(secondStart.firstAcquisitionSource, "poster_qr");
  assert.equal(localStorage.setCalls.length, 2);
});

test("localStorage failure still dispatches session_start with null metadata", async () => {
  const calls = [];
  const client = createAnalyticsClient({
    enabled: true,
    sessionStorage: new MemoryStorage(),
    localStorage: {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    },
    crypto: deterministicCrypto(),
    now: () => Date.parse("2026-09-08T03:00:00.000Z"),
    acquisitionSource: "direct",
    getSupabaseClient: async () => ({
      rpc(name, params) {
        calls.push({ name, params: { ...params } });
        return { data: true, error: null };
      },
    }),
  });
  assert.equal(await client.initialize(), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.p_acquisition_source, "direct");
  assert.equal(calls[0].params.p_is_returning, null);
  assert.equal(calls[0].params.p_return_gap, null);
  assert.equal(calls[0].params.p_first_acquisition_source, null);
});

test("RPC semantic guard fails malformed return metadata closed", () => {
  const common = {
    eventId: "event",
    eventName: "session_start",
    occurredAt: "2026-09-08T00:00:00.000Z",
    sessionId: "session",
    acquisitionSource: "direct",
  };
  assert.deepEqual(buildRpcParameters({
    ...common,
    isReturning: false,
    returnGap: null,
    firstAcquisitionSource: "poster_qr",
  }), {
    p_event_id: "event",
    p_event_name: "session_start",
    p_occurred_at: "2026-09-08T00:00:00.000Z",
    p_session_id: "session",
    p_acquisition_source: "direct",
    p_is_returning: null,
    p_return_gap: null,
    p_first_acquisition_source: null,
  });
});

test("Week 2 tracking adds no persistent identifier or behavioral history", () => {
  assert.deepEqual(ACQUISITION_SOURCES, [
    "direct", "everytime", "kakao", "instagram", "poster_qr", "share", "internal_test", "other",
  ]);
  assert.match(analyticsSource, /changwonFoodVisitHistoryV1/);
  assert.doesNotMatch(
    analyticsSource,
    /anonymous_?id|client_?id|device_?id|fingerprint|navigator\.userAgent|visitCount|visitHistory\s*:\s*\[/i,
  );
  assert.doesNotMatch(analyticsSource, /changwonFoodHistory|historyId|eatenAt/);
});
