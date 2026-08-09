const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const foodCharacter = require("../food-character-admin.js");
const {
  REVIEW_DECISIONS,
  buildApprovedCandidate,
  buildReviewDiff,
  buildReviewedData,
  reviewedToCsv,
} = require("../scripts/build-food-character-reviewed.js");
const { loadFoodData } = require("../scripts/preview-food-character-migration.js");

const root = path.resolve(__dirname, "..");
const preview = JSON.parse(fs.readFileSync(path.join(root, "docs", "food-character", "food-character-preview.json"), "utf8"));
const reviewed = buildReviewedData(preview, "2026-08-09T00:00:00.000Z");
const data = loadFoodData();

assert.equal(Object.keys(REVIEW_DECISIONS).length, 100);
assert.equal(reviewed.items.length, 100);
assert.equal(new Set(reviewed.items.map((item) => item.menu_id)).size, 100);
assert.deepEqual(reviewed.items.map((item) => item.menu_id), Array.from(data.menus, (item) => item.id));
assert.ok(reviewed.items.every((item) => item.review_status === "reviewed"));
assert.ok(reviewed.items.every((item) => foodCharacter.isAllowedFoodCharacter(item.reviewed_food_character)));
assert.ok(reviewed.items.every((item) => item.reviewed_food_character && item.review_note));
assert.equal(reviewed.metadata.tags_used_for_review, false);
assert.equal(reviewed.metadata.db_applied, false);
assert.equal(reviewed.stats.reviewed_count, 100);
assert.equal(reviewed.stats.needs_human_confirmation_count, 0);
assert.equal(reviewed.stats.same_as_suggestion_count, 99);
assert.equal(reviewed.stats.changed_count, 1);
assert.deepEqual(reviewed.stats.distribution, {
  "rice-meal": 24,
  "noodle-special": 25,
  "hot-soup": 16,
  "quick-snack": 21,
  "main-dish": 14,
});

function reviewedByName(name) {
  return reviewed.items.find((item) => item.menu_name === name);
}

assert.equal(reviewedByName("닭고기 부리또").reviewed_food_character, "quick-snack");
assert.equal(reviewedByName("소고기 쌀국수").reviewed_food_character, "noodle-special");
assert.equal(reviewedByName("미니탕수육").reviewed_food_character, "main-dish");
assert.equal(reviewedByName("돈까스 도련님 고기고기").suggested_food_character, "main-dish");
assert.equal(reviewedByName("돈까스 도련님 고기고기").reviewed_food_character, "rice-meal");

assert.equal(reviewedToCsv(reviewed).trimEnd().split("\n").length, 101);
assert.equal(buildApprovedCandidate(reviewed).length, 100);
assert.match(buildReviewDiff(reviewed), /M017/);
assert.match(buildReviewDiff(reviewed), /경고 18개 검토/);

const decisionSource = fs.readFileSync(path.join(root, "scripts", "build-food-character-reviewed.js"), "utf8");
const decisionsBlock = decisionSource.slice(
  decisionSource.indexOf("const REVIEW_DECISIONS"),
  decisionSource.indexOf("const REVIEWED_COLUMNS"),
);
assert.doesNotMatch(decisionsBlock, /tags?/i);

console.log("food character human review: 100 reviewed rows and FC-2 candidate passed");
