const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const foodCharacter = require("../food-character-admin.js");

const root = path.resolve(__dirname, "..");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const adminSource = fs.readFileSync(path.join(root, "admin.js"), "utf8");

function createFakeSupabase({ updateData, updateError = null, verificationData, verificationError = null } = {}) {
  const calls = {
    tables: [],
    updates: [],
    updateFilters: [],
    updateFilterOperators: [],
    verificationFilters: [],
    selects: [],
  };
  let updateCallCount = 0;

  return {
    calls,
    from(table) {
      calls.tables.push(table);
      let mode = "read";
      const query = {
        update(payload) {
          mode = "update";
          updateCallCount += 1;
          calls.updates.push(payload);
          return query;
        },
        select(columns) {
          calls.selects.push({ mode, columns });
          return query;
        },
        eq(column, value) {
          const filter = { column, value };
          if (mode === "update") {
            calls.updateFilters.push(filter);
            calls.updateFilterOperators.push("eq");
          }
          else calls.verificationFilters.push(filter);
          return query;
        },
        is(column, value) {
          calls.updateFilters.push({ column, value });
          calls.updateFilterOperators.push("is");
          return query;
        },
        maybeSingle() {
          return Promise.resolve({ data: verificationData, error: verificationError });
        },
        then(resolve, reject) {
          const data = updateData === undefined
            ? [{ id: "M017", food_character: "noodle-special" }]
            : updateData;
          return Promise.resolve({ data, error: updateError }).then(resolve, reject);
        },
      };
      return query;
    },
    get updateCallCount() {
      return updateCallCount;
    },
  };
}

function errorCode(promise) {
  return promise.then(
    () => null,
    (error) => error.code,
  );
}

const selected = foodCharacter.createEditorState({
  id: "M017",
  name: "돈까스 도련님 고기고기",
  restaurantName: "리코리코",
  foodCharacter: "rice-meal",
});
let status = foodCharacter.getEditorStatus(selected, "supabase");
assert.equal(status.selectEnabled, true);
assert.equal(status.saveEnabled, false);
assert.equal(status.dirty, false);
assert.equal(selected.originalValue, "rice-meal");

status = foodCharacter.getEditorStatus(selected, "static");
assert.equal(status.selectEnabled, false);
assert.equal(status.saveEnabled, false);

const changed = foodCharacter.updateEditorValue(selected, "noodle-special");
status = foodCharacter.getEditorStatus(changed, "supabase");
assert.equal(status.dirty, true);
assert.equal(status.saveEnabled, true);
assert.equal(changed.originalValue, "rice-meal");
assert.equal(changed.nextValue, "noodle-special");

const invalid = foodCharacter.updateEditorValue(selected, "dessert");
status = foodCharacter.getEditorStatus(invalid, "supabase");
assert.equal(status.nextValid, false);
assert.equal(status.saveEnabled, false);

const missingValue = foodCharacter.createEditorState({
  id: "M101",
  name: "새 메뉴",
  restaurantName: "테스트 가게",
  foodCharacter: null,
});
status = foodCharacter.getEditorStatus(missingValue, "supabase");
assert.equal(status.originalValid, false);
assert.equal(status.selectEnabled, true);
assert.equal(status.saveEnabled, false);
const missingValueRecovery = foodCharacter.updateEditorValue(missingValue, "noodle-special");
status = foodCharacter.getEditorStatus(missingValueRecovery, "supabase");
assert.equal(status.dirty, true);
assert.equal(status.saveEnabled, true);

const invalidValue = foodCharacter.createEditorState({
  id: "M102",
  name: "기존 잘못된 메뉴",
  restaurantName: "테스트 가게",
  foodCharacter: "legacy-invalid",
});
status = foodCharacter.getEditorStatus(invalidValue, "supabase");
assert.equal(status.selectEnabled, true);
assert.equal(status.saveEnabled, false);
const invalidValueRecovery = foodCharacter.updateEditorValue(invalidValue, "main-dish");
assert.equal(foodCharacter.getEditorStatus(invalidValueRecovery, "supabase").saveEnabled, true);

const reset = foodCharacter.createEditorState();
assert.equal(reset.menuId, null);
assert.equal(reset.originalValue, null);
assert.equal(reset.nextValue, null);
assert.equal(foodCharacter.getEditorStatus(reset, "supabase").dirty, false);

