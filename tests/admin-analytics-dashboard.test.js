const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { extractFunctionSource } = require("../scripts/analyze-food-character.js");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const originalMigration = read("supabase", "migrations", "20260824121500_create_admin_analytics_dashboard.sql");
const eatenMigration = read("supabase", "migrations", "20260831090000_add_eaten_record_analytics_v1_1.sql");
const rangeMigration = read("supabase", "migrations", "20260922120000_add_admin_analytics_date_range_rpc.sql");
const originalRollback = read("docs", "analytics", "admin-dashboard-rollback.sql");
const originalPrecheck = read("docs", "analytics", "admin-dashboard-precheck-readonly.sql");
const originalPostcheck = read("docs", "analytics", "admin-dashboard-postcheck-readonly.sql");
const adminHtml = read("admin.html");
const adminJs = read("admin.js");
const adminCss = read("admin.css");

function stripSqlLiterals(sql) {
  return sql.replace(/--[^\r\n]*/g, "").replace(/'(?:''|[^'])*'/g, "''");
}

test("existing no-argument dashboard RPC remains in history and is not replaced by v2", () => {
  assert.match(originalMigration, /CREATE FUNCTION public\.get_admin_analytics_dashboard\(\)/);
  assert.match(eatenMigration, /CREATE OR REPLACE FUNCTION public\.get_admin_analytics_dashboard\(\)/);
  assert.doesNotMatch(rangeMigration, /(?:DROP|CREATE OR REPLACE) FUNCTION public\.get_admin_analytics_dashboard\(\)/);
  assert.doesNotMatch(rangeMigration, /REVOKE ALL ON FUNCTION public\.get_admin_analytics_dashboard\(\)/);
  assert.match(rangeMigration, /pg_get_functiondef\(to_regprocedure\('public\.get_admin_analytics_dashboard\(\)'\)\)/);
});

