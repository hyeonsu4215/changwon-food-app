const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { extractFunctionSource } = require("../scripts/analyze-food-character.js");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const adminJs = read("admin.js");
const adminHtml = read("admin.html");
const originalMigration = read("supabase", "migrations", "20260824121500_create_admin_analytics_dashboard.sql");
const migration = read("supabase", "migrations", "20260922120000_add_admin_analytics_date_range_rpc.sql");
const backup = read("docs", "analytics", "admin-dashboard-v2-backup-readonly.sql");
const precheck = read("docs", "analytics", "admin-dashboard-v2-precheck-readonly.sql");
const postcheck = read("docs", "analytics", "admin-dashboard-v2-postcheck-readonly.sql");
const rollback = read("docs", "analytics", "admin-dashboard-v2-rollback.sql");
const guide = read("docs", "analytics", "admin-dashboard-v2.md");

const acquisitionLabels = Object.freeze([
  ["direct", "직접 접속"], ["everytime", "에브리타임"], ["kakao", "카카오"],
  ["instagram", "인스타"], ["poster_qr", "포스터 QR"], ["share", "묵찌 공유"], ["other", "기타"],
]);
const returnGapLabels = Object.freeze([
  ["same_day", "sameDay", "같은 날"], ["1d", "d1", "1일 후"], ["2_3d", "d2To3", "2~3일 후"],
  ["4_7d", "d4To7", "4~7일 후"], ["8_30d", "d8To30", "8~30일 후"], ["31d_plus", "d31Plus", "31일+"],
]);
const rangePresets = Object.freeze(["today", "yesterday", "last_7_days", "last_30_days", "all", "custom"]);

const runtime = new Function(
  "ANALYTICS_ACQUISITION_LABELS",
  "ANALYTICS_RETURN_GAP_LABELS",
  "ANALYTICS_RANGE_PRESETS",
  `${extractFunctionSource(adminJs, "escapeHtml")}
   ${extractFunctionSource(adminJs, "analyticsCount")}
   ${extractFunctionSource(adminJs, "analyticsOptionalCount")}
   ${extractFunctionSource(adminJs, "isAnalyticsDateString")}
   ${extractFunctionSource(adminJs, "analyticsCalendarDateShift")}
   ${extractFunctionSource(adminJs, "analyticsCalendarDayCount")}
   ${extractFunctionSource(adminJs, "analyticsDateSequence")}
   ${extractFunctionSource(adminJs, "analyticsRangeForPreset")}
   ${extractFunctionSource(adminJs, "normalizeAnalyticsDashboard")}
   ${extractFunctionSource(adminJs, "analyticsMetric")}
   ${extractFunctionSource(adminJs, "formatAnalyticsDisplayDate")}
   ${extractFunctionSource(adminJs, "analyticsRangeDisplay")}
   ${extractFunctionSource(adminJs, "analyticsRetentionMeasurementNote")}
   ${extractFunctionSource(adminJs, "renderAnalyticsDashboardMarkup")}
   ${extractFunctionSource(adminJs, "validateAnalyticsCustomRange")}
   return { analyticsRangeForPreset, normalizeAnalyticsDashboard, analyticsRetentionMeasurementNote,
     renderAnalyticsDashboardMarkup, validateAnalyticsCustomRange };`,
)(acquisitionLabels, returnGapLabels, rangePresets);

function payloadFixture() {
  const dates = ["10", "11", "12", "13", "14", "15", "16"];
  const counts = [2, 3, 0, 4, 5, 1, 5];
  return {
    range: {
      start_date: "2026-09-10", end_date: "2026-09-16", day_count: 7,
      server_today: "2026-09-22", analytics_available_from: "2026-09-01",
      retention_measured_from: "2026-09-09",
    },
    summary: {
      sessions: 20, completed_sessions: 10, completion_rate: 50,
      refreshes: 7, menu_detail_opens: 8, map_opens: 6, shares: 3, errors: 1, eaten_records: 4,
    },
    acquisition: { direct: 5, everytime: 4, kakao: 3, instagram: 2, poster_qr: 2, share: 2, other: 2, internal_test: 1 },
    daily: dates.map((date, index) => ({ date: `2026-09-${date}`, sessions: counts[index] })),
    restaurants: [{
      restaurant_id: "C010", restaurant_name: "따뜻한밥상", recommendation_exposures: 8,
      menu_detail_opens: 4, map_opens: 3, eaten_records: 2,
    }],
    retention: {
      measured_sessions: 20, new_sessions: 14, returning_sessions: 6, unmeasured_sessions: 0,
      returning_session_share: 30,
      return_gap: { same_day: 2, "1d": 1, "2_3d": 1, "4_7d": 1, "8_30d": 1, "31d_plus": 0 },
      first_acquisition_source: {
        direct: { new_sessions: 4, returning_sessions: 1 },
        everytime: { new_sessions: 3, returning_sessions: 1 },
        kakao: { new_sessions: 2, returning_sessions: 1 },
        instagram: { new_sessions: 2, returning_sessions: 1 },
        poster_qr: { new_sessions: 1, returning_sessions: 1 },
        share: { new_sessions: 1, returning_sessions: 1 },
        other: { new_sessions: 1, returning_sessions: 0 },
      },
    },
  };
}

