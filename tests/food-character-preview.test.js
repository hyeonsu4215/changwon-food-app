const assert = require("node:assert/strict");

const {
  buildMigrationPreview,
  loadFoodData,
  previewToCsv,
} = require("../scripts/preview-food-character-migration.js");

const data = loadFoodData();
const preview = buildMigrationPreview(data, "2026-08-09T00:00:00.000Z");

assert.equal(data.restaurants.length, 29);
assert.equal(data.menus.length, 100);
assert.equal(preview.stats.total_menus, 100);
assert.equal(preview.items.length, 100);
assert.equal(preview.stats.needs_review_count, 100);
assert.equal(preview.metadata.tags_used_for_classification, false);
assert.ok(preview.items.every((item) => item.review_status === "needs-review"));
assert.ok(preview.items.every((item) => item.current_food_character === null));
assert.ok(preview.items.every((item) => Object.hasOwn(item, "warning")));

function itemByName(name) {
  return preview.items.find((item) => item.menu_name === name);
}

assert.equal(itemByName("닭고기 부리또").suggested_food_character, "quick-snack");
assert.equal(itemByName("소고기 쌀국수").suggested_food_character, "noodle-special");
assert.equal(itemByName("미니탕수육").suggested_food_character, "main-dish");
assert.ok(itemByName("닭고기 부리또").warning);
assert.ok(itemByName("소고기 쌀국수").warning);
assert.ok(itemByName("미니탕수육").warning);

const countTotal = Object.values(preview.stats.suggested_counts).reduce((sum, count) => sum + count, 0);
assert.equal(countTotal + preview.stats.unclassified_count, 100);
assert.equal(previewToCsv(preview).trimEnd().split("\n").length, 101);

console.log("food character migration preview: 29 stores and 100 review rows passed");
