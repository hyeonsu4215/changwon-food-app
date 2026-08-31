const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { extractFunctionSource } = require("../scripts/analyze-food-character.js");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const analyticsSource = fs.readFileSync(path.join(root, "analytics-client.js"), "utf8");

function createHarness(options = {}) {
  const added = [];
  const analyticsEvents = [];
  const dialog = {
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; },
  };
  const cancelButton = { focusCount: 0, focus() { this.focusCount += 1; } };
  const els = {
    eatenConfirmDialog: dialog,
    eatenConfirmMenuName: { textContent: "" },
    cancelEatenConfirm: cancelButton,
  };
  const state = { pendingEatenMenuId: null };
  const DATA = {
    menus: options.menus || [{ id: "M001", restaurantId: "C001", name: "아주 긴 테스트 메뉴 이름" }],
  };
  const restaurantsById = new Map((options.restaurants || [{ id: "C001" }]).map((restaurant) => [restaurant.id, restaurant]));
  const analyticsClient = {
    recordEatenRecordAdded(payload) {
      analyticsEvents.push(payload);
      if (options.analyticsThrows) throw new Error("analytics unavailable");
      if (options.analyticsRejects) return Promise.reject(new Error("analytics rejected"));
      return Promise.resolve(options.analyticsResult ?? true);
    },
  };
  const factory = new Function(
    "DATA",
    "els",
    "state",
    "addHistory",
    "analyticsClient",
    "restaurantsById",
    `${extractFunctionSource(appSource, "closeEatenConfirmDialog")}
     ${extractFunctionSource(appSource, "openEatenConfirmDialog")}
     ${extractFunctionSource(appSource, "confirmEatenRecord")}
     return { closeEatenConfirmDialog, openEatenConfirmDialog, confirmEatenRecord };`,
  );
  return {
    added,
    analyticsEvents,
    cancelButton,
    dialog,
    els,
    state,
    ...factory(DATA, els, state, options.addHistory || ((id) => added.push(id)), analyticsClient, restaurantsById),
  };
}

test("every data-ate action uses the eaten confirmation label", () => {
  const actions = [...appSource.matchAll(/<button[^>]*data-ate="\$\{item\.id\}"[^>]*>([^<]+)<\/button>/g)];
  assert.equal(actions.length, 6);
  assert.ok(actions.every((match) => match[1] === "먹었어요"));
  assert.doesNotMatch(appSource, /data-ate="\$\{item\.id\}"[^>]*>먹음 기록<\/button>/);
  assert.doesNotMatch(appSource, /aria-label="\$\{escapeHtml\(item\.name\)\} 먹음 기록"/);
});

