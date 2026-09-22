const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { extractFunctionSource } = require("../scripts/analyze-food-character.js");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const adminJs = read("admin.js");
const adminCss = read("admin.css");
const swJs = read("sw.js");
const migration = read("supabase", "migrations", "20260922180000_add_admin_analytics_daily_metrics.sql");
const rollback = read("docs", "analytics", "admin-dashboard-v2-1-rollback.sql");
const backup = read("docs", "analytics", "admin-dashboard-v2-1-backup-readonly.sql");
const precheck = read("docs", "analytics", "admin-dashboard-v2-1-precheck-readonly.sql");
const postcheck = read("docs", "analytics", "admin-dashboard-v2-1-postcheck-readonly.sql");

const acquisitionLabels = Object.freeze([
  ["direct", "직접 접속"], ["everytime", "에브리타임"], ["kakao", "카카오"],
  ["instagram", "인스타"], ["poster_qr", "포스터 QR"], ["share", "묵찌 공유"], ["other", "기타"],
]);
const returnGapLabels = Object.freeze([
  ["same_day", "sameDay", "같은 날"], ["1d", "d1", "1일 후"], ["2_3d", "d2To3", "2~3일 후"],
  ["4_7d", "d4To7", "4~7일 후"], ["8_30d", "d8To30", "8~30일 후"], ["31d_plus", "d31Plus", "31일+"],
]);
const dailyMetrics = Object.freeze([
  { slug: "sessions", key: "sessions", label: "이용 세션" },
  { slug: "completed_sessions", key: "completedSessions", label: "추천 완료 세션" },
  { slug: "refreshes", key: "refreshes", label: "다른 메뉴 추천" },
  { slug: "menu_detail_opens", key: "menuDetailOpens", label: "메뉴 상세" },
  { slug: "map_opens", key: "mapOpens", label: "지도 열기" },
  { slug: "shares", key: "shares", label: "공유" },
  { slug: "eaten_records", key: "eatenRecords", label: "먹음 기록" },
  { slug: "returning_sessions", key: "returningSessions", label: "재방문 세션" },
]);

const runtime = new Function(
  "ANALYTICS_ACQUISITION_LABELS",
  "ANALYTICS_RETURN_GAP_LABELS",
  "ANALYTICS_DAILY_METRICS",
  `${extractFunctionSource(adminJs, "escapeHtml")}
   ${extractFunctionSource(adminJs, "analyticsCount")}
   ${extractFunctionSource(adminJs, "isAnalyticsDateString")}
   ${extractFunctionSource(adminJs, "analyticsCalendarDateShift")}
   ${extractFunctionSource(adminJs, "analyticsCalendarDayCount")}
   ${extractFunctionSource(adminJs, "analyticsDateSequence")}
   ${extractFunctionSource(adminJs, "normalizeAnalyticsDashboard")}
   ${extractFunctionSource(adminJs, "analyticsMetric")}
   ${extractFunctionSource(adminJs, "formatAnalyticsDisplayDate")}
   ${extractFunctionSource(adminJs, "analyticsRangeDisplay")}
   ${extractFunctionSource(adminJs, "analyticsRetentionMeasurementNote")}
   ${extractFunctionSource(adminJs, "analyticsDailyMetricDefinition")}
   ${extractFunctionSource(adminJs, "analyticsDailyLabelIndexes")}
   ${extractFunctionSource(adminJs, "renderAnalyticsDailyChart")}
   ${extractFunctionSource(adminJs, "renderAnalyticsDashboardMarkup")}
   return { normalizeAnalyticsDashboard, analyticsDailyLabelIndexes, renderAnalyticsDailyChart,
     renderAnalyticsDashboardMarkup };`,
)(acquisitionLabels, returnGapLabels, dailyMetrics);

