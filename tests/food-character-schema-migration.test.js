const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migrationDirectory = path.join(root, "supabase", "migrations");
const migrationFiles = fs.readdirSync(migrationDirectory)
  .filter((name) => /^\d{14}_add_food_character\.sql$/.test(name));

assert.deepEqual(migrationFiles, ["20260809094834_add_food_character.sql"]);

const sql = fs.readFileSync(path.join(migrationDirectory, migrationFiles[0]), "utf8");
const withoutComments = sql.replace(/^\s*--.*$/gm, "");
const alterTargets = [...withoutComments.matchAll(/\balter\s+table\s+([^\s;]+)/gi)]
  .map((match) => match[1].toLowerCase());

assert.match(sql, /NOT EXECUTED/);
assert.match(withoutComments, /\bbegin\s*;/i);
assert.match(withoutComments, /\bcommit\s*;/i);
assert.equal((withoutComments.match(/\$approval_a\$/g) || []).length, 2);
assert.match(withoutComments, /to_regclass\('public\.menus'\)/i);
assert.match(withoutComments, /menus has % rows, expected 0/i);
assert.match(withoutComments, /column_name\s*=\s*'food_character'/i);
assert.match(withoutComments, /food_character already exists/i);
assert.match(withoutComments, /menus_food_character_allowed already exists/i);
assert.match(withoutComments, /add\s+column\s+food_character\s+text\s+null\s*;/i);
assert.match(withoutComments, /add\s+constraint\s+menus_food_character_allowed/i);
assert.doesNotMatch(withoutComments, /add\s+column[\s\S]*?\bdefault\b/i);

const checkMatch = withoutComments.match(
  /check\s*\(\s*food_character\s+is\s+null\s+or\s+food_character\s+in\s*\(([\s\S]*?)\)\s*\)/i,
);
assert.ok(checkMatch, "Food Character CHECK constraint was not found.");
const checkValues = [...checkMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
assert.deepEqual(checkValues, [
  "rice-meal",
  "noodle-special",
  "hot-soup",
  "quick-snack",
  "main-dish",
]);

assert.ok(alterTargets.length >= 2);
assert.equal(alterTargets.every((target) => target === "public.menus"), true);
assert.doesNotMatch(withoutComments, /^\s*(?:insert|update|upsert|delete)\b/gim);
assert.doesNotMatch(withoutComments, /\b(?:enable|disable)\s+row\s+level\s+security\b/i);
assert.doesNotMatch(withoutComments, /\b(?:create|alter|drop)\s+policy\b/i);
assert.doesNotMatch(withoutComments, /\brestaurants\b/i);
assert.doesNotMatch(withoutComments, /\bfood_traits\b/i);

const plan = fs.readFileSync(
  path.join(root, "docs", "catalog-migration", "approval-a-schema-plan.md"),
  "utf8",
);
assert.match(plan, /NOT EXECUTED/);
assert.match(plan, /Supabase restaurants \| 1 row/);
assert.match(plan, /Supabase menus \| 0 rows/);
assert.match(plan, /food_character` \| nullable column present/);
assert.match(plan, /Restaurant writes \| 0/);
assert.match(plan, /Menu row inserts \| 0/);
assert.match(plan, /RLS or policy changes \| 0/);
assert.match(plan, /FC-1 Primary Food Character select remains disabled/);
assert.match(plan, /Insert restaurants C002-C029/);
assert.match(plan, /Insert menus M001-M100/);
assert.match(plan, /Populate 100 Food Character values/);
assert.match(plan, /Connect Food Character to the recommendation algorithm/);

console.log("Approval A schema migration: nullable TEXT, five-value CHECK, and zero data writes passed");
