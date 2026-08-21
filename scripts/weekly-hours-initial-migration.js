const fs = require("node:fs");
const path = require("node:path");

const {
  CLASSIFICATIONS,
  WEEKDAYS,
  buildPreview,
  readCatalog,
} = require("./weekly-hours-preview");

const AUTO_SAFE_IDS = Object.freeze([
  "C001", "C002", "C007", "C010", "C013", "C014",
  "C015", "C017", "C020", "C022", "C023", "C027",
]);
const UNKNOWN_IDS = Object.freeze(["C003", "C009", "C011", "C019"]);
const EXCLUDED_IDS = Object.freeze([
  "C004", "C005", "C006", "C008", "C012", "C016", "C018",
  "C021", "C024", "C025", "C026", "C028", "C029",
]);
const TARGET_IDS = Object.freeze([...AUTO_SAFE_IDS, ...UNKNOWN_IDS].sort());
const MIGRATION_NAME = "20260816204500_seed_initial_restaurant_weekly_hours.sql";
const ROW_COLUMNS = Object.freeze([
  "restaurant_id",
  "iso_weekday",
  "day_status",
  "open_time",
  "close_time",
  "closes_next_day",
  "break_status",
  "break_start",
  "break_end",
  "note",
  "source",
  "last_verified_at",
]);

function normalizeTime(value) {
  if (value == null) return null;
  return /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
}

function toMigrationRow(row) {
  return {
    restaurant_id: row.restaurantId,
    iso_weekday: row.isoWeekday,
    day_status: row.dayStatus,
    open_time: normalizeTime(row.openTime),
    close_time: normalizeTime(row.closeTime),
    closes_next_day: false,
    break_status: row.breakStatus,
    break_start: normalizeTime(row.breakStart),
    break_end: normalizeTime(row.breakEnd),
    note: null,
    source: "legacy_migration",
    last_verified_at: null,
  };
}

function countBy(rows, field) {
  return rows.reduce((counts, row) => {
    counts[row[field]] = (counts[row[field]] || 0) + 1;
    return counts;
  }, {});
}

function buildInitialMigration(catalog) {
  const preview = buildPreview(catalog);
  const restaurantsById = new Map(preview.restaurants.map((restaurant) => [restaurant.id, restaurant]));
  const rows = preview.generatedRows
    .map(toMigrationRow)
    .sort((a, b) => a.restaurant_id.localeCompare(b.restaurant_id) || a.iso_weekday - b.iso_weekday);
  const targets = TARGET_IDS.map((id) => {
    const restaurant = restaurantsById.get(id);
    if (!restaurant) throw new Error(`Missing migration target: ${id}`);
    return restaurant;
  });
  const baselines = targets.map((restaurant) => ({
    id: restaurant.id,
    name: restaurant.name,
    open_time: restaurant.legacyBefore.openTime,
    close_time: restaurant.legacyBefore.closeTime,
    break_time: restaurant.legacyBefore.breakTime,
    closed_days: restaurant.legacyBefore.closedDays,
  }));
  const result = {
    version: 1,
    source: "legacy_migration",
    rowCount: rows.length,
    restaurantCount: new Set(rows.map((row) => row.restaurant_id)).size,
    targetIds: [...TARGET_IDS],
    excludedIds: [...EXCLUDED_IDS],
    statusCounts: countBy(rows, "day_status"),
    breakCounts: countBy(rows, "break_status"),
    targets,
    baselines,
    rows,
  };
  validateInitialMigration(result);
  return result;
}

