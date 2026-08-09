const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const foodCharacter = require("../food-character-admin.js");

const root = path.resolve(__dirname, "..");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const adminSource = fs.readFileSync(path.join(root, "admin.js"), "utf8");

assert.equal(foodCharacter.definitions.length, 5);
assert.equal(new Set(foodCharacter.allowedValues).size, 5);
assert.deepEqual(foodCharacter.allowedValues, [
  "rice-meal",
  "noodle-special",
  "hot-soup",
  "quick-snack",
  "main-dish",
]);
foodCharacter.definitions.forEach((definition) => {
  assert.ok(definition.label, `${definition.value}에 한국어 label이 있어야 합니다.`);
  assert.ok(definition.description, `${definition.value}에 관리자 설명이 있어야 합니다.`);
});

function draft(name, category, tags = []) {
  return foodCharacter.suggestFoodCharacterDraft({ name, category, tags });
}

assert.equal(draft("닭고기 부리또", "햄버거", ["혼밥", "밥"]).suggestedFoodCharacter, "quick-snack");
assert.equal(draft("소고기 쌀국수", "아시안", ["혼밥"]).suggestedFoodCharacter, "noodle-special");
assert.equal(draft("미니탕수육", "중식", ["해장"]).suggestedFoodCharacter, "main-dish");
assert.ok(draft("닭고기 부리또", "햄버거").warning);
assert.ok(draft("소고기 쌀국수", "아시안").warning);
assert.ok(draft("미니탕수육", "중식").warning);

const withoutTags = draft("테스트 메뉴", "한식", []);
const misleadingTags = draft("테스트 메뉴", "한식", ["밥", "탕", "국수", "혼밥"]);
assert.deepEqual(misleadingTags, withoutTags, "tags는 자동 초안 판정에 영향을 주면 안 됩니다.");

assert.match(adminHtml, /id="foodCharacterPreview"[^>]*disabled/);
assert.match(adminHtml, /실제 선택 및 저장은 FC-2 승인 후 활성화/);
assert.match(adminHtml, /food-character-admin\.js[\s\S]*supabase-config\.js[\s\S]*admin\.js/);

const appMenuToDbSource = adminSource.slice(
  adminSource.indexOf("function appMenuToDb"),
  adminSource.indexOf("function nextId"),
);
const saveMenuSource = adminSource.slice(
  adminSource.indexOf("async function saveMenu"),
  adminSource.indexOf("async function deleteRestaurant"),
);
assert.doesNotMatch(appMenuToDbSource, /food_?character/i);
assert.doesNotMatch(saveMenuSource, /food_?character/i);

console.log("food character foundation: definitions, disabled UI, and payload isolation passed");
