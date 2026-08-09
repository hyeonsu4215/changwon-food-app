const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const preflight = require("../scripts/generate-catalog-migration-preflight.js");

const root = path.resolve(__dirname, "..");
const data = preflight.loadFoodData();
const candidate = preflight.loadFoodCharacterCandidate();
const payloads = preflight.buildPayloads(data, candidate);

assert.equal(payloads.stores.length, 29);
assert.equal(payloads.menus.length, 100);
assert.equal(payloads.menusWithFoodCharacter.length, 100);
assert.equal(payloads.validation.duplicate_store_ids.length, 0);
assert.equal(payloads.validation.duplicate_menu_ids.length, 0);
assert.equal(payloads.validation.duplicate_candidate_ids.length, 0);
assert.equal(payloads.validation.invalid_store_identity_ids.length, 0);
assert.equal(payloads.validation.invalid_store_coordinate_ids.length, 0);
assert.equal(payloads.validation.invalid_store_boolean_ids.length, 0);
assert.equal(payloads.validation.orphan_menu_ids.length, 0);
assert.equal(payloads.validation.missing_candidate_ids.length, 0);
assert.equal(payloads.validation.extra_candidate_ids.length, 0);
assert.equal(payloads.validation.invalid_food_character_ids.length, 0);
assert.equal(payloads.validation.invalid_price_ids.length, 0);
assert.equal(payloads.validation.invalid_taste_ids.length, 0);
assert.equal(payloads.validation.invalid_tags_ids.length, 0);
assert.equal(payloads.validation.invalid_available_ids.length, 0);
assert.deepEqual(payloads.distribution, {
  "rice-meal": 24,
  "noodle-special": 25,
  "hot-soup": 16,
  "quick-snack": 21,
  "main-dish": 14,
});

const expectedRepresentatives = {
  M001: "quick-snack",
  M017: "rice-meal",
  M031: "noodle-special",
  M098: "main-dish",
};
Object.entries(expectedRepresentatives).forEach(([id, expected]) => {
  assert.equal(payloads.menusWithFoodCharacter.find((menu) => menu.id === id)?.food_character, expected);
});

assert.deepEqual(preflight.ALLOWED_FOOD_CHARACTERS, [
  "rice-meal",
  "noodle-special",
  "hot-soup",
  "quick-snack",
  "main-dish",
]);

const sqlPreview = preflight.buildSchemaPreviewSql();
assert.match(sqlPreview, /PREVIEW ONLY/);
assert.match(sqlPreview, /add column food_character text null/i);
preflight.ALLOWED_FOOD_CHARACTERS.forEach((value) => assert.match(sqlPreview, new RegExp(value)));
assert.doesNotMatch(sqlPreview, /create\s+table\s+(?:public\.)?food_traits/i);

const source = fs.readFileSync(path.join(root, "scripts", "generate-catalog-migration-preflight.js"), "utf8");
const fetchFunction = source.slice(source.indexOf("async function fetchRows"), source.indexOf("function appRestaurantToDb"));
assert.match(fetchFunction, /method: "GET"/);
assert.doesNotMatch(fetchFunction, /method: "(?:POST|PUT|PATCH|DELETE)"/);
assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE|serviceRoleKey/);

const output = path.join(root, "docs", "catalog-migration");
const storesPreview = JSON.parse(fs.readFileSync(path.join(output, "stores-preview.json"), "utf8"));
const menusPreview = JSON.parse(fs.readFileSync(path.join(output, "menus-preview.json"), "utf8"));
const combinedPreview = JSON.parse(fs.readFileSync(path.join(output, "menus-with-food-character-preview.json"), "utf8"));
const storesBackupFile = path.join(output, "backups", "pre-migration-stores.json");
const menusBackupFile = path.join(output, "backups", "pre-migration-menus.json");
const storesBackup = JSON.parse(fs.readFileSync(storesBackupFile, "utf8"));
const menusBackup = JSON.parse(fs.readFileSync(menusBackupFile, "utf8"));
const backupManifest = JSON.parse(fs.readFileSync(path.join(output, "backups", "pre-migration-backup-manifest.json"), "utf8"));

assert.equal(storesPreview.metadata.database_write_performed, false);
assert.equal(menusPreview.metadata.database_write_performed, false);
assert.equal(combinedPreview.metadata.database_write_performed, false);
assert.equal(storesPreview.items.length, 29);
assert.equal(menusPreview.items.length, 100);
assert.equal(combinedPreview.items.length, 100);
assert.equal(storesBackup.metadata.row_count, 1);
assert.equal(storesBackup.rows[0].id, "C001");
assert.equal(menusBackup.metadata.row_count, 0);
assert.deepEqual(menusBackup.rows, []);
assert.equal(JSON.stringify(storesBackup).includes("anonKey"), false);
assert.equal(JSON.stringify(menusBackup).includes("anonKey"), false);

const backupFiles = new Map(backupManifest.files.map((file) => [file.name, file]));
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
assert.equal(backupFiles.get("pre-migration-stores.json").sha256, sha256(storesBackupFile));
assert.equal(backupFiles.get("pre-migration-menus.json").sha256, sha256(menusBackupFile));

assert.equal(fs.readFileSync(path.join(output, "stores-preview.csv"), "utf8").trimEnd().split(/\r?\n/).length, 30);
assert.equal(fs.readFileSync(path.join(output, "menus-preview.csv"), "utf8").trimEnd().split(/\r?\n/).length, 101);
assert.equal(
  fs.readFileSync(path.join(output, "menus-with-food-character-preview.csv"), "utf8").trimEnd().split(/\r?\n/).length,
  101,
);

console.log("catalog migration preflight: 29 stores, 100 menus, 100 Food Characters passed");