function validateInitialMigration(result) {
  if (result.rowCount !== 112 || result.restaurantCount !== 16) {
    throw new Error(`Unexpected migration size: ${result.restaurantCount} restaurants, ${result.rowCount} rows`);
  }
  if (JSON.stringify(result.statusCounts) !== JSON.stringify({ open: 69, closed: 15, unknown: 28 })) {
    throw new Error(`Unexpected day-status distribution: ${JSON.stringify(result.statusCounts)}`);
  }
  if (JSON.stringify(result.breakCounts) !== JSON.stringify({ unknown: 86, none: 15, scheduled: 11 })) {
    throw new Error(`Unexpected break-status distribution: ${JSON.stringify(result.breakCounts)}`);
  }
  for (const id of TARGET_IDS) {
    const rows = result.rows.filter((row) => row.restaurant_id === id);
    if (rows.length !== 7 || rows.some((row, index) => row.iso_weekday !== index + 1)) {
      throw new Error(`${id} does not have ISO weekdays 1 through 7`);
    }
  }
  if (result.rows.some((row) => EXCLUDED_IDS.includes(row.restaurant_id))) {
    throw new Error("An excluded restaurant entered the initial migration");
  }
  if (result.rows.some((row) => row.source !== "legacy_migration"
    || row.last_verified_at !== null
    || row.note !== null
    || row.closes_next_day !== false)) {
    throw new Error("Migration metadata contract changed");
  }
}

