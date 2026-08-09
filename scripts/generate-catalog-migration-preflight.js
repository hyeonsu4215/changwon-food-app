const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const vm = require("node:vm");

const catalogPolicy = require("../catalog-policy.js");

const RESTAURANT_COLUMNS = Object.freeze([
  "id", "name", "area", "address", "lat", "lng", "phone", "open_time", "close_time",
  "break_time", "closed_days", "takeout", "delivery", "alone", "group_available", "seats",
  "review_count", "source", "last_checked", "memo", "active",
]);

const MENU_COLUMNS = Object.freeze([
  "id", "restaurant_id", "restaurant_name", "name", "category", "price", "spicy", "salty",
  "sweet", "portion", "value", "speed", "signature", "available", "tags", "source",
  "last_checked", "recommend_note",
]);

const ALLOWED_FOOD_CHARACTERS = Object.freeze([
  "rice-meal",
  "noodle-special",
  "hot-soup",
  "quick-snack",
  "main-dish",
]);

const STORE_MAPPING = Object.freeze([
  ["id", "id", "string", "No transform"],
  ["name", "name", "string", "No transform"],
  ["area", "area", "string", "The app uses area for the requested region concept"],
  ["address", "address", "string", "No transform"],
  ["lat", "lat", "number", "Number(value || 0)"],
  ["lng", "lng", "number", "Number(value || 0)"],
  ["phone", "phone", "string", "Empty string fallback"],
  ["openTime", "open_time", "string", "Empty string fallback"],
  ["closeTime", "close_time", "string", "Empty string fallback"],
  ["breakTime", "break_time", "string", "Empty string fallback"],
  ["closedDays", "closed_days", "string", "Empty string fallback"],
  ["takeout", "takeout", "boolean", "Boolean(value)"],
  ["delivery", "delivery", "boolean", "Boolean(value)"],
  ["alone", "alone", "boolean", "Boolean(value)"],
  ["group", "group_available", "boolean", "Boolean(value)"],
  ["seats", "seats", "number", "Number(value || 0)"],
  ["reviewCount", "review_count", "number", "Number(value || 0)"],
  ["source", "source", "string", "Empty string fallback"],
  ["lastChecked", "last_checked", "timestamp", "Null when empty"],
  ["memo", "memo", "string", "Empty string fallback"],
  ["(implicit)", "active", "boolean", "True unless explicitly false"],
]);

const MENU_MAPPING = Object.freeze([
  ["id", "id", "string", "No transform"],
  ["restaurantId", "restaurant_id", "string", "Application-level store reference"],
  ["restaurantName", "restaurant_name", "string", "Resolved from the mapped store when possible"],
  ["name", "name", "string", "No transform"],
  ["category", "category", "string", "기타 fallback"],
  ["price", "price", "number", "Number(value || 0)"],
  ["spicy", "spicy", "number", "Number(value || 0), validated 0-5"],
  ["salty", "salty", "number", "Number(value || 0), validated 0-5"],
  ["sweet", "sweet", "number", "Number(value || 0), validated 0-5"],
  ["portion", "portion", "number", "Number(value || 0), validated 0-5"],
  ["value", "value", "number", "Number(value || 0), validated 0-5"],
  ["speed", "speed", "number", "Number(value || 0), validated 0-5"],
  ["signature", "signature", "boolean", "Boolean(value)"],
  ["available", "available", "boolean", "True unless explicitly false"],
  ["tags", "tags", "array", "Copied array; non-array is rejected by validation"],
  ["source", "source", "string", "Empty string fallback"],
  ["lastChecked", "last_checked", "timestamp", "Null when empty"],
  ["recommendNote", "recommend_note", "string", "Empty string fallback"],
]);

function loadFoodData(dataFile = path.resolve(__dirname, "..", "data.js")) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(dataFile, "utf8"), sandbox, { filename: dataFile });
  const data = sandbox.window.CHANGWON_FOOD_DATA;
  if (!data || !Array.isArray(data.restaurants) || !Array.isArray(data.menus)) {
    throw new Error("data.js must expose restaurants and menus arrays.");
  }
  return data;
}

function loadFoodCharacterCandidate(
  candidateFile = path.resolve(__dirname, "..", "docs", "food-character", "food-character-approved-candidate.json"),
) {
  const candidate = JSON.parse(fs.readFileSync(candidateFile, "utf8"));
  if (!Array.isArray(candidate)) throw new Error("Food Character candidate must be an array.");
  return candidate;
}