const contextFunctionSource = adminSource.slice(
  adminSource.indexOf("function invalidateFoodCharacterEditorContext"),
  adminSource.indexOf("function resetFoodCharacterEditingState"),
);

function createContextFunctions(state) {
  return new Function(
    "state",
    `${contextFunctionSource}; return { invalidateFoodCharacterEditorContext, isCurrentFoodCharacterRequest };`,
  )(state);
}

const resetFunctionSource = adminSource.slice(
  adminSource.indexOf("function invalidateFoodCharacterEditorContext"),
  adminSource.indexOf("function clearMenuForm"),
);
const resetState = {
  foodCharacterEditorGeneration: 4,
  foodCharacterEditor: { ...changed, saving: true },
  foodCharacterMessage: "dirty",
  foodCharacterMessageType: "error",
};
const resetFoodCharacterEditingState = new Function(
  "state",
  "ADMIN_FOOD_CHARACTER",
  "renderFoodCharacterEditor",
  `${resetFunctionSource}; return resetFoodCharacterEditingState;`,
)(resetState, foodCharacter, () => {});
resetFoodCharacterEditingState();
assert.equal(resetState.foodCharacterEditorGeneration, 5);
assert.equal(resetState.foodCharacterEditor.menuId, null);
assert.equal(resetState.foodCharacterEditor.saving, false);
assert.equal(resetState.foodCharacterMessage, "");
assert.equal(resetState.foodCharacterMessageType, "");

const saveFunctionSource = adminSource.slice(
  adminSource.indexOf("async function saveSelectedFoodCharacter"),
  adminSource.indexOf("async function saveRestaurant"),
);
const confirmPosition = saveFunctionSource.indexOf("const confirmed = confirm(");
const writePosition = saveFunctionSource.indexOf("saveFoodCharacterChange({");
assert.ok(confirmPosition >= 0 && writePosition > confirmPosition, "확인 이후에만 write helper를 호출해야 합니다.");
assert.match(
  adminSource.slice(adminSource.indexOf("function switchCatalogSource"), adminSource.indexOf("function canEditSupabaseCatalog")),
  /resetCatalogEditingState\(\)/,
);
assert.match(
  adminSource.slice(adminSource.indexOf("async function loadCatalog"), adminSource.indexOf("async function seedCatalogFromStatic")),
  /resetCatalogEditingState\(\)/,
);
assert.match(
  adminSource.slice(adminSource.indexOf("function editMenu"), adminSource.indexOf("function resetCatalogEditingState")),
  /invalidateFoodCharacterEditorContext\(\)/,
);

const contextProbeState = {
  foodCharacterEditorGeneration: 7,
  catalogSource: "supabase",
  selectedMenuId: "M017",
  foodCharacterEditor: { menuId: "M017" },
};
const contextProbe = createContextFunctions(contextProbeState);
assert.equal(contextProbe.isCurrentFoodCharacterRequest({ generation: 7, source: "supabase", menuId: "M017" }), true);
assert.equal(contextProbe.isCurrentFoodCharacterRequest({ generation: 6, source: "supabase", menuId: "M017" }), false);
assert.equal(contextProbe.isCurrentFoodCharacterRequest({ generation: 7, source: "static", menuId: "M017" }), false);
assert.equal(contextProbe.isCurrentFoodCharacterRequest({ generation: 7, source: "supabase", menuId: "M018" }), false);