function sqlLiteral(value) {
  if (value == null) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function renderRowTuples(rows, indent = "  ") {
  return rows.map((row, index) => {
    const values = ROW_COLUMNS.map((column) => sqlLiteral(row[column])).join(", ");
    return `${indent}(${values})${index === rows.length - 1 ? "" : ","}`;
  }).join("\n");
}

function typedSqlLiteral(column, value) {
  const literal = sqlLiteral(value);
  const casts = {
    restaurant_id: "text",
    iso_weekday: "smallint",
    day_status: "text",
    open_time: "time without time zone",
    close_time: "time without time zone",
    closes_next_day: "boolean",
    break_status: "text",
    break_start: "time without time zone",
    break_end: "time without time zone",
    note: "text",
    source: "text",
    last_verified_at: "timestamptz",
  };
  return `${literal}::${casts[column]}`;
}

function renderExpectedRowsCte(rows, name = "expected_rows") {
  const values = rows.map((row, index) => {
    const tuple = ROW_COLUMNS.map((column) => typedSqlLiteral(column, row[column])).join(", ");
    return `    (${tuple})${index === rows.length - 1 ? "" : ","}`;
  }).join("\n");
  return `${name} (${ROW_COLUMNS.join(", ")}) AS (\n  VALUES\n${values}\n)`;
}

function renderBaselineCte(baselines, name = "expected_baseline") {
  const columns = ["id", "name", "open_time", "close_time", "break_time", "closed_days"];
  const values = baselines.map((row, index) => {
    const tuple = columns.map((column) => sqlLiteral(row[column])).join(", ");
    return `    (${tuple})${index === baselines.length - 1 ? "" : ","}`;
  }).join("\n");
  return `${name} (${columns.join(", ")}) AS (\n  VALUES\n${values}\n)`;
}

function renderCanonicalMigration(result) {
  return `INSERT INTO public.restaurant_weekly_hours (\n  ${ROW_COLUMNS.join(",\n  ")}\n) VALUES\n${renderRowTuples(result.rows)};\n`;
}

function renderJson(result) {
  return `${JSON.stringify({
    version: result.version,
    source: result.source,
    row_count: result.rowCount,
    restaurant_count: result.restaurantCount,
    target_ids: result.targetIds,
    excluded_ids: result.excludedIds,
    day_status_counts: result.statusCounts,
    break_status_counts: result.breakCounts,
    rows: result.rows,
  }, null, 2)}\n`;
}

function displayValue(value) {
  return value == null ? "NULL" : String(value);
}

function renderHumanPreview(result) {
  const lines = [
    "# Initial Weekly Hours Migration Preview",
    "",
    "> Historical preview record. These 112 rows were applied manually on 2026-08-16; the user app still uses the legacy hours reader.",
    "",
    "## Summary",
    "",
    "- Targets: 16 restaurants",
    "- Rows: 112",
    "- Day status: open 69, closed 15, unknown 28",
    "- Break status: scheduled 11, none 15, unknown 86",
    "- Metadata: source `legacy_migration`, note NULL, last_verified_at NULL",
    "- Excluded: 13 restaurants, including C024",
    "",
  ];
  for (const target of result.targets) {
    const baseline = result.baselines.find((item) => item.id === target.id);
    const rows = result.rows.filter((row) => row.restaurant_id === target.id);
    lines.push(
      `## ${target.id} ${target.name}`,
      "",
      `BEFORE: open=${displayValue(baseline.open_time)}; close=${displayValue(baseline.close_time)}; break=${baseline.break_time === "" ? "(blank)" : displayValue(baseline.break_time)}; closed=${displayValue(baseline.closed_days)}`,
      "",
      "| Day | Status | Open | Close | Next day | Break | Break start | Break end |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const row of rows) {
      const weekday = WEEKDAYS.find((day) => day.isoWeekday === row.iso_weekday);
      lines.push(`| ${weekday.label} | ${row.day_status} | ${displayValue(row.open_time)} | ${displayValue(row.close_time)} | ${row.closes_next_day} | ${row.break_status} | ${displayValue(row.break_start)} | ${displayValue(row.break_end)} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function renderExecutionTransaction(result) {
  const canonical = renderCanonicalMigration(result).trimEnd();
  const baselineCte = renderBaselineCte(result.baselines);
  const expectedRowsCte = renderExpectedRowsCte(result.rows);
  const targetIds = result.targetIds.map(sqlLiteral).join(", ");
  const excludedIds = result.excludedIds.map(sqlLiteral).join(", ");
  return `-- EXECUTED MANUALLY IN SUPABASE SQL EDITOR ON 2026-08-16.
-- HISTORICAL EXECUTION RECORD. DO NOT RE-RUN.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $preflight$
DECLARE
  difference_count integer;
  constraint_count integer;
  policy_count integer;
  trigger_count integer;
  restaurant_count integer;
  menu_count integer;
  weekly_count integer;
  restaurants_fingerprint text;
  menus_fingerprint text;
BEGIN
  IF to_regclass('public.restaurants') IS NULL
    OR to_regclass('public.menus') IS NULL
    OR to_regclass('public.restaurant_weekly_hours') IS NULL THEN
    RAISE EXCEPTION 'Initial weekly migration preflight failed: required table is missing';
  END IF;

  SELECT count(*) INTO restaurant_count FROM public.restaurants;
  SELECT count(*) INTO menu_count FROM public.menus;
  SELECT count(*) INTO weekly_count FROM public.restaurant_weekly_hours;

  IF restaurant_count <> 29 OR menu_count <> 100 OR weekly_count <> 0 THEN
    RAISE EXCEPTION
      'Initial weekly migration preflight failed: expected restaurants=29 menus=100 weekly=0, got restaurants=% menus=% weekly=%',
      restaurant_count,
      menu_count,
      weekly_count;
  END IF;

  WITH expected_columns(ordinal_position, column_name, data_type, is_nullable) AS (
    VALUES
      (1, 'restaurant_id', 'text', 'NO'),
      (2, 'iso_weekday', 'smallint', 'NO'),
      (3, 'day_status', 'text', 'NO'),
      (4, 'open_time', 'time without time zone', 'YES'),
      (5, 'close_time', 'time without time zone', 'YES'),
      (6, 'closes_next_day', 'boolean', 'NO'),
      (7, 'break_status', 'text', 'NO'),
      (8, 'break_start', 'time without time zone', 'YES'),
      (9, 'break_end', 'time without time zone', 'YES'),
      (10, 'note', 'text', 'YES'),
      (11, 'source', 'text', 'YES'),
      (12, 'last_verified_at', 'timestamp with time zone', 'YES'),
      (13, 'updated_at', 'timestamp with time zone', 'NO')
  ),
  actual_columns AS (
    SELECT ordinal_position::integer, column_name::text, data_type::text, is_nullable::text
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurant_weekly_hours'
  ),
  differences AS (
    (SELECT * FROM expected_columns EXCEPT SELECT * FROM actual_columns)
    UNION ALL
    (SELECT * FROM actual_columns EXCEPT SELECT * FROM expected_columns)
  )
  SELECT count(*) INTO difference_count FROM differences;

  IF difference_count <> 0 THEN
    RAISE EXCEPTION 'Initial weekly migration preflight failed: 13-column schema changed';
  END IF;

  IF (
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurant_weekly_hours'
      AND column_name = 'closes_next_day'
  ) IS DISTINCT FROM 'false' OR (
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurant_weekly_hours'
      AND column_name = 'updated_at'
  ) IS DISTINCT FROM 'now()' THEN
    RAISE EXCEPTION 'Initial weekly migration preflight failed: schema defaults changed';
  END IF;

  SELECT count(*) INTO constraint_count
  FROM pg_constraint
  WHERE conrelid = 'public.restaurant_weekly_hours'::regclass
    AND conname IN (
      'restaurant_weekly_hours_pkey',
      'restaurant_weekly_hours_restaurant_fkey',
      'restaurant_weekly_hours_iso_weekday_allowed',
      'restaurant_weekly_hours_day_status_allowed',
      'restaurant_weekly_hours_break_status_allowed',
      'restaurant_weekly_hours_day_shape_valid',
      'restaurant_weekly_hours_break_shape_valid'
    );

  IF constraint_count <> 7 OR NOT (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.restaurant_weekly_hours'::regclass
  ) THEN
    RAISE EXCEPTION 'Initial weekly migration preflight failed: constraints or RLS changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.restaurant_weekly_hours'::regclass
      AND constraint_row.conname = 'restaurant_weekly_hours_pkey'
      AND constraint_row.contype = 'p'
      AND (
        SELECT array_agg(attribute.attname ORDER BY key.ordinality)
        FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = constraint_row.conrelid
         AND attribute.attnum = key.attnum
      ) = ARRAY['restaurant_id', 'iso_weekday']::name[]
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.restaurant_weekly_hours'::regclass
      AND constraint_row.conname = 'restaurant_weekly_hours_restaurant_fkey'
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.restaurants'::regclass
      AND constraint_row.confdeltype = 'r'
      AND (
        SELECT array_agg(attribute.attname ORDER BY key.ordinality)
        FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = constraint_row.conrelid
         AND attribute.attnum = key.attnum
      ) = ARRAY['restaurant_id']::name[]
      AND (
        SELECT array_agg(attribute.attname ORDER BY key.ordinality)
        FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = constraint_row.confrelid
         AND attribute.attnum = key.attnum
      ) = ARRAY['id']::name[]
  ) THEN
    RAISE EXCEPTION 'Initial weekly migration preflight failed: PK or FK contract changed';
  END IF;

  SELECT count(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'restaurant_weekly_hours';

  SELECT count(*) INTO trigger_count
  FROM pg_trigger
  WHERE tgrelid = 'public.restaurant_weekly_hours'::regclass
    AND NOT tgisinternal
    AND tgname = 'restaurant_weekly_hours_updated_at'
    AND tgenabled = 'O'
    AND tgfoid = 'public.set_updated_at()'::regprocedure;

  IF policy_count <> 2 OR trigger_count <> 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'restaurant_weekly_hours'
      AND policyname = 'Active restaurant weekly hours are readable by everyone'
      AND cmd = 'SELECT'
      AND roles @> ARRAY['anon', 'authenticated']::name[]
      AND qual LIKE '%restaurant.active = true%'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'restaurant_weekly_hours'
      AND policyname = 'Admins can manage restaurant weekly hours'
      AND cmd = 'ALL'
      AND roles = ARRAY['authenticated']::name[]
      AND qual LIKE '%is_admin()%'
      AND with_check LIKE '%is_admin()%'
  ) THEN
    RAISE EXCEPTION 'Initial weekly migration preflight failed: policies or trigger changed';
  END IF;

  IF NOT has_table_privilege('anon', 'public.restaurant_weekly_hours', 'SELECT')
    OR has_table_privilege('anon', 'public.restaurant_weekly_hours', 'INSERT')
    OR has_table_privilege('anon', 'public.restaurant_weekly_hours', 'UPDATE')
    OR has_table_privilege('anon', 'public.restaurant_weekly_hours', 'DELETE')
    OR NOT has_table_privilege('authenticated', 'public.restaurant_weekly_hours', 'SELECT')
    OR NOT has_table_privilege('authenticated', 'public.restaurant_weekly_hours', 'INSERT')
    OR NOT has_table_privilege('authenticated', 'public.restaurant_weekly_hours', 'UPDATE')
    OR NOT has_table_privilege('authenticated', 'public.restaurant_weekly_hours', 'DELETE') THEN
    RAISE EXCEPTION 'Initial weekly migration preflight failed: table grants changed';
  END IF;

  WITH ${baselineCte},
  actual_baseline AS (
    SELECT id, name, open_time, close_time, break_time, closed_days
    FROM public.restaurants
    WHERE id IN (${targetIds})
  ),
  differences AS (
    (SELECT * FROM expected_baseline EXCEPT SELECT * FROM actual_baseline)
    UNION ALL
    (SELECT * FROM actual_baseline EXCEPT SELECT * FROM expected_baseline)
  )
  SELECT count(*) INTO difference_count FROM differences;

  IF difference_count <> 0 THEN
    RAISE EXCEPTION 'Initial weekly migration preflight failed: 16-target legacy baseline changed';
  END IF;

  IF (SELECT count(*) FROM public.restaurants WHERE id IN (${excludedIds})) <> 13 THEN
    RAISE EXCEPTION 'Initial weekly migration preflight failed: excluded restaurant set changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.restaurants
    WHERE id = 'C024'
      AND name = '고가밀면'
      AND closed_days = '2,4번째 일요일'
  ) THEN
    RAISE EXCEPTION 'Initial weekly migration preflight failed: C024 special closure changed';
  END IF;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(restaurant) ORDER BY restaurant.id), '[]'::jsonb)::text)
  INTO restaurants_fingerprint
  FROM public.restaurants AS restaurant;

  SELECT md5(COALESCE(jsonb_agg(to_jsonb(menu) ORDER BY menu.id), '[]'::jsonb)::text)
  INTO menus_fingerprint
  FROM public.menus AS menu;

  PERFORM set_config('mukjji.initial_weekly_restaurants_fingerprint', restaurants_fingerprint, true);
  PERFORM set_config('mukjji.initial_weekly_menus_fingerprint', menus_fingerprint, true);
