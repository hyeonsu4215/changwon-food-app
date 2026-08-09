const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const preflight = require("./generate-catalog-migration-preflight.js");

const ROOT = path.resolve(__dirname, "..");
const CATALOG_DIRECTORY = path.join(ROOT, "docs", "catalog-migration");
const DEFAULT_OUTPUT_DIRECTORY = path.join(CATALOG_DIRECTORY, "execution-preview");
const EXPECTED_DISTRIBUTION = Object.freeze({
  "rice-meal": 24,
  "noodle-special": 25,
  "hot-soup": 16,
  "quick-snack": 21,
  "main-dish": 14,
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sequentialIds(prefix, start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => (
    `${prefix}${String(start + index).padStart(3, "0")}`
  ));
}

function duplicateValues(values) {
  const seen = new Set();
  return [...new Set(values.filter((value) => (seen.has(value) ? true : !seen.add(value))))].sort();
}

function assertExactIds(actualRows, expectedIds, label) {
  const actualIds = actualRows.map((row) => row.id).sort();
  assert.deepEqual(actualIds, [...expectedIds].sort(), `${label} IDs do not match the approved range.`);
  assert.deepEqual(duplicateValues(actualRows.map((row) => row.id)), [], `${label} contains duplicate IDs.`);
}

function assertBaselineIntegrity(catalogDirectory = CATALOG_DIRECTORY) {
  const backupDirectory = path.join(catalogDirectory, "backups");
  const manifest = readJson(path.join(backupDirectory, "pre-migration-backup-manifest.json"));
  const backupFiles = new Map(manifest.files.map((item) => [item.name, item]));
  for (const name of ["pre-migration-stores.json", "pre-migration-menus.json"]) {
    const file = path.join(backupDirectory, name);
    assert.ok(fs.existsSync(file), `Missing baseline backup: ${name}`);
    assert.equal(sha256(file), backupFiles.get(name)?.sha256, `Backup SHA-256 mismatch: ${name}`);
  }

  const storesBackup = readJson(path.join(backupDirectory, "pre-migration-stores.json"));
  const menusBackup = readJson(path.join(backupDirectory, "pre-migration-menus.json"));
  assert.equal(storesBackup.metadata.row_count, 1);
  assert.equal(storesBackup.rows.length, 1);
  assert.equal(storesBackup.rows[0].id, "C001");
  assert.equal(storesBackup.rows[0].name, "리코리코");
  assert.equal(storesBackup.rows[0].last_checked, "2026-06-15T00:00:00+00:00");
  assert.equal(menusBackup.metadata.row_count, 0);
  assert.deepEqual(menusBackup.rows, []);

  const storesPreview = readJson(path.join(catalogDirectory, "stores-preview.json"));
  const menusPreview = readJson(path.join(catalogDirectory, "menus-preview.json"));
  const combinedPreview = readJson(path.join(catalogDirectory, "menus-with-food-character-preview.json"));
  assert.equal(storesPreview.items.length, 29);
  assert.equal(menusPreview.items.length, 100);
  assert.equal(combinedPreview.items.length, 100);
  assert.ok(fs.existsSync(path.join(catalogDirectory, "c001-conflict-analysis.md")));
  assert.ok(fs.existsSync(path.join(catalogDirectory, "rollback-plan.md")));
  assert.ok(fs.existsSync(path.join(catalogDirectory, "post-migration-validation-plan.md")));

  const c001Diff = fs.readFileSync(path.join(catalogDirectory, "c001-conflict-analysis.md"), "utf8");
  assert.match(c001Diff, /Static.*2026-06-16T00:00:00/s);
  assert.match(c001Diff, /Supabase.*2026-06-15T00:00:00\+00:00/s);
  return { storesBackup, menusBackup, storesPreview, menusPreview, combinedPreview, manifest };
}

function validateExecutionPayloads(restaurants, menus, baselineC001) {
  const expectedRestaurantIds = sequentialIds("C", 2, 29);
  const expectedMenuIds = sequentialIds("M", 1, 100);
  assert.equal(restaurants.length, 28);
  assert.equal(menus.length, 100);
  assertExactIds(restaurants, expectedRestaurantIds, "Restaurant insert payload");
  assertExactIds(menus, expectedMenuIds, "Menu insert payload");
  assert.equal(restaurants.some((row) => row.id === "C001"), false, "C001 must not be written.");

  const knownRestaurantIds = new Set([baselineC001.id, ...restaurants.map((row) => row.id)]);
  assert.equal(baselineC001.active, true, "Existing C001 must remain usable by referenced menus.");
  const orphanMenuIds = menus.filter((row) => !knownRestaurantIds.has(row.restaurant_id)).map((row) => row.id);
  const restaurantColumns = preflight.RESTAURANT_COLUMNS;
  const menuColumns = [...preflight.MENU_COLUMNS, "food_character"];
  const invalidRestaurantShapeIds = restaurants
    .filter((row) => restaurantColumns.some((column) => !Object.hasOwn(row, column)))
    .map((row) => row.id);
  const invalidMenuShapeIds = menus
    .filter((row) => menuColumns.some((column) => !Object.hasOwn(row, column)))
    .map((row) => row.id);
  const invalidRestaurantIds = restaurants
    .filter((row) => !/^C(?:00[2-9]|0[12][0-9])$/.test(row.id))
    .map((row) => row.id);
  const invalidCoordinateIds = restaurants
    .filter((row) => !Number.isFinite(row.lat) || !Number.isFinite(row.lng)
      || row.lat < -90 || row.lat > 90 || row.lng < -180 || row.lng > 180)
    .map((row) => row.id);
  const restaurantBooleanKeys = ["takeout", "delivery", "alone", "group_available", "active"];
  const invalidRestaurantBooleanIds = restaurants
    .filter((row) => restaurantBooleanKeys.some((key) => typeof row[key] !== "boolean"))
    .map((row) => row.id);
  const tasteKeys = ["spicy", "salty", "sweet", "portion", "value", "speed"];
  const invalidMenuIds = menus
    .filter((row) => !/^M(?:00[1-9]|0[1-9][0-9]|100)$/.test(row.id))
    .map((row) => row.id);
  const invalidPriceIds = menus.filter((row) => !Number.isFinite(row.price) || row.price < 0).map((row) => row.id);
  const invalidTasteIds = menus
    .filter((row) => tasteKeys.some((key) => !Number.isFinite(row[key]) || row[key] < 0 || row[key] > 5))
    .map((row) => row.id);
  const invalidTagsIds = menus.filter((row) => !Array.isArray(row.tags)).map((row) => row.id);
  const invalidAvailableIds = menus.filter((row) => typeof row.available !== "boolean").map((row) => row.id);
  const invalidFoodCharacterIds = menus
    .filter((row) => !preflight.ALLOWED_FOOD_CHARACTERS.includes(row.food_character))
    .map((row) => row.id);
  const distribution = Object.fromEntries(preflight.ALLOWED_FOOD_CHARACTERS.map((value) => [value, 0]));
  menus.forEach((row) => { distribution[row.food_character] += 1; });

  const validation = {
    restaurant_rows: restaurants.length,
    menu_rows: menus.length,
    c001_write_rows: 0,
    referenced_restaurant_count: new Set(menus.map((row) => row.restaurant_id)).size,
    c001_menu_reference_rows: menus.filter((row) => row.restaurant_id === "C001").length,
    duplicate_restaurant_ids: duplicateValues(restaurants.map((row) => row.id)),
    duplicate_menu_ids: duplicateValues(menus.map((row) => row.id)),
    invalid_restaurant_ids: invalidRestaurantIds,
    invalid_restaurant_shape_ids: invalidRestaurantShapeIds,
    invalid_restaurant_coordinate_ids: invalidCoordinateIds,
    invalid_restaurant_boolean_ids: invalidRestaurantBooleanIds,
    invalid_menu_ids: invalidMenuIds,
    invalid_menu_shape_ids: invalidMenuShapeIds,
    orphan_menu_ids: orphanMenuIds,
    invalid_price_ids: invalidPriceIds,
    invalid_taste_ids: invalidTasteIds,
    invalid_tags_ids: invalidTagsIds,
    invalid_available_ids: invalidAvailableIds,
    invalid_food_character_ids: invalidFoodCharacterIds,
    food_character_null_rows: menus.filter((row) => row.food_character == null).length,
    food_character_distribution: distribution,
  };
  Object.entries(validation).forEach(([key, value]) => {
    if (Array.isArray(value)) assert.equal(value.length, 0, `${key} must be empty.`);
  });
  assert.equal(validation.food_character_null_rows, 0);
  assert.deepEqual(distribution, EXPECTED_DISTRIBUTION);
  return validation;
}

function wrapExecutionPreview({ generatedAt, purpose, targetTable, items, validation }) {
  return {
    metadata: {
      purpose,
      generated_at: generatedAt,
      target_table: targetTable,
      execution_status: "PREVIEW_ONLY_NOT_EXECUTED",
      database_write_performed: false,
      row_count: items.length,
      validation,
    },
    items,
  };
}

function sqlJson(value, tag) {
  return `$${tag}$${JSON.stringify(value, null, 2)}$${tag}$::jsonb`;
}

function quotedColumns(columns) {
  return columns.map((column) => `"${column}"`).join(", ");
}

function selectedColumns(alias, columns) {
  return columns.map((column) => `${alias}."${column}"`).join(", ");
}

function buildSchemaSql() {
  const allowed = preflight.ALLOWED_FOOD_CHARACTERS.map((value) => `'${value}'`).join(", ");
  return `-- APPROVAL A PREVIEW ONLY. DO NOT EXECUTE WITHOUT SEPARATE EXPLICIT APPROVAL.
-- Adds one nullable column and one CHECK constraint. No default, backfill, RLS, or Secondary Trait.

begin;

do $schema$
declare
  v_data_type text;
  v_is_nullable text;
  v_column_default text;
begin
  if to_regclass('public.menus') is null then
    raise exception 'Baseline assertion failed: public.menus does not exist';
  end if;

  select data_type, is_nullable, column_default
    into v_data_type, v_is_nullable, v_column_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'menus'
    and column_name = 'food_character';

  if not found then
    alter table public.menus add column food_character text null;
  elsif v_data_type <> 'text' or v_is_nullable <> 'YES' or v_column_default is not null then
    raise exception 'food_character exists with an unexpected type/nullability/default';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.menus'::regclass
      and conname = 'menus_food_character_allowed'
  ) then
    raise exception 'Constraint already exists; stop for definition review instead of replacing it';
  end if;

  alter table public.menus
    add constraint menus_food_character_allowed
    check (food_character is null or food_character in (${allowed}))
    not valid;

  alter table public.menus validate constraint menus_food_character_allowed;
end
$schema$;

commit;

-- A failed assertion or DDL statement leaves this transaction uncommitted/aborted.
-- Approval B must remain a separate action after this schema change is verified.
`;
}

function buildCatalogTransactionSql({ restaurants, menus, baselineC001 }) {
  const restaurantColumns = preflight.RESTAURANT_COLUMNS;
  const menuColumns = [...preflight.MENU_COLUMNS, "food_character"];
  const c001Expected = sqlJson(baselineC001, "c001_expected");
  const restaurantPayload = sqlJson(restaurants, "restaurants_payload");
  const menuPayload = sqlJson(menus, "menus_payload");
  const distributionChecks = Object.entries(EXPECTED_DISTRIBUTION)
    .map(([value, count]) => `  if (select count(*) from public.menus where food_character = '${value}') <> ${count} then\n    raise exception 'Post-write assertion failed: ${value} count must be ${count}';\n  end if;`)
    .join("\n\n");

  return `-- APPROVAL B PREVIEW ONLY. DO NOT EXECUTE WITHOUT SEPARATE EXPLICIT APPROVAL.
-- Intended for Supabase SQL Editor, psql, or equivalent direct PostgreSQL execution.
-- C001 is asserted and referenced, but never inserted, updated, upserted, or deleted.

begin;
set transaction isolation level serializable;
set local timezone = 'UTC';

lock table public.restaurants in share row exclusive mode;
lock table public.menus in share row exclusive mode;

do $catalog_migration$
declare
  v_actual integer;
  v_written integer;
  v_c001 jsonb;
  v_expected_c001 constant jsonb := ${c001Expected};
  v_restaurants constant jsonb := ${restaurantPayload};
  v_menus constant jsonb := ${menuPayload};
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'menus' and column_name = 'food_character'
  ) then
    raise exception 'Baseline assertion failed: Approval A food_character column is missing';
  end if;

  select count(*) into v_actual from public.restaurants;
  if v_actual <> 1 then
    raise exception 'Baseline assertion failed: restaurants count is %, expected 1', v_actual;
  end if;

  select count(*) into v_actual from public.menus;
  if v_actual <> 0 then
    raise exception 'Baseline assertion failed: menus count is %, expected 0', v_actual;
  end if;

  if not exists (select 1 from public.restaurants where id = 'C001' and name = '리코리코') then
    raise exception 'Baseline assertion failed: C001 리코리코 is missing';
  end if;

  select to_jsonb(snapshot) into v_c001
  from (
    select ${quotedColumns(restaurantColumns)}
    from public.restaurants
    where id = 'C001'
  ) as snapshot;
  if v_c001 is null or v_c001 is distinct from v_expected_c001 then
    raise exception 'Baseline assertion failed: C001 fingerprint differs from the approved backup';
  end if;

  if exists (
    select 1 from public.restaurants
    where id = any (array(select 'C' || to_char(value, 'FM000') from generate_series(2, 29) as series(value)))
  ) then
    raise exception 'ID collision: at least one of C002-C029 already exists';
  end if;

  if exists (
    select 1 from public.menus
    where id = any (array(select 'M' || to_char(value, 'FM000') from generate_series(1, 100) as series(value)))
  ) then
    raise exception 'ID collision: at least one of M001-M100 already exists';
  end if;

  insert into public.restaurants (${quotedColumns(restaurantColumns)})
  select ${selectedColumns("payload", restaurantColumns)}
  from jsonb_populate_recordset(null::public.restaurants, v_restaurants) as payload;
  get diagnostics v_written = row_count;
  if v_written <> 28 then
    raise exception 'Restaurant insert assertion failed: wrote %, expected 28', v_written;
  end if;

  insert into public.menus (${quotedColumns(menuColumns)})
  select ${selectedColumns("payload", menuColumns)}
  from jsonb_populate_recordset(null::public.menus, v_menus) as payload;
  get diagnostics v_written = row_count;
  if v_written <> 100 then
    raise exception 'Menu insert assertion failed: wrote %, expected 100', v_written;
  end if;

  if (select count(*) from public.restaurants) <> 29 then
    raise exception 'Post-write assertion failed: restaurants total must be 29';
  end if;
  if (select count(*) from public.menus) <> 100 then
    raise exception 'Post-write assertion failed: menus total must be 100';
  end if;
  if (
    select count(*) from public.restaurants
    where id = any (array(select 'C' || to_char(value, 'FM000') from generate_series(2, 29) as series(value)))
  ) <> 28 then
    raise exception 'Post-write assertion failed: C002-C029 count must be 28';
  end if;
  if (
    select count(*) from public.menus
    where id = any (array(select 'M' || to_char(value, 'FM000') from generate_series(1, 100) as series(value)))
  ) <> 100 then
    raise exception 'Post-write assertion failed: M001-M100 count must be 100';
  end if;
  if exists (
    select 1 from public.menus
    where food_character is null
       or food_character not in ('rice-meal', 'noodle-special', 'hot-soup', 'quick-snack', 'main-dish')
  ) then
    raise exception 'Post-write assertion failed: null or invalid Food Character exists';
  end if;

${distributionChecks}

  if exists (
    select 1
    from public.menus as menu
    left join public.restaurants as restaurant on restaurant.id = menu.restaurant_id
    where restaurant.id is null
  ) then
    raise exception 'Post-write assertion failed: orphan menu exists';
  end if;
  if exists (
    select 1
    from public.menus as menu
    left join public.restaurants as restaurant on restaurant.id = menu.restaurant_id
    where menu.available is true and restaurant.id is null
  ) then
    raise exception 'Post-write assertion failed: sellable menu references a missing restaurant';
  end if;
  if exists (
    select 1
    from public.menus as menu
    join public.restaurants as restaurant on restaurant.id = menu.restaurant_id
    where menu.available is true and restaurant.active is false
  ) then
    raise exception 'Post-write assertion failed: sellable menu references an inactive restaurant';
  end if;

  select to_jsonb(snapshot) into v_c001
  from (
    select ${quotedColumns(restaurantColumns)}
    from public.restaurants
    where id = 'C001'
  ) as snapshot;
  if v_c001 is distinct from v_expected_c001 then
    raise exception 'Post-write assertion failed: C001 changed';
  end if;
end
$catalog_migration$;

commit;

-- PostgreSQL MVCC keeps these inserts invisible to other sessions until COMMIT.
-- Any assertion error aborts the transaction, so the expected visible states are only 1/0 or 29/100.
`;
}

function buildRollbackSql({ baselineC001 }) {
  const c001Expected = sqlJson(baselineC001, "c001_expected");
  const restaurantColumns = preflight.RESTAURANT_COLUMNS;
  return `-- POST-COMMIT ROLLBACK PREVIEW ONLY. DO NOT EXECUTE WITHOUT SEPARATE EXPLICIT APPROVAL.
-- Deletes only migration-owned IDs. C001 is asserted and remains untouched.

begin;
set transaction isolation level serializable;
set local timezone = 'UTC';

lock table public.restaurants in share row exclusive mode;
lock table public.menus in share row exclusive mode;

do $catalog_rollback$
declare
  v_written integer;
  v_c001 jsonb;
  v_expected_c001 constant jsonb := ${c001Expected};
begin
  if (select count(*) from public.restaurants) <> 29
     or (select count(*) from public.menus) <> 100 then
    raise exception 'Rollback baseline differs from the expected 29/100 committed state';
  end if;
  if (
    select count(*) from public.restaurants
    where id = any (array(select 'C' || to_char(value, 'FM000') from generate_series(2, 29) as series(value)))
  ) <> 28 or (
    select count(*) from public.menus
    where id = any (array(select 'M' || to_char(value, 'FM000') from generate_series(1, 100) as series(value)))
  ) <> 100 then
    raise exception 'Rollback ownership assertion failed';
  end if;

  select to_jsonb(snapshot) into v_c001
  from (
    select ${quotedColumns(restaurantColumns)}
    from public.restaurants
    where id = 'C001'
  ) as snapshot;
  if v_c001 is null or v_c001 is distinct from v_expected_c001 then
    raise exception 'Rollback assertion failed: C001 differs from the approved baseline';
  end if;

  delete from public.menus
  where id = any (array(select 'M' || to_char(value, 'FM000') from generate_series(1, 100) as series(value)));
  get diagnostics v_written = row_count;
  if v_written <> 100 then
    raise exception 'Rollback failed: deleted % menus, expected 100', v_written;
  end if;

  delete from public.restaurants
  where id = any (array(select 'C' || to_char(value, 'FM000') from generate_series(2, 29) as series(value)));
  get diagnostics v_written = row_count;
  if v_written <> 28 then
    raise exception 'Rollback failed: deleted % restaurants, expected 28', v_written;
  end if;

  if (select count(*) from public.restaurants) <> 1
     or (select count(*) from public.menus) <> 0 then
    raise exception 'Rollback validation failed: expected baseline 1/0';
  end if;
  if not exists (select 1 from public.restaurants where id = 'C001') then
    raise exception 'Rollback validation failed: C001 is missing';
  end if;
end
$catalog_rollback$;

commit;
`;
}

function buildFinalApprovalSummary({ generatedAt, validation }) {
  return `# Catalog Migration Final Approval Summary

> PREVIEW ONLY. Approval A and Approval B are separate. No database or schema change was executed.

Generated: ${generatedAt}

## Before

| Item | Current |
| --- | ---: |
| Supabase restaurants | 1 |
| Supabase menus | 0 |
| Existing untouched row | C001 리코리코 |
| User app catalog | static 29/100 |

## Approval A: Schema Only

- Add \`public.menus.food_character TEXT NULL\`.
- Add a CHECK allowing only \`rice-meal\`, \`noodle-special\`, \`hot-soup\`, \`quick-snack\`, and \`main-dish\` when non-null.
- No default, backfill, Secondary Trait, \`food_traits\`, or RLS change.
- Approval A must stop after schema verification. Approval B is never automatic.

## Approval B: One Catalog Transaction

| Write | Rows |
| --- | ---: |
| Restaurants INSERT | ${validation.restaurant_rows} |
| Restaurants UPDATE | 0 |
| Menus INSERT | ${validation.menu_rows} |
| Menus UPDATE | 0 |
| C001 write | ${validation.c001_write_rows} |
| DELETE | 0 |

## Exact Diff

| Resource | Existing untouched | New | Updated | Deleted |
| --- | --- | --- | ---: | ---: |
| Restaurants | C001 | C002-C029 (28) | 0 | 0 |
| Menus | none | M001-M100 (100) | 0 | 0 |
| Food Character | none | 100 values on the new menu rows | 0 | 0 |

## Expected After Approval B

| Item | Expected |
| --- | ---: |
| Supabase restaurants | 29 |
| Supabase menus | 100 |
| Food Character populated | 100/100 |
| Food Character null/invalid | 0/0 |
| Orphan menus | 0 |
| User app catalog | Supabase |

Distribution: rice-meal 24, noodle-special 25, hot-soup 16, quick-snack 21, main-dish 14.

## C001 Decision

C001 is excluded from every write payload. Its existing Supabase value, including \`last_checked = 2026-06-15T00:00:00+00:00\`, is fingerprinted before and after the transaction and must remain unchanged.

All 100 menu references resolve across C001-C029. Five new menu rows reference the existing active C001 row, so no C001 write is needed for referential completeness.

## Failure Boundaries

- Transaction assertion/write failure: automatic rollback; the visible catalog remains 1/0.
- Schema succeeds but catalog transaction fails: 1/0 remains and only an unused nullable column exists. Do not rush to drop it; handle schema rollback under a separate approval.
- Catalog commits but operational validation fails: use the separately reviewed rollback transaction to delete only M001-M100 and C002-C029, leaving C001 untouched.
`;
}

function buildExecutionGuide() {
  return `# Execution Tool Recommendation

> ANALYSIS ONLY. No command or SQL in this package has been executed against Supabase.

## Recommended path

This worktree currently has no \`supabase/migrations\` directory, and neither \`supabase\` nor \`psql\` is installed or available on PATH. In the current environment, the Supabase Dashboard SQL Editor is therefore the directly available execution path. It can submit each reviewed file as one PostgreSQL batch and supports the assertions and table locks in this package.

Supabase's official migration guide warns that direct remote changes in SQL Editor bypass migration history. If this project adopts a tracked migration workflow before execution, prefer two reviewed migration files and Supabase CLI: add/push only Approval A, stop and verify, then add/push Approval B after its separate approval. Use \`supabase db push --dry-run\` before either push.

1. Approval A: run only \`01-add-food-character.sql\`, verify the nullable column and CHECK, then stop.
2. Obtain separate Approval B.
3. Immediately recheck the exact 1/0 baseline and backup fingerprint.
4. Run only \`02-migrate-catalog.sql\` as one batch.
5. Perform the post-migration checks before closing the migration window.

## Not recommended

- Browser anon client or \`seedCatalogFromStatic()\`: the existing two-request flow cannot make restaurant and menu writes atomic.
- REST upsert: the 1/0 baseline gives no reason to permit overwrite, and upsert weakens collision detection.
- A persistent RPC/function solely for this one-time migration: it adds an extra database object and permission surface. If an RPC is later required operationally, define, review, execute, and remove it under separate approvals.

## Credential handling

No service credential belongs in source files, generated SQL, shell history, logs, or reports. The SQL Editor uses the authenticated Supabase dashboard session. A direct client must receive credentials through an operator-controlled secret channel; this package neither requests nor stores them.

Official references:

- https://supabase.com/docs/guides/database/overview
- https://supabase.com/docs/guides/deployment/database-migrations
- https://supabase.com/docs/guides/local-development/cli-workflows
- https://www.postgresql.org/docs/current/transaction-iso.html
`;
}

function buildSourceTransitionAnalysis() {
  return `# User App Source Transition

## Visibility boundary

The catalog migration is one PostgreSQL transaction. Under PostgreSQL MVCC, other sessions do not see its uncommitted inserts. The table locks also prevent concurrent catalog writes during baseline verification and insertion.

- Before COMMIT: PostgREST readers continue to see the existing restaurants 1 / menus 0 state, so the user app keeps static 29/100.
- After a successful COMMIT: all 28 restaurant rows and all 100 menu rows become visible together, producing restaurants 29 / menus 100.
- On any assertion or insert failure: the transaction aborts and none of the catalog inserts commit.

The user app currently switches when it sees at least one active Supabase restaurant and at least one available Supabase menu. Atomic visibility prevents the migration itself from exposing a partial insert state. Operational validation is still a separate gate after COMMIT because application behavior, cache state, and read policy must be checked independently.
`;
}

function buildRollbackPlan() {
  return `# Execution Rollback Plan

> PLAN AND SQL PREVIEW ONLY. No rollback was executed.

## Approval B transaction fails

PostgreSQL aborts the transaction. No C002-C029 or M001-M100 row becomes visible, C001 remains untouched, and the catalog remains restaurants 1 / menus 0.

## Approval A succeeds but Approval B fails

The catalog remains 1/0. The nullable, unused \`menus.food_character\` column does not affect the current user app because deployed code does not read it. Keep the column temporarily and decide any DROP under a separate schema approval; an urgent DROP adds avoidable risk.

## Approval B commits but operational validation fails

Use \`03-rollback-catalog.sql\` only after separate approval. It requires the exact 29/100 committed state and the unchanged C001 fingerprint, then deletes M001-M100 before C002-C029 in one transaction. It asserts the restored 1/0 state before COMMIT. It never updates or deletes C001.

Schema rollback remains separate. Drop the CHECK before the column only after confirming no deployed client consumes \`food_character\`.
`;
}

function generateExecutionPreview({
  catalogDirectory = CATALOG_DIRECTORY,
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
  generatedAt = new Date().toISOString(),
} = {}) {
  const baseline = assertBaselineIntegrity(catalogDirectory);
  const baselineC001 = baseline.storesBackup.rows[0];
  const restaurants = baseline.storesPreview.items.filter((row) => row.id !== "C001");
  const menus = baseline.combinedPreview.items;
  const validation = validateExecutionPayloads(restaurants, menus, baselineC001);

  const restaurantPreview = wrapExecutionPreview({
    generatedAt,
    purpose: "Approval B restaurant INSERT payload; C001 intentionally excluded",
    targetTable: "public.restaurants",
    items: restaurants,
    validation,
  });
  const menuPreview = wrapExecutionPreview({
    generatedAt,
    purpose: "Approval B menu INSERT payload after separate food_character schema approval",
    targetTable: "public.menus",
    items: menus,
    validation,
  });

  writeJson(path.join(outputDirectory, "restaurants-insert-preview.json"), restaurantPreview);
  writeText(
    path.join(outputDirectory, "restaurants-insert-preview.csv"),
    preflight.rowsToCsv(restaurants, preflight.RESTAURANT_COLUMNS),
  );
  writeJson(path.join(outputDirectory, "menus-insert-preview.json"), menuPreview);
  writeText(
    path.join(outputDirectory, "menus-insert-preview.csv"),
    preflight.rowsToCsv(menus, [...preflight.MENU_COLUMNS, "food_character"]),
  );
  writeText(path.join(outputDirectory, "01-add-food-character.sql"), buildSchemaSql());
  writeText(
    path.join(outputDirectory, "02-migrate-catalog.sql"),
    buildCatalogTransactionSql({ restaurants, menus, baselineC001 }),
  );
  writeText(path.join(outputDirectory, "03-rollback-catalog.sql"), buildRollbackSql({ baselineC001 }));
  writeText(path.join(outputDirectory, "final-approval-summary.md"), buildFinalApprovalSummary({ generatedAt, validation }));
  writeText(path.join(outputDirectory, "execution-tool-recommendation.md"), buildExecutionGuide());
  writeText(path.join(outputDirectory, "source-transition-analysis.md"), buildSourceTransitionAnalysis());
  writeText(path.join(outputDirectory, "rollback-plan.md"), buildRollbackPlan());
  writeJson(path.join(outputDirectory, "execution-manifest.json"), {
    metadata: {
      purpose: "Approval B ownership and validation manifest",
      generated_at: generatedAt,
      execution_status: "PREVIEW_ONLY_NOT_EXECUTED",
      database_write_performed: false,
      baseline_backup_manifest_sha256: sha256(path.join(catalogDirectory, "backups", "pre-migration-backup-manifest.json")),
    },
    baseline_existing_untouched_restaurant_ids: ["C001"],
    migration_owned_restaurant_ids: restaurants.map((row) => row.id),
    migration_owned_menu_ids: menus.map((row) => row.id),
    updated_ids: [],
    deleted_ids: [],
    validation,
  });

  return { baseline, baselineC001, restaurants, menus, validation, outputDirectory };
}

if (require.main === module) {
  const result = generateExecutionPreview();
  console.log(JSON.stringify({
    output_directory: path.relative(process.cwd(), result.outputDirectory),
    restaurants_insert: result.restaurants.length,
    restaurants_update: 0,
    menus_insert: result.menus.length,
    menus_update: 0,
    c001_write: 0,
    food_character: result.menus.length,
    distribution: result.validation.food_character_distribution,
    database_write_performed: false,
    schema_change_performed: false,
  }, null, 2));
}

module.exports = Object.freeze({
  EXPECTED_DISTRIBUTION,
  assertBaselineIntegrity,
  buildCatalogTransactionSql,
  buildRollbackSql,
  buildSchemaSql,
  generateExecutionPreview,
  sequentialIds,
  validateExecutionPayloads,
});
