const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { extractFunctionSource } = require("../scripts/analyze-food-character.js");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const adminSource = fs.readFileSync(path.join(root, "admin.js"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const dataSource = fs.readFileSync(path.join(root, "data.js"), "utf8");
const schemaSql = fs.readFileSync(path.join(root, "supabase", "migrations", "20260815090000_add_map_search_fields.sql"), "utf8");

const dataSandbox = { window: {} };
vm.runInNewContext(dataSource, dataSandbox, { filename: "data.js" });
const catalog = dataSandbox.window.CHANGWON_FOOD_DATA;
const restaurantsById = new Map(catalog.restaurants.map((restaurant) => [restaurant.id, restaurant]));

const mapRuntime = new Function(
  "restaurantsById",
  `${extractFunctionSource(appSource, "escapeHtml")}
   ${extractFunctionSource(appSource, "mapSearchConfig")}
   ${extractFunctionSource(appSource, "mapUrl")}
   ${extractFunctionSource(appSource, "mapActionHtml")}
   return { mapSearchConfig, mapUrl, mapActionHtml };`,
)(restaurantsById);

const defaultRestaurant = restaurantsById.get("C001");
assert.equal(
  decodeURIComponent(mapRuntime.mapUrl({ restaurant: defaultRestaurant }).split("/").pop()),
  `창원대 ${defaultRestaurant.name}`,
);
assert.equal(mapRuntime.mapSearchConfig({ restaurant: { name: "공백 식당", mapSearchKeyword: "   " } }).query, "창원대 공백 식당");
assert.equal(mapRuntime.mapSearchConfig({ restaurantName: "대체 식당" }).query, "창원대 대체 식당");
assert.equal(mapRuntime.mapSearchConfig({ restaurant: { name: "숫자 식당", mapSearchKeyword: 123 } }).query, "창원대 숫자 식당");
assert.equal(mapRuntime.mapSearchConfig(undefined).query, "창원대 ");
assert.equal(
  decodeURIComponent(mapRuntime.mapUrl({ restaurant: { name: "기본", mapSearchKeyword: "한글 / 공백" } }).split("/").pop()),
  "한글 / 공백",
);
assert.match(mapRuntime.mapUrl({ restaurant: { name: "기본", mapSearchKeyword: "한글 / 공백" } }), /%ED%95%9C%EA%B8%80%20%2F%20%EA%B3%B5%EB%B0%B1$/);

const expectedExceptions = new Map([
  ["C003", { name: "엄마손", keyword: "엄마손분식", disabled: false }],
  ["C005", { name: "경대컵밥", keyword: null, disabled: true }],
  ["C010", { name: "따뜻한밥상", keyword: "창원 따뜻한밥상", disabled: false }],
  ["C011", { name: "소소소국수집", keyword: "소소소국수집", disabled: false }],
  ["C014", { name: "창대 비빔밥 뷔페", keyword: "창대 비빔밥 뷔페", disabled: false }],
  ["C018", { name: "뼈따구", keyword: "뼈따구", disabled: false }],
]);

const configuredRestaurants = catalog.restaurants.filter(
  (restaurant) => Object.hasOwn(restaurant, "mapSearchKeyword") || Object.hasOwn(restaurant, "mapSearchDisabled"),
);
assert.equal(configuredRestaurants.length, 6);
assert.equal(catalog.restaurants.length - configuredRestaurants.length, 23);

expectedExceptions.forEach((expected, id) => {
  const restaurant = restaurantsById.get(id);
  assert.ok(restaurant, `${id} must exist in static fallback`);
  assert.equal(restaurant.name, expected.name);
  assert.equal(restaurant.mapSearchKeyword, expected.keyword);
  assert.equal(restaurant.mapSearchDisabled, expected.disabled);
  if (expected.disabled) {
    assert.equal(mapRuntime.mapUrl({ restaurant }), null);
  } else {
    assert.equal(decodeURIComponent(mapRuntime.mapUrl({ restaurant }).split("/").pop()), expected.keyword);
  }
});

const unavailableHtml = mapRuntime.mapActionHtml({ restaurant: restaurantsById.get("C005") }, { label: "지도" });
assert.match(unavailableHtml, /data-map-unavailable/);
assert.match(unavailableHtml, /<button type="button"/);
assert.doesNotMatch(unavailableHtml, /href=/);
assert.match(appSource, /data-map-unavailable[\s\S]*현재 네이버 지도에 등록된 가게 정보가 없어요/);

const adminRuntime = new Function(
  `${extractFunctionSource(adminSource, "normalizeMapSearchSettings")}
   ${extractFunctionSource(adminSource, "appRestaurantToDb")}
   return { normalizeMapSearchSettings, appRestaurantToDb };`,
)();

assert.deepEqual(adminRuntime.normalizeMapSearchSettings("  엄마손분식  ", false), {
  mapSearchKeyword: "엄마손분식",
  mapSearchDisabled: false,
});
assert.deepEqual(adminRuntime.normalizeMapSearchSettings("남아 있으면 안 됨", true), {
  mapSearchKeyword: null,
  mapSearchDisabled: true,
});
assert.deepEqual(adminRuntime.normalizeMapSearchSettings("   ", false), {
  mapSearchKeyword: null,
  mapSearchDisabled: false,
});

const adminPayload = adminRuntime.appRestaurantToDb({
  id: "C005",
  name: "경대컵밥",
  mapSearchKeyword: "지워질 값",
  mapSearchDisabled: true,
});
assert.equal(adminPayload.map_search_keyword, null);
assert.equal(adminPayload.map_search_disabled, true);

assert.match(adminHtml, /name="mapSearchKeyword"/);
assert.match(adminHtml, /name="mapSearchDisabled"\s+type="checkbox"/);
assert.match(adminHtml, /비워두면 기본 검색어를 사용합니다/);
assert.match(adminHtml, /네이버 지도에 등록되지 않은 가게 등에 사용합니다/);
assert.match(extractFunctionSource(adminSource, "saveRestaurant"), /if \(!canEditSupabaseCatalog\(\)\)/);

function withoutSqlComments(sql) {
  return sql.replace(/--.*$/gm, "");
}

const executableSchemaSql = withoutSqlComments(schemaSql);
assert.match(executableSchemaSql, /alter table public\.restaurants/i);
assert.match(executableSchemaSql, /map_search_keyword text null/i);
assert.match(executableSchemaSql, /map_search_disabled boolean not null default false/i);
assert.doesNotMatch(executableSchemaSql, /\b(insert|update|upsert|delete)\b/i);
assert.doesNotMatch(executableSchemaSql, /\b(enable|disable)\s+row\s+level\s+security\b/i);

console.log("map search keyword: runtime, static fallback, admin payload, and schema safeguards passed");
