"use strict";

// STATUS: NOT EXECUTED. This test performs no database connection or SQL execution.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const contract = require("../scripts/approval-b-schema-contract.js");

const root = path.resolve(__dirname, "..");
const packageDir = path.join(root, "docs", "catalog-migration", "approval-b");
const read = (name) => fs.readFileSync(path.join(packageDir, name), "utf8");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const sql = read("02-migrate-catalog.sql");
const rollbackSql = read("03-rollback-catalog.sql");
const restaurantsDoc = JSON.parse(read("restaurants-insert-preview.json"));
const menusDoc = JSON.parse(read("menus-insert-preview.json"));

const CHECKPOINT = "47500127be5f44979b7154422388ec643d04722a";
const SOURCE_HASHES = Object.freeze({
  "restaurants-insert-preview.json": "84c9b931b7fa7dc29096b7388c61f467681c4a5f61d76b5bf8f3f59b35b645c7",
  "menus-insert-preview.json": "552fe2d1dee9b312069a9a886428cee8c19ce06ce58950ee5aefd661caa08c8f",
});

function extractJsonPayload(source, tag) {
  const match = source.match(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$::jsonb`));
  assert.ok(match, `Missing SQL JSON payload: ${tag}`);
  return JSON.parse(match[1]);
}

function assertSqlLexicallyBalanced(source) {
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("--", index)) {
      const newline = source.indexOf("\n", index + 2);
      index = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (source[index] === "'") {
      let closed = false;
      index += 1;
      while (index < source.length) {
        if (source[index] !== "'") {
          index += 1;
          continue;
        }
        if (source[index + 1] === "'") {
          index += 2;
          continue;
        }
        index += 1;
        closed = true;
        break;
      }
      assert.ok(closed, "Unterminated SQL string literal");
      continue;
    }
    if (source[index] === '"') {
      let closed = false;
      index += 1;
      while (index < source.length) {
        if (source[index] !== '"') {
          index += 1;
          continue;
        }
        if (source[index + 1] === '"') {
          index += 2;
          continue;
        }
        index += 1;
        closed = true;
        break;
      }
      assert.ok(closed, "Unterminated quoted identifier");
      continue;
    }
    if (source[index] === "$") {
      const tag = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$/)?.[0];
      if (tag) {
        const closing = source.indexOf(tag, index + tag.length);
        assert.notEqual(closing, -1, `Unterminated dollar quote: ${tag}`);
        index = closing + tag.length;
        continue;
      }
    }
    index += 1;
  }
}

function sequentialIds(prefix, start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => `${prefix}${String(start + index).padStart(3, "0")}`);
}

function makeExpression(values = contract.ALLOWED_FOOD_CHARACTERS) {
  const literals = values.map((value) => `'${value}'::text`).join(", ");
  return `((food_character IS NULL) OR (food_character = ANY (ARRAY[${literals}])))`;
}

function validMetadata(overrides = {}) {
  const constraintOverrides = overrides.constraint || {};
  return {
    column: {
      dataType: "text",
      isNullable: "YES",
      defaultValue: null,
      ...overrides.column,
    },
    constraints: overrides.constraints || [
      {
        name: "menus_food_character_allowed",
        type: "c",
        validated: true,
        noInherit: false,
        columns: ["food_character"],
        expression: makeExpression(),
        acceptsNull: true,
        acceptsAllowed: true,
        rejectsInvalid: true,
        ...constraintOverrides,
      },
    ],
  };
}

const schemaScenarios = [
  ["food_character missing", { column: null }, false],
  ["type not text", validMetadata({ column: { dataType: "varchar" } }), false],
  ["nullable NO", validMetadata({ column: { isNullable: "NO" } }), false],
  ["default exists", validMetadata({ column: { defaultValue: "'rice-meal'::text" } }), false],
  ["constraint missing", validMetadata({ constraints: [] }), false],
  ["duplicate named constraint metadata", validMetadata({ constraints: [validMetadata().constraints[0], validMetadata().constraints[0]] }), false],
  ["same name, wrong value", validMetadata({ constraint: { expression: makeExpression(["rice-meal", "noodle-special", "hot-soup", "quick-snack", "salad"]) } }), false],
  ["one value missing", validMetadata({ constraint: { expression: makeExpression(contract.ALLOWED_FOOD_CHARACTERS.slice(0, 4)) } }), false],
  ["sixth value added", validMetadata({ constraint: { expression: makeExpression([...contract.ALLOWED_FOOD_CHARACTERS, "salad"]) } }), false],
  ["exact five values and nullable", validMetadata(), true],
];

for (const [name, metadata, expectedPass] of schemaScenarios) {
  const errors = contract.validateSchemaContract(metadata);
  assert.equal(errors.length === 0, expectedPass, `${name}: ${errors.join(", ")}`);
}

assert.match(sql, /STATUS: NOT EXECUTED/);
assertSqlLexicallyBalanced(sql);
assertSqlLexicallyBalanced(rollbackSql);
assert.ok(sql.includes(contract.SCHEMA_DECLARATIONS_SQL));
assert.ok(sql.includes(contract.SCHEMA_ASSERTION_SQL));
assert.match(sql, /information_schema\.columns/);
assert.match(sql, /pg_constraint/);
assert.match(sql, /pg_get_expr\(conbin, conrelid, true\)/);
assert.match(sql, /regexp_matches\(v_constraint_expr/);
assert.match(sql, /values \(null::text\)/i);
assert.match(sql, /values \(''''::text\).*secondary-trait/i);
assert.match(read("final-approval-summary.md"), new RegExp(CHECKPOINT));

assert.equal(sha256(read("restaurants-insert-preview.json")), SOURCE_HASHES["restaurants-insert-preview.json"]);
assert.equal(sha256(read("menus-insert-preview.json")), SOURCE_HASHES["menus-insert-preview.json"]);
assert.deepEqual(extractJsonPayload(sql, "restaurants_payload"), restaurantsDoc.items);
assert.deepEqual(extractJsonPayload(sql, "menus_payload"), menusDoc.items);
assert.equal(Object.keys(extractJsonPayload(sql, "c001_expected")).length, 21);

assert.deepEqual(restaurantsDoc.items.map((row) => row.id), sequentialIds("C", 2, 29));
assert.equal(restaurantsDoc.items.some((row) => row.id === "C001"), false);
assert.deepEqual(menusDoc.items.map((row) => row.id), sequentialIds("M", 1, 100));
assert.equal(new Set(menusDoc.items.map((row) => row.restaurant_id)).size, 29);
assert.equal(menusDoc.items.filter((row) => row.restaurant_id === "C001").length, 5);

const allowed = new Set(contract.ALLOWED_FOOD_CHARACTERS);
assert.equal(menusDoc.items.filter((row) => !allowed.has(row.food_character)).length, 0);
assert.deepEqual(
  Object.fromEntries(contract.ALLOWED_FOOD_CHARACTERS.map((value) => [value, menusDoc.items.filter((row) => row.food_character === value).length])),
  { "rice-meal": 24, "noodle-special": 25, "hot-soup": 16, "quick-snack": 21, "main-dish": 14 },
);

const withoutComments = sql.replace(/^--.*$/gm, "");
const schemaAssertionIndex = withoutComments.indexOf("select data_type, is_nullable, column_default");
const restaurantInsertIndex = withoutComments.indexOf("insert into public.restaurants");
assert.ok(schemaAssertionIndex > -1 && schemaAssertionIndex < restaurantInsertIndex);
assert.equal((withoutComments.match(/^begin;$/gim) || []).length, 1);
assert.equal((withoutComments.match(/^commit;$/gim) || []).length, 1);
assert.equal((withoutComments.match(/insert into public\.(?:restaurants|menus)/gi) || []).length, 2);
assert.doesNotMatch(withoutComments, /\bupdate\s+public\./i);
assert.doesNotMatch(withoutComments, /\bupsert\b/i);
assert.doesNotMatch(withoutComments, /\bon\s+conflict\b/i);
assert.doesNotMatch(withoutComments, /\bdelete\s+from\b/i);
assert.doesNotMatch(withoutComments, /\balter\s+table\b/i);
assert.match(sql, /insert into public\.restaurants \("id", "name"/i);
assert.match(sql, /insert into public\.menus \("id", "restaurant_id"[\s\S]*?"food_character"\)/i);
assert.match(sql, /restaurants count is %, expected 1/i);
assert.match(sql, /menus count is %, expected 0/i);
assert.match(sql, /C001 fingerprint differs from the approved backup/i);
assert.match(sql, /C002-C029 count must be 28/i);
assert.match(sql, /M001-M100 count must be 100/i);
assert.match(sql, /null or invalid Food Character exists/i);
for (const [value, count] of Object.entries({ "rice-meal": 24, "noodle-special": 25, "hot-soup": 16, "quick-snack": 21, "main-dish": 14 })) {
  assert.match(sql, new RegExp(`${value} count must be ${count}`));
}
assert.match(sql, /orphan menu exists/i);
assert.match(sql, /sellable menu references a missing restaurant/i);
assert.match(sql, /Post-write assertion failed: C001 changed/);
assert.match(sql, /sellable menu references an inactive restaurant/);

assert.match(rollbackSql, /STATUS: NOT EXECUTED/);
assert.match(rollbackSql, /delete from public\.menus[\s\S]*generate_series\(1, 100\)/i);
assert.match(rollbackSql, /delete from public\.restaurants[\s\S]*generate_series\(2, 29\)/i);
assert.doesNotMatch(rollbackSql, /delete from public\.restaurants where id = 'C001'/i);
assert.doesNotMatch(rollbackSql, /\balter\s+table\b/i);

console.log("Approval B transaction: 10 schema scenarios, 28 restaurants, 100 menus, atomic guards passed");