END;
$preflight$;

-- BEGIN CANONICAL DATA EFFECT
${canonical}
-- END CANONICAL DATA EFFECT

DO $postcheck$
DECLARE
  difference_count integer;
  invalid_group_count integer;
  restaurant_count integer;
  menu_count integer;
  weekly_count integer;
  restaurants_fingerprint text;
  menus_fingerprint text;
BEGIN
  SELECT count(*) INTO weekly_count FROM public.restaurant_weekly_hours;

  IF weekly_count <> 112
    OR (SELECT count(DISTINCT restaurant_id) FROM public.restaurant_weekly_hours) <> 16
    OR (SELECT count(*) FROM public.restaurant_weekly_hours WHERE day_status = 'open') <> 69
    OR (SELECT count(*) FROM public.restaurant_weekly_hours WHERE day_status = 'closed') <> 15
    OR (SELECT count(*) FROM public.restaurant_weekly_hours WHERE day_status = 'unknown') <> 28
    OR (SELECT count(*) FROM public.restaurant_weekly_hours WHERE break_status = 'scheduled') <> 11
    OR (SELECT count(*) FROM public.restaurant_weekly_hours WHERE break_status = 'none') <> 15
    OR (SELECT count(*) FROM public.restaurant_weekly_hours WHERE break_status = 'unknown') <> 86
    OR (SELECT count(*) FROM public.restaurant_weekly_hours WHERE source = 'legacy_migration') <> 112
    OR (SELECT count(*) FROM public.restaurant_weekly_hours WHERE last_verified_at IS NULL) <> 112
    OR (SELECT count(*) FROM public.restaurant_weekly_hours WHERE closes_next_day = false) <> 112
    OR (SELECT count(*) FROM public.restaurant_weekly_hours WHERE updated_at IS NOT NULL) <> 112 THEN
    RAISE EXCEPTION 'Initial weekly migration post-check failed: aggregate mismatch';
  END IF;

  SELECT count(*) INTO invalid_group_count
  FROM (
    SELECT restaurant_id
    FROM public.restaurant_weekly_hours
    GROUP BY restaurant_id
    HAVING count(*) <> 7
      OR count(DISTINCT iso_weekday) <> 7
      OR min(iso_weekday) <> 1
      OR max(iso_weekday) <> 7
  ) AS invalid_groups;

  IF invalid_group_count <> 0 THEN
    RAISE EXCEPTION 'Initial weekly migration post-check failed: weekday completeness mismatch';
  END IF;

  IF (SELECT count(*) FROM public.restaurant_weekly_hours WHERE restaurant_id IN (${excludedIds})) <> 0 THEN
    RAISE EXCEPTION 'Initial weekly migration post-check failed: excluded restaurant row found';
  END IF;

  WITH ${expectedRowsCte},
  actual_rows AS (
    SELECT ${ROW_COLUMNS.join(", ")}
    FROM public.restaurant_weekly_hours
  ),
  differences AS (
    (SELECT * FROM expected_rows EXCEPT SELECT * FROM actual_rows)
    UNION ALL
    (SELECT * FROM actual_rows EXCEPT SELECT * FROM expected_rows)
  )
  SELECT count(*) INTO difference_count FROM differences;

  IF difference_count <> 0 THEN
    RAISE EXCEPTION 'Initial weekly migration post-check failed: exact expected rows differ';
  END IF;

  SELECT count(*) INTO restaurant_count FROM public.restaurants;
  SELECT count(*) INTO menu_count FROM public.menus;
  SELECT md5(COALESCE(jsonb_agg(to_jsonb(restaurant) ORDER BY restaurant.id), '[]'::jsonb)::text)
  INTO restaurants_fingerprint
  FROM public.restaurants AS restaurant;
  SELECT md5(COALESCE(jsonb_agg(to_jsonb(menu) ORDER BY menu.id), '[]'::jsonb)::text)
  INTO menus_fingerprint
  FROM public.menus AS menu;

  IF restaurant_count <> 29 OR menu_count <> 100
    OR restaurants_fingerprint IS DISTINCT FROM current_setting('mukjji.initial_weekly_restaurants_fingerprint', true)
    OR menus_fingerprint IS DISTINCT FROM current_setting('mukjji.initial_weekly_menus_fingerprint', true) THEN
    RAISE EXCEPTION 'Initial weekly migration post-check failed: existing catalog changed';
  END IF;
