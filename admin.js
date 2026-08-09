const DATA = window.CHANGWON_FOOD_DATA;
const catalogPolicy = window.CHANGWON_CATALOG_POLICY;
const CATALOG_SEED_LOCKED = true;

function cloneStaticValue(value) {
  if (Array.isArray(value)) return value.map(cloneStaticValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, cloneStaticValue(nestedValue)]));
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function readStaticCatalog(data) {
  if (!data || !Array.isArray(data.restaurants) || !Array.isArray(data.menus)) {
    return {
      restaurants: [],
      menus: [],
      error: { message: "data.js의 가게 또는 메뉴 배열을 읽을 수 없습니다." },
    };
  }
  return {
    restaurants: deepFreeze(cloneStaticValue(data.restaurants)),
    menus: deepFreeze(cloneStaticValue(data.menus)),
    error: null,
  };
}

const staticCatalog = readStaticCatalog(DATA);

const state = {
  supabase: null,
  user: null,
  reviews: [],
  reports: [],
  restaurants: [],
  menus: [],
  staticRestaurants: staticCatalog.restaurants,
  staticMenus: staticCatalog.menus,
  staticDataError: staticCatalog.error,
  catalogConnection: { connected: false, error: null },
  catalogResponse: { restaurants: [], menus: [] },
  dataStatus: null,
  catalogSource: "supabase",
  selectedRestaurantId: null,
  selectedMenuId: null,
  reviewFilter: "all",
  reviewMode: "all",
  reviewRestaurantId: "all",
  reviewPage: 0,
  reviewPageSize: 10,
  reportFilter: "all",
  catalogMode: "restaurants",
};

const els = {
  adminStatus: document.querySelector("#adminStatus"),
  connectionBadge: document.querySelector("#connectionBadge"),
  signOutButton: document.querySelector("#signOutButton"),
  loginPanel: document.querySelector("#loginPanel"),
  loginForm: document.querySelector("#loginForm"),
  adminEmail: document.querySelector("#adminEmail"),
  adminPassword: document.querySelector("#adminPassword"),
  adminPanel: document.querySelector("#adminPanel"),
  refreshDataStatus: document.querySelector("#refreshDataStatus"),
  catalogHealthBadge: document.querySelector("#catalogHealthBadge"),
  catalogHealthTitle: document.querySelector("#catalogHealthTitle"),
  diagConnection: document.querySelector("#diagConnection"),
  diagSupabaseStores: document.querySelector("#diagSupabaseStores"),
  diagSupabaseMenus: document.querySelector("#diagSupabaseMenus"),
  diagStaticCounts: document.querySelector("#diagStaticCounts"),
  diagAdminSource: document.querySelector("#diagAdminSource"),
  diagUserSource: document.querySelector("#diagUserSource"),
  diagRefreshedAt: document.querySelector("#diagRefreshedAt"),
  diagnosticWarnings: document.querySelector("#diagnosticWarnings"),
  reviewsPanel: document.querySelector("#reviewsPanel"),
  reportsPanel: document.querySelector("#reportsPanel"),
  catalogPanel: document.querySelector("#catalogPanel"),
  reviewList: document.querySelector("#reviewList"),
  reviewPager: document.querySelector("#reviewPager"),
  reviewCount: document.querySelector("#reviewCount"),
  reviewRestaurantFilter: document.querySelector("#reviewRestaurantFilter"),
  reviewStoreField: document.querySelector("#reviewStoreField"),
  reportList: document.querySelector("#reportList"),
  catalogList: document.querySelector("#catalogList"),
  catalogCount: document.querySelector("#catalogCount"),
  catalogSourceBadge: document.querySelector("#catalogSourceBadge"),
  catalogSourceSummary: document.querySelector("#catalogSourceSummary"),
  catalogWriteWarning: document.querySelector("#catalogWriteWarning"),
  newCatalogButton: document.querySelector("#newCatalogButton"),
  restaurantEditor: document.querySelector("#restaurantEditor"),
  menuEditor: document.querySelector("#menuEditor"),
  restaurantForm: document.querySelector("#restaurantForm"),
  menuForm: document.querySelector("#menuForm"),
  seedCatalog: document.querySelector("#seedCatalog"),
  refreshCatalog: document.querySelector("#refreshCatalog"),
  refreshReviews: document.querySelector("#refreshReviews"),
  refreshReports: document.querySelector("#refreshReports"),
};

const restaurantsById = new Map();
const menusById = new Map();
const staticRestaurantsById = new Map(state.staticRestaurants.map((restaurant) => [restaurant.id, restaurant]));
const staticMenusById = new Map(state.staticMenus.map((menu) => [menu.id, menu]));

