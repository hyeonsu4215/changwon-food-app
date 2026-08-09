const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const adminSource = fs.readFileSync(path.join(root, "admin.js"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");

function sourceBetween(startMarker, endMarker) {
  const start = adminSource.indexOf(startMarker);
  const end = adminSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker} 구현을 찾을 수 있어야 합니다.`);
  return adminSource.slice(start, end);
}

const staticCatalogFunctions = sourceBetween("function cloneStaticValue", "const staticCatalog =");
const readStaticCatalog = new Function(`${staticCatalogFunctions}; return readStaticCatalog;`)();
const originalStaticData = {
  restaurants: [{ id: "C001", details: { note: "original" } }],
  menus: [{ id: "M001", restaurantId: "C001", tags: ["혼밥"] }],
};
const protectedStaticData = readStaticCatalog(originalStaticData);
assert.notEqual(protectedStaticData.menus, originalStaticData.menus);
assert.notEqual(protectedStaticData.menus[0].tags, originalStaticData.menus[0].tags);
assert.ok(Object.isFrozen(protectedStaticData.restaurants));
assert.ok(Object.isFrozen(protectedStaticData.restaurants[0].details));
assert.ok(Object.isFrozen(protectedStaticData.menus[0].tags));
originalStaticData.menus[0].tags.push("원본 변경");
assert.deepEqual(protectedStaticData.menus[0].tags, ["혼밥"]);

const sourceSwitchFunctions = sourceBetween("function resetCatalogEditingState", "function canEditSupabaseCatalog");
const sourceState = { catalogSource: "supabase", selectedRestaurantId: "C001", selectedMenuId: "M001" };
const resetCalls = { restaurant: 0, menu: 0, render: 0 };
const switchCatalogSource = new Function(
  "state",
  "clearRestaurantForm",
  "clearMenuForm",
  "renderCatalog",
  `${sourceSwitchFunctions}; return switchCatalogSource;`,
)(
  sourceState,
  () => { resetCalls.restaurant += 1; },
  () => { resetCalls.menu += 1; },
  () => { resetCalls.render += 1; },
);
assert.equal(switchCatalogSource("static"), true);
assert.equal(sourceState.catalogSource, "static");
assert.equal(sourceState.selectedRestaurantId, null);
assert.equal(sourceState.selectedMenuId, null);
assert.deepEqual(resetCalls, { restaurant: 1, menu: 1, render: 1 });
sourceState.selectedRestaurantId = "dirty-store";
sourceState.selectedMenuId = "dirty-menu";
assert.equal(switchCatalogSource("supabase"), true);
assert.equal(sourceState.selectedRestaurantId, null);
assert.equal(sourceState.selectedMenuId, null);
assert.deepEqual(resetCalls, { restaurant: 2, menu: 2, render: 2 });

const seedFunctionSource = sourceBetween("async function seedCatalogFromStatic()", "async function loadReviews()");
const writeFunctionSource = sourceBetween("function canEditSupabaseCatalog()", "function bindEvents()");
const calls = { alert: 0, confirm: 0, writes: 0 };
const state = {
  catalogSource: "static",
  dataStatus: { supabase: { connected: true }, status: "normal" },
  supabase: {
    from() {
      calls.writes += 1;
      throw new Error("정적 원본에서는 Supabase write 경로에 도달하면 안 됩니다.");
    },
  },
};
const helpers = new Function(
  "state",
  "alert",
  "confirm",
  "CATALOG_SEED_LOCKED",
  "currentCatalogData",
  `${seedFunctionSource}\n${writeFunctionSource}; return { seedCatalogFromStatic, saveRestaurant, saveMenu, deleteRestaurant, deleteMenu };`,
)(
  state,
  () => { calls.alert += 1; },
  () => { calls.confirm += 1; return true; },
  true,
  () => ({ editable: false }),
);

(async () => {
  const blockedEvent = { preventDefault() {} };
  assert.equal(await helpers.seedCatalogFromStatic(), false);
  await helpers.saveRestaurant(blockedEvent);
  await helpers.saveMenu(blockedEvent);
  await helpers.deleteRestaurant("C001");
  await helpers.deleteMenu("M001");
  assert.equal(calls.writes, 0);
  assert.equal(calls.confirm, 0);
  assert.equal(calls.alert, 3);
  assert.match(adminHtml, /id="seedCatalog"[^>]*disabled/);
  assert.match(adminHtml, /정적 데이터와 Supabase 비교 준비 중/);
  assert.match(adminHtml, /data-catalog-source="supabase" aria-pressed="true"/);
  assert.match(adminHtml, /data-catalog-source="static" aria-pressed="false"/);
  console.log("admin safety: static writes blocked, source reset, static data protected");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