END;
$postcheck$;

COMMIT;
`;
}

function renderPostcheck(result) {
  const targetIds = result.targetIds.map(sqlLiteral).join(", ");
  const excludedIds = result.excludedIds.map(sqlLiteral).join(", ");
  return `-- READ ONLY POST-CHECK.
BEGIN;
SET TRANSACTION READ ONLY;

SELECT
  (SELECT count(*) FROM public.restaurants) AS restaurants,
  (SELECT count(*) FROM public.menus) AS menus,
  (SELECT count(*) FROM public.restaurant_weekly_hours) AS weekly_rows,
  (SELECT count(DISTINCT restaurant_id) FROM public.restaurant_weekly_hours) AS weekly_restaurants,
  (SELECT count(*) FROM public.restaurant_weekly_hours WHERE day_status = 'open') AS open_count,
  (SELECT count(*) FROM public.restaurant_weekly_hours WHERE day_status = 'closed') AS closed_count,
  (SELECT count(*) FROM public.restaurant_weekly_hours WHERE day_status = 'unknown') AS unknown_count,
  (SELECT count(*) FROM public.restaurant_weekly_hours WHERE break_status = 'scheduled') AS scheduled_break_count,
  (SELECT count(*) FROM public.restaurant_weekly_hours WHERE break_status = 'none') AS none_break_count,
  (SELECT count(*) FROM public.restaurant_weekly_hours WHERE break_status = 'unknown') AS unknown_break_count,
  (SELECT count(*) FROM public.restaurant_weekly_hours WHERE source = 'legacy_migration') AS legacy_source_count,
  (SELECT count(*) FROM public.restaurant_weekly_hours WHERE last_verified_at IS NULL) AS unverified_count,
  (SELECT count(*) FROM public.restaurant_weekly_hours WHERE restaurant_id IN (${excludedIds})) AS manual_review_rows,
  (SELECT count(*) FROM public.restaurant_weekly_hours WHERE restaurant_id = 'C024') AS c024_rows;

