const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const foodCharacter = require("../food-character-admin.js");

const CSV_COLUMNS = Object.freeze([
  "menu_id",
  "store_id",
  "store_name",
  "menu_name",
  "category",
  "tags",
  "current_food_character",
  "suggested_food_character",
  "confidence",
  "warning",
  "review_status",
]);

function loadFoodData(dataFile = path.resolve(__dirname, "..", "data.js")) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(dataFile, "utf8"), sandbox, { filename: dataFile });
  const data = sandbox.window.CHANGWON_FOOD_DATA;
  if (!data || !Array.isArray(data.restaurants) || !Array.isArray(data.menus)) {
    throw new Error("data.js에서 restaurants 또는 menus 배열을 읽을 수 없습니다.");
  }
  return data;
}

function buildMigrationPreview(data, generatedAt = new Date().toISOString()) {
  const storesById = new Map(data.restaurants.map((store) => [store.id, store]));
  const items = data.menus.map((menu) => {
    const store = storesById.get(menu.restaurantId);
    const draft = foodCharacter.suggestFoodCharacterDraft({
      name: menu.name,
      category: menu.category,
      restaurantName: menu.restaurantName || store?.name || "",
    });
    return {
      menu_id: menu.id,
      store_id: menu.restaurantId,
      store_name: menu.restaurantName || store?.name || "",
      menu_name: menu.name,
      category: menu.category,
      tags: Array.isArray(menu.tags) ? [...menu.tags] : [],
      current_food_character: menu.foodCharacter ?? menu.food_character ?? null,
      suggested_food_character: draft.suggestedFoodCharacter,
      confidence: draft.confidence,
      warning: draft.warning,
      review_status: draft.reviewStatus,
    };
  });

  const suggestedCounts = Object.fromEntries(foodCharacter.allowedValues.map((value) => [value, 0]));
  items.forEach((item) => {
    if (item.suggested_food_character in suggestedCounts) suggestedCounts[item.suggested_food_character] += 1;
  });

  return {
    metadata: {
      purpose: "FC-1 human review draft; never use directly for a database update",
      generated_at: generatedAt,
      source: "data.js",
      stores_count: data.restaurants.length,
      menus_count: data.menus.length,
      review_policy: "Every row requires human approval before FC-2",
      tags_used_for_classification: false,
    },
    definitions: foodCharacter.definitions,
    stats: {
      total_menus: items.length,
      suggested_counts: suggestedCounts,
      unclassified_count: items.filter((item) => !item.suggested_food_character).length,
      warning_count: items.filter((item) => item.warning).length,
      needs_review_count: items.filter((item) => item.review_status === "needs-review").length,
    },
    items,
  };
}

function csvEscape(value) {
  const text = Array.isArray(value) ? JSON.stringify(value) : String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function previewToCsv(preview) {
  const rows = preview.items.map((item) => CSV_COLUMNS.map((column) => csvEscape(item[column])).join(","));
  return `${CSV_COLUMNS.join(",")}\n${rows.join("\n")}\n`;
}

function writePreviewFiles({
  dataFile = path.resolve(__dirname, "..", "data.js"),
  outputDirectory = path.resolve(__dirname, "..", "docs", "food-character"),
  generatedAt = new Date().toISOString(),
} = {}) {
  const preview = buildMigrationPreview(loadFoodData(dataFile), generatedAt);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const jsonFile = path.join(outputDirectory, "food-character-preview.json");
  const csvFile = path.join(outputDirectory, "food-character-preview.csv");
  fs.writeFileSync(jsonFile, `${JSON.stringify(preview, null, 2)}\n`, "utf8");
  fs.writeFileSync(csvFile, previewToCsv(preview), "utf8");
  return { preview, jsonFile, csvFile };
}

if (require.main === module) {
  const outputFlagIndex = process.argv.indexOf("--output-dir");
  const outputDirectory = outputFlagIndex >= 0
    ? path.resolve(process.argv[outputFlagIndex + 1])
    : path.resolve(__dirname, "..", "docs", "food-character");
  const result = writePreviewFiles({ outputDirectory });
  console.log(JSON.stringify({
    json_file: path.relative(process.cwd(), result.jsonFile),
    csv_file: path.relative(process.cwd(), result.csvFile),
    stats: result.preview.stats,
  }, null, 2));
}

module.exports = Object.freeze({
  CSV_COLUMNS,
  buildMigrationPreview,
  loadFoodData,
  previewToCsv,
  writePreviewFiles,
});
