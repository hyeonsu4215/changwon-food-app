const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { extractFunctionSource } = require("../scripts/analyze-food-character.js");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const migration = read("supabase", "migrations", "20260824121500_create_admin_analytics_dashboard.sql");
const eatenMigration = read("supabase", "migrations", "20260831090000_add_eaten_record_analytics_v1_1.sql");
const rollback = read("docs", "analytics", "admin-dashboard-rollback.sql");
const precheck = read("docs", "analytics", "admin-dashboard-precheck-readonly.sql");
const postcheck = read("docs", "analytics", "admin-dashboard-postcheck-readonly.sql");
const guide = read("docs", "analytics", "admin-dashboard-v1.md");
const adminHtml = read("admin.html");
const adminJs = read("admin.js");
const adminCss = read("admin.css");

const acquisitionLabels = Object.freeze([
  ["direct", "직접 접속"],
  ["everytime", "에브리타임"],
  ["kakao", "카카오"],
  ["instagram", "인스타"],
  ["poster_qr", "포스터 QR"],
  ["share", "묵찌 공유"],
  ["other", "기타"],
]);

const returnGapLabels = Object.freeze([
  ["same_day", "sameDay", "같은 날"],
  ["1d", "d1", "1일 후"],
  ["2_3d", "d2To3", "2~3일 후"],
  ["4_7d", "d4To7", "4~7일 후"],
  ["8_30d", "d8To30", "8~30일 후"],
  ["31d_plus", "d31Plus", "31일+"],
]);

const runtime = new Function(
  "ANALYTICS_ACQUISITION_LABELS",
  "ANALYTICS_RETURN_GAP_LABELS",
  `${extractFunctionSource(adminJs, "escapeHtml")}
   ${extractFunctionSource(adminJs, "analyticsCount")}
   ${extractFunctionSource(adminJs, "analyticsOptionalCount")}
   ${extractFunctionSource(adminJs, "normalizeAnalyticsDashboard")}
   ${extractFunctionSource(adminJs, "analyticsMetric")}
   ${extractFunctionSource(adminJs, "renderAnalyticsDashboardMarkup")}
   return { normalizeAnalyticsDashboard, renderAnalyticsDashboardMarkup };`,
)(acquisitionLabels, returnGapLabels);

function stripSqlLiterals(sql) {
  return sql
    .replace(/--[^\r\n]*/g, "")
    .replace(/'(?:''|[^'])*'/g, "''");
}

function emptyPayload() {
  return {
    today: {
      sessions: 0,
      completed_sessions: 0,
      completion_rate: null,
      refreshes: 0,
      menu_detail_opens: 0,
      map_opens: 0,
      shares: 0,
      errors: 0,
    },
    acquisition: {
      direct: 0,
      everytime: 0,
      kakao: 0,
      instagram: 0,
      poster_qr: 0,
      share: 0,
      other: 0,
      internal_test: 0,
    },
    retention: {
      measured_sessions: 0,
      new_sessions: 0,
      returning_sessions: 0,
      unmeasured_sessions: 0,
      returning_session_share: null,
      return_gap: {
        same_day: 0,
        "1d": 0,
        "2_3d": 0,
        "4_7d": 0,
        "8_30d": 0,
        "31d_plus": 0,
      },
      first_acquisition_source: Object.fromEntries(
        acquisitionLabels.map(([slug]) => [slug, { new_sessions: 0, returning_sessions: 0 }]),
      ),
    },
    last_7_days: { sessions: 0, completed_sessions: 0, map_opens: 0 },
    restaurants: [],
  };
}