function readPublicSupabaseConfig(configFile = path.resolve(__dirname, "..", "supabase-config.js")) {
  const source = fs.readFileSync(configFile, "utf8");
  const url = source.match(/url:\s*["']([^"']+)["']/)?.[1];
  const anonKey = source.match(/anonKey:\s*["']([^"']+)["']/)?.[1];
  if (!url || !anonKey) throw new Error("Public Supabase URL or anon key is unavailable.");
  return { url, anonKey };
}

async function fetchRows({ projectUrl, anonKey, table, columns, orderBy = "id" }) {
  const endpoint = new URL(`/rest/v1/${table}`, projectUrl);
  endpoint.searchParams.set("select", columns.join(","));
  if (orderBy) endpoint.searchParams.set("order", `${orderBy}.asc`);
  endpoint.searchParams.set("limit", "1000");
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Prefer: "count=exact",
    },
  });
  if (!response.ok) throw new Error(`${table} read failed with HTTP ${response.status}.`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error(`${table} response is not an array.`);
  return {
    rows,
    status: response.status,
    contentRange: response.headers.get("content-range") || "unavailable",
    verifiedColumns: [...columns],
  };
}

function appRestaurantToDb(restaurant) {
  return {
    id: restaurant.id,
    name: restaurant.name,
    area: restaurant.area || "",
    address: restaurant.address || "",
    lat: Number(restaurant.lat || 0),
    lng: Number(restaurant.lng || 0),
    phone: restaurant.phone || "",
    open_time: restaurant.openTime || "",
    close_time: restaurant.closeTime || "",
    break_time: restaurant.breakTime || "",
    closed_days: restaurant.closedDays || "",
    takeout: Boolean(restaurant.takeout),
    delivery: Boolean(restaurant.delivery),
    alone: Boolean(restaurant.alone),
    group_available: Boolean(restaurant.group),
    seats: Number(restaurant.seats || 0),
    review_count: Number(restaurant.reviewCount || 0),
    source: restaurant.source || "",
    last_checked: restaurant.lastChecked || null,
    memo: restaurant.memo || "",
    active: restaurant.active !== false,
  };
}

function appMenuToDb(menu, restaurantsById) {
  const restaurant = restaurantsById.get(menu.restaurantId);
  return {
    id: menu.id,
    restaurant_id: menu.restaurantId,
    restaurant_name: restaurant?.name || menu.restaurantName || "",
    name: menu.name,
    category: menu.category || "기타",
    price: Number(menu.price || 0),
    spicy: Number(menu.spicy || 0),
    salty: Number(menu.salty || 0),
    sweet: Number(menu.sweet || 0),
    portion: Number(menu.portion || 0),
    value: Number(menu.value || 0),
    speed: Number(menu.speed || 0),
    signature: Boolean(menu.signature),
    available: menu.available !== false,
    tags: Array.isArray(menu.tags) ? [...menu.tags] : [],
    source: menu.source || "",
    last_checked: menu.lastChecked || null,
    recommend_note: menu.recommendNote || "",
  };
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  values.forEach((value) => (seen.has(value) ? duplicates.add(value) : seen.add(value)));
  return [...duplicates].sort();
}

