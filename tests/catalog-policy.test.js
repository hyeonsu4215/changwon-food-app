const assert = require("node:assert/strict");
const policy = require("../catalog-policy.js");

const staticRestaurants = Array.from({ length: 29 }, (_, index) => ({ id: `C${index + 1}` }));
const staticMenus = Array.from({ length: 100 }, (_, index) => ({ id: `M${index + 1}` }));

function assess(overrides = {}) {
  return policy.assessCatalogData({
    supabaseConnected: true,
    supabaseRestaurants: [],
    supabaseMenus: [],
    staticRestaurants,
    staticMenus,
    adminDisplayedSource: "supabase",
    ...overrides,
  });
}

const partial = assess({ supabaseRestaurants: [{ id: "C001", active: true }] });
assert.equal(partial.status, "partial");
assert.equal(partial.userAppExpectedSource, "static");
assert.equal(partial.sourceMismatch, true);

const empty = assess();
assert.equal(empty.status, "empty");
assert.equal(empty.userAppExpectedSource, "static");

const normal = assess({
  supabaseRestaurants: [{ id: "C001", active: true }],
  supabaseMenus: [{ id: "M001", restaurant_id: "C001", available: true }],
});
assert.equal(normal.status, "normal");
assert.equal(normal.userAppExpectedSource, "supabase");
assert.equal(normal.sourceMismatch, false);
assert.equal(normal.supabase.validAvailableMenusCount, 1);

const connectionError = assess({
  supabaseConnected: false,
  supabaseError: { message: "network unavailable" },
});
assert.equal(connectionError.status, "connection-error");
assert.equal(connectionError.userAppExpectedSource, "static");

const nullResponse = assess({ supabaseRestaurants: null, supabaseMenus: [] });
assert.equal(nullResponse.status, "data-shape-error");
assert.equal(nullResponse.supabase.restaurantsDataState, "null");
assert.equal(nullResponse.userAppExpectedSource, "static");

const undefinedResponse = assess({ supabaseRestaurants: undefined, supabaseMenus: [] });
assert.equal(undefinedResponse.status, "data-shape-error");
assert.equal(undefinedResponse.supabase.restaurantsDataState, "undefined");

const objectResponse = assess({ supabaseRestaurants: [], supabaseMenus: {} });
assert.equal(objectResponse.status, "data-shape-error");
assert.equal(objectResponse.supabase.menusDataState, "invalid");

const dataWithError = assess({
  supabaseRestaurants: [],
  supabaseMenus: [],
  supabaseError: { message: "permission denied" },
});
assert.equal(dataWithError.status, "connection-error");

const staticError = assess({
  staticRestaurants: null,
  staticMenus: null,
  staticError: { message: "data.js unavailable" },
});
assert.equal(staticError.staticData.loaded, false);
assert.equal(staticError.userAppExpectedSource, "unavailable");
assert.equal(staticError.status, "static-error");

const explicitMismatch = assess({
  supabaseRestaurants: [{ id: "C001", active: true }],
  supabaseMenus: [{ id: "M001", restaurant_id: "C001", available: true }],
  adminDisplayedSource: "static",
});
assert.equal(explicitMismatch.userAppExpectedSource, "supabase");
assert.equal(explicitMismatch.sourceMismatch, true);

const orphaned = assess({
  supabaseRestaurants: [{ id: "C001", active: true }],
  supabaseMenus: [{ id: "M001", restaurant_id: "C999", available: true }],
});
assert.equal(orphaned.status, "partial");
assert.equal(orphaned.supabase.orphanMenusCount, 1);
assert.equal(orphaned.supabase.validAvailableMenusCount, 0);

const inactiveRestaurantMenu = assess({
  supabaseRestaurants: [
    { id: "C001", active: true },
    { id: "C002", active: false },
  ],
  supabaseMenus: [{ id: "M001", restaurant_id: "C002", available: true }],
});
assert.equal(inactiveRestaurantMenu.status, "partial");
assert.equal(inactiveRestaurantMenu.userAppExpectedSource, "supabase");
assert.equal(inactiveRestaurantMenu.supabase.validAvailableMenusCount, 0);
assert.equal(inactiveRestaurantMenu.supabase.inactiveRestaurantMenusCount, 1);
assert.ok(inactiveRestaurantMenu.warnings.some((warning) => warning.code === "no-valid-menu"));

const mixedIntegrity = assess({
  supabaseRestaurants: [
    { id: "C001", active: true },
    { id: "C002", active: false },
  ],
  supabaseMenus: [
    { id: "M001", restaurant_id: "C001", available: true },
    { id: "M002", restaurant_id: "C002", available: true },
  ],
});
assert.equal(mixedIntegrity.status, "partial");
assert.equal(mixedIntegrity.supabase.validAvailableMenusCount, 1);
assert.equal(mixedIntegrity.supabase.inactiveRestaurantMenusCount, 1);

const nonTrueRestaurant = assess({
  supabaseRestaurants: [{ id: "C001", active: null }],
  supabaseMenus: [{ id: "M001", restaurant_id: "C001", available: true }],
});
assert.equal(nonTrueRestaurant.status, "partial");
assert.equal(nonTrueRestaurant.userAppExpectedSource, "static");

const nonTrueMenu = assess({
  supabaseRestaurants: [{ id: "C001", active: true }],
  supabaseMenus: [{ id: "M001", restaurant_id: "C001", available: null }],
});
assert.equal(nonTrueMenu.status, "partial");
assert.equal(nonTrueMenu.userAppExpectedSource, "static");

console.log("catalog policy scenarios: 15 passed");
