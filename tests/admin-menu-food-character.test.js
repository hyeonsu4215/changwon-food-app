const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const foodCharacter = require("../food-character-admin.js");

const root = path.resolve(__dirname, "..");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const adminCss = fs.readFileSync(path.join(root, "admin.css"), "utf8");
const adminSource = fs.readFileSync(path.join(root, "admin.js"), "utf8");

function sourceBetween(startMarker, endMarker) {
  const start = adminSource.indexOf(startMarker);
  const end = adminSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker} 구현을 찾을 수 있어야 합니다.`);
  return adminSource.slice(start, end);
}

const restaurantsById = new Map([["C030", { id: "C030", name: "테스트 가게" }]]);
const appMenuToDb = new Function(
  "restaurantsById",
  `${sourceBetween("function appMenuToDb", "function nextId")}; return appMenuToDb;`,
)(restaurantsById);
const saveMenuSource = sourceBetween("async function saveMenu", "async function deleteRestaurant");

function field(value = "") {
  return { value, checked: false, focusCalls: 0, focus() { this.focusCalls += 1; } };
}

function createSaveHarness({ foodCharacterValue = "", selectedMenuId = null } = {}) {
  const form = {
    id: field("M107"),
    restaurantId: field("C030"),
    name: field("테스트 메뉴"),
    category: field("일식/돈까스"),
    foodCharacter: field(foodCharacterValue),
    price: field("11900"),
    spicy: field("1"),
    salty: field("2"),
    sweet: field("1"),
    portion: field("4"),
    value: field("3"),
    speed: field("2"),
    tags: field("혼밥, 신메뉴"),
    source: field("관리자 확인"),
    lastChecked: field("2026-09-03"),
    recommendNote: field("테스트 추천 메모"),
    signature: { checked: true },
    available: { checked: true },
  };
  const calls = { alerts: [], upserts: [], loads: 0 };
  const state = {
    selectedMenuId,
    supabase: {
      from(table) {
        assert.equal(table, "menus");
        return {
          upsert(payload, options) {
            calls.upserts.push({ payload, options });
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  };
  const saveMenu = new Function(
    "state",
    "els",
    "restaurantsById",
    "canEditSupabaseCatalog",
    "ADMIN_FOOD_CHARACTER",
    "dateInputToIso",
    "appMenuToDb",
    "alert",
    "loadCatalog",
    `${saveMenuSource}; return saveMenu;`,
  )(
    state,
    { menuForm: { elements: form } },
    restaurantsById,
    () => true,
    foodCharacter,
    (value) => value ? `${value}T00:00:00.000Z` : null,
    appMenuToDb,
    (message) => calls.alerts.push(message),
    async () => { calls.loads += 1; },
  );
  return { calls, form, saveMenu };
}

(async () => {
  assert.match(adminHtml, /id="menuCreateFoodCharacter"[^>]*name="foodCharacter"[^>]*aria-required="true"/);
  assert.match(adminHtml, /id="foodCharacterEditor"[^>]*hidden/);
  assert.doesNotMatch(adminHtml, /option value="(?:rice-meal|noodle-special|hot-soup|quick-snack|main-dish)"/);
  assert.match(adminCss, /\.catalog-form input,[\s\S]*\.catalog-form select \{[\s\S]*width: 100%/);
  assert.match(adminCss, /\.catalog-form \{\s*grid-template-columns: 1fr;/);

  const invalidCreate = createSaveHarness();
  assert.equal(await invalidCreate.saveMenu({ preventDefault() {} }), false);
  assert.equal(invalidCreate.calls.upserts.length, 0);
  assert.equal(invalidCreate.calls.loads, 0);
  assert.deepEqual(invalidCreate.calls.alerts, ["Primary Food Character를 선택해주세요."]);
  assert.equal(invalidCreate.form.foodCharacter.focusCalls, 1);

  const validCreate = createSaveHarness({ foodCharacterValue: "noodle-special" });
  assert.equal(await validCreate.saveMenu({ preventDefault() {} }), true);
  assert.equal(validCreate.calls.upserts.length, 1);
  assert.equal(validCreate.calls.loads, 1);
  const createPayload = validCreate.calls.upserts[0].payload;
  assert.equal(createPayload.food_character, "noodle-special");
  assert.equal(createPayload.id, "M107");
  assert.equal(createPayload.restaurant_id, "C030");
  assert.equal(createPayload.restaurant_name, "테스트 가게");
  assert.equal(createPayload.name, "테스트 메뉴");
  assert.equal(createPayload.price, 11900);
  assert.deepEqual(createPayload.tags, ["혼밥", "신메뉴"]);
  assert.equal(createPayload.signature, true);
  assert.equal(createPayload.available, true);

  const invalidSlugCreate = createSaveHarness({ foodCharacterValue: "legacy-invalid" });
  assert.equal(await invalidSlugCreate.saveMenu({ preventDefault() {} }), false);
  assert.equal(invalidSlugCreate.calls.upserts.length, 0);

  const existingEdit = createSaveHarness({ foodCharacterValue: "quick-snack", selectedMenuId: "M101" });
  assert.equal(await existingEdit.saveMenu({ preventDefault() {} }), true);
  assert.equal(Object.hasOwn(existingEdit.calls.upserts[0].payload, "food_character"), false);

  const reloadedMenu = {
    id: createPayload.id,
    name: createPayload.name,
    restaurantName: createPayload.restaurant_name,
    foodCharacter: createPayload.food_character,
  };
  const reloadedEditor = foodCharacter.createEditorState(reloadedMenu);
  const reloadedStatus = foodCharacter.getEditorStatus(reloadedEditor, "supabase");
  assert.equal(reloadedEditor.originalValue, "noodle-special");
  assert.equal(reloadedStatus.originalValid, true);
  assert.equal(reloadedStatus.selectEnabled, true);
  assert.equal(reloadedStatus.saveEnabled, false);

  const modeSource = sourceBetween("function renderMenuCreateFoodCharacterOptions", "function renderFoodCharacterEditor");
  const createField = {
    value: "",
    innerHTML: "",
    disabled: true,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const modeEls = {
    menuCreateFoodCharacterField: { hidden: true },
    menuCreateFoodCharacter: createField,
    foodCharacterEditor: { hidden: false },
  };
  const modeState = { selectedMenuId: null, catalogSource: "supabase" };
  const syncMenuFoodCharacterMode = new Function(
    "els",
    "state",
    "ADMIN_FOOD_CHARACTER",
    `${modeSource}; return syncMenuFoodCharacterMode;`,
  )(modeEls, modeState, foodCharacter);
  syncMenuFoodCharacterMode();
  assert.equal(modeEls.menuCreateFoodCharacterField.hidden, false);
  assert.equal(createField.disabled, false);
  assert.equal(modeEls.foodCharacterEditor.hidden, true);
  foodCharacter.allowedValues.forEach((value) => assert.match(createField.innerHTML, new RegExp(`value="${value}"`)));

  modeState.selectedMenuId = "M101";
  syncMenuFoodCharacterMode();
  assert.equal(modeEls.menuCreateFoodCharacterField.hidden, true);
  assert.equal(createField.disabled, true);
  assert.equal(modeEls.foodCharacterEditor.hidden, false);

  console.log("admin menu Food Character: required create payload, edit isolation, and reload state passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
