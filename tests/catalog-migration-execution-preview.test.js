const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const execution = require("../scripts/generate-catalog-migration-execution-preview.js");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "docs", "catalog-migration", "execution-preview");
const baseline = execution.assertBaselineIntegrity();
const baselineC001 = baseline.storesBackup.rows[0];
const restaurants = baseline.storesPreview.items.filter((row) => row.id !== "C001");
const menus = baseline.combinedPreview.items;
const validation = execution.validateExecutionPayloads(restaurants, menus, baselineC001);

assert.equal(restaurants.length, 28);
assert.deepEqual(restaurants.map((row) => row.id), execution.sequentialIds("C", 2, 29));
assert.equal(restaurants.some((row) => row.id === "C001"), false);
assert.equal(menus.length, 100);
assert.deepEqual(menus.map((row) => row.id), execution.sequentialIds("M", 1, 100));
assert.equal(validation.c001_write_rows, 0);
assert.equal(validation.referenced_restaurant_count, 29);
assert.equal(validation.c001_menu_reference_rows, 5);
assert.equal(validation.orphan_menu_ids.length, 0);
assert.equal(validation.invalid_restaurant_shape_ids.length, 0);
assert.equal(validation.invalid_menu_shape_ids.length, 0);
assert.equal(validation.invalid_food_character_ids.length, 0);
assert.equal(validation.food_character_null_rows, 0);
assert.deepEqual(validation.food_character_distribution, execution.EXPECTED_DISTRIBUTION);

const restaurantPreview = JSON.parse(fs.readFileSync(path.join(output, "restaurants-insert-preview.json"), "utf8"));
const menuPreview = JSON.parse(fs.readFileSync(path.join(output, "menus-insert-preview.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(output, "execution-manifest.json"), "utf8"));
assert.equal(restaurantPreview.metadata.database_write_performed, false);
assert.equal(restaurantPreview.items.length, 28);
assert.equal(restaurantPreview.items.some((row) => row.id === "C001"), false);
assert.equal(menuPreview.metadata.database_write_performed, false);
assert.equal(menuPreview.items.length, 100);
assert.deepEqual(manifest.baseline_existing_untouched_restaurant_ids, ["C001"]);
assert.deepEqual(manifest.migration_owned_restaurant_ids, execution.sequentialIds("C", 2, 29));
assert.deepEqual(manifest.migration_owned_menu_ids, execution.sequentialIds("M", 1, 100));
assert.deepEqual(manifest.updated_ids, []);
assert.deepEqual(manifest.deleted_ids, []);

assert.equal(
  fs.readFileSync(path.join(output, "restaurants-insert-preview.csv"), "utf8").trimEnd().split(/\r?\n/).length,
  29,
);
assert.equal(
  fs.readFileSync(path.join(output, "menus-insert-preview.csv"), "utf8").trimEnd().split(/\r?\n/).length,
  101,
);

const schemaSql = execution.buildSchemaSql();
assert.match(schemaSql, /APPROVAL A PREVIEW ONLY/);
assert.match(schemaSql, /add column food_character text null/i);
assert.match(schemaSql, /column_default is not null/i);
assert.doesNotMatch(schemaSql, /default\s+['"]/i);
assert.doesNotMatch(schemaSql, /create\s+table\s+(?:public\.)?food_traits/i);

const transactionSql = execution.buildCatalogTransactionSql({ restaurants, menus, baselineC001 });
assert.match(transactionSql, /APPROVAL B PREVIEW ONLY/);
assert.match(transactionSql, /set transaction isolation level serializable/i);
assert.match(transactionSql, /lock table public\.restaurants/i);
assert.match(transactionSql, /restaurants count is %, expected 1/i);
assert.match(transactionSql, /menus count is %, expected 0/i);
assert.match(transactionSql, /C001 리코리코 is missing/);
assert.match(transactionSql, /C001 fingerprint differs/i);
assert.match(transactionSql, /jsonb_populate_recordset\(null::public\.restaurants/i);
assert.match(transactionSql, /jsonb_populate_recordset\(null::public\.menus/i);
assert.doesNotMatch(transactionSql, /insert into public\.restaurants[\s\S]*?"C001"/i);
assert.doesNotMatch(transactionSql, /\b(?:update|upsert)\s+public\.restaurants/i);
assert.match(transactionSql, /Post-write assertion failed: C001 changed/);
assert.match(transactionSql, /sellable menu references an inactive restaurant/);
assert.match(transactionSql, /rice-meal count must be 24/);
assert.match(transactionSql, /noodle-special count must be 25/);
assert.match(transactionSql, /hot-soup count must be 16/);
assert.match(transactionSql, /quick-snack count must be 21/);
assert.match(transactionSql, /main-dish count must be 14/);
assert.doesNotMatch(transactionSql, /service[_ -]?role|anonKey|apikey/i);

const generatedTransactionSql = fs.readFileSync(path.join(output, "02-migrate-catalog.sql"), "utf8");
assert.equal(generatedTransactionSql, transactionSql);
const extractJsonPayload = (sql, tag) => {
  const match = sql.match(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$::jsonb`));
  assert.ok(match, `Missing SQL JSON payload: ${tag}`);
  return JSON.parse(match[1]);
};
assert.deepEqual(extractJsonPayload(transactionSql, "c001_expected"), baselineC001);
assert.deepEqual(extractJsonPayload(transactionSql, "restaurants_payload"), restaurants);
assert.deepEqual(extractJsonPayload(transactionSql, "menus_payload"), menus);
assert.equal(extractJsonPayload(transactionSql, "restaurants_payload").some((row) => row.id === "C001"), false);
for (const tag of ["catalog_migration", "c001_expected", "restaurants_payload", "menus_payload"]) {
  assert.equal(transactionSql.match(new RegExp(`\\$${tag}\\$`, "g"))?.length, 2, `Unbalanced SQL tag: ${tag}`);
}
assert.match(transactionSql, /^begin;[\s\S]*commit;\s*[\s\S]*$/m);

const rollbackSql = execution.buildRollbackSql({ baselineC001 });
assert.match(rollbackSql, /delete from public\.menus[\s\S]*generate_series\(1, 100\)/i);
assert.match(rollbackSql, /delete from public\.restaurants[\s\S]*generate_series\(2, 29\)/i);
assert.doesNotMatch(rollbackSql, /\bbetween\b/i);
assert.doesNotMatch(rollbackSql, /delete from public\.restaurants where id = 'C001'/i);
assert.doesNotMatch(rollbackSql, /update\s+public\.restaurants/i);

for (const file of ["01-add-food-character.sql", "02-migrate-catalog.sql", "03-rollback-catalog.sql"]) {
  const sql = fs.readFileSync(path.join(output, file), "utf8");
  assert.match(sql, /PREVIEW ONLY/);
  assert.doesNotMatch(sql, /service[_ -]?role|anonKey|apikey/i);
}

console.log("catalog migration execution preview: 28 restaurants, 100 menus, C001 write 0 passed");
