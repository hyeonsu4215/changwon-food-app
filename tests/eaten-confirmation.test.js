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

function createHarness() {
  const added = [];
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
  const DATA = { menus: [{ id: "M001", name: "아주 긴 테스트 메뉴 이름" }] };
  const factory = new Function(
    "DATA",
    "els",
    "state",
    "addHistory",
    `${extractFunctionSource(appSource, "closeEatenConfirmDialog")}
     ${extractFunctionSource(appSource, "openEatenConfirmDialog")}
     ${extractFunctionSource(appSource, "confirmEatenRecord")}
     return { closeEatenConfirmDialog, openEatenConfirmDialog, confirmEatenRecord };`,
  );
  return {
    added,
    cancelButton,
    dialog,
    els,
    state,
    ...factory(DATA, els, state, (id) => added.push(id)),
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
  assert.match(confirm, /if \(id\) addHistory\(id\)/);
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

  harness.openEatenConfirmDialog("M001");
  harness.confirmEatenRecord();
  harness.confirmEatenRecord();
  assert.deepEqual(harness.added, ["M001"]);
  assert.equal(harness.state.pendingEatenMenuId, null);
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

test("history schema, storage limit, and analytics contract stay unchanged", () => {
  const addHistory = extractFunctionSource(appSource, "addHistory");
  const saveHistory = extractFunctionSource(appSource, "saveHistory");
  assert.match(addHistory, /state\.history\.unshift\(\{ historyId: createHistoryId\(\), id, eatenAt: new Date\(\)\.toISOString\(\) \}\)/);
  assert.match(addHistory, /state\.history = state\.history\.slice\(0, 200\)/);
  assert.match(saveHistory, /localStorage\.setItem\("changwonFoodHistory", JSON\.stringify\(state\.history\)\)/);
  assert.doesNotMatch(analyticsSource, /eaten_record/);
  assert.doesNotMatch(appSource, /eaten_record/);
});

console.log("eaten confirmation: labels, confirmation-only persistence, cleanup, accessibility, and history compatibility passed");