test("data-ate delegates to confirmation and only confirm calls addHistory", () => {
  const bindEvents = extractFunctionSource(appSource, "bindEvents");
  const closeConfirm = extractFunctionSource(appSource, "closeEatenConfirmDialog");
  const confirm = extractFunctionSource(appSource, "confirmEatenRecord");
  assert.match(bindEvents, /if \(ate\) \{\s*openEatenConfirmDialog\(ate\.dataset\.ate\);\s*return;/);
  assert.doesNotMatch(bindEvents, /if \(ate\)[^{\n]*addHistory/);
  assert.doesNotMatch(closeConfirm, /addHistory/);
  assert.ok(confirm.indexOf("addHistory(id)") < confirm.indexOf("recordEatenRecordAdded"));
  assert.match(confirm, /analyticsClient\?\.recordEatenRecordAdded\(\{ menuId: id, restaurantId \}\)/);
  assert.match(confirm, /trackingRequest\.catch\(\(\) => false\)/);
  assert.equal((appSource.match(/addHistory\(/g) || []).length, 2);
});

test("confirmation consumes one pending menu and cancel clears without saving", () => {
  const harness = createHarness();
  harness.openEatenConfirmDialog("M001");
  assert.equal(harness.dialog.open, true);
  assert.equal(harness.state.pendingEatenMenuId, "M001");
  assert.equal(harness.els.eatenConfirmMenuName.textContent, "아주 긴 테스트 메뉴 이름");
  assert.equal(harness.cancelButton.focusCount, 1);

  harness.closeEatenConfirmDialog();
  assert.equal(harness.dialog.open, false);
  assert.equal(harness.state.pendingEatenMenuId, null);
  assert.deepEqual(harness.added, []);
  assert.deepEqual(harness.analyticsEvents, []);

  harness.openEatenConfirmDialog("M001");
  harness.confirmEatenRecord();
  harness.confirmEatenRecord();
  assert.deepEqual(harness.added, ["M001"]);
  assert.deepEqual(harness.analyticsEvents, [{ menuId: "M001", restaurantId: "C001" }]);
  assert.equal(harness.state.pendingEatenMenuId, null);
});

test("history persistence failure prevents analytics while separate confirmations remain distinct", () => {
  const failed = createHarness({ addHistory() { throw new Error("storage blocked"); } });
  failed.openEatenConfirmDialog("M001");
  assert.throws(() => failed.confirmEatenRecord(), /storage blocked/);
  assert.deepEqual(failed.analyticsEvents, []);

  const repeated = createHarness();
  repeated.openEatenConfirmDialog("M001");
  repeated.confirmEatenRecord();
  repeated.openEatenConfirmDialog("M001");
  repeated.confirmEatenRecord();
  assert.deepEqual(repeated.added, ["M001", "M001"]);
  assert.equal(repeated.analyticsEvents.length, 2);
});

test("missing or invalid restaurant lookup preserves history and sends no analytics", () => {
  const missingRestaurant = createHarness({
    menus: [{ id: "M001", name: "식당 누락 메뉴" }],
  });
  missingRestaurant.openEatenConfirmDialog("M001");
  missingRestaurant.confirmEatenRecord();
  assert.deepEqual(missingRestaurant.added, ["M001"]);
  assert.deepEqual(missingRestaurant.analyticsEvents, []);

  const invalidRestaurant = createHarness({
    menus: [{ id: "M001", restaurantId: "C999", name: "잘못된 식당 메뉴" }],
  });
  invalidRestaurant.openEatenConfirmDialog("M001");
  invalidRestaurant.confirmEatenRecord();
  assert.deepEqual(invalidRestaurant.added, ["M001"]);
  assert.deepEqual(invalidRestaurant.analyticsEvents, []);
});

test("analytics sync and async failures cannot undo a saved history entry", async () => {
  const syncFailure = createHarness({ analyticsThrows: true });
  syncFailure.openEatenConfirmDialog("M001");
  assert.doesNotThrow(() => syncFailure.confirmEatenRecord());
  assert.deepEqual(syncFailure.added, ["M001"]);

  const asyncFailure = createHarness({ analyticsRejects: true });
  asyncFailure.openEatenConfirmDialog("M001");
  assert.doesNotThrow(() => asyncFailure.confirmEatenRecord());
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(asyncFailure.added, ["M001"]);
});

test("dialog cancel, backdrop, and close paths share cleanup", () => {
  const bindEvents = extractFunctionSource(appSource, "bindEvents");
  assert.match(bindEvents, /cancelEatenConfirm\?\.addEventListener\("click", closeEatenConfirmDialog\)/);
  assert.match(bindEvents, /addEventListener\("cancel", \(event\) => \{\s*event\.preventDefault\(\);\s*closeEatenConfirmDialog\(\);/);
  assert.match(bindEvents, /event\.target === els\.eatenConfirmDialog\) closeEatenConfirmDialog\(\)/);
  assert.match(bindEvents, /addEventListener\("close", \(\) => \{\s*state\.pendingEatenMenuId = null;/);
});

test("dialog markup and controls remain accessible on mobile", () => {
  assert.match(indexSource, /<dialog id="eatenConfirmDialog" aria-labelledby="eatenConfirmTitle" aria-describedby="eatenConfirmDescription">/);
  assert.match(indexSource, /id="cancelEatenConfirm">취소<\/button>/);
  assert.match(indexSource, /id="confirmEatenRecord">네, 먹었어요<\/button>/);
  assert.match(stylesSource, /\.eaten-confirm-actions button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(stylesSource, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(stylesSource, /overflow-wrap:\s*anywhere/);
});

test("history schema and storage limit stay unchanged while analytics stays payload-minimal", () => {
  const addHistory = extractFunctionSource(appSource, "addHistory");
  const saveHistory = extractFunctionSource(appSource, "saveHistory");
  assert.match(addHistory, /state\.history\.unshift\(\{ historyId: createHistoryId\(\), id, eatenAt: new Date\(\)\.toISOString\(\) \}\)/);
  assert.match(addHistory, /state\.history = state\.history\.slice\(0, 200\)/);
  assert.match(saveHistory, /localStorage\.setItem\("changwonFoodHistory", JSON\.stringify\(state\.history\)\)/);
  assert.match(analyticsSource, /recordEatenRecordAdded/);
  assert.doesNotMatch(analyticsSource, /historyId|eatenAt|changwonFoodHistory|user_id|auth\.uid|nickname|exact location/i);
});

console.log("eaten confirmation: labels, confirmation-only persistence, cleanup, accessibility, and history compatibility passed");