test("dashboard migration creates one admin-only aggregate RPC and nothing else", () => {
  assert.equal((migration.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((migration.match(/^COMMIT;$/gm) || []).length, 1);
  assert.equal((migration.match(/CREATE FUNCTION public\.get_admin_analytics_dashboard\(\)/g) || []).length, 1);
  assert.match(migration, /RETURNS jsonb[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = pg_catalog/);
  assert.match(migration, /public\.is_admin\(\) IS DISTINCT FROM true/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_admin_analytics_dashboard\(\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_admin_analytics_dashboard\(\) TO authenticated/);
  assert.doesNotMatch(migration, /has_function_privilege\(\s*'PUBLIC'/);
  assert.match(migration, /acl\.grantee = 0[\s\S]*acl\.privilege_type = 'EXECUTE'/);
  assert.doesNotMatch(migration, /CREATE INDEX|CREATE POLICY|ALTER POLICY|ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON\s+(?:TABLE\s+)?public\.analytics_events/i);
});

test("dashboard aggregation uses KST server receipt boundaries and excludes full internal-test sessions", () => {
  const functionBody = migration.match(/CREATE FUNCTION public\.get_admin_analytics_dashboard\(\)[\s\S]*?\$admin_analytics_dashboard\$;/)?.[0] || "";
  assert.match(functionBody, /TIME ZONE 'Asia\/Seoul'/);
  assert.match(functionBody, /server_received_at >= bounds\.today_start/);
  assert.match(functionBody, /server_received_at < bounds\.tomorrow_start/);
  assert.match(functionBody, /date - 6/);
  assert.doesNotMatch(functionBody, /occurred_at/);
  const testSet = functionBody.indexOf("internal_test_sessions AS MATERIALIZED");
  const dateSets = functionBody.indexOf("today_events AS MATERIALIZED");
  assert.ok(testSet >= 0 && testSet < dateSets);
  assert.match(functionBody, /event_name = 'session_start'[\s\S]*acquisition_source = 'internal_test'/);
  assert.match(functionBody, /NOT EXISTS \([\s\S]*test_session\.session_id = event_row\.session_id/);
});

test("completion and restaurant metrics retain the approved meanings", () => {
  assert.match(migration, /source_context IN \('discovery', 'personalized'\)/);
  assert.doesNotMatch(migration, /source_context IN \([^)]*shared_pick/);
  assert.match(migration, /GROUP BY event_row\.recommendation_id, event_row\.session_id, event_row\.source_context/);
  assert.match(migration, /HAVING count\(\*\) = 3/);
  assert.match(migration, /count\(DISTINCT event_row\.position\) = 3/);
  assert.match(migration, /min\(event_row\.position\) = 1/);
  assert.match(migration, /max\(event_row\.position\) = 3/);
  assert.match(migration, /count\(DISTINCT event_row\.menu_id\) = 3/);
  assert.match(migration, /count\(\*\) FILTER \(WHERE event_row\.event_name = 'recommendation_shown'\) AS recommendation_exposures/);
  assert.doesNotMatch(migration, /count\(DISTINCT event_row\.recommendation_id\) AS recommendation_exposures/);
  assert.match(migration, /ORDER BY metric\.map_opens DESC,[\s\S]*metric\.menu_detail_opens DESC,[\s\S]*metric\.recommendation_exposures DESC/);
});

test("restaurant history remains visible after its catalog row is deleted", () => {
  assert.match(migration, /FROM restaurant_metrics AS metric\s+LEFT JOIN public\.restaurants AS restaurant ON restaurant\.id = metric\.restaurant_id/);
  assert.doesNotMatch(migration, /FROM restaurant_metrics AS metric\s+JOIN public\.restaurants AS restaurant/);
  assert.match(migration, /'restaurant_name', COALESCE\(restaurant\.name, '삭제된 가게'\)/);
  assert.match(migration, /COALESCE\(restaurant\.name, '삭제된 가게'\) ASC/);
});

test("migration and rollback never mutate analytics or core rows", () => {
  const protectedDml = /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(?:analytics_events|restaurants|menus|restaurant_weekly_hours)/i;
  assert.doesNotMatch(migration, protectedDml);
  assert.doesNotMatch(rollback, protectedDml);
  assert.doesNotMatch(migration, /\b(?:ALTER TABLE|DROP TABLE|TRUNCATE|CASCADE)\b/i);
  assert.doesNotMatch(rollback, /\b(?:DROP TABLE|TRUNCATE|CASCADE)\b/i);
  assert.equal((rollback.match(/DROP FUNCTION public\.get_admin_analytics_dashboard\(\)/g) || []).length, 1);
});

test("precheck and postcheck remain read-only and verify raw-table security", () => {
  const mutation = /\b(?:BEGIN|COMMIT|ALTER|CREATE|DROP|TRUNCATE|MERGE|GRANT|REVOKE|INSERT|UPDATE|DELETE)\b/i;
  assert.doesNotMatch(stripSqlLiterals(precheck), mutation);
  assert.doesNotMatch(stripSqlLiterals(postcheck), mutation);
  [precheck, postcheck].forEach((sql) => {
    assert.match(sql, /relrowsecurity/);
    assert.match(sql, /pg_catalog\.pg_policies/);
    assert.match(sql, /has_table_privilege\('anon', 'public\.analytics_events', 'SELECT'\)/);
    assert.match(sql, /has_table_privilege\('authenticated', 'public\.analytics_events', 'SELECT'\)/);
  });
  assert.match(postcheck, /acl\.grantee = 0/);
  assert.doesNotMatch(postcheck, /has_function_privilege\(\s*'PUBLIC'/);
});

test("zero-data JSON normalizes and renders as a normal empty dashboard", () => {
  const data = runtime.normalizeAnalyticsDashboard(emptyPayload());
  assert.ok(data);
  assert.equal(data.today.sessions, 0);
  assert.equal(data.today.completionRate, null);
  assert.equal(data.today.eatenRecords, 0);
  assert.equal(data.lastSevenDays.eatenRecords, 0);
  assert.equal(data.retention.measuredSessions, 0);
  assert.equal(data.retention.returningSessionShare, null);
  assert.deepEqual(data.restaurants, []);
  const html = runtime.renderAnalyticsDashboardMarkup(data);
  assert.match(html, /오늘 이용 세션/);
  assert.match(html, /추천 완료율/);
  assert.match(html, />-</);
  assert.match(html, /내부 테스트 0세션 · 일반 이용 합계에서 제외/);
  assert.match(html, /아직 기록된 관심 데이터가 없습니다/);
  assert.match(html, /먹음 기록/);
  assert.match(html, /오늘 재방문 현황/);
  assert.match(html, /측정 세션/);
  assert.match(html, /재방문 세션 비중/);
  assert.match(html, /재방문 세션 비중<\/dt><dd>-<\/dd>/);
  assert.match(html, /미측정 0세션/);
  assert.match(html, /같은 날/);
  assert.match(html, /31일\+/);
  assert.match(html, /최초 유입별 오늘 세션/);
  assert.match(html, /첫 방문 0 · 재방문 0/);
  assert.doesNotMatch(html, /Analytics|RPC|Session ID|Recommendation ID|Raw Events/);
});

test("today retention normalizes semantic totals and renders session-only language", () => {
  const payload = emptyPayload();
  payload.retention = {
    measured_sessions: 20,
    new_sessions: 14,
    returning_sessions: 6,
    unmeasured_sessions: 3,
    returning_session_share: 30,
    return_gap: {
      same_day: 2,
      "1d": 1,
      "2_3d": 1,
      "4_7d": 1,
      "8_30d": 1,
      "31d_plus": 0,
    },
    first_acquisition_source: {
      direct: { new_sessions: 4, returning_sessions: 1 },
      everytime: { new_sessions: 3, returning_sessions: 1 },
      kakao: { new_sessions: 2, returning_sessions: 1 },
      instagram: { new_sessions: 2, returning_sessions: 1 },
      poster_qr: { new_sessions: 1, returning_sessions: 1 },
      share: { new_sessions: 1, returning_sessions: 1 },
      other: { new_sessions: 1, returning_sessions: 0 },
      internal_test: { new_sessions: 99, returning_sessions: 99 },
    },
  };

  const data = runtime.normalizeAnalyticsDashboard(payload);
  assert.ok(data);
  assert.equal(data.retention.measuredSessions, 20);
  assert.equal(data.retention.newSessions, 14);
  assert.equal(data.retention.returningSessions, 6);
  assert.equal(data.retention.unmeasuredSessions, 3);
  assert.equal(data.retention.returningSessionShare, 30);
  assert.deepEqual(data.retention.returnGap, {
    sameDay: 2,
    d1: 1,
    d2To3: 1,
    d4To7: 1,
    d8To30: 1,
    d31Plus: 0,
  });

  const html = runtime.renderAnalyticsDashboardMarkup(data);
  [
    "오늘 재방문 현황",
    "측정 세션",
    "첫 방문",
    "재방문",
    "재방문 세션 비중",
    "30%",
    "미측정 3세션",
    "같은 날",
    "1일 후",
    "2~3일 후",
    "4~7일 후",
    "8~30일 후",
    "31일+",
    "최초 유입별 오늘 세션",
    "포스터 QR",
  ].forEach((text) => assert.match(html, new RegExp(text.replace("+", "\\+"))));
  assert.match(html, /재방문 세션 비중 = 재방문 세션 ÷ 측정 세션/);
  assert.doesNotMatch(html, /사용자 재방문율|유저 리텐션|최근 7일 재방문/);
  assert.doesNotMatch(html, /data-first-acquisition-source="internal_test"/);
});

test("invalid retention payloads fail closed without partial dashboard data", () => {
  const cases = [];
  const missingRetention = emptyPayload();
  delete missingRetention.retention;
  cases.push(missingRetention);
  const negativeCount = emptyPayload();
  negativeCount.retention.new_sessions = -1;
  cases.push(negativeCount);
  const invalidShare = emptyPayload();
  invalidShare.retention.returning_session_share = 101;
  cases.push(invalidShare);
  const missingGap = emptyPayload();
  delete missingGap.retention.return_gap["4_7d"];
  cases.push(missingGap);
  const malformedSource = emptyPayload();
  malformedSource.retention.first_acquisition_source.poster_qr = null;
  cases.push(malformedSource);
  const measuredMismatch = emptyPayload();
  measuredMismatch.retention.measured_sessions = 1;
  cases.push(measuredMismatch);
  const gapMismatch = emptyPayload();
  gapMismatch.retention.measured_sessions = 1;
  gapMismatch.retention.returning_sessions = 1;
  gapMismatch.retention.returning_session_share = 100;
  gapMismatch.retention.first_acquisition_source.direct.returning_sessions = 1;
  cases.push(gapMismatch);
  const sourceMismatch = emptyPayload();
  sourceMismatch.retention.measured_sessions = 1;
  sourceMismatch.retention.new_sessions = 1;
  sourceMismatch.retention.returning_session_share = 0;
  cases.push(sourceMismatch);
  const shareMismatch = emptyPayload();
  shareMismatch.retention.measured_sessions = 1;
  shareMismatch.retention.new_sessions = 1;
  shareMismatch.retention.returning_session_share = 50;
  shareMismatch.retention.first_acquisition_source.direct.new_sessions = 1;
  cases.push(shareMismatch);

  cases.forEach((payload) => assert.equal(runtime.normalizeAnalyticsDashboard(payload), null));
});

test("eaten metrics are added without weakening internal-test exclusion", () => {
  const functionBody = eatenMigration.match(/CREATE OR REPLACE FUNCTION public\.get_admin_analytics_dashboard\(\)[\s\S]*?\$admin_analytics_dashboard\$;/)?.[0] || "";
  assert.match(functionBody, /internal_test_sessions AS MATERIALIZED[\s\S]*eligible_events AS MATERIALIZED/);
  assert.match(functionBody, /count\(\*\) FILTER \(WHERE event_name = 'eaten_record_added'\) AS eaten_records/);
  assert.match(functionBody, /count\(\*\) FILTER \(WHERE event_row\.event_name = 'eaten_record_added'\) AS eaten_records/);
  assert.match(functionBody, /'eaten_records', today\.eaten_records/);
  assert.match(functionBody, /'eaten_records', seven_days\.eaten_records/);
  assert.match(functionBody, /'eaten_records', metric\.eaten_records/);

  const payload = emptyPayload();
  payload.today.eaten_records = 4;
  payload.last_7_days.eaten_records = 9;
  payload.restaurants = [{
    restaurant_id: "C001",
    restaurant_name: "리코리코",
    recommendation_exposures: 3,
    menu_detail_opens: 2,
    map_opens: 1,
    eaten_records: 5,
  }];
  const data = runtime.normalizeAnalyticsDashboard(payload);
  assert.equal(data.today.eatenRecords, 4);
  assert.equal(data.lastSevenDays.eatenRecords, 9);
  assert.equal(data.restaurants[0].eatenRecords, 5);
  const html = runtime.renderAnalyticsDashboardMarkup(data);
  assert.match(html, /먹음 기록/);
  assert.match(html, />4회</);
  assert.match(html, />9회</);
  assert.match(html, /data-label="먹음 기록">5</);
});

test("invalid dashboard payload fails closed instead of rendering partial values", () => {
  const missingSource = emptyPayload();
  delete missingSource.acquisition.kakao;
  assert.equal(runtime.normalizeAnalyticsDashboard(missingSource), null);
  const invalidCount = emptyPayload();
  invalidCount.today.sessions = -1;
  assert.equal(runtime.normalizeAnalyticsDashboard(invalidCount), null);
  const invalidRestaurant = emptyPayload();
  invalidRestaurant.restaurants = [{ restaurant_id: "C001", restaurant_name: "", recommendation_exposures: 1, menu_detail_opens: 0, map_opens: 0 }];
  assert.equal(runtime.normalizeAnalyticsDashboard(invalidRestaurant), null);
});

test("admin UI defaults to usage and preserves all existing tabs", () => {
  const tabOrder = ["analytics", "reviews", "reports", "catalog"].map((name) => adminHtml.indexOf(`data-admin-tab="${name}"`));
  assert.ok(tabOrder.every((index) => index >= 0));
  assert.deepEqual([...tabOrder].sort((a, b) => a - b), tabOrder);
  assert.match(adminHtml, /id="analyticsTab" class="is-active" role="tab" aria-selected="true"/);
  assert.match(adminHtml, /id="analyticsPanel"[\s\S]*role="tabpanel"/);
  assert.match(adminHtml, /사용 현황을 불러오는 중/);
  assert.match(adminJs, /setAdminTab\("analytics"\)/);
  assert.match(adminJs, /사용 현황을 불러오지 못했습니다/);
});

test("dashboard loading status is visible only while loading or reporting an error", () => {
  const renderer = extractFunctionSource(adminJs, "renderAnalyticsDashboard");
  assert.match(renderer, /state\.analytics\.loading[\s\S]*analyticsStatus\.hidden = false[\s\S]*사용 현황을 불러오는 중/);
  assert.match(renderer, /state\.analytics\.error \|\| !state\.analytics\.data[\s\S]*analyticsStatus\.hidden = false[\s\S]*사용 현황을 불러오지 못했습니다/);
  assert.match(renderer, /analyticsStatus\.hidden = true[\s\S]*analyticsContent\.hidden = false/);

  const visibleRule = adminCss.match(/\.analytics-status\s*\{[^}]*\}/)?.[0] || "";
  const hiddenRule = adminCss.match(/\.analytics-status\[hidden\]\s*\{[^}]*\}/)?.[0] || "";
  assert.match(visibleRule, /display:\s*flex/);
  assert.match(hiddenRule, /display:\s*none/);
  assert.ok(adminCss.indexOf(hiddenRule) > adminCss.indexOf(visibleRule));
  assert.doesNotMatch(hiddenRule, /!important/);
});

test("browser calls only the aggregate RPC after admin authorization", () => {
  const loader = extractFunctionSource(adminJs, "loadAnalyticsDashboard");
  assert.ok(loader.indexOf("!state.adminAuthorized || !state.supabase") < loader.indexOf("state.supabase.rpc"));
  assert.equal((adminJs.match(/\.rpc\("get_admin_analytics_dashboard"\)/g) || []).length, 1);
  assert.doesNotMatch(adminJs, /\.from\(["']analytics_events["']\)/);
  assert.match(adminJs, /loadAnalyticsDashboard\(\{ force: true \}\)/);
  assert.match(adminJs, /analyticsRequestId/);
  assert.match(adminJs, /state\.user\?\.id !== userId/);
});

test("sign-out and denied authorization remove dashboard data from the DOM", () => {
  const reset = extractFunctionSource(adminJs, "resetAnalyticsDashboardState");
  assert.match(reset, /analyticsRequestId \+= 1/);
  assert.match(reset, /analyticsContent\.replaceChildren\(\)/);
  assert.match(reset, /analyticsContent\.hidden = true/);
  assert.match(extractFunctionSource(adminJs, "signOut"), /resetAnalyticsDashboardState\(\)/);
  const enterAdmin = extractFunctionSource(adminJs, "enterAdmin");
  assert.ok(enterAdmin.indexOf("resetAnalyticsDashboardState()") < enterAdmin.indexOf("state.adminAuthorized = false"));
});

test("responsive dashboard uses existing breakpoints without chart dependencies", () => {
  assert.match(adminCss, /\.analytics-kpi-grid/);
  assert.match(adminCss, /@media \(max-width: 560px\)[\s\S]*\.analytics-restaurant-row/);
  assert.match(adminCss, /@media \(max-width: 400px\)[\s\S]*\.analytics-kpi-grid/);
  assert.match(adminCss, /\.analytics-return-gap-grid/);
  assert.match(adminCss, /@media \(max-width: 400px\)[\s\S]*\.analytics-retention-kpi-grid/);
  assert.doesNotMatch(`${adminHtml}\n${adminJs}`, /chart\.js|echarts|highcharts|d3\.js/i);
  assert.match(guide, /not user or visit counts|not user or visit counts/i);
});