function dateAt(index) {
  const date = new Date("2026-01-01T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
}

function payloadFixture(dayCount = 7) {
  const daily = Array.from({ length: dayCount }, (_, index) => ({
    date: dateAt(index),
    sessions: (index % 3) + 1,
    completed_sessions: index % 2,
    refreshes: index % 4 === 0 ? 1 : 0,
    menu_detail_opens: index % 3 === 0 ? 1 : 0,
    map_opens: index % 5 === 0 ? 1 : 0,
    shares: index % 6 === 0 ? 1 : 0,
    eaten_records: index % 7 === 0 ? 1 : 0,
    returning_sessions: index % 4 === 0 ? 1 : 0,
  }));
  const total = (key) => daily.reduce((sum, row) => sum + row[key], 0);
  const sessions = total("sessions");
  const completed = total("completed_sessions");
  const returning = total("returning_sessions");
  const newSessions = sessions - returning;
  const firstSources = Object.fromEntries(acquisitionLabels.map(([slug], index) => [slug, {
    new_sessions: index === 0 ? newSessions : 0,
    returning_sessions: index === 0 ? returning : 0,
  }]));
  return {
    range: {
      start_date: daily[0].date,
      end_date: daily.at(-1).date,
      day_count: dayCount,
      server_today: "2027-12-31",
      analytics_available_from: daily[0].date,
      retention_measured_from: daily[0].date,
    },
    summary: {
      sessions,
      completed_sessions: completed,
      completion_rate: sessions === 0 ? null : Number(((completed / sessions) * 100).toFixed(1)),
      refreshes: total("refreshes"),
      menu_detail_opens: total("menu_detail_opens"),
      map_opens: total("map_opens"),
      shares: total("shares"),
      errors: 0,
      eaten_records: total("eaten_records"),
    },
    acquisition: { direct: sessions, everytime: 0, kakao: 0, instagram: 0, poster_qr: 0, share: 0, other: 0, internal_test: 0 },
    daily,
    restaurants: [],
    retention: {
      measured_sessions: sessions,
      new_sessions: newSessions,
      returning_sessions: returning,
      unmeasured_sessions: 0,
      returning_session_share: sessions === 0 ? null : Number(((returning / sessions) * 100).toFixed(1)),
      return_gap: { same_day: returning, "1d": 0, "2_3d": 0, "4_7d": 0, "8_30d": 0, "31d_plus": 0 },
      first_acquisition_source: firstSources,
    },
  };
}

function stripSqlLiterals(sql) {
  return sql.replace(/--[^\r\n]*/g, "").replace(/'(?:''|[^'])*'/g, "''");
}