function createAdminSaveHarness({ confirmResult = true, saveResult, saveError, saveImplementation } = {}) {
  const state = {
    supabase: {},
    catalogSource: "supabase",
    selectedMenuId: "M017",
    foodCharacterEditorGeneration: 1,
    menus: [{
      id: "M017",
      name: "돈까스 도련님 고기고기",
      restaurantName: "리코리코",
      foodCharacter: "rice-meal",
      price: 12900,
    }],
    foodCharacterEditor: { ...changed },
    foodCharacterMessage: "",
    foodCharacterMessageType: "",
  };
  const calls = { confirm: 0, save: 0, render: 0, refreshMaps: 0 };
  const helper = {
    ...foodCharacter,
    async saveFoodCharacterChange(request) {
      calls.save += 1;
      if (saveImplementation) return saveImplementation(request);
      if (saveError) throw saveError;
      return saveResult || { menuId: "M017", foodCharacter: "noodle-special" };
    },
  };
  const saveSelectedFoodCharacter = new Function(
    "state",
    "ADMIN_FOOD_CHARACTER",
    "canEditSupabaseCatalog",
    "renderFoodCharacterEditor",
    "confirm",
    "refreshCatalogMaps",
    "isCurrentFoodCharacterRequest",
    `${saveFunctionSource}; return saveSelectedFoodCharacter;`,
  )(
    state,
    helper,
    () => true,
    () => { calls.render += 1; },
    () => { calls.confirm += 1; return confirmResult; },
    () => { calls.refreshMaps += 1; },
    createContextFunctions(state).isCurrentFoodCharacterRequest,
  );
  return {
    state,
    calls,
    saveSelectedFoodCharacter,
    ...createContextFunctions(state),
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function selectEditor(harness, nextValue = "hot-soup") {
  harness.invalidateFoodCharacterEditorContext();
  harness.state.catalogSource = "supabase";
  harness.state.selectedMenuId = "M017";
  harness.state.foodCharacterEditor = foodCharacter.updateEditorValue(
    foodCharacter.createEditorState({
      id: "M017",
      name: "돈까스 도련님 고기고기",
      restaurantName: "리코리코",
      foodCharacter: "rice-meal",
    }),
    nextValue,
  );
  harness.state.foodCharacterMessage = "";
  harness.state.foodCharacterMessageType = "";
}

function resetEditor(harness, source = "supabase") {
  harness.invalidateFoodCharacterEditorContext();
  harness.state.catalogSource = source;
  harness.state.selectedMenuId = null;
  harness.state.foodCharacterEditor = foodCharacter.createEditorState();
  harness.state.foodCharacterMessage = "";
  harness.state.foodCharacterMessageType = "";
}

(async () => {
  const cancelledHarness = createAdminSaveHarness({ confirmResult: false });
  assert.equal(await cancelledHarness.saveSelectedFoodCharacter(), false);
  assert.equal(cancelledHarness.calls.confirm, 1);
  assert.equal(cancelledHarness.calls.save, 0);

  const adminSuccess = createAdminSaveHarness();
  assert.equal(await adminSuccess.saveSelectedFoodCharacter(), true);
  assert.equal(adminSuccess.calls.save, 1);
  assert.equal(adminSuccess.calls.refreshMaps, 1);
  assert.equal(adminSuccess.state.menus[0].foodCharacter, "noodle-special");
  assert.equal(adminSuccess.state.menus[0].price, 12900);
  assert.equal(adminSuccess.state.foodCharacterEditor.originalValue, "noodle-special");
  assert.equal(adminSuccess.state.foodCharacterEditor.nextValue, "noodle-special");
  assert.equal(foodCharacter.getEditorStatus(adminSuccess.state.foodCharacterEditor, "supabase").dirty, false);
  assert.equal(adminSuccess.state.foodCharacterMessageType, "success");

  const adminFailure = createAdminSaveHarness({
    saveError: new foodCharacter.FoodCharacterSaveError("stale"),
  });
  assert.equal(await adminFailure.saveSelectedFoodCharacter(), false);
  assert.equal(adminFailure.state.menus[0].foodCharacter, "rice-meal");
  assert.equal(adminFailure.state.foodCharacterEditor.originalValue, "rice-meal");
  assert.equal(adminFailure.state.foodCharacterEditor.nextValue, "noodle-special");
  assert.equal(adminFailure.state.foodCharacterMessageType, "error");

  const resetRaceRequest = createDeferred();
  const resetRace = createAdminSaveHarness({ saveImplementation: () => resetRaceRequest.promise });
  const resetRaceSave = resetRace.saveSelectedFoodCharacter();
  resetEditor(resetRace);
  selectEditor(resetRace, "hot-soup");
  resetRaceRequest.resolve({ menuId: "M017", foodCharacter: "noodle-special" });
  assert.equal(await resetRaceSave, false);
  assert.equal(resetRace.state.foodCharacterEditor.originalValue, "rice-meal");
  assert.equal(resetRace.state.foodCharacterEditor.nextValue, "hot-soup");
  assert.equal(foodCharacter.getEditorStatus(resetRace.state.foodCharacterEditor, "supabase").dirty, true);
  assert.equal(resetRace.state.foodCharacterMessage, "");

  const staleErrorRequest = createDeferred();
  const staleErrorRace = createAdminSaveHarness({ saveImplementation: () => staleErrorRequest.promise });
  const staleErrorSave = staleErrorRace.saveSelectedFoodCharacter();
  resetEditor(staleErrorRace);
  selectEditor(staleErrorRace, "hot-soup");
  staleErrorRequest.reject(new foodCharacter.FoodCharacterSaveError("connection"));
  assert.equal(await staleErrorSave, false);
  assert.equal(staleErrorRace.state.foodCharacterEditor.originalValue, "rice-meal");
  assert.equal(staleErrorRace.state.foodCharacterEditor.nextValue, "hot-soup");
  assert.equal(staleErrorRace.state.foodCharacterMessage, "");
  assert.equal(staleErrorRace.state.foodCharacterMessageType, "");

  const sourceRaceRequest = createDeferred();
  const sourceRace = createAdminSaveHarness({ saveImplementation: () => sourceRaceRequest.promise });
  const sourceRaceSave = sourceRace.saveSelectedFoodCharacter();
  resetEditor(sourceRace, "static");
  sourceRaceRequest.resolve({ menuId: "M017", foodCharacter: "noodle-special" });
  assert.equal(await sourceRaceSave, false);
  assert.equal(sourceRace.state.catalogSource, "static");
  assert.equal(sourceRace.state.foodCharacterEditor.menuId, null);
  assert.equal(sourceRace.state.foodCharacterMessage, "");

  const requestA = createDeferred();
  const requestB = createDeferred();
  const queuedRequests = [requestA, requestB];
  const overlappingRace = createAdminSaveHarness({
    saveImplementation: () => queuedRequests.shift().promise,
  });
  const saveA = overlappingRace.saveSelectedFoodCharacter();
  resetEditor(overlappingRace);
  selectEditor(overlappingRace, "hot-soup");
  const saveB = overlappingRace.saveSelectedFoodCharacter();
  assert.equal(overlappingRace.state.foodCharacterEditor.saving, true);
  requestA.resolve({ menuId: "M017", foodCharacter: "noodle-special" });
  assert.equal(await saveA, false);
  assert.equal(overlappingRace.state.foodCharacterEditor.saving, true);
  assert.equal(overlappingRace.state.foodCharacterEditor.originalValue, "rice-meal");
  assert.equal(overlappingRace.state.foodCharacterEditor.nextValue, "hot-soup");
  assert.equal(overlappingRace.state.foodCharacterMessage, "");
  requestB.resolve({ menuId: "M017", foodCharacter: "hot-soup" });
  assert.equal(await saveB, true);
  assert.equal(overlappingRace.state.foodCharacterEditor.saving, false);
  assert.equal(overlappingRace.state.foodCharacterEditor.originalValue, "hot-soup");
  assert.equal(overlappingRace.state.foodCharacterEditor.nextValue, "hot-soup");
  assert.equal(overlappingRace.state.foodCharacterMessageType, "success");

  const doubleSubmitRequest = createDeferred();
  const doubleSubmit = createAdminSaveHarness({ saveImplementation: () => doubleSubmitRequest.promise });
  const firstSubmit = doubleSubmit.saveSelectedFoodCharacter();
  const secondSubmit = doubleSubmit.saveSelectedFoodCharacter();
  assert.equal(await secondSubmit, false);
  assert.equal(doubleSubmit.calls.save, 1);
  assert.equal(doubleSubmit.state.foodCharacterEditor.saving, true);
  assert.equal(doubleSubmit.state.foodCharacterMessageType, "");
  doubleSubmitRequest.resolve({ menuId: "M017", foodCharacter: "noodle-special" });
  assert.equal(await firstSubmit, true);
  assert.equal(doubleSubmit.calls.save, 1);

  const successfulClient = createFakeSupabase({
    updateData: [{ id: "M017", food_character: "noodle-special" }],
    verificationData: { id: "M017", food_character: "noodle-special" },
  });
  const saved = await foodCharacter.saveFoodCharacterChange({
    supabase: successfulClient,
    source: "supabase",
    menuId: "M017",
    originalValue: "rice-meal",
    nextValue: "noodle-special",
  });
  assert.deepEqual(saved, { menuId: "M017", foodCharacter: "noodle-special" });
  assert.equal(successfulClient.updateCallCount, 1);
  assert.deepEqual(successfulClient.calls.tables, ["menus", "menus"]);
  assert.deepEqual(successfulClient.calls.updates, [{ food_character: "noodle-special" }]);
  assert.deepEqual(Object.keys(successfulClient.calls.updates[0]), ["food_character"]);
  assert.deepEqual(successfulClient.calls.updateFilters, [
    { column: "id", value: "M017" },
    { column: "food_character", value: "rice-meal" },
  ]);
  assert.deepEqual(successfulClient.calls.updateFilterOperators, ["eq", "eq"]);
  assert.deepEqual(successfulClient.calls.verificationFilters, [{ column: "id", value: "M017" }]);
  assert.deepEqual(successfulClient.calls.selects, [
    { mode: "update", columns: "id,food_character" },
    { mode: "read", columns: "id,food_character" },
  ]);

  const verifiedEditor = foodCharacter.createEditorState({
    id: saved.menuId,
    name: selected.menuName,
    restaurantName: selected.restaurantName,
    foodCharacter: saved.foodCharacter,
  });
  assert.equal(verifiedEditor.originalValue, "noodle-special");
  assert.equal(foodCharacter.getEditorStatus(verifiedEditor, "supabase").dirty, false);

  const nullRecoveryClient = createFakeSupabase({
    updateData: [{ id: "M101", food_character: "noodle-special" }],
    verificationData: { id: "M101", food_character: "noodle-special" },
  });
  assert.deepEqual(await foodCharacter.saveFoodCharacterChange({
    supabase: nullRecoveryClient,
    source: "supabase",
    menuId: "M101",
    originalValue: null,
    nextValue: "noodle-special",
  }), { menuId: "M101", foodCharacter: "noodle-special" });
  assert.deepEqual(nullRecoveryClient.calls.updates, [{ food_character: "noodle-special" }]);
  assert.deepEqual(nullRecoveryClient.calls.updateFilters, [
    { column: "id", value: "M101" },
    { column: "food_character", value: null },
  ]);
  assert.deepEqual(nullRecoveryClient.calls.updateFilterOperators, ["eq", "is"]);

  const invalidRecoveryClient = createFakeSupabase({
    updateData: [{ id: "M102", food_character: "main-dish" }],
    verificationData: { id: "M102", food_character: "main-dish" },
  });
  assert.deepEqual(await foodCharacter.saveFoodCharacterChange({
    supabase: invalidRecoveryClient,
    source: "supabase",
    menuId: "M102",
    originalValue: "legacy-invalid",
    nextValue: "main-dish",
  }), { menuId: "M102", foodCharacter: "main-dish" });
  assert.deepEqual(invalidRecoveryClient.calls.updateFilterOperators, ["eq", "eq"]);
  assert.deepEqual(invalidRecoveryClient.calls.updateFilters[1], {
    column: "food_character",
    value: "legacy-invalid",
  });

  const staleClient = createFakeSupabase({ updateData: [] });
  assert.equal(await errorCode(foodCharacter.saveFoodCharacterChange({
    supabase: staleClient,
    source: "supabase",
    menuId: "M017",
    originalValue: "rice-meal",
    nextValue: "noodle-special",
  })), "stale");
  assert.deepEqual(staleClient.calls.tables, ["menus"]);

  const multipleRowsClient = createFakeSupabase({
    updateData: [
      { id: "M017", food_character: "noodle-special" },
      { id: "M018", food_character: "noodle-special" },
    ],
  });
  assert.equal(await errorCode(foodCharacter.saveFoodCharacterChange({
    supabase: multipleRowsClient,
    source: "supabase",
    menuId: "M017",
    originalValue: "rice-meal",
    nextValue: "noodle-special",
  })), "invalid-response");
  assert.deepEqual(multipleRowsClient.calls.tables, ["menus"]);

  const authorizationClient = createFakeSupabase({
    updateData: null,
    updateError: { code: "42501", message: "permission denied" },
  });
  assert.equal(await errorCode(foodCharacter.saveFoodCharacterChange({
    supabase: authorizationClient,
    source: "supabase",
    menuId: "M017",
    originalValue: "rice-meal",
    nextValue: "noodle-special",
  })), "authorization");

  const connectionClient = createFakeSupabase({
    updateData: null,
    updateError: { message: "Failed to fetch" },
  });
  assert.equal(await errorCode(foodCharacter.saveFoodCharacterChange({
    supabase: connectionClient,
    source: "supabase",
    menuId: "M017",
    originalValue: "rice-meal",
    nextValue: "noodle-special",
  })), "connection");

  const databaseErrorClient = createFakeSupabase({
    updateData: null,
    updateError: { code: "PGRST204", status: 400, message: "database request rejected" },
  });
  assert.equal(await errorCode(foodCharacter.saveFoodCharacterChange({
    supabase: databaseErrorClient,
    source: "supabase",
    menuId: "M017",
    originalValue: "rice-meal",
    nextValue: "noodle-special",
  })), "database-error");

  const mismatchClient = createFakeSupabase({
    updateData: [{ id: "M017", food_character: "noodle-special" }],
    verificationData: { id: "M017", food_character: "hot-soup" },
  });
  assert.equal(await errorCode(foodCharacter.saveFoodCharacterChange({
    supabase: mismatchClient,
    source: "supabase",
    menuId: "M017",
    originalValue: "rice-meal",
    nextValue: "noodle-special",
  })), "verification-mismatch");

  const blockedClient = createFakeSupabase();
  assert.equal(await errorCode(foodCharacter.saveFoodCharacterChange({
    supabase: blockedClient,
    source: "static",
    menuId: "M017",
    originalValue: "rice-meal",
    nextValue: "noodle-special",
  })), "static-source");
  assert.equal(blockedClient.updateCallCount, 0);
  assert.equal(await errorCode(foodCharacter.saveFoodCharacterChange({
    supabase: blockedClient,
    source: "supabase",
    menuId: "M017",
    originalValue: "rice-meal",
    nextValue: "dessert",
  })), "invalid-value");
  assert.equal(blockedClient.updateCallCount, 0);
  assert.equal(await errorCode(foodCharacter.saveFoodCharacterChange({
    supabase: blockedClient,
    source: "supabase",
    menuId: "",
    originalValue: "rice-meal",
    nextValue: "noodle-special",
  })), "missing-menu");
  assert.equal(blockedClient.updateCallCount, 0);
  assert.equal(await errorCode(foodCharacter.saveFoodCharacterChange({
    supabase: blockedClient,
    source: "supabase",
    menuId: "M017",
    originalValue: undefined,
    nextValue: "noodle-special",
  })), "invalid-original");
  assert.equal(blockedClient.updateCallCount, 0);

  const recoveryHarness = createAdminSaveHarness();
  recoveryHarness.state.menus[0].foodCharacter = null;
  recoveryHarness.state.foodCharacterEditor = foodCharacter.updateEditorValue(
    foodCharacter.createEditorState({
      ...recoveryHarness.state.menus[0],
      foodCharacter: null,
    }),
    "noodle-special",
  );
  assert.equal(await recoveryHarness.saveSelectedFoodCharacter(), true);
  assert.equal(recoveryHarness.calls.save, 1);
  assert.equal(recoveryHarness.state.menus[0].foodCharacter, "noodle-special");

  assert.match(adminHtml, /id="foodCharacterSelect"[^>]*disabled/);
  assert.match(adminHtml, /id="saveFoodCharacter"[^>]*disabled/);
  assert.match(adminHtml, /FC-2/);
  assert.match(adminSource, /올바른 Primary Food Character를 선택해 복구해주세요/);
  assert.match(adminSource, /정적 데이터는 읽기 전용/);
  assert.match(adminSource, /saveFoodCharacterChange\(\{[\s\S]*originalValue: requestContext\.originalValue[\s\S]*nextValue: requestContext\.nextValue/);
  assert.match(adminSource, /state\.menus = state\.menus\.map/);
  assert.match(adminSource, /createEditorState\(verifiedMenu\)/);
  assert.doesNotMatch(
    adminSource.slice(adminSource.indexOf("async function saveSelectedFoodCharacter"), adminSource.indexOf("async function saveRestaurant")),
    /\.upsert\(|\.insert\(|\.delete\(/,
  );

  console.log("food character FC-2: state, CAS payload, verification, and write guards passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