function validatePayloads(stores, menus, candidate) {
  const storeIds = stores.map((store) => store.id);
  const menuIds = menus.map((menu) => menu.id);
  const candidateIds = candidate.map((item) => item.id);
  const storeIdSet = new Set(storeIds);
  const menuIdSet = new Set(menuIds);
  const candidateIdSet = new Set(candidateIds);
  const tasteKeys = ["spicy", "salty", "sweet", "portion", "value", "speed"];
  const missingCandidateIds = menuIds.filter((id) => !candidateIdSet.has(id));
  const extraCandidateIds = candidateIds.filter((id) => !menuIdSet.has(id));
  const invalidFoodCharacters = candidate.filter((item) => !ALLOWED_FOOD_CHARACTERS.includes(item.food_character));
  const invalidStoreIdentityIds = stores.filter((store) => !store.id || !store.name).map((store) => store.id || "(missing-id)");
  const invalidStoreCoordinateIds = stores
    .filter((store) => !Number.isFinite(store.lat) || !Number.isFinite(store.lng))
    .map((store) => store.id);
  const storeBooleanKeys = ["takeout", "delivery", "alone", "group_available", "active"];
  const invalidStoreBooleanIds = stores
    .filter((store) => storeBooleanKeys.some((key) => typeof store[key] !== "boolean"))
    .map((store) => store.id);
  const orphanMenuIds = menus.filter((menu) => !storeIdSet.has(menu.restaurant_id)).map((menu) => menu.id);
  const invalidPriceIds = menus.filter((menu) => !Number.isFinite(menu.price) || menu.price < 0).map((menu) => menu.id);
  const invalidTasteIds = menus
    .filter((menu) => tasteKeys.some((key) => !Number.isFinite(menu[key]) || menu[key] < 0 || menu[key] > 5))
    .map((menu) => menu.id);
  const invalidTagsIds = menus.filter((menu) => !Array.isArray(menu.tags)).map((menu) => menu.id);
  const invalidAvailableIds = menus.filter((menu) => typeof menu.available !== "boolean").map((menu) => menu.id);
  const result = {
    stores_count: stores.length,
    menus_count: menus.length,
    candidate_count: candidate.length,
    duplicate_store_ids: duplicateValues(storeIds),
    duplicate_menu_ids: duplicateValues(menuIds),
    duplicate_candidate_ids: duplicateValues(candidateIds),
    invalid_store_identity_ids: invalidStoreIdentityIds,
    invalid_store_coordinate_ids: invalidStoreCoordinateIds,
    invalid_store_boolean_ids: invalidStoreBooleanIds,
    missing_candidate_ids: missingCandidateIds,
    extra_candidate_ids: extraCandidateIds,
    invalid_food_character_ids: invalidFoodCharacters.map((item) => item.id),
    orphan_menu_ids: orphanMenuIds,
    invalid_price_ids: invalidPriceIds,
    invalid_taste_ids: invalidTasteIds,
    invalid_tags_ids: invalidTagsIds,
    invalid_available_ids: invalidAvailableIds,
  };
  const failures = Object.entries(result)
    .filter(([, value]) => Array.isArray(value) && value.length > 0)
    .map(([key]) => key);
  if (stores.length !== 29 || menus.length !== 100 || candidate.length !== 100 || failures.length) {
    throw new Error(`Preflight validation failed: ${failures.join(",") || "unexpected counts"}`);
  }
  return result;
}

function buildPayloads(data, candidate) {
  const stores = data.restaurants.map(appRestaurantToDb);
  const restaurantsById = new Map(stores.map((store) => [store.id, store]));
  const menus = data.menus.map((menu) => appMenuToDb(menu, restaurantsById));
  const candidateById = new Map(candidate.map((item) => [item.id, item.food_character]));
  const menusWithFoodCharacter = menus.map((menu) => ({
    ...menu,
    food_character: candidateById.get(menu.id),
  }));
  const validation = validatePayloads(stores, menus, candidate);
  const distribution = Object.fromEntries(ALLOWED_FOOD_CHARACTERS.map((value) => [value, 0]));
  menusWithFoodCharacter.forEach((menu) => { distribution[menu.food_character] += 1; });
  return { stores, menus, menusWithFoodCharacter, validation, distribution };
}