test("migration extends only the existing range RPC and preserves security", () => {
  assert.equal((migration.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((migration.match(/^COMMIT;$/gm) || []).length, 1);
  assert.equal((migration.match(/CREATE OR REPLACE FUNCTION public\.get_admin_analytics_dashboard_range\(/g) || []).length, 1);
  assert.match(migration, /p_start_date date DEFAULT NULL,[\s\S]*p_end_date date DEFAULT NULL/);
  assert.match(migration, /RETURNS jsonb[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = pg_catalog/);
  assert.match(migration, /public\.is_admin\(\) IS DISTINCT FROM true/);
  ["range", "summary", "acquisition", "daily", "restaurants", "retention"]
    .forEach((key) => assert.match(migration, new RegExp(`'${key}'`)));
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_admin_analytics_dashboard_range\(date, date\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_admin_analytics_dashboard_range\(date, date\) TO authenticated, service_role/);
  const executable = stripSqlLiterals(migration);
  assert.doesNotMatch(executable, /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE|MERGE|ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|DROP\s+INDEX|CREATE\s+POLICY|ALTER\s+POLICY)\b/i);
  assert.doesNotMatch(migration, /GRANT\s+SELECT\s+ON\s+(?:TABLE\s+)?public\.analytics_events|ENABLE ROW LEVEL SECURITY|DISABLE ROW LEVEL SECURITY/i);
});

test("daily SQL contains all eight additive metrics with KST and existing exclusions", () => {
  ["sessions", "completed_sessions", "refreshes", "menu_detail_opens", "map_opens", "shares", "eaten_records", "returning_sessions"]
    .forEach((key) => assert.match(migration, new RegExp(`'${key}', metric\\.${key}`)));
  assert.match(migration, /generate_series\(v_start_date::timestamp, v_end_date::timestamp, interval '1 day'\)/);
  assert.match(migration, /server_received_at AT TIME ZONE 'Asia\/Seoul'/);
  assert.doesNotMatch(migration.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$admin_analytics_range\$;/)?.[0] || "", /occurred_at/);
  assert.match(migration, /internal_test_sessions AS MATERIALIZED[\s\S]*eligible_events AS MATERIALIZED/);
  assert.match(migration, /HAVING count\(\*\) = 3[\s\S]*count\(DISTINCT event_row\.position\) = 3[\s\S]*count\(DISTINCT event_row\.menu_id\) = 3/);
  assert.match(migration, /daily totals mismatch/);
});

test("normalization accepts safe daily integers and rejects every total mismatch", () => {
  const normalized = runtime.normalizeAnalyticsDashboard(payloadFixture());
  assert.ok(normalized);
  assert.equal(normalized.daily.length, 7);
  dailyMetrics.forEach(({ key }) => assert.ok(normalized.daily.every((row) => Number.isSafeInteger(row[key]) && row[key] >= 0)));

  const payloadKeys = {
    sessions: "sessions", completedSessions: "completed_sessions", refreshes: "refreshes",
    menuDetailOpens: "menu_detail_opens", mapOpens: "map_opens", shares: "shares",
    eatenRecords: "eaten_records", returningSessions: "returning_sessions",
  };
  Object.values(payloadKeys).forEach((payloadKey) => {
    const bad = payloadFixture();
    bad.daily[0][payloadKey] += 1;
    assert.equal(runtime.normalizeAnalyticsDashboard(bad), null, payloadKey);
  });
  const malformed = payloadFixture();
  malformed.daily[0].map_opens = -1;
  assert.equal(runtime.normalizeAnalyticsDashboard(malformed), null);
});

test("chart represents every day while thinning only x-axis labels", () => {
  [1, 7, 30, 366].forEach((dayCount) => {
    const normalized = runtime.normalizeAnalyticsDashboard(payloadFixture(dayCount));
    assert.ok(normalized);
    const html = runtime.renderAnalyticsDailyChart(normalized.daily, "sessions");
    assert.equal((html.match(/data-analytics-point=/g) || []).length, dayCount);
    const labelCount = (html.match(/analytics-daily-axis-label/g) || []).length;
    assert.equal(labelCount, runtime.analyticsDailyLabelIndexes(dayCount).length);
    assert.ok(labelCount <= (dayCount <= 7 ? dayCount : 7));
  });

  const thirtyDays = runtime.normalizeAnalyticsDashboard(payloadFixture(30));
  assert.ok(thirtyDays);
  const thirtyDayHtml = runtime.renderAnalyticsDailyChart(thirtyDays.daily, "sessions");
  assert.equal(thirtyDays.daily.length, 30);
  assert.equal((thirtyDayHtml.match(/data-analytics-point=/g) || []).length, 30);
  assert.equal((thirtyDayHtml.match(/analytics-daily-axis-label/g) || []).length, 7);
});

test("one-day zero chart and metric-specific list remain readable", () => {
  const payload = payloadFixture(1);
  Object.keys(payload.daily[0]).filter((key) => key !== "date").forEach((key) => { payload.daily[0][key] = 0; });
  payload.summary = {
    sessions: 0, completed_sessions: 0, completion_rate: null, refreshes: 0,
    menu_detail_opens: 0, map_opens: 0, shares: 0, errors: 0, eaten_records: 0,
  };
  payload.acquisition.direct = 0;
  payload.retention.measured_sessions = 0;
  payload.retention.new_sessions = 0;
  payload.retention.returning_sessions = 0;
  payload.retention.returning_session_share = null;
  payload.retention.return_gap.same_day = 0;
  payload.retention.first_acquisition_source.direct.new_sessions = 0;
  payload.retention.first_acquisition_source.direct.returning_sessions = 0;
  const normalized = runtime.normalizeAnalyticsDashboard(payload);
  assert.ok(normalized);
  const html = runtime.renderAnalyticsDashboardMarkup(normalized, { selectedDailyMetric: "map_opens" });
  assert.equal((html.match(/data-analytics-point=/g) || []).length, 1);
  assert.match(html, /analytics-daily-point-value[^>]*>0<\/text>/);
  assert.match(html, /value="map_opens" selected/);
  assert.match(html, /지도 열기 · 1일 내역/);
  assert.match(html, /2026\.01\.01 지도 열기 0/);
});

test("selector exposes exactly eight metrics and rerenders without an RPC", () => {
  dailyMetrics.forEach(({ slug, label }) => {
    assert.match(adminJs, new RegExp(`slug: "${slug}"`));
    assert.match(adminJs, new RegExp(`label: "${label}"`));
  });
  assert.match(adminJs, /selectedDailyMetric: "sessions"/);
  const changeHandler = adminJs.match(/document\.body\.addEventListener\("change",[\s\S]*?\n  \}\);/)?.[0] || "";
  assert.match(changeHandler, /data-analytics-daily-metric/);
  assert.match(changeHandler, /renderAnalyticsDashboard\(\)/);
  assert.doesNotMatch(changeHandler, /\.rpc\(|loadAnalyticsDashboard/);
  const loader = extractFunctionSource(adminJs, "loadAnalyticsDashboard");
  assert.match(loader, /\.\.\.state\.analytics/);
  const reset = extractFunctionSource(adminJs, "resetAnalyticsDashboardState");
  assert.match(reset, /selectedDailyMetric: "sessions"/);
});

test("loading and error clear stale chart content", () => {
  const renderer = extractFunctionSource(adminJs, "renderAnalyticsDashboard");
  assert.equal((renderer.match(/analyticsContent\.replaceChildren\(\)/g) || []).length, 2);
  assert.match(renderer, /selectedDailyMetric: state\.analytics\.selectedDailyMetric/);
});

test("chart uses a local responsive SVG without horizontal scrolling", () => {
  assert.match(adminJs, /<svg class="analytics-daily-chart"/);
  assert.match(adminJs, /<svg class="analytics-daily-chart" width="100%" height="\$\{height\}"/);
  assert.match(adminCss, /\.analytics-daily-chart-scroll\s*\{[^}]*width: 100%;[^}]*max-width: 100%;[^}]*min-width: 0;/);
  assert.match(adminCss, /\.analytics-daily-chart\s*\{[^}]*width: 100%;[^}]*max-width: 720px;[^}]*min-width: 0;[^}]*height: 260px;/);
  assert.doesNotMatch(adminCss, /\.analytics-daily-chart-scroll\s*\{[^}]*overflow-x:\s*auto/);
  assert.doesNotMatch(adminCss, /\.analytics-daily-chart\s*\{[^}]*min-width:\s*(?:540|560)px/);
  assert.doesNotMatch(adminCss, /@media[\s\S]*\.analytics-daily-chart\s*\{[^}]*min-width:/);
  assert.match(adminCss, /@media[\s\S]*\.analytics-daily-toolbar[\s\S]*flex-direction: column/);
  assert.doesNotMatch(`${adminJs}\n${adminCss}`, /Chart\.js|chartjs|D3\.js|d3\.min|Highcharts|ECharts/i);
});

test("support SQL is read-only and rollback restores only the v2 function body", () => {
  [backup, precheck, postcheck].forEach((sql) => {
    assert.doesNotMatch(stripSqlLiterals(sql), /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|ALTER|CREATE|DROP|TRUNCATE|MERGE)\b/i);
  });
  assert.equal((rollback.match(/CREATE OR REPLACE FUNCTION public\.get_admin_analytics_dashboard_range\(/g) || []).length, 1);
  assert.doesNotMatch(rollback, /CASCADE|DROP FUNCTION|ALTER TABLE|CREATE TABLE|DROP TABLE/i);
  assert.match(rollback, /jsonb_build_object\('date', metric\.date, 'sessions', metric\.sessions\)/);
  assert.doesNotMatch(rollback, /'completed_sessions', metric\.completed_sessions/);
});

test("service worker advances only to cache v65", () => {
  assert.match(swJs, /const CACHE_NAME = `\$\{CACHE_PREFIX\}v65`/);
  assert.doesNotMatch(swJs, /v66|v64`/);
});
