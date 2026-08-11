"use strict";

// STATUS: NOT EXECUTED. This helper only defines and tests the Approval B contract.

const ALLOWED_FOOD_CHARACTERS = Object.freeze([
  "rice-meal",
  "noodle-special",
  "hot-soup",
  "quick-snack",
  "main-dish",
]);

const SORTED_ALLOWED_FOOD_CHARACTERS = Object.freeze([...ALLOWED_FOOD_CHARACTERS].sort());
const EXPECTED_CONSTRAINT_SHAPE =
  "food_characterisnullorfood_character=anyarray['value','value','value','value','value']";

function extractConstraintLiterals(expression) {
  return [...String(expression || "").matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

function normalizeConstraintExpression(expression) {
  return String(expression || "")
    .toLowerCase()
    .replace(/::text\[\]/g, "")
    .replace(/::text/g, "")
    .replace(/'[^']*'/g, "'value'")
    .replace(/[\s()]/g, "");
}

function validateSchemaContract(metadata) {
  const errors = [];
  const column = metadata?.column;

  if (!column) {
    errors.push("food_character missing");
  } else {
    if (column.dataType !== "text") errors.push("food_character type must be text");
    if (column.isNullable !== "YES") errors.push("food_character must be nullable");
    if (column.defaultValue !== null) errors.push("food_character must not have a default");
  }

  const constraints = Array.isArray(metadata?.constraints) ? metadata.constraints : [];
  if (constraints.length !== 1) {
    errors.push("menus_food_character_allowed must exist exactly once");
    return errors;
  }

  const constraint = constraints[0];
  if (constraint.name !== "menus_food_character_allowed") errors.push("constraint name mismatch");
  if (constraint.type !== "c") errors.push("constraint must be CHECK");
  if (constraint.validated !== true) errors.push("constraint must be validated");
  if (constraint.noInherit !== false) errors.push("constraint must not use NO INHERIT");
  if (JSON.stringify(constraint.columns) !== JSON.stringify(["food_character"])) {
    errors.push("constraint must reference only food_character");
  }

  const literals = extractConstraintLiterals(constraint.expression).sort();
  if (JSON.stringify(literals) !== JSON.stringify(SORTED_ALLOWED_FOOD_CHARACTERS)) {
    errors.push("constraint allowed values mismatch");
  }
  if (normalizeConstraintExpression(constraint.expression) !== EXPECTED_CONSTRAINT_SHAPE) {
    errors.push("constraint expression shape mismatch");
  }
  if (constraint.acceptsNull !== true || constraint.acceptsAllowed !== true) {
    errors.push("constraint must accept NULL and all five allowed values");
  }
  if (constraint.rejectsInvalid !== true) errors.push("constraint must reject invalid values");

  return errors;
}

const SCHEMA_DECLARATIONS_SQL = `  v_food_character_attnum smallint;
  v_food_character_data_type text;
  v_food_character_nullable text;
  v_food_character_default text;
  v_constraint_count integer;
  v_constraint_type text;
  v_constraint_validated boolean;
  v_constraint_no_inherit boolean;
  v_constraint_keys smallint[];
  v_constraint_expr text;
  v_constraint_literals text[];
  v_constraint_shape text;
  v_valid_semantics_ok boolean;
  v_invalid_semantics_ok boolean;`;

const allowedSqlValues = ALLOWED_FOOD_CHARACTERS.map((value) => `(''${value}''::text)`).join(", ");
const sortedAllowedSqlArray = SORTED_ALLOWED_FOOD_CHARACTERS.map((value) => `'${value}'`).join(", ");
const expectedConstraintShapeSql = EXPECTED_CONSTRAINT_SHAPE.replaceAll("'", "''");

const SCHEMA_ASSERTION_SQL = `  -- Fail closed unless the manually applied Approval A schema contract is exact.
  select data_type, is_nullable, column_default
    into v_food_character_data_type, v_food_character_nullable, v_food_character_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'menus'
    and column_name = 'food_character';

  if not found then
    raise exception 'Approval B schema baseline failed: public.menus.food_character is missing';
  end if;
  if v_food_character_data_type is distinct from 'text'
     or v_food_character_nullable is distinct from 'YES'
     or v_food_character_default is not null then
    raise exception
      'Approval B schema baseline failed: food_character definition mismatch (type=%, nullable=%, default=%)',
      v_food_character_data_type,
      v_food_character_nullable,
      coalesce(v_food_character_default, 'none');
  end if;

  select attnum
    into v_food_character_attnum
  from pg_attribute
  where attrelid = 'public.menus'::regclass
    and attname = 'food_character'
    and not attisdropped;

  if not found then
    raise exception 'Approval B schema baseline failed: food_character catalog metadata is missing';
  end if;

  select count(*)
    into v_constraint_count
  from pg_constraint
  where conrelid = 'public.menus'::regclass
    and conname = 'menus_food_character_allowed';

  if v_constraint_count <> 1 then
    raise exception
      'Approval B schema baseline failed: menus_food_character_allowed count is %, expected 1',
      v_constraint_count;
  end if;

  select contype::text,
         convalidated,
         connoinherit,
         conkey,
         pg_get_expr(conbin, conrelid, true)
    into v_constraint_type,
         v_constraint_validated,
         v_constraint_no_inherit,
         v_constraint_keys,
         v_constraint_expr
  from pg_constraint
  where conrelid = 'public.menus'::regclass
    and conname = 'menus_food_character_allowed';

  if v_constraint_type is distinct from 'c'
     or v_constraint_validated is not true
     or v_constraint_no_inherit is not false
     or v_constraint_keys is distinct from array[v_food_character_attnum]::smallint[] then
    raise exception
      'Approval B schema baseline failed: menus_food_character_allowed metadata mismatch';
  end if;

  select coalesce(array_agg(capture[1] order by capture[1]), array[]::text[])
    into v_constraint_literals
  from regexp_matches(v_constraint_expr, '''([^'']*)''', 'g') as matches(capture);

  if v_constraint_literals is distinct from array[${sortedAllowedSqlArray}]::text[] then
    raise exception
      'Approval B schema baseline failed: Food Character allowed-value set mismatch (%)',
      v_constraint_literals;
  end if;

  v_constraint_shape := lower(v_constraint_expr);
  v_constraint_shape := replace(v_constraint_shape, '::text[]', '');
  v_constraint_shape := replace(v_constraint_shape, '::text', '');
  v_constraint_shape := regexp_replace(v_constraint_shape, '''[^'']*''', '''value''', 'g');
  v_constraint_shape := regexp_replace(v_constraint_shape, '[[:space:]()]', '', 'g');

  if v_constraint_shape is distinct from '${expectedConstraintShapeSql}' then
    raise exception
      'Approval B schema baseline failed: Food Character CHECK expression shape mismatch (%)',
      v_constraint_expr;
  end if;

  execute format(
    'select coalesce(bool_and((%s) is true), false) from (values (null::text), ${allowedSqlValues}) as probe(food_character)',
    v_constraint_expr
  ) into v_valid_semantics_ok;

  execute format(
    'select coalesce(bool_and((%s) is false), false) from (values (''''::text), (''invalid''::text), (''secondary-trait''::text), (''rice_meal''::text)) as probe(food_character)',
    v_constraint_expr
  ) into v_invalid_semantics_ok;

  if v_valid_semantics_ok is not true or v_invalid_semantics_ok is not true then
    raise exception
      'Approval B schema baseline failed: Food Character CHECK semantic probes failed';
  end if;`;

module.exports = {
  ALLOWED_FOOD_CHARACTERS,
  EXPECTED_CONSTRAINT_SHAPE,
  SCHEMA_ASSERTION_SQL,
  SCHEMA_DECLARATIONS_SQL,
  extractConstraintLiterals,
  normalizeConstraintExpression,
  validateSchemaContract,
};