function refreshCatalogMaps() {
  restaurantsById.clear();
  state.restaurants.forEach((restaurant) => restaurantsById.set(restaurant.id, restaurant));
  menusById.clear();
  state.menus.forEach((menu) => menusById.set(menu.id, menu));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function toDateInput(value) {
  if (!value || value === "X") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function dateInputToIso(value) {
  return value ? `${value}T00:00:00` : null;
}

function sourceLabel(source) {
  return {
    supabase: "Supabase 관리 데이터",
    static: "정적 data.js · 읽기 전용",
    unavailable: "사용 불가",
  }[source] || "확인 불가";
}

function healthMeta(status) {
  return {
    normal: { label: "정상", title: "Supabase 카탈로그를 운영 앱도 사용할 것으로 예상됩니다.", className: "is-normal" },
    partial: { label: "부분 데이터", title: "데이터 불일치 주의", className: "is-warning" },
    empty: { label: "빈 데이터", title: "Supabase 카탈로그가 비어 있습니다.", className: "is-warning" },
    "static-error": { label: "정적 데이터 오류", title: "정적 기준 데이터를 읽지 못했습니다.", className: "is-danger" },
    "data-shape-error": { label: "응답 형식 오류", title: "Supabase 응답 형식이 올바르지 않습니다.", className: "is-danger" },
    "policy-load-error": { label: "정책 로드 오류", title: "데이터 판정 정책 파일 로드 오류", className: "is-danger" },
    "connection-error": { label: "연결 오류", title: "Supabase 카탈로그를 조회하지 못했습니다.", className: "is-danger" },
  }[status] || { label: "확인 불가", title: "데이터 상태를 확인할 수 없습니다.", className: "is-idle" };
}

function formatRefreshTime(value) {
  if (!value) return "아직 새로고침하지 않음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "확인 불가";
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function updateDataStatus(refreshedAt = state.dataStatus?.refreshedAt || null) {
  if (!catalogPolicy?.assessCatalogData) {
    state.dataStatus = {
      source: "unavailable",
      status: "policy-load-error",
      supabase: {
        connected: state.catalogConnection.connected,
        storesCount: state.restaurants.length,
        menusCount: state.menus.length,
        activeStoresCount: state.restaurants.filter((restaurant) => restaurant.active === true).length,
        availableMenusCount: state.menus.filter((menu) => menu.available === true).length,
        validAvailableMenusCount: 0,
        inactiveRestaurantMenusCount: 0,
        orphanMenusCount: 0,
        responseShapeValid: false,
        error: null,
      },
      staticData: {
        loaded: !state.staticDataError,
        storesCount: state.staticRestaurants.length,
        menusCount: state.staticMenus.length,
        error: state.staticDataError,
      },
      userAppExpectedSource: "unavailable",
      adminDisplayedSource: "unavailable",
      sourceMismatch: false,
      refreshedAt,
      warnings: [{ code: "policy-load-error", level: "danger", message: "데이터 판정 정책 파일 로드 오류가 발생했습니다. 카탈로그 편집을 사용할 수 없습니다." }],
    };
    renderDataStatus();
    return;
  }
  state.dataStatus = catalogPolicy.assessCatalogData({
    supabaseConnected: state.catalogConnection.connected,
    supabaseRestaurants: state.catalogResponse.restaurants,
    supabaseMenus: state.catalogResponse.menus,
    supabaseError: state.catalogConnection.error,
    staticRestaurants: state.staticRestaurants,
    staticMenus: state.staticMenus,
    staticError: state.staticDataError,
    adminDisplayedSource: state.catalogSource,
    refreshedAt,
  });
  renderDataStatus();
}

function renderDataStatus() {
  const status = state.dataStatus;
  if (!status) return;
  const health = healthMeta(status.status);
  const responseError = status.status === "data-shape-error";
  const policyError = status.status === "policy-load-error";
  els.catalogHealthBadge.textContent = health.label;
  els.catalogHealthBadge.className = `health-badge ${health.className}`;
  els.catalogHealthTitle.textContent = health.title;
  els.diagConnection.textContent = policyError
    ? "정책 파일 로드 오류"
    : responseError
      ? "연결됨 · 응답 형식 오류"
      : status.supabase.connected
        ? "연결됨"
        : "연결 오류";
  els.diagSupabaseStores.textContent = `${status.supabase.storesCount}곳 (운영 표시 ${status.supabase.activeStoresCount}곳)`;
  els.diagSupabaseMenus.textContent = `${status.supabase.menusCount}개 (판매중 ${status.supabase.availableMenusCount}개)`;
  els.diagStaticCounts.textContent = status.staticData.loaded
    ? `가게 ${status.staticData.storesCount}곳 · 메뉴 ${status.staticData.menusCount}개`
    : "읽기 오류";
  els.diagAdminSource.textContent = sourceLabel(status.adminDisplayedSource);
  els.diagUserSource.textContent = sourceLabel(status.userAppExpectedSource);
  els.diagRefreshedAt.textContent = formatRefreshTime(status.refreshedAt);
  els.connectionBadge.textContent = policyError
    ? "판정 정책 오류"
    : responseError
      ? "Supabase 응답 오류"
      : status.supabase.connected
        ? "Supabase 연결됨"
        : "Supabase 연결 오류";
  els.connectionBadge.className = `connection-badge ${status.supabase.connected && !responseError && !policyError ? "is-connected" : "is-error"}`;
  els.diagnosticWarnings.innerHTML = status.warnings.length
    ? status.warnings
        .map((warning) => `<p class="diagnostic-warning ${warning.level}">${escapeHtml(warning.message)}</p>`)
        .join("")
    : `<p class="diagnostic-ok">가게·메뉴 원본과 기본 참조 관계가 정상입니다.</p>`;
}

function currentCatalogData() {
  if (state.catalogSource === "static") {
    return {
      restaurants: state.staticRestaurants,
      menus: state.staticMenus,
      restaurantsById: staticRestaurantsById,
      editable: false,
    };
  }
  return {
    restaurants: state.restaurants,
    menus: state.menus,
    restaurantsById,
    editable: Boolean(
      state.dataStatus?.supabase.connected &&
      !["connection-error", "data-shape-error", "policy-load-error"].includes(state.dataStatus.status),
    ),
  };
}

function dbRestaurantToApp(row) {
  return {
    id: row.id,
    name: row.name || "",
    area: row.area || "",
    address: row.address || "",
    lat: Number(row.lat || 0),
    lng: Number(row.lng || 0),
    phone: row.phone || "",
    openTime: row.open_time || "",
    closeTime: row.close_time || "",
    breakTime: row.break_time || "",
    closedDays: row.closed_days || "",
    takeout: Boolean(row.takeout),
    delivery: Boolean(row.delivery),
    alone: Boolean(row.alone),
    group: Boolean(row.group_available),
    seats: Number(row.seats || 0),
    reviewCount: Number(row.review_count || 0),
    source: row.source || "",
    lastChecked: row.last_checked || "",
    memo: row.memo || "",
    active: row.active !== false,
  };
}

function dbMenuToApp(row) {
  const restaurant = restaurantsById.get(row.restaurant_id);
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurant_name || restaurant?.name || "",
    name: row.name || "",
    category: row.category || "기타",
    price: Number(row.price || 0),
    spicy: Number(row.spicy || 0),
    salty: Number(row.salty || 0),
    sweet: Number(row.sweet || 0),
    portion: Number(row.portion || 0),
    value: Number(row.value || 0),
    speed: Number(row.speed || 0),
    signature: Boolean(row.signature),
    available: Boolean(row.available),
    tags: Array.isArray(row.tags) ? row.tags : [],
    source: row.source || "",
    lastChecked: row.last_checked || "",
    recommendNote: row.recommend_note || "",
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

function appMenuToDb(menu) {
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
    tags: Array.isArray(menu.tags) ? menu.tags : [],
    source: menu.source || "",
    last_checked: menu.lastChecked || null,
    recommend_note: menu.recommendNote || "",
  };
}

function nextId(prefix, rows) {
  const max = rows.reduce((value, row) => {
    const number = Number(String(row.id || "").replace(prefix, ""));
    return Number.isFinite(number) ? Math.max(value, number) : value;
  }, 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

function menuLabel(menuId) {
  const menu = menusById.get(menuId);
  const restaurant = menu ? restaurantsById.get(menu.restaurantId) : null;
  if (!menu) {
    const staticMenu = staticMenusById.get(menuId);
    const staticRestaurant = staticMenu ? staticRestaurantsById.get(staticMenu.restaurantId) : null;
    if (staticMenu) return `${staticRestaurant?.name || staticMenu.restaurantName} · ${staticMenu.name} (정적 기준)`;
    return menuId || "메뉴 없음";
  }
  return `${restaurant?.name || menu.restaurantName} · ${menu.name}`;
}

function reviewRestaurantId(review) {
  if (review.restaurant_id) return review.restaurant_id;
  const menu = menusById.get(review.menu_id);
  return menu?.restaurantId || staticMenusById.get(review.menu_id)?.restaurantId || "";
}

function reviewRestaurantName(review) {
  const id = reviewRestaurantId(review);
  return restaurantsById.get(id)?.name || (staticRestaurantsById.get(id)?.name ? `${staticRestaurantsById.get(id).name} (정적 기준)` : "가게 정보 없음");
}

function renderRestaurantFilterOptions() {
  if (!els.reviewRestaurantFilter) return;
  const supabaseIds = new Set(state.restaurants.map((restaurant) => restaurant.id));
  const supabaseOptions = state.restaurants
    .map((restaurant) => `<option value="${restaurant.id}">${escapeHtml(restaurant.name)}</option>`)
    .join("");
  const staticOptions = state.staticRestaurants
    .filter((restaurant) => !supabaseIds.has(restaurant.id))
    .map((restaurant) => `<option value="${restaurant.id}">${escapeHtml(restaurant.name)} (정적 기준)</option>`)
    .join("");
  els.reviewRestaurantFilter.innerHTML = `<option value="all">전체 가게</option>${supabaseOptions}${staticOptions}`;
  const menuSelect = els.menuForm?.elements.restaurantId;
  if (menuSelect) {
    menuSelect.innerHTML = supabaseOptions;
  }
}

async function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function initSupabase() {
  const config = window.CHANGWON_SUPABASE_CONFIG;
  if (!config?.enabled || !config.url || !config.anonKey) {
    els.adminStatus.textContent = "Supabase 설정이 없습니다.";
    state.catalogConnection = { connected: false, error: { message: "Supabase 설정이 없습니다." } };
    updateDataStatus();
    return false;
  }
  if (!window.supabase?.createClient) {
    await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2").catch(() => null);
  }
  if (!window.supabase?.createClient) {
    els.adminStatus.textContent = "Supabase 라이브러리를 불러오지 못했습니다.";
    state.catalogConnection = { connected: false, error: { message: "Supabase 라이브러리 로딩 실패" } };
    updateDataStatus();
    return false;
  }
  state.supabase = window.supabase.createClient(config.url, config.anonKey);
  const session = await state.supabase.auth.getSession();
  state.user = session.data.session?.user || null;
  if (state.user) await enterAdmin();
  return true;
}

async function isAdminUser() {
  if (!state.user) return false;
  const { data, error } = await state.supabase.from("admin_users").select("role").eq("user_id", state.user.id).maybeSingle();
  if (error) {
    console.warn("admin check failed", error);
    return false;
  }
  return Boolean(data);
}

async function enterAdmin() {
  const allowed = await isAdminUser();
  if (!allowed) {
    els.adminStatus.textContent = "관리자 권한이 없는 계정입니다.";
    els.loginPanel.hidden = false;
    els.adminPanel.hidden = true;
    els.signOutButton.hidden = false;
    return;
  }
  els.adminStatus.textContent = `${state.user.email || "관리자"} 로그인 중`;
  els.loginPanel.hidden = true;
  els.adminPanel.hidden = false;
  els.signOutButton.hidden = false;
  await loadCatalog();
  await Promise.all([loadReviews(), loadReports()]);
}

async function handleLogin(event) {
  event.preventDefault();
  els.adminStatus.textContent = "로그인 중...";
  const { data, error } = await state.supabase.auth.signInWithPassword({
    email: els.adminEmail.value.trim(),
    password: els.adminPassword.value,
  });
  if (error) {
    els.adminStatus.textContent = error.message || "로그인에 실패했습니다.";
    return;
  }
  state.user = data.user;
  await enterAdmin();
}

async function signOut() {
  await state.supabase.auth.signOut();
  state.user = null;
  state.reviews = [];
  state.reports = [];
  els.adminStatus.textContent = "로그인이 필요합니다.";
  els.loginPanel.hidden = false;
  els.adminPanel.hidden = true;
  els.signOutButton.hidden = true;
}

async function loadCatalog() {
  if (!els.catalogList) return;
  els.catalogList.innerHTML = `<div class="empty">Supabase 가게·메뉴 데이터를 불러오는 중...</div>`;
  let restaurantResult;
  let menuResult;
  try {
    [restaurantResult, menuResult] = await Promise.all([
      state.supabase.from("restaurants").select("*").order("name", { ascending: true }),
      state.supabase.from("menus").select("*").order("name", { ascending: true }),
    ]);
  } catch (error) {
    console.warn("catalog load failed", error);
    restaurantResult = { data: null, error };
    menuResult = { data: null, error };
  }

  state.catalogResponse = {
    restaurants: restaurantResult?.data,
    menus: menuResult?.data,
  };
  const catalogError = restaurantResult?.error || menuResult?.error;
  if (catalogError) {
    state.restaurants = [];
    state.menus = [];
    state.catalogConnection = { connected: false, error: catalogError };
    refreshCatalogMaps();
    renderRestaurantFilterOptions();
    updateDataStatus(new Date().toISOString());
    renderCatalog();
    return;
  }

  state.restaurants = Array.isArray(restaurantResult?.data) ? restaurantResult.data.map(dbRestaurantToApp) : [];
  refreshCatalogMaps();
  state.menus = Array.isArray(menuResult?.data) ? menuResult.data.map(dbMenuToApp) : [];
  state.catalogConnection = { connected: true, error: null };
  refreshCatalogMaps();
  renderRestaurantFilterOptions();
  clearRestaurantForm();
  clearMenuForm();
  updateDataStatus(new Date().toISOString());
  renderCatalog();
}

async function seedCatalogFromStatic() {
  if (CATALOG_SEED_LOCKED) {
    alert("초기 업로드는 안전 기능이 준비될 때까지 잠겨 있습니다.");
    return false;
  }
  if (!confirm("현재 data.js의 가게/메뉴를 Supabase에 업로드할까요? 같은 ID는 덮어씁니다.")) return;
  els.catalogList.innerHTML = `<div class="empty">초기 데이터를 업로드하는 중...</div>`;
  state.restaurants = [...DATA.restaurants].map((restaurant) => ({ ...restaurant, active: true }));
  state.menus = [...DATA.menus];
  refreshCatalogMaps();
  const restaurantRows = state.restaurants.map(appRestaurantToDb);
  const menuRows = state.menus.map(appMenuToDb);
  const restaurantResult = await state.supabase.from("restaurants").upsert(restaurantRows, { onConflict: "id" });
  if (restaurantResult.error) {
    alert(restaurantResult.error.message || "가게 업로드에 실패했습니다.");
    renderCatalog();
    return;
  }
  const menuResult = await state.supabase.from("menus").upsert(menuRows, { onConflict: "id" });
  if (menuResult.error) {
    alert(menuResult.error.message || "메뉴 업로드에 실패했습니다.");
    renderCatalog();
    return;
  }
  await loadCatalog();
  alert("초기 가게/메뉴 데이터 업로드 완료!");
}

async function loadReviews() {
  els.reviewList.innerHTML = `<div class="empty">후기를 불러오는 중...</div>`;
  const { data, error } = await state.supabase
    .from("menu_reviews")
    .select("id,user_id,menu_id,restaurant_id,nickname,rating,hygiene,kindness,review_text,status,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) {
    els.reviewList.innerHTML = `<div class="empty">후기 로딩 실패: ${escapeHtml(error.message)}</div>`;
    return;
  }
  state.reviews = data || [];
  state.reviewPage = 0;
  renderReviews();
}

function renderReviews() {
  let rows = state.reviews.filter((review) => state.reviewFilter === "all" || review.status === state.reviewFilter);
  if (state.reviewMode === "store" && state.reviewRestaurantId !== "all") {
    rows = rows.filter((review) => reviewRestaurantId(review) === state.reviewRestaurantId);
  }
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / state.reviewPageSize));
  state.reviewPage = Math.min(state.reviewPage, totalPages - 1);
  const start = state.reviewPage * state.reviewPageSize;
  const pageRows = rows.slice(start, start + state.reviewPageSize);

  els.reviewStoreField.hidden = state.reviewMode !== "store";
  els.reviewCount.textContent =
    state.reviewMode === "store"
      ? `가게별 보기 · ${total}개 중 ${total ? `${start + 1}-${Math.min(start + state.reviewPageSize, total)}` : "0"}개 표시`
      : `전체 리뷰 · ${total}개 중 ${total ? `${start + 1}-${Math.min(start + state.reviewPageSize, total)}` : "0"}개 표시`;

  els.reviewList.innerHTML = pageRows.length
    ? pageRows
        .map(
          (review) => `
            <article class="admin-row">
              <div class="row-top">
                <strong>${escapeHtml(menuLabel(review.menu_id))}</strong>
                <span class="badge ${review.status}">${review.status === "visible" ? "공개" : "숨김"}</span>
              </div>
              <div class="meta">
                ${escapeHtml(reviewRestaurantName(review))} · ${escapeHtml(review.nickname || "익명")} · 별점 ${review.rating} · 위생 ${review.hygiene} · 친절 ${review.kindness} · ${formatDate(review.created_at)}
              </div>
              <p class="message">${escapeHtml(review.review_text || "내용 없음")}</p>
              <div class="row-actions">
                ${
                  review.status === "visible"
                    ? `<button class="danger" data-review-status="${review.id}" data-status="hidden">숨김 처리</button>`
                    : `<button data-review-status="${review.id}" data-status="visible">공개 복구</button>`
                }
              </div>
            </article>
          `,
        )
        .join("")
    : `<div class="empty">표시할 후기가 없습니다.</div>`;

  els.reviewPager.innerHTML =
    totalPages > 1
      ? `
        <button ${state.reviewPage === 0 ? "disabled" : ""} data-review-page="prev">이전</button>
        <span>${state.reviewPage + 1} / ${totalPages}</span>
        <button ${state.reviewPage >= totalPages - 1 ? "disabled" : ""} data-review-page="next">다음</button>
      `
      : "";
}

async function updateReviewStatus(id, status) {
  const { error } = await state.supabase.from("menu_reviews").update({ status }).eq("id", id);
  if (error) {
    alert(error.message || "후기 상태 변경에 실패했습니다.");
    return;
  }
  state.reviews = state.reviews.map((review) => (review.id === id ? { ...review, status } : review));
  renderReviews();
}

async function loadReports() {
  els.reportList.innerHTML = `<div class="empty">제보를 불러오는 중...</div>`;
  const { data, error } = await state.supabase
    .from("info_reports")
    .select("id,user_id,report_type,target_type,target_id,target_label,reporter,message,status,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) {
    els.reportList.innerHTML = `<div class="empty">제보 로딩 실패: ${escapeHtml(error.message)}</div>`;
    return;
  }
  state.reports = data || [];
  renderReports();
}

function reportTypeLabel(type) {
  return {
    wrong_info: "잘못된 정보",
    price_update: "가격 변경",
    new_menu: "메뉴 추가",
    new_store: "가게 추가",
    closed_store: "폐업/영업 종료",
    other: "기타",
  }[type] || type;
}

function statusLabel(status) {
  return {
    pending: "대기",
    checking: "확인중",
    done: "반영완료",
    rejected: "보류",
  }[status] || status;
}

function renderReports() {
  const rows = state.reports.filter((report) => state.reportFilter === "all" || report.status === state.reportFilter);
  els.reportList.innerHTML = rows.length
    ? rows
        .map(
          (report) => `
            <article class="admin-row">
              <div class="row-top">
                <strong>${escapeHtml(report.target_label || report.target_id || "전체 데이터")}</strong>
                <span class="badge ${report.status}">${statusLabel(report.status)}</span>
              </div>
              <div class="meta">
                ${reportTypeLabel(report.report_type)} · ${escapeHtml(report.reporter || "익명")} · ${formatDate(report.created_at)}
              </div>
              <p class="message">${escapeHtml(report.message)}</p>
              <div class="row-actions">
                <button class="${report.status === "pending" ? "is-active" : ""}" data-report-status="${report.id}" data-status="pending">대기</button>
                <button class="${report.status === "checking" ? "is-active" : ""}" data-report-status="${report.id}" data-status="checking">확인중</button>
                <button class="${report.status === "done" ? "is-active" : ""}" data-report-status="${report.id}" data-status="done">반영완료</button>
                <button class="danger ${report.status === "rejected" ? "is-active" : ""}" data-report-status="${report.id}" data-status="rejected">보류</button>
              </div>
            </article>
          `,
        )
        .join("")
    : `<div class="empty">표시할 제보가 없습니다.</div>`;
}

async function updateReportStatus(id, status) {
  const { error } = await state.supabase.from("info_reports").update({ status }).eq("id", id);
  if (error) {
    alert(error.message || "제보 상태 변경에 실패했습니다.");
    return;
  }
  state.reports = state.reports.map((report) => (report.id === id ? { ...report, status } : report));
  renderReports();
}

function renderCatalog() {
  if (!els.catalogList) return;
  updateDataStatus();
  const catalog = currentCatalogData();
  const isRestaurantMode = state.catalogMode === "restaurants";
  els.restaurantEditor.hidden = !catalog.editable || !isRestaurantMode;
  els.menuEditor.hidden = !catalog.editable || isRestaurantMode;
  els.newCatalogButton.disabled = !catalog.editable;
  els.catalogCount.textContent = isRestaurantMode ? `가게 ${catalog.restaurants.length}곳` : `메뉴 ${catalog.menus.length}개`;
  els.catalogSourceBadge.textContent = state.catalogSource === "static" ? "정적 기준 · 읽기 전용" : "SUPABASE";
  els.catalogSourceBadge.className = `source-badge ${state.catalogSource}`;
  els.catalogSourceSummary.textContent = catalogSourceSummary(catalog, isRestaurantMode);
  renderCatalogWriteWarning(catalog);
  document.querySelectorAll("[data-catalog-source]").forEach((button) => {
    const selected = button.dataset.catalogSource === state.catalogSource;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  els.catalogList.innerHTML = isRestaurantMode
    ? renderRestaurantRows(catalog.restaurants, catalog.editable)
    : renderMenuRows(catalog.menus, catalog.restaurantsById, catalog.editable);
}

function catalogSourceSummary(catalog, isRestaurantMode) {
  const count = isRestaurantMode ? catalog.restaurants.length : catalog.menus.length;
  const unit = isRestaurantMode ? "곳" : "개";
  if (state.catalogSource === "static") {
    return state.staticDataError
      ? "정적 data.js를 읽지 못했습니다."
      : `정적 기준 데이터 ${count}${unit} · 편집할 수 없습니다.`;
  }
  if (state.dataStatus?.status === "policy-load-error") return "데이터 판정 정책 파일 로드 오류 · 편집할 수 없습니다.";
  if (state.dataStatus?.status === "data-shape-error") return "Supabase 응답 형식 오류 · 빈 데이터로 처리하지 않았습니다.";
  if (!state.dataStatus?.supabase.connected) return "Supabase 조회 실패 · 정적 데이터로 자동 대체하지 않았습니다.";
  if (state.dataStatus.status === "partial") return `Supabase에 저장된 준비 데이터 ${count}${unit} · 전체 운영 목록이 아닐 수 있습니다.`;
  if (state.dataStatus.status === "empty") return `Supabase에 저장된 데이터 0${unit}`;
  return `Supabase 운영 데이터 ${count}${unit}`;
}

function renderCatalogWriteWarning(catalog) {
  let message = "";
  if (!catalog.editable && state.catalogSource === "static") {
    message = "정적 data.js는 기준 확인용 읽기 전용 데이터입니다. 이 목록에서는 추가, 수정, 삭제할 수 없습니다.";
  } else if (state.dataStatus?.status === "policy-load-error") {
    message = "데이터 판정 정책 파일 로드 오류가 발생해 카탈로그 편집을 잠갔습니다.";
  } else if (state.dataStatus?.status === "data-shape-error") {
    message = "Supabase 응답 형식이 올바르지 않아 카탈로그 편집을 잠갔습니다.";
  } else if (!catalog.editable) {
    message = "Supabase 조회에 실패해 편집 기능을 사용할 수 없습니다. 연결 상태를 먼저 확인하세요.";
  } else if (state.dataStatus?.userAppExpectedSource !== "supabase") {
    message = "현재 운영 사용자 앱은 정적 data.js를 사용할 것으로 예상됩니다. 여기서 저장한 변경이 운영 앱에 반영되지 않을 수 있습니다.";
  }
  els.catalogWriteWarning.hidden = !message;
  els.catalogWriteWarning.textContent = message;
}

function catalogEmptyMessage() {
  if (state.catalogSource === "static" && state.staticDataError) return "정적 data.js를 읽지 못했습니다.";
  if (state.catalogSource === "supabase" && state.dataStatus?.status === "policy-load-error") {
    return "데이터 판정 정책 파일 로드 오류로 Supabase 목록을 사용할 수 없습니다.";
  }
  if (state.catalogSource === "supabase" && state.dataStatus?.status === "data-shape-error") {
    return "Supabase 응답 형식 오류입니다. 빈 데이터와 구분해 편집을 차단했습니다.";
  }
  if (state.catalogSource === "supabase" && !state.dataStatus?.supabase.connected) {
    return "Supabase 조회에 실패했습니다. 정적 데이터로 자동 대체하지 않았습니다.";
  }
  if (state.catalogSource === "supabase" && state.dataStatus?.status === "partial") {
    return "이 원본에는 해당 데이터가 없습니다. 정적 기준 데이터는 위 원본 전환에서 별도로 확인하세요.";
  }
  return "등록된 데이터가 없습니다.";
}

function renderRestaurantRows(restaurants, editable) {
  return restaurants.length
    ? restaurants
        .map(
          (restaurant) => `
            <article class="admin-row catalog-row">
              <div class="row-top">
                <strong>${escapeHtml(restaurant.name)}</strong>
                <div class="badge-group">
                  <span class="source-badge ${state.catalogSource}">${state.catalogSource === "static" ? "정적 기준" : "SUPABASE"}</span>
                  <span class="badge ${restaurant.active === false ? "hidden" : "visible"}">${restaurant.active === false ? "숨김" : "표시"}</span>
                </div>
              </div>
              <div class="meta">${escapeHtml(restaurant.id)} · ${escapeHtml(restaurant.address || "주소 없음")} · ${restaurant.openTime || "-"}-${restaurant.closeTime || "-"}</div>
              <p class="message">포장 ${restaurant.takeout ? "O" : "X"} · 배달 ${restaurant.delivery ? "O" : "X"} · 혼밥 ${restaurant.alone ? "O" : "X"} · 좌석 ${restaurant.seats || 0}</p>
              ${editable ? `<div class="row-actions"><button data-edit-restaurant="${restaurant.id}">수정</button><button class="danger" data-delete-restaurant="${restaurant.id}">삭제</button></div>` : ""}
            </article>
          `,
        )
        .join("")
    : `<div class="empty">${catalogEmptyMessage()}</div>`;
}

function renderMenuRows(menus, restaurantMap, editable) {
  return menus.length
    ? menus
        .map(
          (menu) => `
            <article class="admin-row catalog-row">
              <div class="row-top">
                <strong>${escapeHtml(menu.name)}</strong>
                <div class="badge-group">
                  <span class="source-badge ${state.catalogSource}">${state.catalogSource === "static" ? "정적 기준" : "SUPABASE"}</span>
                  <span class="badge ${menu.available === false ? "hidden" : "visible"}">${menu.available === false ? "중지" : "판매중"}</span>
                </div>
              </div>
              <div class="meta">${escapeHtml(menu.id)} · ${escapeHtml(restaurantMap.get(menu.restaurantId)?.name || menu.restaurantName || "가게 없음")} · ${escapeHtml(menu.category)} · ${Number(menu.price || 0).toLocaleString("ko-KR")}원</div>
              <p class="message">맵기 ${menu.spicy} · 짠맛 ${menu.salty} · 단맛 ${menu.sweet} · ${escapeHtml((menu.tags || []).join(", "))}</p>
              ${editable ? `<div class="row-actions"><button data-edit-menu="${menu.id}">수정</button><button class="danger" data-delete-menu="${menu.id}">삭제</button></div>` : ""}
            </article>
          `,
        )
        .join("")
    : `<div class="empty">${catalogEmptyMessage()}</div>`;
}

function clearRestaurantForm() {
  if (!els.restaurantForm) return;
  state.selectedRestaurantId = null;
  els.restaurantForm.reset();
  els.restaurantForm.elements.id.value = nextId("C", state.restaurants);
  els.restaurantForm.elements.area.value = "정문";
  els.restaurantForm.elements.takeout.checked = true;
  els.restaurantForm.elements.delivery.checked = false;
  els.restaurantForm.elements.alone.checked = true;
  els.restaurantForm.elements.group.checked = true;
  els.restaurantForm.elements.active.checked = true;
}

function clearMenuForm() {
  if (!els.menuForm) return;
  state.selectedMenuId = null;
  els.menuForm.reset();
  els.menuForm.elements.id.value = nextId("M", state.menus);
  els.menuForm.elements.price.value = 0;
  els.menuForm.elements.spicy.value = 2;
  els.menuForm.elements.salty.value = 3;
  els.menuForm.elements.sweet.value = 2;
  els.menuForm.elements.portion.value = 3;
  els.menuForm.elements.value.value = 3;
  els.menuForm.elements.speed.value = 3;
  els.menuForm.elements.signature.checked = true;
  els.menuForm.elements.available.checked = true;
}

function editRestaurant(id) {
  const restaurant = state.restaurants.find((item) => item.id === id);
  if (!restaurant) return;
  state.selectedRestaurantId = id;
  const form = els.restaurantForm.elements;
  form.id.value = restaurant.id;
  form.name.value = restaurant.name || "";
  form.area.value = restaurant.area || "";
  form.address.value = restaurant.address || "";
  form.lat.value = restaurant.lat || "";
  form.lng.value = restaurant.lng || "";
  form.phone.value = restaurant.phone || "";
  form.openTime.value = restaurant.openTime || "";
  form.closeTime.value = restaurant.closeTime || "";
  form.breakTime.value = restaurant.breakTime || "";
  form.closedDays.value = restaurant.closedDays || "";
  form.seats.value = restaurant.seats || 0;
  form.reviewCount.value = restaurant.reviewCount || 0;
  form.source.value = restaurant.source || "";
  form.lastChecked.value = toDateInput(restaurant.lastChecked);
  form.memo.value = restaurant.memo || "";
  form.takeout.checked = Boolean(restaurant.takeout);
  form.delivery.checked = Boolean(restaurant.delivery);
  form.alone.checked = Boolean(restaurant.alone);
  form.group.checked = Boolean(restaurant.group);
  form.active.checked = restaurant.active !== false;
  els.restaurantEditor.scrollIntoView({ behavior: "smooth", block: "start" });
}

function editMenu(id) {
  const menu = state.menus.find((item) => item.id === id);
  if (!menu) return;
  state.selectedMenuId = id;
  const form = els.menuForm.elements;
  form.id.value = menu.id;
  form.restaurantId.value = menu.restaurantId;
  form.name.value = menu.name || "";
  form.category.value = menu.category || "";
  form.price.value = menu.price || 0;
  form.spicy.value = menu.spicy || 0;
  form.salty.value = menu.salty || 0;
  form.sweet.value = menu.sweet || 0;
  form.portion.value = menu.portion || 0;
  form.value.value = menu.value || 0;
  form.speed.value = menu.speed || 0;
  form.tags.value = (menu.tags || []).join(", ");
  form.source.value = menu.source || "";
  form.lastChecked.value = toDateInput(menu.lastChecked);
  form.recommendNote.value = menu.recommendNote || "";
  form.signature.checked = Boolean(menu.signature);
  form.available.checked = menu.available !== false;
  els.menuEditor.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetCatalogEditingState() {
  state.selectedRestaurantId = null;
  state.selectedMenuId = null;
  clearRestaurantForm();
  clearMenuForm();
}

function switchCatalogSource(nextSource) {
  if (!["supabase", "static"].includes(nextSource) || nextSource === state.catalogSource) return false;
  state.catalogSource = nextSource;
  resetCatalogEditingState();
  renderCatalog();
  return true;
}

function canEditSupabaseCatalog() {
  return state.catalogSource === "supabase" && currentCatalogData().editable;
}

async function saveRestaurant(event) {
  event.preventDefault();
  if (!canEditSupabaseCatalog()) {
    alert("현재 데이터 원본은 편집할 수 없습니다.");
    return;
  }
  const form = els.restaurantForm.elements;
  const restaurant = {
    id: form.id.value.trim(),
    name: form.name.value.trim(),
    area: form.area.value.trim(),
    address: form.address.value.trim(),
    lat: Number(form.lat.value || 0),
    lng: Number(form.lng.value || 0),
    phone: form.phone.value.trim(),
    openTime: form.openTime.value.trim(),
    closeTime: form.closeTime.value.trim(),
    breakTime: form.breakTime.value.trim(),
    closedDays: form.closedDays.value.trim(),
    seats: Number(form.seats.value || 0),
    reviewCount: Number(form.reviewCount.value || 0),
    source: form.source.value.trim(),
    lastChecked: dateInputToIso(form.lastChecked.value),
    memo: form.memo.value.trim(),
    takeout: form.takeout.checked,
    delivery: form.delivery.checked,
    alone: form.alone.checked,
    group: form.group.checked,
    active: form.active.checked,
  };
  const { error } = await state.supabase.from("restaurants").upsert(appRestaurantToDb(restaurant), { onConflict: "id" });
  if (error) {
    alert(error.message || "가게 저장에 실패했습니다.");
    return;
  }
  await loadCatalog();
  alert("가게 저장 완료!");
}

async function saveMenu(event) {
  event.preventDefault();
  if (!canEditSupabaseCatalog()) {
    alert("현재 데이터 원본은 편집할 수 없습니다.");
    return;
  }
  const form = els.menuForm.elements;
  const restaurant = restaurantsById.get(form.restaurantId.value);
  const menu = {
    id: form.id.value.trim(),
    restaurantId: form.restaurantId.value,
    restaurantName: restaurant?.name || "",
    name: form.name.value.trim(),
    category: form.category.value.trim(),
    price: Number(form.price.value || 0),
    spicy: Number(form.spicy.value || 0),
    salty: Number(form.salty.value || 0),
    sweet: Number(form.sweet.value || 0),
    portion: Number(form.portion.value || 0),
    value: Number(form.value.value || 0),
    speed: Number(form.speed.value || 0),
    signature: form.signature.checked,
    available: form.available.checked,
    tags: form.tags.value.split(",").map((tag) => tag.trim()).filter(Boolean),
    source: form.source.value.trim(),
    lastChecked: dateInputToIso(form.lastChecked.value),
    recommendNote: form.recommendNote.value.trim(),
  };
  const { error } = await state.supabase.from("menus").upsert(appMenuToDb(menu), { onConflict: "id" });
  if (error) {
    alert(error.message || "메뉴 저장에 실패했습니다.");
    return;
  }
  await loadCatalog();
  alert("메뉴 저장 완료!");
}

async function deleteRestaurant(id) {
  if (!canEditSupabaseCatalog()) return;
  if (!confirm("이 가게를 삭제할까요? 연결된 메뉴도 함께 삭제됩니다.")) return;
  const { error } = await state.supabase.from("restaurants").delete().eq("id", id);
  if (error) {
    alert(error.message || "가게 삭제에 실패했습니다.");
    return;
  }
  await loadCatalog();
}

async function deleteMenu(id) {
  if (!canEditSupabaseCatalog()) return;
  if (!confirm("이 메뉴를 삭제할까요?")) return;
  const { error } = await state.supabase.from("menus").delete().eq("id", id);
  if (error) {
    alert(error.message || "메뉴 삭제에 실패했습니다.");
    return;
  }
  await loadCatalog();
}

function bindEvents() {
  els.loginForm.addEventListener("submit", handleLogin);
  els.signOutButton.addEventListener("click", signOut);
  els.refreshReviews.addEventListener("click", loadReviews);
  els.refreshReports.addEventListener("click", loadReports);
  els.refreshCatalog?.addEventListener("click", loadCatalog);
  els.refreshDataStatus?.addEventListener("click", loadCatalog);
  els.seedCatalog?.addEventListener("click", seedCatalogFromStatic);
  els.restaurantForm?.addEventListener("submit", saveRestaurant);
  els.menuForm?.addEventListener("submit", saveMenu);

  document.body.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-admin-tab]");
    if (tab) {
      document.querySelectorAll("[data-admin-tab]").forEach((button) => button.classList.toggle("is-active", button === tab));
      const target = tab.dataset.adminTab;
      els.reviewsPanel.hidden = target !== "reviews";
      els.reportsPanel.hidden = target !== "reports";
      els.catalogPanel.hidden = target !== "catalog";
      if (target === "catalog") renderCatalog();
    }
    const reviewFilter = event.target.closest("[data-review-filter]");
    if (reviewFilter) {
      state.reviewFilter = reviewFilter.dataset.reviewFilter;
      state.reviewPage = 0;
      document.querySelectorAll("[data-review-filter]").forEach((button) => button.classList.toggle("is-active", button === reviewFilter));
      renderReviews();
    }
    const reviewMode = event.target.closest("[data-review-mode]");
    if (reviewMode) {
      state.reviewMode = reviewMode.dataset.reviewMode;
      state.reviewPage = 0;
      document.querySelectorAll("[data-review-mode]").forEach((button) => button.classList.toggle("is-active", button === reviewMode));
      renderReviews();
    }
    const reviewPage = event.target.closest("[data-review-page]");
    if (reviewPage) {
      state.reviewPage += reviewPage.dataset.reviewPage === "next" ? 1 : -1;
      renderReviews();
    }
    const reportFilter = event.target.closest("[data-report-filter]");
    if (reportFilter) {
      state.reportFilter = reportFilter.dataset.reportFilter;
      document.querySelectorAll("[data-report-filter]").forEach((button) => button.classList.toggle("is-active", button === reportFilter));
      renderReports();
    }
    const reviewStatus = event.target.closest("[data-review-status]");
    if (reviewStatus) updateReviewStatus(reviewStatus.dataset.reviewStatus, reviewStatus.dataset.status);
    const reportStatus = event.target.closest("[data-report-status]");
    if (reportStatus) updateReportStatus(reportStatus.dataset.reportStatus, reportStatus.dataset.status);
    const catalogMode = event.target.closest("[data-catalog-mode]");
    if (catalogMode) {
      state.catalogMode = catalogMode.dataset.catalogMode;
      document.querySelectorAll("[data-catalog-mode]").forEach((button) => button.classList.toggle("is-active", button === catalogMode));
      renderCatalog();
    }
    const catalogSource = event.target.closest("[data-catalog-source]");
    if (catalogSource) {
      switchCatalogSource(catalogSource.dataset.catalogSource);
    }
    if (event.target.closest("[data-new-catalog]")) {
      if (!canEditSupabaseCatalog()) return;
      state.catalogMode === "restaurants" ? clearRestaurantForm() : clearMenuForm();
    }
    if (event.target.closest("[data-clear-restaurant]")) clearRestaurantForm();
    if (event.target.closest("[data-clear-menu]")) clearMenuForm();
    const editRestaurantButton = event.target.closest("[data-edit-restaurant]");
    if (editRestaurantButton) editRestaurant(editRestaurantButton.dataset.editRestaurant);
    const editMenuButton = event.target.closest("[data-edit-menu]");
    if (editMenuButton) editMenu(editMenuButton.dataset.editMenu);
    const deleteRestaurantButton = event.target.closest("[data-delete-restaurant]");
    if (deleteRestaurantButton) deleteRestaurant(deleteRestaurantButton.dataset.deleteRestaurant);
    const deleteMenuButton = event.target.closest("[data-delete-menu]");
    if (deleteMenuButton) deleteMenu(deleteMenuButton.dataset.deleteMenu);
  });
  els.reviewRestaurantFilter?.addEventListener("change", (event) => {
    state.reviewRestaurantId = event.target.value;
    state.reviewPage = 0;
    renderReviews();
  });
}

renderRestaurantFilterOptions();
bindEvents();
initSupabase();