function isBlank(value) {
  return value === null || typeof value === "undefined" || value === "";
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildC001Diff(staticStore, databaseStore) {
  return RESTAURANT_COLUMNS.map((field) => {
    const staticValue = staticStore?.[field];
    const databaseValue = databaseStore?.[field];
    let classification = "same";
    let note = "Values are identical.";
    if (!valuesEqual(staticValue, databaseValue)) {
      if (isBlank(databaseValue) && !isBlank(staticValue)) {
        classification = "static-more-detailed";
        note = "Static contains a value while Supabase is blank.";
      } else if (isBlank(staticValue) && !isBlank(databaseValue)) {
        classification = "supabase-more-detailed";
        note = "Supabase contains a value while static is blank.";
      } else {
        classification = "value-conflict";
        note = "Both sources contain different values; human approval is required.";
      }
    }
    return { field, static_value: staticValue ?? null, supabase_value: databaseValue ?? null, classification, note };
  });
}

function csvEscape(value) {
  const text = Array.isArray(value) || (value && typeof value === "object")
    ? JSON.stringify(value)
    : String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function rowsToCsv(rows, columns) {
  const body = rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","));
  return `${columns.join(",")}\n${body.join("\n")}\n`;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function markdownValue(value) {
  if (value === null || typeof value === "undefined") return "`null`";
  return `\`${String(value).replaceAll("|", "\\|")}\``;
}

function buildStoreMappingMarkdown() {
  const rows = STORE_MAPPING.map(([source, target, type, transform]) => `| ${source} | ${target} | ${type} | ${transform} |`).join("\n");
  return `# Store Mapping\n\n> PREVIEW ONLY. No database write has been performed.\n\nThe application table name is \`restaurants\`; this report uses "stores" only as a domain label. All 21 target columns were accepted by an anon GET select. OpenAPI constraint metadata required service-role access and was not requested. Required/nullable, primary key, and foreign key constraints therefore remain unconfirmed. \`id\` as the conflict target and \`menus.restaurant_id\` as the relationship are application-level inferences from existing code, not catalog metadata claims.\n\n| data.js | restaurants | Type | Transform |\n| --- | --- | --- | --- |\n${rows}\n`;
}

function buildMenuMappingMarkdown() {
  const rows = MENU_MAPPING.map(([source, target, type, transform]) => `| ${source} | ${target} | ${type} | ${transform} |`).join("\n");
  return `# Menu Mapping\n\n> PREVIEW ONLY. No database write has been performed.\n\nAll 18 current target columns were accepted by an anon GET select. The table has zero rows, so value-level runtime shape cannot be sampled. Required/nullable, primary key, and foreign key constraints remain unconfirmed because OpenAPI metadata is not available to anon. \`food_character\` is intentionally absent from the current mapping and appears only in the combined preview after separate schema approval.\n\n| data.js | menus | Type | Transform |\n| --- | --- | --- | --- |\n${rows}\n`;
}

function buildC001Markdown(diff) {
  const rows = diff.map((item) => `| ${item.field} | ${markdownValue(item.static_value)} | ${markdownValue(item.supabase_value)} | ${item.classification} | ${item.note} |`).join("\n");
  const conflicts = diff.filter((item) => item.classification !== "same");
  return `# C001 Conflict Analysis\n\n> PREVIEW ONLY. No value is selected automatically.\n\n- Compared row: C001 리코리코\n- Different fields: ${conflicts.length}\n- Human approval required: ${conflicts.length > 0 ? "yes" : "no"}\n\n| Field | Static | Supabase | Classification | Note |\n| --- | --- | --- | --- | --- |\n${rows}\n`;
}

function buildSchemaPreviewSql() {
  const values = ALLOWED_FOOD_CHARACTERS.map((value) => `'${value}'`).join(", ");
  return `-- PREVIEW ONLY. DO NOT EXECUTE WITHOUT SEPARATE SCHEMA APPROVAL.\n-- Secondary Trait and food_traits are intentionally out of scope.\n\nbegin;\n\nalter table public.menus\n  add column food_character text null;\n\nalter table public.menus\n  add constraint menus_food_character_allowed\n  check (food_character is null or food_character in (${values}))\n  not valid;\n\nalter table public.menus\n  validate constraint menus_food_character_allowed;\n\ncommit;\n\n-- Nullable is intentional for rollout compatibility: existing rows and old clients remain valid\n-- while catalog migration and application consumption are approved independently.\n-- Rollback is a separate approval: drop the constraint first, then drop the column only after\n-- confirming that no deployed code reads it.\n`;
}

function buildRollbackPlan(generatedAt) {
  return `# Catalog Migration Rollback Plan\n\n> PLAN ONLY. No DELETE, UPDATE, schema change, or rollback command was executed.\n\n## Baseline\n\n- Captured at: ${generatedAt}\n- Supabase restaurants: 1 row, C001\n- Supabase menus: 0 rows\n- User app source: static 29/100\n\n## Identity and manifest\n\n- Preserve the exact C001 backup before every write approval.\n- Treat C002-C029 as proposed inserts only after rechecking the baseline.\n- Treat M001-M100 as proposed inserts only after confirming menus is still empty.\n- Abort if any target ID exists unexpectedly; do not broaden deletion criteria.\n\n## Catalog rollback sequence\n\n1. Stop and record post-write counts and failed gate; do not patch data in place.\n2. Remove only migration-owned M001-M100 rows identified by the approved manifest.\n3. Remove only migration-owned C002-C029 rows identified by the approved manifest.\n4. Restore C001 from \`backups/pre-migration-stores.json\` field-for-field.\n5. Validate restaurants=1, menus=0 and rerun orphan/inactive checks.\n6. Confirm the user app falls back to static 29/100 before declaring rollback complete.\n\n## Schema rollback\n\nThe nullable column may remain harmless while no client consumes it. Dropping the CHECK constraint or column requires separate schema approval and must occur only after confirming that no deployed code references \`food_character\`. Catalog rollback and schema rollback are independent decisions.\n`;
}

function buildPostMigrationValidationPlan() {
  return `# Post-migration Validation Plan

> PLAN ONLY. Run only after separately approved schema and catalog migrations.

## Database

- Confirm \`restaurants=29\` and \`menus=100\`.
- Confirm duplicate restaurant/menu IDs are 0.
- Confirm orphan menus are 0.
- Confirm sellable menus linked to inactive stores are 0.
- Confirm all 100 menus have one allowed \`food_character\`; null and invalid values are 0.
- Compare C001 against the approved conflict decision and pre-migration backup.

## Administrator

- Supabase source reports normal, not partial.
- User app expected source reports Supabase and source mismatch warning is cleared.
- Static 29/100 remains available as read-only recovery/reference data.
- Primary Food Character renders only after separately approved UI activation.
- Initial upload remains locked unless a later safety feature explicitly replaces it.

## User app

- Confirm the selected catalog source is Supabase only after all integrity checks pass.
- Verify recommendation returns 3 menus.
- Verify search, favorites, eaten history, sharing, reviews, world cup, roulette, and map links.
- Verify location denial still falls back to the Changwon National University main gate.
- Verify PC and 360/390/430px mobile layouts.

## Service Worker and rollback readiness

- Confirm required catalog assets and cache version respond normally.
- Do not clear user caches as part of validation.
- Keep the baseline backups and migration ID manifest until the observation window closes.
- Treat successful writes and a safe user-source switch as separate sign-offs.
`;
}

function buildPreflightReport({ generatedAt, projectUrl, current, payloads, c001Diff, tableChecks, assessment }) {
  const c001Conflicts = c001Diff.filter((item) => item.classification !== "same");
  return `# Catalog Migration Preflight Report\n\n> READ-ONLY PREFLIGHT. No Supabase write, schema change, RLS change, seed, or migration was executed.\n\n## Baseline\n\n- Generated: ${generatedAt}\n- Project URL: ${projectUrl}\n- Catalog tables: \`restaurants\`, \`menus\`\n- Related public tables used by the app: \`menu_reviews\`, \`info_reports\`\n- Anon-visible Supabase rows: restaurants ${current.restaurants.rows.length}, menus ${current.menus.rows.length}\n- Static rows: stores ${payloads.stores.length}, menus ${payloads.menus.length}\n- Current admin status: ${assessment.status}\n- Current user app expected source: ${assessment.userAppExpectedSource}\n- Source mismatch: ${assessment.sourceMismatch}\n\n## Schema observation\n\nExplicit GET selects verified ${RESTAURANT_COLUMNS.length} restaurant columns and ${MENU_COLUMNS.length} menu columns. The menus table currently has no rows, so runtime value shape cannot be sampled. The PostgREST OpenAPI endpoint rejected anon access and requested service-role credentials; those credentials were not requested or used. Required/nullable, PK, and FK constraints are therefore **unconfirmed**. Existing \`onConflict: "id"\` and relationship code are implementation evidence only.\n\n${tableChecks.map((item) => `- ${item.table}: GET ${item.status}, anon-visible rows ${item.rows.length}`).join("\n")}\n\n## Payload validation\n\n- Stores: ${payloads.validation.stores_count}, duplicate IDs ${payloads.validation.duplicate_store_ids.length}\n- Menus: ${payloads.validation.menus_count}, duplicate IDs ${payloads.validation.duplicate_menu_ids.length}\n- Missing restaurant references: ${payloads.validation.orphan_menu_ids.length}\n- Invalid price/taste/tags/available: ${payloads.validation.invalid_price_ids.length}/${payloads.validation.invalid_taste_ids.length}/${payloads.validation.invalid_tags_ids.length}/${payloads.validation.invalid_available_ids.length}\n- Food Character candidate: ${payloads.validation.candidate_count}, missing ${payloads.validation.missing_candidate_ids.length}, extra ${payloads.validation.extra_candidate_ids.length}, duplicate ${payloads.validation.duplicate_candidate_ids.length}\n- Distribution: ${ALLOWED_FOOD_CHARACTERS.map((value) => `${value} ${payloads.distribution[value]}`).join(", ")}\n\n## C001\n\nC001 has ${c001Conflicts.length} non-identical field(s). No winner is selected. See \`c001-conflict-analysis.md\`.\n\n## Migration strategy comparison\n\n| Strategy | Write steps | Partial-failure risk | Rollback | Validation | User app risk |\n| --- | --- | --- | --- | --- | --- |\n| A. Nullable schema, then bulk 29/100 with FC | Schema + 2 REST bulk writes | Stores can commit before menus fail | Medium | Good between steps | App switches when any active store and available menu coexist |\n| B. Catalog, then schema, then FC update | 2 bulk writes + schema + another 100-row write | Highest; app may switch before FC completion | Hard | Multiple intermediate states | Highest |\n| C. Nullable schema, then one server-side catalog transaction with assertions | Schema approval + one transactional catalog operation | Lowest; assertion failure rolls back catalog | Best with baseline backup | Best | Source changes only after transaction commit |\n\n**Recommendation: C.** Approve the nullable schema separately, then use a dedicated server-side transaction that asserts the 1/0 baseline, resolves C001 explicitly, writes 29/100 including Food Character, validates counts/references/allowed values, and rolls back on any failure. Do not use the current browser seed function for production migration.\n\n## Existing seed function\n\n\`seedCatalogFromStatic()\` is locked. It bulk-upserts \`restaurants\` first and \`menus\` second with \`onConflict: "id"\`. The two requests are not one transaction; a menu failure leaves restaurant changes committed. It has no preflight baseline assertion, C001 conflict decision, manifest, post-write validation, or rollback. It is insufficient for the production migration.\n\n## User source transition\n\nThe user app queries only active restaurants and available menus, then selects Supabase when both arrays are non-empty. It does not wait for 29/100 completeness.\n\n- Complete 29/100: expected Supabase source after integrity checks pass.\n- Stores succeed, menus fail and remain 0: static fallback remains, but DB is partially changed.\n- First available menu appears: the app can switch early even if the menu set is incomplete.\n- Orphan or inactive-store-linked menus: diagnostics warn, but source selection can still occur if any active store and any available menu exist.\n\nTreat "DB write success" and "safe user-source switch" as separate approval gates.\n\n## Approval gates\n\n1. Preserve current backup and hashes.\n2. Approve nullable schema preview.\n3. Approve 29/100 payload and Food Character diff.\n4. Resolve C001 fields manually.\n5. Recheck exact baseline counts and target IDs immediately before execution.\n6. Approve schema execution separately.\n7. Approve one transaction-safe catalog write separately.\n8. Validate 29/100, orphan 0, inactive-linked sellable 0, Food Character 100/100.\n9. Verify admin normal state and user app Supabase source.\n10. Confirm rollback evidence before closing the migration window.\n\n## Preflight verdict\n\nSchema/migration approval review is possible after the C001 field conflict is explicitly decided and server-side transaction payload is reviewed.\n`;
}

function buildBackupSummary({ generatedAt, projectUrl, current }) {
  return `# Pre-migration Catalog Backup\n\n- Exported at: ${generatedAt}\n- Project URL: ${projectUrl}\n- Access path: anon GET/SELECT only\n- restaurants: ${current.restaurants.rows.length}\n- menus: ${current.menus.rows.length}\n- Secret/token stored: no\n\nThe JSON backups preserve every field returned by explicit catalog SELECTs. Constraint metadata is not included because anon access cannot read the OpenAPI schema endpoint.\n`;
}

function wrapPreview({ generatedAt, purpose, source, targetTable, items, extra = {} }) {
  return {
    metadata: {
      purpose,
      generated_at: generatedAt,
      source,
      target_table: targetTable,
      database_write_performed: false,
      row_count: items.length,
      ...extra,
    },
    items,
  };
}

async function generatePreflight({
  outputDirectory = path.resolve(__dirname, "..", "docs", "catalog-migration"),
  generatedAt = new Date().toISOString(),
} = {}) {
  const data = loadFoodData();
  const candidate = loadFoodCharacterCandidate();
  const { url: projectUrl, anonKey } = readPublicSupabaseConfig();
  const payloads = buildPayloads(data, candidate);
  const [restaurants, menus, menuReviews, infoReports, adminUsers, reviewSummary, tasteSummary] = await Promise.all([
    fetchRows({ projectUrl, anonKey, table: "restaurants", columns: RESTAURANT_COLUMNS }),
    fetchRows({ projectUrl, anonKey, table: "menus", columns: MENU_COLUMNS }),
    fetchRows({ projectUrl, anonKey, table: "menu_reviews", columns: ["id"] }),
    fetchRows({ projectUrl, anonKey, table: "info_reports", columns: ["id"] }),
    fetchRows({ projectUrl, anonKey, table: "admin_users", columns: ["user_id", "role"], orderBy: "user_id" }),
    fetchRows({ projectUrl, anonKey, table: "menu_review_summary", columns: ["*"], orderBy: null }),
    fetchRows({ projectUrl, anonKey, table: "menu_taste_summary", columns: ["*"], orderBy: null }),
  ]);
  const current = { restaurants, menus };
  const tableChecks = [
    { table: "restaurants", ...restaurants },
    { table: "menus", ...menus },
    { table: "menu_reviews", ...menuReviews },
    { table: "info_reports", ...infoReports },
    { table: "admin_users", ...adminUsers },
    { table: "menu_review_summary", ...reviewSummary },
    { table: "menu_taste_summary", ...tasteSummary },
  ];
  const assessment = catalogPolicy.assessCatalogData({
    supabaseConnected: true,
    supabaseRestaurants: restaurants.rows,
    supabaseMenus: menus.rows,
    staticRestaurants: data.restaurants,
    staticMenus: data.menus,
    adminDisplayedSource: "supabase",
    refreshedAt: generatedAt,
  });
  const staticC001 = payloads.stores.find((store) => store.id === "C001");
  const databaseC001 = restaurants.rows.find((store) => store.id === "C001");
  if (!staticC001 || !databaseC001) throw new Error("C001 must exist in both static and Supabase sources.");
  const c001Diff = buildC001Diff(staticC001, databaseC001);
  const projectRef = new URL(projectUrl).hostname.split(".")[0];
  const backupMetadata = (table, result) => ({
    purpose: "Pre-migration read-only catalog backup",
    exported_at: generatedAt,
    project_url: projectUrl,
    project_ref: projectRef,
    table,
    access: "anon GET/SELECT",
    row_count: result.rows.length,
    content_range: result.contentRange,
    verified_select_columns: result.verifiedColumns,
    secret_stored: false,
  });

  const storePreview = wrapPreview({
    generatedAt,
    purpose: "Approval preview for static stores mapped to public.restaurants; not uploaded",
    source: "data.js restaurants",
    targetTable: "public.restaurants",
    items: payloads.stores,
    extra: { validation: payloads.validation },
  });
  const menuPreview = wrapPreview({
    generatedAt,
    purpose: "Approval preview for static menus mapped to public.menus; not uploaded",
    source: "data.js menus",
    targetTable: "public.menus",
    items: payloads.menus,
    extra: { validation: payloads.validation },
  });
  const combinedPreview = wrapPreview({
    generatedAt,
    purpose: "Approval preview combining catalog menus with reviewed Primary Food Character; not uploaded",
    source: "data.js menus + food-character-approved-candidate.json",
    targetTable: "public.menus after separate schema approval",
    items: payloads.menusWithFoodCharacter,
    extra: { validation: payloads.validation, distribution: payloads.distribution },
  });

  const backupDirectory = path.join(outputDirectory, "backups");
  const storesBackupFile = path.join(backupDirectory, "pre-migration-stores.json");
  const menusBackupFile = path.join(backupDirectory, "pre-migration-menus.json");
  writeJson(storesBackupFile, {
    metadata: backupMetadata("public.restaurants", restaurants),
    rows: restaurants.rows,
  });
  writeJson(menusBackupFile, {
    metadata: backupMetadata("public.menus", menus),
    rows: menus.rows,
  });
  writeJson(path.join(backupDirectory, "pre-migration-backup-manifest.json"), {
    metadata: {
      purpose: "Integrity manifest for read-only baseline backups",
      generated_at: generatedAt,
      project_url: projectUrl,
      secret_stored: false,
    },
    files: [
      { name: path.basename(storesBackupFile), row_count: restaurants.rows.length, sha256: sha256File(storesBackupFile) },
      { name: path.basename(menusBackupFile), row_count: menus.rows.length, sha256: sha256File(menusBackupFile) },
    ],
  });
  writeText(path.join(backupDirectory, "pre-migration-summary.md"), buildBackupSummary({ generatedAt, projectUrl, current }));
  writeJson(path.join(outputDirectory, "stores-preview.json"), storePreview);
  writeText(path.join(outputDirectory, "stores-preview.csv"), rowsToCsv(payloads.stores, RESTAURANT_COLUMNS));
  writeJson(path.join(outputDirectory, "menus-preview.json"), menuPreview);
  writeText(path.join(outputDirectory, "menus-preview.csv"), rowsToCsv(payloads.menus, MENU_COLUMNS));
  writeJson(path.join(outputDirectory, "menus-with-food-character-preview.json"), combinedPreview);
  writeText(
    path.join(outputDirectory, "menus-with-food-character-preview.csv"),
    rowsToCsv(payloads.menusWithFoodCharacter, [...MENU_COLUMNS, "food_character"]),
  );
  writeText(path.join(outputDirectory, "store-mapping.md"), buildStoreMappingMarkdown());
  writeText(path.join(outputDirectory, "menu-mapping.md"), buildMenuMappingMarkdown());
  writeText(path.join(outputDirectory, "c001-conflict-analysis.md"), buildC001Markdown(c001Diff));
  writeText(path.join(outputDirectory, "food-character-schema-preview.sql"), buildSchemaPreviewSql());
  writeText(path.join(outputDirectory, "rollback-plan.md"), buildRollbackPlan(generatedAt));
  writeText(path.join(outputDirectory, "post-migration-validation-plan.md"), buildPostMigrationValidationPlan());
  const preflightReport = buildPreflightReport({
    generatedAt,
    projectUrl,
    current,
    payloads,
    c001Diff,
    tableChecks,
    assessment,
  }).replace(
    "- Related public tables used by the app: `menu_reviews`, `info_reports`",
    "- Related public resources used by the app: `menu_reviews`, `info_reports`, `admin_users`, `menu_review_summary`, `menu_taste_summary`",
  ).replace(
    `- Stores: ${payloads.validation.stores_count}, duplicate IDs ${payloads.validation.duplicate_store_ids.length}`,
    `- Stores: ${payloads.validation.stores_count}, duplicate IDs ${payloads.validation.duplicate_store_ids.length}, invalid identity/coordinate/boolean ${payloads.validation.invalid_store_identity_ids.length}/${payloads.validation.invalid_store_coordinate_ids.length}/${payloads.validation.invalid_store_boolean_ids.length}`,
  );
  writeText(path.join(outputDirectory, "preflight-report.md"), preflightReport);
  writeJson(path.join(outputDirectory, "migration-id-manifest-preview.json"), {
    metadata: {
      purpose: "Identity-only rollback manifest preview; no rows have been written",
      generated_at: generatedAt,
      existing_store_ids: restaurants.rows.map((row) => row.id),
      existing_menu_ids: menus.rows.map((row) => row.id),
    },
    proposed_store_ids: payloads.stores.map((row) => row.id),
    proposed_menu_ids: payloads.menus.map((row) => row.id),
  });

  return { projectUrl, current, tableChecks, payloads, c001Diff, assessment, outputDirectory };
}

if (require.main === module) {
  generatePreflight()
    .then((result) => {
      console.log(JSON.stringify({
        output_directory: path.relative(process.cwd(), result.outputDirectory),
        supabase: {
          restaurants: result.current.restaurants.rows.length,
          menus: result.current.menus.rows.length,
        },
        preview: {
          stores: result.payloads.stores.length,
          menus: result.payloads.menus.length,
          menus_with_food_character: result.payloads.menusWithFoodCharacter.length,
          distribution: result.payloads.distribution,
        },
        catalog_status: result.assessment.status,
        user_app_expected_source: result.assessment.userAppExpectedSource,
        database_write_performed: false,
      }, null, 2));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = Object.freeze({
  ALLOWED_FOOD_CHARACTERS,
  MENU_MAPPING,
  MENU_COLUMNS,
  RESTAURANT_COLUMNS,
  STORE_MAPPING,
  appMenuToDb,
  appRestaurantToDb,
  buildC001Diff,
  buildPayloads,
  buildSchemaPreviewSql,
  fetchRows,
  generatePreflight,
  loadFoodCharacterCandidate,
  loadFoodData,
  readPublicSupabaseConfig,
  rowsToCsv,
  validatePayloads,
});