function stripSqlLiterals(sql) {
  return sql.replace(/--[^\r\n]*/g, "").replace(/'(?:''|[^'])*'/g, "''");
}

test("range migration creates only the additive admin RPC with secure ACL", () => {
  assert.equal((migration.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((migration.match(/^COMMIT;$/gm) || []).length, 1);
  assert.equal((migration.match(/CREATE FUNCTION public\.get_admin_analytics_dashboard_range\(/g) || []).length, 1);
  assert.match(migration, /p_start_date date DEFAULT NULL,[\s\S]*p_end_date date DEFAULT NULL/);
  assert.match(migration, /RETURNS jsonb[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = pg_catalog/);
  assert.match(migration, /public\.is_admin\(\) IS DISTINCT FROM true/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_admin_analytics_dashboard_range\(date, date\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_admin_analytics_dashboard_range\(date, date\) TO authenticated, service_role/);
  assert.match(migration, /has_function_privilege\('anon', 'public\.get_admin_analytics_dashboard_range\(date,date\)', 'EXECUTE'\)/);
  assert.match(migration, /has_function_privilege\('authenticated', 'public\.get_admin_analytics_dashboard_range\(date,date\)', 'EXECUTE'\)/);
  assert.match(migration, /has_function_privilege\('service_role', 'public\.get_admin_analytics_dashboard_range\(date,date\)', 'EXECUTE'\)/);
  assert.doesNotMatch(originalMigration, /ALTER FUNCTION public\.get_admin_analytics_dashboard\(\)[\s\S]*OWNER TO/i);
  assert.doesNotMatch(migration, /ALTER FUNCTION public\.get_admin_analytics_dashboard_range\(date, date\)[\s\S]*OWNER TO/i);
  assert.doesNotMatch(migration, /(?:DROP|CREATE OR REPLACE) FUNCTION public\.get_admin_analytics_dashboard\(\)/);
});

test("server validation uses inclusive KST dates and rejects invalid requests", () => {
  assert.match(migration, /AT TIME ZONE 'Asia\/Seoul'/);
  assert.match(migration, /v_start_date := v_server_today - 6/);
  assert.match(migration, /p_start_date IS NULL OR p_end_date IS NULL[\s\S]*ERRCODE = '22023'/);
  assert.match(migration, /v_start_date > v_end_date/);
  assert.match(migration, /v_end_date > v_server_today/);
  assert.match(migration, /v_day_count > 731/);
  assert.match(migration, /server_received_at >= v_start_at[\s\S]*server_received_at < v_end_at/);
  const functionBody = migration.match(/CREATE FUNCTION public\.get_admin_analytics_dashboard_range[\s\S]*?\$admin_analytics_range\$;/)?.[0] || "";
  assert.doesNotMatch(functionBody, /occurred_at/);
});

test("range aggregation preserves internal-test exclusion and recommendation semantics", () => {
  assert.match(migration, /internal_test_sessions AS MATERIALIZED[\s\S]*eligible_events AS MATERIALIZED/);
  assert.match(migration, /NOT EXISTS \([\s\S]*test_session\.session_id = event_row\.session_id/);
  assert.match(migration, /source_context IN \('discovery', 'personalized'\)/);
  assert.doesNotMatch(migration, /source_context IN \([^)]*shared_pick/);
  assert.match(migration, /HAVING count\(\*\) = 3/);
  assert.match(migration, /count\(DISTINCT event_row\.position\) = 3/);
  assert.match(migration, /count\(DISTINCT event_row\.menu_id\) = 3/);
  assert.match(migration, /LEFT JOIN public\.restaurants AS restaurant/);
  assert.match(migration, /COALESCE\(restaurant\.name, '삭제된 가게'\)/);
});

test("migration changes no rows, tables, RLS, policies, grants, or indexes", () => {
  const structural = stripSqlLiterals(migration);
  assert.doesNotMatch(structural, /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|UPSERT|ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|CREATE\s+POLICY|ALTER\s+POLICY)\b/i);
  assert.doesNotMatch(migration, /GRANT\s+SELECT\s+ON\s+(?:TABLE\s+)?public\.analytics_events/i);
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY/i);
});

test("rollback removes only the range RPC without cascade", () => {
  assert.match(rollback, /REVOKE ALL ON FUNCTION public\.get_admin_analytics_dashboard_range\(date, date\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.equal((rollback.match(/DROP FUNCTION public\.get_admin_analytics_dashboard_range\(date, date\)/g) || []).length, 1);
  assert.doesNotMatch(rollback, /DROP FUNCTION public\.get_admin_analytics_dashboard\(\)/);
  assert.doesNotMatch(rollback, /CASCADE|ALTER TABLE|DROP TABLE|INSERT|UPDATE|DELETE FROM/i);
});

test("read-only support SQL covers definitions, ACL, schema, indexes, and raw security", () => {
  [backup, precheck, postcheck].forEach((sql) => {
    assert.match(sql, /get_admin_analytics_dashboard/);
    assert.match(sql, /analytics_events/);
    assert.match(sql, /rls_enabled|relrowsecurity/);
    assert.match(sql, /anon_select/);
    assert.match(sql, /authenticated_select/);
  });
  assert.match(backup, /analytics_indexes/);
  assert.match(backup, /pg_get_functiondef/);
  assert.match(postcheck, /authenticated_execute/);
  assert.match(postcheck, /service_role_execute/);
  assert.match(postcheck, /'pass',[\s\S]*NOT has_function_privilege\('anon',[\s\S]*has_function_privilege\('authenticated',[\s\S]*has_function_privilege\('service_role'/);
  assert.match(precheck, /pg_catalog\.pg_policies[\s\S]*tablename = 'analytics_events'\) = 0/);
});

test("quick ranges use the server date and full-history availability", () => {
  const context = { serverToday: "2026-09-22", analyticsAvailableFrom: "2026-09-01" };
  assert.deepEqual(runtime.analyticsRangeForPreset("today", context), { startDate: "2026-09-22", endDate: "2026-09-22" });
  assert.deepEqual(runtime.analyticsRangeForPreset("yesterday", context), { startDate: "2026-09-21", endDate: "2026-09-21" });
  assert.deepEqual(runtime.analyticsRangeForPreset("last_7_days", context), { startDate: "2026-09-16", endDate: "2026-09-22" });
  assert.deepEqual(runtime.analyticsRangeForPreset("last_30_days", context), { startDate: "2026-08-24", endDate: "2026-09-22" });
  assert.deepEqual(runtime.analyticsRangeForPreset("all", context), { startDate: "2026-09-01", endDate: "2026-09-22" });
  assert.deepEqual(runtime.analyticsRangeForPreset("all", { ...context, analyticsAvailableFrom: null }), { startDate: "2026-09-22", endDate: "2026-09-22" });
});

test("custom range validation fails invalid selections closed", () => {
  const range = { serverToday: "2026-09-22", analyticsAvailableFrom: "2026-09-01" };
  assert.equal(runtime.validateAnalyticsCustomRange("2026-09-10", "2026-09-16", range), "");
  assert.match(runtime.validateAnalyticsCustomRange("", "2026-09-16", range), /모두 선택/);
  assert.match(runtime.validateAnalyticsCustomRange("2026-09-17", "2026-09-16", range), /늦을 수 없습니다/);
  assert.match(runtime.validateAnalyticsCustomRange("2026-09-10", "2026-09-23", range), /서버 기준 오늘/);
  assert.match(runtime.validateAnalyticsCustomRange("2026-08-31", "2026-09-16", range), /기록된 첫날/);
  assert.match(runtime.validateAnalyticsCustomRange("2024-08-31", "2026-09-01", { ...range, analyticsAvailableFrom: null }), /731일/);
});

test("selected-range payload renders all dates including zero", () => {
  const normalized = runtime.normalizeAnalyticsDashboard(payloadFixture());
  assert.ok(normalized);
  assert.equal(normalized.range.dayCount, 7);
  assert.equal(normalized.summary.sessions, 20);
  assert.equal(normalized.daily[2].sessions, 0);
  const html = runtime.renderAnalyticsDashboardMarkup(normalized);
  ["선택 기간 요약", "날짜별 이용 세션", "재방문 현황", "재방문 세션 비중", "가게별 관심", "먹음 기록"]
    .forEach((label) => assert.match(html, new RegExp(label)));
  assert.match(html, /2026\.09\.10 ~ 2026\.09\.16/);
  assert.match(html, /datetime="2026-09-12"/);
  assert.match(html, /2026\.09\.12 0세션/);
  assert.doesNotMatch(html, /오늘 이용 세션|오늘 재방문 현황|최근 7일 가게별 관심/);
});

test("zero-data is a valid one-day dashboard", () => {
  const payload = payloadFixture();
  payload.range = { ...payload.range, start_date: "2026-09-22", end_date: "2026-09-22", day_count: 1 };
  payload.summary = { sessions: 0, completed_sessions: 0, completion_rate: null, refreshes: 0, menu_detail_opens: 0, map_opens: 0, shares: 0, errors: 0, eaten_records: 0 };
  payload.daily = [{ date: "2026-09-22", sessions: 0 }];
  payload.restaurants = [];
  payload.retention = {
    measured_sessions: 0, new_sessions: 0, returning_sessions: 0, unmeasured_sessions: 0,
    returning_session_share: null,
    return_gap: { same_day: 0, "1d": 0, "2_3d": 0, "4_7d": 0, "8_30d": 0, "31d_plus": 0 },
    first_acquisition_source: Object.fromEntries(acquisitionLabels.map(([slug]) => [slug, { new_sessions: 0, returning_sessions: 0 }])),
  };
  const normalized = runtime.normalizeAnalyticsDashboard(payload);
  assert.ok(normalized);
  const html = runtime.renderAnalyticsDashboardMarkup(normalized);
  assert.match(html, /추천 완료율<\/dt><dd>-<\/dd>/);
  assert.match(html, /재방문 세션 비중<\/dt><dd>-<\/dd>/);
  assert.match(html, /아직 기록된 관심 데이터가 없습니다/);
});

test("invalid range and semantic payloads fail closed", () => {
  const cases = [];
  const badDayCount = payloadFixture(); badDayCount.range.day_count = 6; cases.push(badDayCount);
  const badOrder = payloadFixture(); badOrder.daily.reverse(); cases.push(badOrder);
  const badDailyTotal = payloadFixture(); badDailyTotal.daily[0].sessions = 3; cases.push(badDailyTotal);
  const badCompletion = payloadFixture(); badCompletion.summary.completion_rate = 49; cases.push(badCompletion);
  const badMeasured = payloadFixture(); badMeasured.retention.measured_sessions = 19; cases.push(badMeasured);
  const badGap = payloadFixture(); badGap.retention.return_gap.same_day = 3; cases.push(badGap);
  const badSource = payloadFixture(); badSource.retention.first_acquisition_source.direct.new_sessions = 5; cases.push(badSource);
  const missingRestaurantMetric = payloadFixture(); delete missingRestaurantMetric.restaurants[0].eaten_records; cases.push(missingRestaurantMetric);
  cases.forEach((payload) => assert.equal(runtime.normalizeAnalyticsDashboard(payload), null));
});

test("retention notes cover after, overlapping, and before periods", () => {
  assert.equal(runtime.analyticsRetentionMeasurementNote({ startDate: "2026-09-10", endDate: "2026-09-16", retentionMeasuredFrom: "2026-09-09" }), "재방문 측정 시작 2026.09.09");
  assert.match(runtime.analyticsRetentionMeasurementNote({ startDate: "2026-09-01", endDate: "2026-09-16", retentionMeasuredFrom: "2026-09-09" }), /2026\.09\.09 이후 측정 가능한 세션 기준/);
  assert.match(runtime.analyticsRetentionMeasurementNote({ startDate: "2026-09-01", endDate: "2026-09-08", retentionMeasuredFrom: "2026-09-09" }), /측정 시작 전/);
  const html = runtime.renderAnalyticsDashboardMarkup(runtime.normalizeAnalyticsDashboard(payloadFixture()));
  assert.doesNotMatch(html, /사용자 재방문율|유저 리텐션|사용자 유지율/);
  assert.match(html, /재방문 세션 비중/);
});

test("HTML and loader expose presets, named RPC args, and stale protection", () => {
  ["today", "yesterday", "last_7_days", "last_30_days", "all", "custom"]
    .forEach((preset) => assert.match(adminHtml, new RegExp(`data-analytics-range-preset="${preset}"`)));
  assert.match(adminHtml, /id="analyticsStartDate" type="date"/);
  assert.match(adminHtml, /id="analyticsEndDate" type="date"/);
  const loader = extractFunctionSource(adminJs, "loadAnalyticsDashboard");
  assert.match(loader, /get_admin_analytics_dashboard_range/);
  assert.match(loader, /p_start_date: startDate/);
  assert.match(loader, /p_end_date: endDate/);
  assert.match(loader, /requestId !== state\.analyticsRequestId/);
  assert.match(loader, /state\.user\?\.id !== userId/);
});

test("guide states v2 safety and session-only interpretation", () => {
  assert.match(guide, /server_received_at/);
  assert.match(guide, /Asia\/Seoul/);
  assert.match(guide, /not user retention/i);
  assert.match(guide, /existing `public\.get_admin_analytics_dashboard\(\)` RPC is preserved/);
  assert.match(guide, /`authenticated` and `service_role` receive execute/);
});
