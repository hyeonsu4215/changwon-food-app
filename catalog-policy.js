(function initCatalogPolicy(root, factory) {
  const policy = factory();
  if (root) root.CHANGWON_CATALOG_POLICY = policy;
  if (typeof module === "object" && module.exports) module.exports = policy;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCatalogPolicy() {
  function shouldUseSupabaseCatalog(restaurants, menus) {
    return Array.isArray(restaurants) && restaurants.length > 0 && Array.isArray(menus) && menus.length > 0;
  }

  function catalogArrayState(value) {
    if (Array.isArray(value)) return value.length > 0 ? "data" : "empty";
    if (value === null) return "null";
    if (typeof value === "undefined") return "undefined";
    return "invalid";
  }

  function expectedUserAppSource({ connected, restaurants, menus, staticLoaded }) {
    if (connected && shouldUseSupabaseCatalog(restaurants, menus)) return "supabase";
    return staticLoaded ? "static" : "unavailable";
  }

  function assessCatalogData({
    supabaseConnected,
    supabaseRestaurants,
    supabaseMenus,
    supabaseError = null,
    staticRestaurants,
    staticMenus,
    staticError = null,
    adminDisplayedSource = "supabase",
    refreshedAt = null,
  }) {
    const restaurantsDataState = catalogArrayState(supabaseRestaurants);
    const menusDataState = catalogArrayState(supabaseMenus);
    const responseShapeValid = Array.isArray(supabaseRestaurants) && Array.isArray(supabaseMenus);
    const databaseRestaurants = Array.isArray(supabaseRestaurants) ? supabaseRestaurants : [];
    const databaseMenus = Array.isArray(supabaseMenus) ? supabaseMenus : [];
    const referenceRestaurants = Array.isArray(staticRestaurants) ? staticRestaurants : [];
    const referenceMenus = Array.isArray(staticMenus) ? staticMenus : [];
    const staticLoaded = !staticError && Array.isArray(staticRestaurants) && Array.isArray(staticMenus);
    const activeRestaurants = databaseRestaurants.filter((restaurant) => restaurant.active === true);
    const availableMenus = databaseMenus.filter((menu) => menu.available === true);
    const restaurantIds = new Set(databaseRestaurants.map((restaurant) => restaurant.id));
    const activeRestaurantIds = new Set(activeRestaurants.map((restaurant) => restaurant.id));
    const inactiveRestaurantIds = new Set(
      databaseRestaurants.filter((restaurant) => restaurant.active !== true).map((restaurant) => restaurant.id),
    );
    const validAvailableMenus = availableMenus.filter((menu) =>
      activeRestaurantIds.has(menu.restaurant_id || menu.restaurantId),
    );
    const inactiveRestaurantMenusCount = databaseMenus.filter((menu) =>
      inactiveRestaurantIds.has(menu.restaurant_id || menu.restaurantId),
    ).length;
    const orphanMenusCount = databaseMenus.filter(
      (menu) => !restaurantIds.has(menu.restaurant_id || menu.restaurantId),
    ).length;
    const connected = Boolean(supabaseConnected) && !supabaseError;
    const userAppExpectedSource = expectedUserAppSource({
      connected,
      restaurants: activeRestaurants,
      menus: availableMenus,
      staticLoaded,
    });

    let status = "normal";
    if (!connected) {
      status = "connection-error";
    } else if (!responseShapeValid) {
      status = "data-shape-error";
    } else if (!staticLoaded) {
      status = "static-error";
    } else if (databaseRestaurants.length === 0 && databaseMenus.length === 0) {
      status = "empty";
    } else if (
      activeRestaurants.length === 0 ||
      validAvailableMenus.length === 0 ||
      inactiveRestaurantMenusCount > 0 ||
      orphanMenusCount > 0
    ) {
      status = "partial";
    }

    let displayedSource = ["supabase", "static"].includes(adminDisplayedSource) ? adminDisplayedSource : "unavailable";
    if (
      (displayedSource === "supabase" && (!connected || !responseShapeValid)) ||
      (displayedSource === "static" && !staticLoaded)
    ) {
      displayedSource = "unavailable";
    }
    const sourceMismatch = displayedSource !== userAppExpectedSource;
    const warnings = [];

    if (status === "connection-error") {
      warnings.push({ code: "connection-error", level: "danger", message: "Supabase 가게·메뉴 조회에 실패했습니다. 빈 데이터와 다른 연결 오류 상태입니다." });
    }
    if (status === "data-shape-error") {
      warnings.push({ code: "data-shape-error", level: "danger", message: "Supabase 응답 형식이 올바르지 않습니다. 빈 데이터와 다른 응답 오류 상태입니다." });
    }
    if (status === "partial") {
      warnings.push({ code: "partial-data", level: "warning", message: "Supabase 카탈로그가 부분 데이터입니다. 전체 운영 목록으로 판단하면 안 됩니다." });
    }
    if (status === "empty") {
      warnings.push({ code: "empty-data", level: "warning", message: "Supabase 가게와 메뉴가 모두 비어 있습니다." });
    }
    if (responseShapeValid && availableMenus.length > 0 && validAvailableMenus.length === 0) {
      warnings.push({ code: "no-valid-menu", level: "danger", message: "판매 가능한 메뉴가 있지만 활성 가게에 연결된 메뉴가 없습니다." });
    }
    if (inactiveRestaurantMenusCount > 0) {
      warnings.push({ code: "inactive-restaurant-menu", level: "warning", message: `비활성 가게를 참조하는 메뉴가 ${inactiveRestaurantMenusCount}개 있습니다.` });
    }
    if (orphanMenusCount > 0) {
      warnings.push({ code: "orphan-menu", level: "danger", message: `가게와 연결되지 않은 메뉴가 ${orphanMenusCount}개 있습니다.` });
    }
    if (!staticLoaded) {
      warnings.push({ code: "static-error", level: "danger", message: "정적 data.js를 읽지 못해 기준 데이터 상태를 확인할 수 없습니다." });
    }
    if (sourceMismatch) {
      warnings.push({ code: "source-mismatch", level: "danger", message: "관리자 표시 원본과 운영 사용자 앱의 예상 원본이 다릅니다. 관리자 수정 내용이 운영 앱에 반영되지 않을 수 있습니다." });
    }

    return {
      source: displayedSource,
      status,
      supabase: {
        connected,
        storesCount: databaseRestaurants.length,
        menusCount: databaseMenus.length,
        activeStoresCount: activeRestaurants.length,
        availableMenusCount: availableMenus.length,
        validAvailableMenusCount: validAvailableMenus.length,
        inactiveRestaurantMenusCount,
        orphanMenusCount,
        restaurantsDataState,
        menusDataState,
        responseShapeValid,
        error: supabaseError,
      },
      staticData: {
        loaded: staticLoaded,
        storesCount: referenceRestaurants.length,
        menusCount: referenceMenus.length,
        error: staticError,
      },
      userAppExpectedSource,
      adminDisplayedSource: displayedSource,
      sourceMismatch,
      refreshedAt,
      warnings,
    };
  }

  return Object.freeze({
    assessCatalogData,
    expectedUserAppSource,
    shouldUseSupabaseCatalog,
  });
});