SELECT
  restaurant_id,
  iso_weekday,
  day_status,
  open_time,
  close_time,
  closes_next_day,
  break_status,
  break_start,
  break_end,
  note,
  source,
  last_verified_at,
  updated_at
FROM public.restaurant_weekly_hours
WHERE restaurant_id IN (${targetIds})
ORDER BY restaurant_id, iso_weekday;

COMMIT;
`;
}

function equalityPredicates(actualAlias, expectedAlias) {
  return ROW_COLUMNS.map((column) => `${actualAlias}.${column} IS NOT DISTINCT FROM ${expectedAlias}.${column}`)
    .join("\n      AND ");
}

function renderRollback(result) {
  const expectedRowsCte = renderExpectedRowsCte(result.rows);
  return `-- ROLLBACK PREVIEW ONLY. DO NOT EXECUTE WITHOUT EXPLICIT APPROVAL.
BEGIN;

DO $rollback$
DECLARE
  difference_count integer;
  deleted_count integer;
BEGIN
  IF to_regclass('public.restaurant_weekly_hours') IS NULL
    OR (SELECT count(*) FROM public.restaurant_weekly_hours) <> 112 THEN
    RAISE EXCEPTION 'Initial weekly rollback stopped: table or row-count baseline changed';
  END IF;

  WITH ${expectedRowsCte},
  actual_rows AS (
    SELECT ${ROW_COLUMNS.join(", ")}
    FROM public.restaurant_weekly_hours
  ),
  differences AS (
    (SELECT * FROM expected_rows EXCEPT SELECT * FROM actual_rows)
    UNION ALL
    (SELECT * FROM actual_rows EXCEPT SELECT * FROM expected_rows)
  )
  SELECT count(*) INTO difference_count FROM differences;

  IF difference_count <> 0 THEN
    RAISE EXCEPTION 'Initial weekly rollback stopped: exact migration rows changed';
  END IF;

  WITH ${expectedRowsCte}
  DELETE FROM public.restaurant_weekly_hours AS actual
  USING expected_rows AS expected
  WHERE ${equalityPredicates("actual", "expected")};

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count <> 112 OR (SELECT count(*) FROM public.restaurant_weekly_hours) <> 0 THEN
    RAISE EXCEPTION 'Initial weekly rollback stopped: expected exactly 112 deletions, got %', deleted_count;
  END IF;