test("v1 security and approved metric meanings remain documented in migration history", () => {
  assert.equal((originalMigration.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((originalMigration.match(/^COMMIT;$/gm) || []).length, 1);
  assert.match(originalMigration, /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog/);
  assert.match(originalMigration, /public\.is_admin\(\) IS DISTINCT FROM true/);
  assert.match(originalMigration, /REVOKE ALL ON FUNCTION public\.get_admin_analytics_dashboard\(\) FROM PUBLIC, anon, authenticated/);
  assert.match(originalMigration, /GRANT EXECUTE ON FUNCTION public\.get_admin_analytics_dashboard\(\) TO authenticated/);
  assert.doesNotMatch(originalMigration, /CREATE INDEX|CREATE POLICY|ALTER POLICY|ENABLE ROW LEVEL SECURITY/);
  assert.match(originalMigration, /source_context IN \('discovery', 'personalized'\)/);
  assert.match(originalMigration, /HAVING count\(\*\) = 3/);
  assert.match(originalMigration, /count\(DISTINCT event_row\.position\) = 3/);
  assert.match(originalMigration, /LEFT JOIN public\.restaurants/);
  assert.match(originalMigration, /COALESCE\(restaurant\.name, '삭제된 가게'\)/);
  assert.doesNotMatch(rangeMigration, /GRANT\s+SELECT\s+ON\s+(?:TABLE\s+)?public\.analytics_events/i);
});

test("v1 dashboard keeps KST receipt boundaries and full internal-test session exclusion", () => {
  const functionBody = originalMigration.match(/CREATE FUNCTION public\.get_admin_analytics_dashboard\(\)[\s\S]*?\$admin_analytics_dashboard\$;/)?.[0] || "";
  assert.match(functionBody, /TIME ZONE 'Asia\/Seoul'/);
  assert.match(functionBody, /server_received_at >= bounds\.today_start/);
  assert.match(functionBody, /server_received_at < bounds\.tomorrow_start/);
  assert.match(functionBody, /internal_test_sessions AS MATERIALIZED/);
  assert.match(functionBody, /NOT EXISTS \([\s\S]*test_session\.session_id = event_row\.session_id/);
  assert.doesNotMatch(functionBody, /occurred_at/);
});

test("v1 restaurant aggregation ordering and deleted-row fallback remain locked", () => {
  assert.match(originalMigration, /count\(\*\) FILTER \(WHERE event_row\.event_name = 'recommendation_shown'\) AS recommendation_exposures/);
  assert.doesNotMatch(originalMigration, /count\(DISTINCT event_row\.recommendation_id\) AS recommendation_exposures/);
  assert.match(originalMigration, /FROM restaurant_metrics AS metric\s+LEFT JOIN public\.restaurants AS restaurant/);
  assert.match(originalMigration, /COALESCE\(restaurant\.name, '삭제된 가게'\)/);
  assert.match(originalMigration, /ORDER BY metric\.map_opens DESC,[\s\S]*metric\.menu_detail_opens DESC,[\s\S]*metric\.recommendation_exposures DESC/);
});

test("v1 support SQL remains narrow and read-only", () => {
  const mutation = /\b(?:BEGIN|COMMIT|ALTER|CREATE|DROP|TRUNCATE|MERGE|GRANT|REVOKE|INSERT|UPDATE|DELETE)\b/i;
  assert.doesNotMatch(stripSqlLiterals(originalPrecheck), mutation);
  assert.doesNotMatch(stripSqlLiterals(originalPostcheck), mutation);
  [originalPrecheck, originalPostcheck].forEach((sql) => {
    assert.match(sql, /relrowsecurity/);
    assert.match(sql, /pg_catalog\.pg_policies/);
    assert.match(sql, /has_table_privilege\('anon', 'public\.analytics_events', 'SELECT'\)/);
    assert.match(sql, /has_table_privilege\('authenticated', 'public\.analytics_events', 'SELECT'\)/);
  });
  assert.equal((originalRollback.match(/DROP FUNCTION public\.get_admin_analytics_dashboard\(\)/g) || []).length, 1);
  assert.doesNotMatch(originalRollback, /DROP TABLE|TRUNCATE|CASCADE|INSERT|UPDATE|DELETE FROM/i);
});

test("eaten-record aggregation remains represented in both existing and range RPCs", () => {
  assert.match(eatenMigration, /count\(\*\) FILTER \(WHERE event_name = 'eaten_record_added'\) AS eaten_records/);
  assert.match(rangeMigration, /count\(\*\) FILTER \(WHERE event_name = 'eaten_record_added'\) AS eaten_records/);
  assert.match(rangeMigration, /count\(\*\) FILTER \(WHERE event_row\.event_name = 'eaten_record_added'\) AS eaten_records/);
});

test("administrator UI preserves all tabs and authorizes before calling Analytics", () => {
  const tabOrder = ["analytics", "reviews", "reports", "catalog"].map((name) => adminHtml.indexOf(`data-admin-tab="${name}"`));
  assert.ok(tabOrder.every((index) => index >= 0));
  assert.deepEqual([...tabOrder].sort((a, b) => a - b), tabOrder);
  assert.match(adminHtml, /id="analyticsTab" class="is-active"/);
  assert.match(adminJs, /setAdminTab\("analytics"\)/);
  const loader = extractFunctionSource(adminJs, "loadAnalyticsDashboard");
  assert.ok(loader.indexOf("!state.adminAuthorized || !state.supabase") < loader.indexOf("state.supabase.rpc"));
  assert.match(loader, /get_admin_analytics_dashboard_range/);
  assert.doesNotMatch(adminJs, /\.from\(["']analytics_events["']\)/);
});

test("sign-out and denied authorization clear dashboard and date-range state", () => {
  const reset = extractFunctionSource(adminJs, "resetAnalyticsDashboardState");
  assert.match(reset, /analyticsRequestId \+= 1/);
  assert.match(reset, /preset: "last_7_days"/);
  assert.match(reset, /requestStartDate: null/);
  assert.match(reset, /analyticsContent\.replaceChildren\(\)/);
  assert.match(extractFunctionSource(adminJs, "signOut"), /resetAnalyticsDashboardState\(\)/);
  const enterAdmin = extractFunctionSource(adminJs, "enterAdmin");
  assert.ok(enterAdmin.indexOf("resetAnalyticsDashboardState()") < enterAdmin.indexOf("state.adminAuthorized = false"));
});

test("loading and error states never expose stale partial dashboard markup", () => {
  const renderer = extractFunctionSource(adminJs, "renderAnalyticsDashboard");
  assert.match(renderer, /state\.analytics\.loading[\s\S]*analyticsContent\.hidden = true/);
  assert.match(renderer, /state\.analytics\.error \|\| !state\.analytics\.data[\s\S]*analyticsContent\.hidden = true/);
  assert.match(renderer, /analyticsStatus\.hidden = true[\s\S]*analyticsContent\.hidden = false/);
  assert.match(adminCss, /\.analytics-status\[hidden\]\s*\{[^}]*display:\s*none/);
});

test("responsive dashboard stays dependency-free and retains existing admin features", () => {
  assert.match(adminCss, /\.analytics-range-presets/);
  assert.match(adminCss, /\.analytics-daily-row/);
  assert.match(adminCss, /@media \(max-width: 560px\)[\s\S]*\.analytics-custom-range/);
  assert.match(adminCss, /@media \(max-width: 400px\)[\s\S]*\.analytics-range-presets button/);
  assert.doesNotMatch(`${adminHtml}\n${adminJs}`, /chart\.js|echarts|highcharts|d3\.js/i);
  ["reviewList", "reportList", "restaurantForm", "menuForm", "weeklyHoursEditor", "foodCharacterEditor"]
    .forEach((id) => assert.match(adminHtml, new RegExp(`id="${id}"`)));
});
