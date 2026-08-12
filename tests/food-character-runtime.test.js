const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  PRIMARY_VALUES,
  loadFoodCharacterRuntime,
  loadDbMenuToApp,
  loadFoodData,
  loadApprovedCharacters,
  buildClassificationAudit,
} = require("../scripts/analyze-food-character.js");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const runtime = loadFoodCharacterRuntime(appSource);
const dbMenuToApp = loadDbMenuToApp(appSource);
const data = loadFoodData();
const approved = loadApprovedCharacters();
const menusById = new Map(data.menus.map((menu) => [menu.id, menu]));

const mapped = dbMenuToApp({
  id: "MTEST",
  restaurant_id: "CTEST",
  name: "테스트 쌀국수",
  category: "아시안",
  available: true,
  tags: ["혼밥"],
  food_character: "noodle-special",
}, new Map());
assert.equal(mapped.foodCharacter, "noodle-special");
assert.equal(runtime.foodCharacter(mapped), "noodle-special");
assert.equal(dbMenuToApp({ id: "MNULL", restaurant_id: "CTEST" }, new Map()).foodCharacter, null);

assert.deepEqual([...runtime.PRIMARY_FOOD_CHARACTERS], PRIMARY_VALUES);
[
  ["부리또", "quick-snack"],
  ["소고기 쌀국수", "noodle-special"],
  ["탄탄멘", "noodle-special"],
  ["김치찌개", "hot-soup"],
  ["미니탕수육", "main-dish"],
  ["돈까스", "main-dish"],
].forEach(([name, explicit]) => {
  assert.equal(runtime.foodCharacter({ name, category: "한식", tags: ["혼밥", "해장"], foodCharacter: explicit }), explicit);
});

[
  ["김치찌개", "quick-snack"],
  ["미니탕수육", "noodle-special"],
  ["닭고기 부리또", "hot-soup"],
  ["볶음짬뽕", "rice-meal"],
  ["비빔밥", "main-dish"],
].forEach(([conflictingName, explicit]) => {
  assert.equal(
    runtime.foodCharacter({
      name: conflictingName,
      category: "분식",
      tags: ["혼밥", "해장"],
      foodCharacter: explicit,
    }),
    explicit,
    `${explicit}: valid explicit value must override name, category, and tags`,
  );
});

const tagVariants = [[], ["혼밥"], ["해장"], ["혼밥", "해장"]];
["닭고기 부리또", "소고기 쌀국수", "미니탕수육", "물밀면"].forEach((name) => {
  const results = new Set(tagVariants.map((tags) => runtime.foodCharacter({ name, category: "기타", tags })));
  assert.equal(results.size, 1, `${name}: fallback must not depend on tags`);
});

assert.equal(runtime.foodCharacter({ name: "미니탕수육", foodCharacter: "invalid" }), "main-dish");
assert.ok(PRIMARY_VALUES.includes(runtime.foodCharacter({ name: "알 수 없는 메뉴", category: "알 수 없음" })));
assert.notEqual(runtime.foodCharacter({ name: "물밀면" }), "cool-light");
assert.notEqual(runtime.foodCharacter({ name: "알 수 없는 메뉴", category: "양식" }), "양식");

const representativeIds = [
  "M001", "M002", "M031", "M026", "M038", "M063", "M094", "M097", "M076",
  "M010", "M089", "M098", "M043", "M071", "M015", "M017",
];
representativeIds.forEach((id) => {
  const menu = menusById.get(id);
  assert.ok(menu, `${id}: static menu missing`);
  assert.equal(runtime.foodCharacter(menu), approved.get(id), `${id} ${menu.name}`);
});

data.menus
  .filter((menu) => /덮밥|비빔밥|버거|김밥|토스트/.test(menu.name))
  .forEach((menu) => assert.equal(runtime.foodCharacter(menu), approved.get(menu.id), `${menu.id} ${menu.name}`));

const audit = buildClassificationAudit(data, approved, runtime);
assert.equal(audit.items.length, 100);
assert.equal(audit.items.filter((item) => !PRIMARY_VALUES.includes(item.fallbackCharacter)).length, 0);
assert.equal(audit.items.filter((item) => item.fallbackSource === "default").length, 0);
assert.equal(audit.stats.fallbackMismatches, 0);

const scoreMenuSource = appSource.slice(
  appSource.indexOf("function scoreMenu"),
  appSource.indexOf("function getRecommendedMenus"),
);
assert.match(scoreMenuSource, /return\s*\{\s*\.\.\.menu,/);

const classifierSource = appSource.slice(
  appSource.indexOf("const PRIMARY_FOOD_CHARACTERS"),
  appSource.indexOf("function discoveryScore"),
);
assert.doesNotMatch(classifierSource, /item\.tags|\.tags/);
assert.doesNotMatch(classifierSource, /"밥"|"탕"|"면"/);
assert.doesNotMatch(classifierSource, /cool-light|return item\.category|return item\?\.category/);

console.log("food character runtime: mapping, explicit precedence, tag-independent fallback, and representative menus passed");