END;
$rollback$;

-- This preview always rolls back. A separately approved rollback package is required.
ROLLBACK;
`;
}

function writeOutputs(root, result) {
  const outputs = new Map([
    [path.join(root, "docs", "weekly-hours", "initial-migration-preview.json"), renderJson(result)],
    [path.join(root, "docs", "weekly-hours", "initial-migration-preview.md"), renderHumanPreview(result)],
    [path.join(root, "supabase", "migrations", MIGRATION_NAME), renderCanonicalMigration(result)],
    [path.join(root, "docs", "weekly-hours", "initial-migration-execution-transaction.sql"), renderExecutionTransaction(result)],
    [path.join(root, "docs", "weekly-hours", "initial-migration-postcheck-readonly.sql"), renderPostcheck(result)],
    [path.join(root, "docs", "weekly-hours", "initial-migration-rollback-preview.sql"), renderRollback(result)],
  ]);
  for (const [filePath, content] of outputs) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }
  return [...outputs.keys()];
}

if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  const result = buildInitialMigration(readCatalog(path.join(root, "data.js")));
  if (process.argv.includes("--write")) {
    for (const filePath of writeOutputs(root, result)) process.stdout.write(`${filePath}\n`);
  } else {
    process.stdout.write(renderJson(result));
  }
}

module.exports = {
  AUTO_SAFE_IDS,
  EXCLUDED_IDS,
  MIGRATION_NAME,
  ROW_COLUMNS,
  TARGET_IDS,
  UNKNOWN_IDS,
  buildInitialMigration,
  renderCanonicalMigration,
  renderExecutionTransaction,
  renderHumanPreview,
  renderJson,
  renderPostcheck,
  renderRollback,
  writeOutputs,
};
