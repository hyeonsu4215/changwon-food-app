const DATA = window.CHANGWON_FOOD_DATA;

const FALLBACK_LOCATION = { label: "국립창원대학교 정문", lat: 35.2438, lng: 128.6916 };
const DATA_UPDATED_AT = "2026.06.22";
const FEEDBACK_FORM_URL = "https://forms.gle/BUYoZiSUXtFDE81J7";
const VISIT_REVIEW_RADIUS_M = 50;
const WEATHER_CACHE_MS = 60 * 60 * 1000;
const WEATHER_SETTING_KEY = "changwonFoodWeatherEnabled";
const TASTE_CUSTOMIZED_KEY = "changwonFoodTastePreferenceCustomized";
const BUDGET_CUSTOMIZED_KEY = "changwonFoodBudgetCustomized";
const RECOMMENDATION_PREFERENCES_KEY = "changwonFoodRecommendationPreferencesV1";
const DISCOVERY_SEED_KEY = "changwonFoodDiscoverySeed";
const ONBOARDING_SEEN_KEY = "changwonFoodOnboardingSeenV1";
const APP_SHARE_URL = "https://changwon-food-app.vercel.app/";
const ACQUISITION_SOURCE_PARAM = "src";
const SHARE_ACQUISITION_SOURCE = "share";
const SHARED_PICK_VERSION = "v1";
const SHARED_PICK_VERSION_PARAM = "sharedPick";
const SHARED_PICK_MENUS_PARAM = "menus";
const SPLASH_MIN_DURATION = 1200;
const splashStartedAt = Date.now();
const WEATHER_BOOSTS = { rain: 5, hot: 4, cold: 5, humid: 3 };
const HOT_SOUP_WORDS = ["순두부", "김치찌개", "육개장", "찌개", "국밥", "탕", "해장", "마라", "라멘", "우동", "칼국수", "찜"];
const HOT_CLEAR_MENU_WORDS = ["냉면", "밀면", "냉국수", "메밀국수", "열무국수", "샐러드", "냉우동", "모밀", "소바", "콩국수"];
const MOOD_OPTIONS = ["혼밥", "단체", "가성비", "든든함", "빠른식사", "비오는날", "해장", "시험기간", "데이트", "스트레스", "포장", "배달"];
const HISTORY_RANGE_OPTIONS = [
  { label: "1주일", days: 7 },
  { label: "1달", days: 30 },
  { label: "3달", days: 90 },
  { label: "6개월", days: 180 },
  { label: "1년", days: 365 },
];
const CATEGORY_META = {
  "도시락": { order: 1, icon: "dosirak.png" },
  "분식": { order: 2, icon: "bunsik.png" },
  "아시안": { order: 3, icon: "asian.png" },
  "양식": { order: 4, icon: "western.png" },
  "일식/돈까스": { order: 5, icon: "japanese.png" },
  "중식": { order: 6, icon: "chinese.png" },
  "찜/탕": { order: 7, icon: "hotpot.png" },
  "한식": { order: 8, icon: "korean.png" },
  "햄버거": { order: 9, icon: "burger.png" },
};

function createDiscoverySeed() {
  const next = Math.floor(Math.random() * 1000000) + Date.now();
  try {
    sessionStorage.setItem(DISCOVERY_SEED_KEY, String(next));
  } catch (error) {
    console.warn("discovery seed storage unavailable", error);
  }
  return next;
}

const discoverySeedValue = (() => {
  try {
    const saved = Number(sessionStorage.getItem(DISCOVERY_SEED_KEY));
    if (Number.isFinite(saved) && saved > 0) return saved;
  } catch (error) {
    console.warn("discovery seed storage unavailable", error);
  }
  return createDiscoverySeed();
})();

try {
  sessionStorage.removeItem("changwonFoodDiscoveryNudgeDismissed");
} catch (error) {
  console.warn("legacy discovery nudge flag unavailable", error);
}

const VALID_RECOMMENDATION_CATEGORIES = new Set(DATA.menus.map((menu) => menu.category));
const VALID_RECOMMENDATION_MOODS = new Set(MOOD_OPTIONS);

function clampNumber(value, min, max, fallback, step = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const stepped = Math.round(number / step) * step;
  return Math.min(max, Math.max(min, stepped));
}

function safePreferenceList(value, validSet) {
  if (!Array.isArray(value)) return [];
  return uniqueTags(value.map((item) => String(item)).filter((item) => validSet.has(item)));
}

function hasRequiredRecommendationPreferenceFields(value) {
  if (!value || typeof value !== "object" || value.version !== 1) return false;
  const numberFields = ["budget", "spicy", "salty", "sweet"];
  const booleanFields = [
    "onlyOpen",
    "needTakeout",
    "needDelivery",
    "needAlone",
    "wantMeat",
    "budgetCustomized",
    "tastePreferenceCustomized",
  ];
  return (
    numberFields.every((key) => typeof value[key] === "number" && Number.isFinite(value[key])) &&
    Array.isArray(value.categories) &&
    Array.isArray(value.moods) &&
    booleanFields.every((key) => typeof value[key] === "boolean")
  );
}

function readRecommendationPreferences() {
  let saved = null;
  try {
    const parsed = JSON.parse(localStorage.getItem(RECOMMENDATION_PREFERENCES_KEY) || "null");
    if (hasRequiredRecommendationPreferenceFields(parsed)) saved = parsed;
  } catch (error) {
    console.warn("recommendation preferences unavailable", error);
  }
  if (!saved) return null;

  return {
    version: 1,
    budget: clampNumber(saved.budget, 3000, 30000, 8000, 500),
    spicy: clampNumber(saved.spicy, 0, 5, 2),
    salty: clampNumber(saved.salty, 0, 5, 3),
    sweet: clampNumber(saved.sweet, 0, 5, 2),
    categories: safePreferenceList(saved.categories, VALID_RECOMMENDATION_CATEGORIES),
    moods: safePreferenceList(saved.moods, VALID_RECOMMENDATION_MOODS),
    onlyOpen: Boolean(saved.onlyOpen),
    needTakeout: Boolean(saved.needTakeout),
    needDelivery: Boolean(saved.needDelivery),
    needAlone: Boolean(saved.needAlone),
    wantMeat: Boolean(saved.wantMeat),
    budgetCustomized: typeof saved.budgetCustomized === "boolean" ? saved.budgetCustomized : false,
    tastePreferenceCustomized: typeof saved.tastePreferenceCustomized === "boolean" ? saved.tastePreferenceCustomized : false,
  };
}

let savedRecommendationPreferences = readRecommendationPreferences();
let appliedRecommendationPreferences = null;

const state = {
  location: null,
  locationStatus: "idle",
  budget: 8000,
  budgetCustomized: false,
  categories: new Set(),
  moods: new Set(),
  onlyOpen: false,
  needTakeout: false,
  needDelivery: false,
  needAlone: false,
  wantMeat: false,
  spicy: 2,
  salty: 3,
  sweet: 2,
  page: 0,
  hasSearched: false,
  appReady: false,
  splashHideScheduled: false,
  onboarding: {
    active: false,
    pending: false,
    preparing: false,
    step: 0,
    force: false,
    previousFocus: null,
    positionFrame: null,
    scrollTimer: null,
    recommendationSnapshot: null,
    createdTemporaryRecommendation: false,
    hadRecommendationAtStart: false,
  },
  suppressDiscoveryPickCount: false,
  isSearching: false,
  recommendTimer: null,
  quickItems: [],
  quickSeenIds: new Set(),
  activeRecommendationMode: "discovery",
  quickMode: "discovery",
  discoveryPickCount: 0,
  discoveryNudgeThreshold: 2,
  rerollCount: 0,
  rerollPromptVisible: false,
  quickAppliedWeather: false,
  quickLocationBase: { ...FALLBACK_LOCATION },
  discoverySeed: discoverySeedValue,
  detailContext: "custom",
  detailAnalyticsContext: null,
  alternativesExpanded: false,
  wishlist: JSON.parse(localStorage.getItem("changwonFoodWishlist") || "[]"),
  history: JSON.parse(localStorage.getItem("changwonFoodHistory") || "[]"),
  pendingEatenMenuId: null,
  historyRangeDays: Number(localStorage.getItem("changwonFoodHistoryRangeDays") || "7"),
  historyVisibleCount: 5,
  tasteOverrides: JSON.parse(localStorage.getItem("changwonFoodTasteOverrides") || "{}"),
  tastePreferenceCustomized: false,
  reviews: JSON.parse(localStorage.getItem("changwonFoodReviews") || "{}"),
  nickname: localStorage.getItem("changwonFoodNickname") || "",
  publicTasteSummary: {},
  publicReviewSummary: {},
  publicReviews: {},
  myReports: [],
  reviewVisibleCount: {},
  catalogSource: "static",
  catalogStatus: "내장 데이터 사용 중",
  weather: JSON.parse(localStorage.getItem("changwonFoodWeather") || "null"),
  weatherEnabled: false,
  weatherStatus: "idle",
  supabase: null,
  supabaseUserId: null,
  supabaseReady: false,
  supabaseError: "",
  syncStatus: "idle",
  lastSyncAt: "",
  pendingReviewRetry: null,
  supabaseInitPromise: null,
  worldcup: null,
  worldcupCategories: new Set(),
  activeTab: "recommendTab",
  lastBackAt: 0,
  externalLinkClickAt: 0,
  pagehideAfterExternalLink: false,
  rangeInputPendingChange: {},
  storeSearchTerm: "",
  expandedStoreMenus: new Set(),
  roulette: {
    active: false,
    items: [],
    selected: null,
    selectedIndex: -1,
    rotation: 0,
    spinning: false,
  },
  locationPreference: localStorage.getItem("changwonFoodLocationPreference") || "",
  locationRequestId: 0,
  preserveDraftOnNextConditionOpen: false,
  sharedPickStatus: "none",
  sharedPickIds: [],
  sharePickPending: false,
};

appliedRecommendationPreferences = recommendationPreferencesSnapshot();

function getAnalyticsSessionStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const analyticsClient =
  typeof window.MukjjiAnalytics?.createAnalyticsClient === "function" &&
  typeof window.MukjjiAnalytics?.isAnalyticsRuntimeEnabled === "function"
  ? window.MukjjiAnalytics.createAnalyticsClient({
      enabled: window.MukjjiAnalytics.isAnalyticsRuntimeEnabled(),
      acquisitionSource: window.MukjjiAnalytics.getAcquisitionSource?.(),
      sessionStorage: getAnalyticsSessionStorage(),
      crypto: window.crypto,
      getSupabaseClient: async () => {
        if (!state.supabase) await initSupabase();
        return state.supabase;
      },
    })
  : null;

function getAnalyticsSourceContext(context) {
  if (context === "search") return "search";
  if (state.sharedPickStatus === "valid") return "shared_pick";
  if (context === "personalized" || context === "custom") return "personalized";
  if (context === "discovery") return "discovery";
  return null;
}

function setAnalyticsRecommendationState() {
  if (!analyticsClient) return;
  const sourceContext = getAnalyticsSourceContext(state.quickMode);
  const menuIds = state.quickItems.map((item) => String(item.id));
  const validItems =
    state.quickItems.length === 3 &&
    new Set(menuIds).size === 3 &&
    state.quickItems.every((item) => item.id && (item.restaurantId || item.restaurant?.id));
  if (validItems && sourceContext && sourceContext !== "search") {
    analyticsClient.startRecommendation(state.quickItems, sourceContext);
    return;
  }
  analyticsClient.clearRecommendation();
  if (!new Set(["discovery", "personalized"]).has(sourceContext)) return;
  const errorCode = !Array.isArray(DATA.menus) || DATA.menus.length === 0
    ? window.MukjjiAnalytics.ERROR_CODES.DATA_UNAVAILABLE
    : state.quickItems.length === 3
      ? window.MukjjiAnalytics.ERROR_CODES.INVALID_RESULT
      : window.MukjjiAnalytics.ERROR_CODES.INSUFFICIENT_CANDIDATES;
  analyticsClient.recordRecommendationError({
    sourceContext,
    errorCode,
    itemCount: Math.min(3, state.quickItems.length),
  });
}

function clearAnalyticsRecommendationState() {
  analyticsClient?.clearRecommendation();
}

function analyticsMapAttributes(item, context) {
  const sourceContext = getAnalyticsSourceContext(context);
  const restaurantId = item?.restaurant?.id || item?.restaurantId || item?.id || "";
  const menuId = item?.restaurant || item?.restaurantId ? item?.id || "" : "";
  if (!sourceContext || !restaurantId) return "";
  if (sourceContext !== "search" && !menuId) return "";
  return ` data-analytics-map data-analytics-context="${escapeHtml(sourceContext)}" data-analytics-restaurant-id="${escapeHtml(restaurantId)}"${menuId ? ` data-analytics-menu-id="${escapeHtml(menuId)}"` : ""}`;
}

const els = {
  locationButton: document.querySelector("#locationButton"),
  shareButton: document.querySelector("#shareButton"),
  onboardingHelpButton: document.querySelector("#onboardingHelpButton"),
  splashScreen: document.querySelector("#splashScreen"),
  locationStatus: document.querySelector("#locationStatus"),
  conditionSummary: document.querySelector("#conditionSummary"),
  weatherCard: document.querySelector("#weatherCard"),
  quickRecommendButton: document.querySelector("#quickRecommendButton"),
  conditionDetails: document.querySelector("#conditionDetails"),
  savedPreferenceCard: document.querySelector("#savedPreferenceCard"),
  searchButton: document.querySelector("#searchButton"),
  resetFiltersButton: document.querySelector("#resetFiltersButton"),
  searchOverlay: document.querySelector("#searchOverlay"),
  budgetRange: document.querySelector("#budgetRange"),
  budgetValue: document.querySelector("#budgetValue"),
  categoryGrid: document.querySelector("#categoryGrid"),
  moodGrid: document.querySelector("#moodGrid"),
  onlyOpen: document.querySelector("#onlyOpen"),
  needTakeout: document.querySelector("#needTakeout"),
  needDelivery: document.querySelector("#needDelivery"),
  needAlone: document.querySelector("#needAlone"),
  wantMeat: document.querySelector("#wantMeat"),
  spicyPreference: document.querySelector("#spicyPreference"),
  saltyPreference: document.querySelector("#saltyPreference"),
  sweetPreference: document.querySelector("#sweetPreference"),
  spicyValue: document.querySelector("#spicyValue"),
  saltyValue: document.querySelector("#saltyValue"),
  sweetValue: document.querySelector("#sweetValue"),
  recommendTitle: document.querySelector("#recommendTitle"),
  recommendSubtitle: document.querySelector("#recommendSubtitle"),
  recommendSection: document.querySelector(".recommend-section"),
  quickRecommendPanel: document.querySelector("#quickRecommendPanel"),
  sharePickButton: document.querySelector("#sharePickButton"),
  recommendActionDock: document.querySelector("#recommendActionDock"),
  recommendNudge: document.querySelector("#recommendNudge"),
  rerollQuickButton: document.querySelector("#rerollQuickButton"),
  toggleAlternativesButton: document.querySelector("#toggleAlternativesButton"),
  menuList: document.querySelector("#menuList"),
  nextRecommendButton: document.querySelector("#nextRecommendButton"),
  rouletteButton: document.querySelector("#rouletteButton"),
  roulettePanel: document.querySelector("#roulettePanel"),
  rouletteWheel: document.querySelector("#rouletteWheel"),
  rouletteStatus: document.querySelector("#rouletteStatus"),
  stopRouletteButton: document.querySelector("#stopRouletteButton"),
  rerollRouletteButton: document.querySelector("#rerollRouletteButton"),
  closeRouletteButton: document.querySelector("#closeRouletteButton"),
  rouletteResult: document.querySelector("#rouletteResult"),
  storeSearchInput: document.querySelector("#storeSearchInput"),
  storeSearchResults: document.querySelector("#storeSearchResults"),
  worldcupSize: document.querySelector("#worldcupSize"),
  worldcupCategoryGrid: document.querySelector("#worldcupCategoryGrid"),
  worldcupBoard: document.querySelector("#worldcupBoard"),
  wishlistList: document.querySelector("#wishlistList"),
  clearWishlist: document.querySelector("#clearWishlist"),
  dataDashboard: document.querySelector("#dataDashboard"),
  detailDialog: document.querySelector("#detailDialog"),
  dialogContent: document.querySelector("#dialogContent"),
  closeDialog: document.querySelector("#closeDialog"),
  eatenConfirmDialog: document.querySelector("#eatenConfirmDialog"),
  eatenConfirmMenuName: document.querySelector("#eatenConfirmMenuName"),
  cancelEatenConfirm: document.querySelector("#cancelEatenConfirm"),
  confirmEatenRecord: document.querySelector("#confirmEatenRecord"),
  locationDialog: document.querySelector("#locationDialog"),
  reportDialog: document.querySelector("#reportDialog"),
  reportForm: document.querySelector("#reportForm"),
  closeReportDialog: document.querySelector("#closeReportDialog"),
  reportTargetType: document.querySelector("#reportTargetType"),
  reportTargetId: document.querySelector("#reportTargetId"),
  reportTargetLabel: document.querySelector("#reportTargetLabel"),
  reportType: document.querySelector("#reportType"),
  reportMessage: document.querySelector("#reportMessage"),
  reportReporter: document.querySelector("#reportReporter"),
  onboardingOverlay: document.querySelector("#onboardingOverlay"),
  onboardingSpotlight: document.querySelector("#onboardingSpotlight"),
  onboardingCard: document.querySelector("#onboardingCard"),
  onboardingStepLabel: document.querySelector("#onboardingStepLabel"),
  onboardingTitle: document.querySelector("#onboardingTitle"),
  onboardingDescription: document.querySelector("#onboardingDescription"),
  onboardingHelper: document.querySelector("#onboardingHelper"),
  onboardingSkipButton: document.querySelector("#onboardingSkipButton"),
  onboardingPrevButton: document.querySelector("#onboardingPrevButton"),
  onboardingNextButton: document.querySelector("#onboardingNextButton"),
  toast: document.querySelector("#toast"),
};

const restaurantsById = new Map(DATA.restaurants.map((restaurant) => [restaurant.id, restaurant]));

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
    mapSearchKeyword: typeof row.map_search_keyword === "string" ? row.map_search_keyword.trim() || null : null,
    mapSearchDisabled: row.map_search_disabled === true,
  };
}

function dbMenuToApp(row, restaurantMap = restaurantsById) {
  const restaurant = restaurantMap.get(row.restaurant_id);
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
    foodCharacter: row.food_character ?? null,
  };
}

function setCatalogData(restaurants, menus, sourceLabel) {
  DATA.restaurants = restaurants;
  restaurantsById.clear();
  DATA.restaurants.forEach((restaurant) => restaurantsById.set(restaurant.id, restaurant));
  DATA.menus = menus.map((menu) => ({
    ...menu,
    restaurantName: menu.restaurantName || restaurantsById.get(menu.restaurantId)?.name || "",
  }));
  DATA.meta = {
    ...(DATA.meta || {}),
    restaurantCount: DATA.restaurants.length,
    menuCount: DATA.menus.length,
    generatedFrom: sourceLabel,
  };
  state.catalogSource = sourceLabel;
  state.catalogStatus = sourceLabel === "supabase" ? "Supabase 데이터 사용 중" : "내장 데이터 사용 중";
}

function clampScore(value, min = 0, max = 5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  return `${Number(value).toLocaleString("ko-KR")}원`;
}

function meters(value) {
  if (!Number.isFinite(value)) return "-";
  if (value < 1000) return `${Math.round(value)}m`;
  return `${(value / 1000).toFixed(1)}km`;
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lon2 - lon1);
  const fromLat = toRad(lat1);
  const toLat = toRad(lat2);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(fromLat) * Math.cos(toLat) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function haversine(a, b) {
  return getDistanceMeters(a.lat, a.lng, b.lat, b.lng);
}

function currentBase() {
  return state.location || FALLBACK_LOCATION;
}

function parseSharedPickFromUrl(urlValue = window.location.href) {
  try {
    const url = new URL(urlValue, window.location.origin);
    const hasVersion = url.searchParams.has(SHARED_PICK_VERSION_PARAM);
    const hasMenus = url.searchParams.has(SHARED_PICK_MENUS_PARAM);
    if (!hasVersion && !hasMenus) return { present: false, valid: false, ids: [] };
    const version = url.searchParams.get(SHARED_PICK_VERSION_PARAM);
    const rawIds = String(url.searchParams.get(SHARED_PICK_MENUS_PARAM) || "").split(",");
    const ids = rawIds.map((id) => id.trim());
    const safeIds = ids.every((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id));
    const uniqueIds = new Set(ids);
    const availableIds = new Set(DATA.menus.filter((menu) => menu.available).map((menu) => String(menu.id)));
    const valid =
      version === SHARED_PICK_VERSION &&
      ids.length === 3 &&
      safeIds &&
      uniqueIds.size === 3 &&
      ids.every((id) => availableIds.has(id));
    return { present: true, valid, ids: valid ? ids : [] };
  } catch {
    return { present: true, valid: false, ids: [] };
  }
}

function buildSharedPickUrl(menuIds) {
  const url = new URL(buildOfficialShareUrl());
  url.searchParams.set(SHARED_PICK_VERSION_PARAM, SHARED_PICK_VERSION);
  url.searchParams.set(SHARED_PICK_MENUS_PARAM, menuIds.map((id) => String(id)).join(","));
  return url.toString();
}

function buildOfficialShareUrl(baseUrl = APP_SHARE_URL) {
  const url = new URL(baseUrl);
  url.searchParams.set(ACQUISITION_SOURCE_PARAM, SHARE_ACQUISITION_SOURCE);
  return url.toString();
}

function resolveSharedPickItems(menuIds, locationBase = FALLBACK_LOCATION) {
  const menusById = new Map(DATA.menus.filter((menu) => menu.available).map((menu) => [String(menu.id), menu]));
  return menuIds.map((id) => {
    const menu = menusById.get(String(id));
    return menu
      ? scoreMenu(menu, {
          applyBudget: false,
          applyTaste: false,
          applyMoods: false,
          applyWeather: false,
          locationBase,
        })
      : null;
  }).filter(Boolean);
}

function cleanAppUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete(SHARED_PICK_VERSION_PARAM);
  url.searchParams.delete(SHARED_PICK_MENUS_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

function setSharedPickState(parsed, locationBase = FALLBACK_LOCATION) {
  if (state.recommendTimer) {
    window.clearTimeout(state.recommendTimer);
    state.recommendTimer = null;
  }
  state.isSearching = false;
  state.hasSearched = true;
  setActiveRecommendationMode("discovery");
  state.quickMode = "discovery";
  state.quickSeenIds = new Set();
  state.rerollCount = 0;
  state.rerollPromptVisible = false;
  state.quickAppliedWeather = false;
  state.quickLocationBase = { ...locationBase };
  state.sharedPickStatus = parsed.valid ? "valid" : "error";
  state.sharedPickIds = parsed.valid ? [...parsed.ids] : [];
  state.quickItems = parsed.valid ? resolveSharedPickItems(parsed.ids, locationBase) : [];
  state.page = 0;
  if (parsed.valid) setAnalyticsRecommendationState();
  else clearAnalyticsRecommendationState();
}

function clearSharedPickState({ pushHistory = false } = {}) {
  if (state.sharedPickStatus === "none") return;
  state.sharedPickStatus = "none";
  state.sharedPickIds = [];
  clearAnalyticsRecommendationState();
  if (pushHistory && history.pushState) {
    history.pushState({ changwonFoodApp: true, screen: "recommendTab" }, "", cleanAppUrl());
  }
}

function initializeSharedPickFromUrl() {
  const parsed = parseSharedPickFromUrl();
  if (parsed.present) setSharedPickState(parsed, FALLBACK_LOCATION);
}

function weekdayKo(date = new Date()) {
  return ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
}

function timeToMinutes(value) {
  if (!value || value === "X") return null;
  const [h, m] = String(value).split(":").map(Number);
  if (!Number.isFinite(h)) return null;
  return h * 60 + (Number.isFinite(m) ? m : 0);
}

function isOpenNow(restaurant) {
  const day = weekdayKo();
  if (restaurant?.closedDays && restaurant.closedDays.includes(day)) return false;
  const open = timeToMinutes(restaurant?.openTime);
  const close = timeToMinutes(restaurant?.closeTime);
  if (open == null || close == null) return true;
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  return current >= open && current <= close;
}

function distanceLabel(distance) {
  if (!Number.isFinite(distance)) return "거리 미상";
  if (distance <= 300) return "가까움";
  if (distance <= 800) return "중간";
  return "멀어요";
}

function hasMeat(menu) {
  const text = `${menu.name} ${menu.category} ${menu.tags.join(" ")}`;
  return /(고기|소고기|돼지|제육|닭|치킨|텐더|햄버거|돈까스|불고기|갈비|차슈|육회|스테이크|부리또|탕수육)/.test(text);
}

function menuTaste(menu) {
  if (state.tasteOverrides[menu.id]) {
    return { ...state.tasteOverrides[menu.id], source: "내 입맛" };
  }
  const publicTaste = state.publicTasteSummary[menu.id];
  if (publicTaste?.vote_count > 0) {
    return {
      spicy: Number(publicTaste.avg_spicy),
      salty: Number(publicTaste.avg_salty),
      sweet: Number(publicTaste.avg_sweet),
      source: `평균 ${publicTaste.vote_count}명`,
    };
  }
  return { spicy: menu.spicy, salty: menu.salty, sweet: menu.sweet, source: "기본값" };
}

function baseTaste(menu) {
  return { spicy: menu.spicy, salty: menu.salty, sweet: menu.sweet };
}

function reviewSummary(menuId) {
  const remote = state.publicReviewSummary[menuId];
  if (remote?.review_count > 0) return remote;
  const localReviews = Object.values(state.reviews).filter((review) => review.menuId === menuId);
  if (!localReviews.length) return null;
  const avg = (field) => localReviews.reduce((sum, review) => sum + Number(review[field] || 0), 0) / localReviews.length;
  return {
    avg_rating: avg("rating").toFixed(2),
    avg_hygiene: avg("hygiene").toFixed(2),
    avg_kindness: avg("kindness").toFixed(2),
    review_count: localReviews.length,
  };
}

function reviewFingerprint(review) {
  return [
    review.menuId || review.menu_id || "",
    review.nickname || "",
    Number(review.rating || 0),
    Number(review.hygiene || 0),
    Number(review.kindness || 0),
    String(review.review_text || "").trim(),
  ].join("|");
}

function uniqueMenuReviews(menuId) {
  const remote = state.publicReviews[menuId] || [];
  const local = Object.values(state.reviews).filter((review) => review.menuId === menuId);
  const seen = new Set();
  return [...local, ...remote]
    .filter((review) => {
      const ownRemoteCopy = review.user_id && review.user_id === state.supabaseUserId && state.reviews[menuId];
      if (ownRemoteCopy) return false;
      const key = reviewFingerprint(review);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.created_at || b.updatedAt || b.updated_at || 0) - new Date(a.created_at || a.updatedAt || a.updated_at || 0));
}

function menuReviews(menuId) {
  const merged = uniqueMenuReviews(menuId);
  const limit = state.reviewVisibleCount[menuId] || 5;
  return merged.slice(0, limit);
}

function menuReviewTotal(menuId) {
  return uniqueMenuReviews(menuId).length;
}

function starButtons(value) {
  const rating = clampScore(value || 5, 1, 5);
  return Array.from({ length: 5 }, (_, index) => {
    const score = index + 1;
    return `<button type="button" class="${score <= rating ? "is-selected" : ""}" data-rating-value="${score}" aria-label="${score}점">${score <= rating ? "★" : "☆"}</button>`;
  }).join("");
}

function isWished(id) {
  return state.wishlist.includes(id);
}

function toast(message, variant = "") {
  const toastHost = els.detailDialog?.open ? els.detailDialog : document.body;
  if (els.toast.parentElement !== toastHost) toastHost.appendChild(els.toast);
  els.toast.classList.toggle("has-mukjji", variant === "happy");
  els.toast.replaceChildren();
  if (variant === "happy") {
    const image = document.createElement("img");
    image.src = "./assets/mukjji/06_mukjji_eating_happy_512.webp";
    image.alt = "";
    image.width = 44;
    image.height = 44;
    image.loading = "lazy";
    image.setAttribute("aria-hidden", "true");
    els.toast.appendChild(image);
  }
  const text = document.createElement("span");
  text.textContent = message;
  els.toast.appendChild(text);
  els.toast.classList.remove("is-visible");
  window.requestAnimationFrame(() => {
    els.toast.classList.add("is-visible");
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => els.toast.classList.remove("is-visible"), 1200);
  });
}

function tastePreferenceEnabled(preferences = state) {
  return Boolean(preferences.tastePreferenceCustomized);
}

function budgetPreferenceEnabled(preferences = state) {
  return Boolean(preferences.budgetCustomized);
}

function cloneRecommendationPreferences(preferences) {
  if (!preferences) return null;
  return {
    ...preferences,
    categories: [...(preferences.categories || [])],
    moods: [...(preferences.moods || [])],
  };
}

function appliedRecommendationConditions() {
  return cloneRecommendationPreferences(appliedRecommendationPreferences) || recommendationPreferencesSnapshot();
}

function conditionSet(value) {
  return value instanceof Set ? value : new Set(value || []);
}

function hasCustomRecommendationConditions(preferences = state) {
  const categories = conditionSet(preferences.categories);
  const moods = conditionSet(preferences.moods);
  return (
    budgetPreferenceEnabled(preferences) ||
    tastePreferenceEnabled(preferences) ||
    categories.size > 0 ||
    moods.size > 0 ||
    preferences.onlyOpen ||
    preferences.needTakeout ||
    preferences.needDelivery ||
    preferences.needAlone ||
    preferences.wantMeat
  );
}

function quickRecommendationMode() {
  return state.activeRecommendationMode === "personalized" ? "custom" : "discovery";
}

function setActiveRecommendationMode(mode) {
  state.activeRecommendationMode = mode === "personalized" ? "personalized" : "discovery";
}

function refreshDiscoverySeed() {
  state.discoverySeed = createDiscoverySeed();
}

function resetDiscoveryNudgeCycle(threshold = 2) {
  state.discoveryPickCount = 0;
  state.discoveryNudgeThreshold = threshold;
}

function resetStoreMenuExpansions() {
  state.expandedStoreMenus = new Set();
}

function markConditionsChanged() {
  state.page = 0;
}

function hasSavedRecommendationPreferences() {
  return Boolean(savedRecommendationPreferences);
}

function applyRecommendationPreferences(preferences) {
  if (!preferences) return false;
  state.budget = clampNumber(preferences.budget, 3000, 30000, 8000, 500);
  state.budgetCustomized = Boolean(preferences.budgetCustomized);
  state.spicy = clampNumber(preferences.spicy, 0, 5, 2);
  state.salty = clampNumber(preferences.salty, 0, 5, 3);
  state.sweet = clampNumber(preferences.sweet, 0, 5, 2);
  state.tastePreferenceCustomized = Boolean(preferences.tastePreferenceCustomized);
  state.categories = new Set(safePreferenceList(preferences.categories, VALID_RECOMMENDATION_CATEGORIES));
  state.moods = new Set(safePreferenceList(preferences.moods, VALID_RECOMMENDATION_MOODS));
  state.onlyOpen = Boolean(preferences.onlyOpen);
  state.needTakeout = Boolean(preferences.needTakeout);
  state.needDelivery = Boolean(preferences.needDelivery);
  state.needAlone = Boolean(preferences.needAlone);
  state.wantMeat = Boolean(preferences.wantMeat);
  state.rangeInputPendingChange = {};
  markConditionsChanged();
  return true;
}

function weatherKind(weather = state.weather) {
  if (!weather) return null;
  const main = String(weather.main || "").toLowerCase();
  const text = `${weather.description || ""} ${main}`.toLowerCase();
  const temp = Number(weather.temp);
  if (weather.rain1h > 0 || text.includes("rain") || text.includes("비")) return "rain";
  if (weather.snow1h > 0 || text.includes("snow") || text.includes("눈")) return "cold";
  if (Number.isFinite(temp) && temp >= 28) return "hot";
  if (Number.isFinite(temp) && temp <= 8) return "cold";
  if (Number(weather.humidity || 0) >= 78 && (main.includes("cloud") || text.includes("흐"))) return "humid";
  return null;
}

function weatherIcon(kind) {
  return { rain: "☔", hot: "☀", cold: "♨", humid: "☁" }[kind] || "🌤";
}

function weatherFreshForRecommendation() {
  return state.weatherEnabled && cachedWeatherFresh() && ["cached", "synced"].includes(state.weatherStatus);
}

function weatherBoost(menu) {
  if (!weatherFreshForRecommendation()) return null;
  const kind = weatherKind();
  if (!kind) return null;
  const name = `${menu.name} ${menu.category} ${(menu.tags || []).join(" ")}`;
  const menuName = String(menu.name || "").replace(/\s+/g, "");
  const includes = (words) => words.some((word) => name.includes(word));
  const menuNameIncludes = (words) => words.some((word) => menuName.includes(word.replace(/\s+/g, "")));
  if (kind === "rain" && includes(["비오는날", "칼국수", "국밥", "탕", "찌개", "라멘", "우동", "마라", "찜", "해장", "든든함"])) {
    return { score: WEATHER_BOOSTS.rain, label: "비 오는 날", reason: "비 오는 날이라 따뜻한 국물이나 든든한 메뉴에 작은 가산점이 들어갔어요." };
  }
  if (kind === "hot" && !menuNameIncludes(HOT_SOUP_WORDS) && menuNameIncludes(HOT_CLEAR_MENU_WORDS)) {
    return { score: WEATHER_BOOSTS.hot, label: "더운 날", reason: "더운 날이라 가볍게 먹기 좋은 메뉴에 작은 가산점이 들어갔어요." };
  }
  if (kind === "cold" && includes(["라멘", "마라", "탕", "찌개", "국밥", "찜", "칼국수", "우동", "든든함"])) {
    return { score: WEATHER_BOOSTS.cold, label: "추운 날", reason: "쌀쌀한 날씨라 따뜻하고 든든한 메뉴에 작은 가산점이 들어갔어요." };
  }
  if (kind === "humid" && includes(["든든함", "한식", "국밥", "탕", "찌개", "빠른식사"])) {
    return { score: WEATHER_BOOSTS.humid, label: "흐린 날", reason: "흐리고 습한 날이라 부담 적고 든든한 메뉴에 작은 가산점이 들어갔어요." };
  }
  return null;
}

function tastePreferenceReasonEnabled(menuOrItem, preferences = state) {
  return tastePreferenceEnabled(preferences);
}

function scoreMenu(menu, options = {}) {
  const conditions = options.conditions || state;
  const moods = conditionSet(conditions.moods);
  const applyBudget = options.applyBudget ?? budgetPreferenceEnabled(conditions);
  // Per-menu tasteOverrides calibrate that menu's taste values, but only the global taste sliders make recommendations personalized.
  const applyTaste = options.applyTaste ?? tastePreferenceEnabled(conditions);
  const applyMoods = options.applyMoods ?? true;
  const applyWeather = options.applyWeather ?? true;
  const locationBase = options.locationBase || currentBase();
  const restaurant = restaurantsById.get(menu.restaurantId);
  const distance = restaurant?.lat && restaurant?.lng ? haversine(locationBase, restaurant) : Infinity;
  const taste = menuTaste(menu);
  const tasteDiff = Math.abs(taste.spicy - conditions.spicy) + Math.abs(taste.salty - conditions.salty) + Math.abs(taste.sweet - conditions.sweet);
  const budgetDiff = Math.max(0, menu.price - conditions.budget);
  let score = 0;
  const reasons = [];

  if (applyTaste) score += tasteDiff * 9;
  if (applyBudget) score += budgetDiff / 160;
  score += Math.min(distance / 35, 30);
  score -= menu.value * 3;
  score -= menu.portion * 1.6;
  score -= menu.signature ? 4 : 0;
  const weather = applyWeather ? weatherBoost(menu) : null;
  if (weather) {
    score -= weather.score;
    reasons.push(weather.label);
  }

  if (applyTaste && tastePreferenceReasonEnabled(menu, conditions) && tasteDiff <= 2) reasons.push("선택한 맛 취향");
  if (applyBudget && menu.price <= conditions.budget) reasons.push("예산 안");
  if (distance <= 300) reasons.push("가까움");
  if (menu.value >= 4) reasons.push("가성비");
  if (menu.portion >= 4) reasons.push("든든함");

  if (applyMoods && moods.size) {
    for (const mood of moods) {
      if (menu.tags.includes(mood)) {
        score -= 18;
        if (!reasons.includes(mood)) reasons.push(mood);
      } else {
        score += 5;
      }
    }
  }

  return {
    ...menu,
    restaurant,
    distance,
    openNow: restaurant ? isOpenNow(restaurant) : true,
    meat: hasMeat(menu),
    taste,
    customTaste: Boolean(state.tasteOverrides[menu.id]),
    publicTaste: state.publicTasteSummary[menu.id] || null,
    reviewSummary: reviewSummary(menu.id),
    weatherBoost: weather,
    score,
    reasons: reasons.slice(0, 4),
  };
}

function getRecommendedMenus(options = {}) {
  const mode = options.mode || quickRecommendationMode();
  const conditions = options.conditions || (mode === "custom" ? appliedRecommendationConditions() : recommendationPreferencesSnapshot());
  const categories = conditionSet(conditions.categories);
  const moods = conditionSet(conditions.moods);
  const applyConditions = options.applyConditions ?? mode === "custom";
  const applyBudget = options.applyBudget ?? (mode === "custom" && budgetPreferenceEnabled(conditions));
  const applyTaste = options.applyTaste ?? (mode === "custom");
  const applyMoods = options.applyMoods ?? applyConditions;
  const applyWeather = options.applyWeather ?? true;
  const locationBase = options.locationBase;
  const sorted = DATA.menus
    .filter((menu) => menu.available)
    .map((menu) =>
      scoreMenu(menu, {
        applyBudget,
        applyTaste: applyTaste && tastePreferenceEnabled(conditions),
        applyMoods,
        applyWeather,
        locationBase,
        conditions,
      }),
    )
    .filter((item) => {
      if (applyConditions && categories.size && !categories.has(item.category)) return false;
      if (applyConditions && moods.size && ![...moods].some((mood) => item.tags.includes(mood))) return false;
      if (applyBudget && item.price > conditions.budget) return false;
      if (applyConditions && conditions.onlyOpen && !item.openNow) return false;
      if (applyConditions && conditions.needTakeout && !item.restaurant?.takeout) return false;
      if (applyConditions && conditions.needDelivery && !item.restaurant?.delivery) return false;
      if (applyConditions && conditions.needAlone && !item.restaurant?.alone) return false;
      if (applyConditions && conditions.wantMeat && !item.meat) return false;
      return true;
    })
    .sort((a, b) => a.score - b.score);
  return diversifyRestaurants(sorted);
}

function diversifyRestaurants(sortedItems) {
  if (sortedItems.length < 3) return sortedItems;
  const [first, ...rest] = sortedItems;
  const selected = [first];
  const remaining = [...rest];

  while (remaining.length) {
    const restaurantCounts = selected.reduce((counts, item) => {
      const key = item.restaurantId || item.restaurant?.id || item.restaurantName;
      counts.set(key, (counts.get(key) || 0) + 1);
      return counts;
    }, new Map());
    let bestIndex = 0;
    let bestValue = Infinity;
    remaining.forEach((item, index) => {
      const key = item.restaurantId || item.restaurant?.id || item.restaurantName;
      const repeatCount = restaurantCounts.get(key) || 0;
      const value = item.score + repeatCount * 8 + Math.max(0, selected.length - 6) * repeatCount * 2;
      if (value < bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    });
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }

  return selected;
}

function pageMenus() {
  const mode = quickRecommendationMode();
  const all = mode === "discovery" ? getDiscoveryMenus() : getRecommendedMenus({ mode: "custom" });
  const start = state.page * 10;
  return { all, items: all.slice(start, start + 10), start };
}

function restaurantKey(item) {
  return item.restaurantId || item.restaurant?.id || item.restaurantName || item.restaurant?.name || item.id;
}

function stableHash(value) {
  return String(value).split("").reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0);
}

function seededNoise(value, salt = 0) {
  const x = Math.sin(stableHash(`${state.discoverySeed}:${salt}:${value}`)) * 10000;
  return x - Math.floor(x);
}

const PRIMARY_FOOD_CHARACTERS = new Set([
  "rice-meal",
  "noodle-special",
  "hot-soup",
  "quick-snack",
  "main-dish",
]);

const FOOD_CHARACTER_NAME_RULES = Object.freeze([
  Object.freeze({
    value: "quick-snack",
    keywords: Object.freeze([
      "부리또", "밥버거", "햄버거", "버거", "김밥", "토스트", "떡볶이", "만두",
      "샌드위치", "핫도그", "봉구", "햄치즈",
    ]),
  }),
  Object.freeze({
    value: "noodle-special",
    keywords: Object.freeze([
      "쌀국수", "칼국수", "잔치국수", "비빔국수", "열무국수", "촌국수", "국수", "볶음짬뽕",
      "짬뽕", "간짜장", "쟁반짜장", "짜장면", "짜장", "라멘", "탄탄멘", "비빔면", "라면",
      "파스타", "비빔밀면", "물밀면", "밀면", "냉면", "우동", "소바", "모밀", "수제비",
    ]),
  }),
  Object.freeze({
    value: "hot-soup",
    keywords: Object.freeze([
      "김치찌개", "된장찌개", "순두부찌개", "순두부", "찌개", "돼지국밥", "순대국밥",
      "내장국밥", "섞어국밥", "국밥", "육개장", "뼈해장국", "콩나물해장국", "해장국",
      "마라탕", "짜글이",
    ]),
  }),
  Object.freeze({
    value: "rice-meal",
    keywords: Object.freeze(["덮밥", "도시락", "비빔밥", "볶음밥", "알밥", "리조또", "정식", "백반", "컵밥", "치킨마요"]),
  }),
]);

const FOOD_CHARACTER_CONTEXT_RULES = Object.freeze([
  Object.freeze({
    value: "rice-meal",
    category: "도시락",
    keywords: Object.freeze(["돈까스", "돈가스"]),
  }),
]);

const FOOD_CHARACTER_MAIN_DISH_KEYWORDS = Object.freeze([
  "돈까스", "돈가스", "탕수육", "닭갈비", "찜닭", "두루치기", "불고기", "피자",
  "스테이크", "해물전", "제육볶음",
]);

const FOOD_CHARACTER_CATEGORY_FALLBACKS = Object.freeze({
  도시락: "rice-meal",
  햄버거: "quick-snack",
  분식: "quick-snack",
  "일식/돈까스": "main-dish",
});

const DEFAULT_PRIMARY_FOOD_CHARACTER = "main-dish";

function normalizeFoodCharacterText(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function classifyFoodCharacterFallback(item = {}) {
  const name = normalizeFoodCharacterText(item.name);
  const category = String(item.category || "").trim();

  for (const rule of FOOD_CHARACTER_NAME_RULES) {
    const keyword = rule.keywords.find((candidate) => name.includes(normalizeFoodCharacterText(candidate)));
    if (keyword) {
      return { value: rule.value, matchedRule: keyword, source: "name" };
    }
  }

  for (const rule of FOOD_CHARACTER_CONTEXT_RULES) {
    const keyword = rule.keywords.find((candidate) => name.includes(normalizeFoodCharacterText(candidate)));
    if (category === rule.category && keyword) {
      return { value: rule.value, matchedRule: `${rule.category}:${keyword}`, source: "name-category" };
    }
  }

  const mainDishKeyword = FOOD_CHARACTER_MAIN_DISH_KEYWORDS.find(
    (candidate) => name.includes(normalizeFoodCharacterText(candidate)),
  );
  if (mainDishKeyword) {
    return { value: "main-dish", matchedRule: mainDishKeyword, source: "name" };
  }

  const categoryValue = FOOD_CHARACTER_CATEGORY_FALLBACKS[category];
  if (categoryValue) {
    return { value: categoryValue, matchedRule: category, source: "category" };
  }

  return { value: DEFAULT_PRIMARY_FOOD_CHARACTER, matchedRule: "default", source: "default" };
}

function foodCharacter(item) {
  if (PRIMARY_FOOD_CHARACTERS.has(item?.foodCharacter)) return item.foodCharacter;
  return classifyFoodCharacterFallback(item).value;
}

function discoveryScore(item) {
  let score = 0;
  if (Number.isFinite(item.distance)) score += Math.min(item.distance / 55, 28);
  else score += 18;
  score += item.openNow ? -4 : 3;
  score -= item.signature ? 3 : 0;
  if (item.weatherBoost) score -= item.weatherBoost.score;
  if (!item.restaurant) score += 12;
  if (!Number.isFinite(Number(item.price)) || item.price <= 0) score += 18;
  if (item.price > 15000) score += Math.min((item.price - 15000) / 600, 16);
  score += seededNoise(item.id, item.restaurantId) * 16;
  return score;
}

function getDiscoveryMenus(options = {}) {
  return DATA.menus
    .filter((menu) => menu.available)
    .map((menu) =>
      scoreMenu(menu, {
        applyBudget: false,
        applyTaste: false,
        applyMoods: false,
        applyWeather: options.applyWeather ?? true,
        locationBase: options.locationBase,
      }),
    )
    .map((item) => ({
      ...item,
      discoveryCharacter: foodCharacter(item),
      discoveryScore: discoveryScore(item),
    }))
    .sort((a, b) => a.discoveryScore - b.discoveryScore);
}

function addQuickCandidates(selected, selectedIds, items, targetCount, preferDifferentRestaurant) {
  for (const item of items) {
    if (selected.length >= targetCount) return;
    if (selectedIds.has(item.id)) continue;
    if (preferDifferentRestaurant && selected.some((picked) => restaurantKey(picked) === restaurantKey(item))) continue;
    selected.push(item);
    selectedIds.add(item.id);
  }
}

function addQuickCandidatesByScore(selected, selectedIds, items, targetCount, heroScore, scoreSteps) {
  for (const maxGap of scoreSteps) {
    addQuickCandidates(
      selected,
      selectedIds,
      items.filter((item) => item.score - heroScore <= maxGap),
      targetCount,
      true,
    );
  }
  for (const maxGap of scoreSteps) {
    addQuickCandidates(
      selected,
      selectedIds,
      items.filter((item) => item.score - heroScore <= maxGap),
      targetCount,
      false,
    );
  }
}

function selectQuickRecommendations(allItems, { keepTop = false, seenIds = new Set(), previousIds = new Set() } = {}) {
  if (!allItems.length) return [];
  const targetCount = Math.min(3, allItems.length);
  const selected = [];
  const selectedIds = new Set();
  const heroScore = Number(allItems[0].score);
  const reliableSteps = [8, 12, 18, 26];
  const fallbackSteps = [34, 42];

  if (keepTop) {
    selected.push(allItems[0]);
    selectedIds.add(allItems[0].id);
  }

  const unseen = allItems.filter((item) => !seenIds.has(item.id));
  const reusable = allItems.filter((item) => seenIds.has(item.id) && !previousIds.has(item.id));
  const previous = allItems.filter((item) => previousIds.has(item.id));

  addQuickCandidatesByScore(selected, selectedIds, keepTop ? allItems : unseen, targetCount, heroScore, reliableSteps);
  addQuickCandidatesByScore(selected, selectedIds, unseen, targetCount, heroScore, fallbackSteps);
  addQuickCandidatesByScore(selected, selectedIds, reusable, targetCount, heroScore, reliableSteps);
  addQuickCandidatesByScore(selected, selectedIds, reusable, targetCount, heroScore, fallbackSteps);
  addQuickCandidatesByScore(selected, selectedIds, previous, targetCount, heroScore, reliableSteps);
  addQuickCandidatesByScore(selected, selectedIds, previous, targetCount, heroScore, fallbackSteps);
  addQuickCandidates(selected, selectedIds, allItems.filter((item) => !previousIds.has(item.id)), targetCount, true);
  addQuickCandidates(selected, selectedIds, allItems.filter((item) => !previousIds.has(item.id)), targetCount, false);
  addQuickCandidates(selected, selectedIds, allItems, targetCount, true);
  addQuickCandidates(selected, selectedIds, allItems, targetCount, false);
  return selected.slice(0, targetCount);
}

function addDiscoveryCandidates(selected, selectedIds, items, targetCount, { differentRestaurant = false, differentCharacter = false } = {}) {
  for (const item of items) {
    if (selected.length >= targetCount) return;
    if (selectedIds.has(item.id)) continue;
    if (differentRestaurant && selected.some((picked) => restaurantKey(picked) === restaurantKey(item))) continue;
    if (differentCharacter && selected.some((picked) => picked.discoveryCharacter === item.discoveryCharacter)) continue;
    selected.push(item);
    selectedIds.add(item.id);
  }
}

function fillDiscoveryCandidates(selected, selectedIds, items, targetCount) {
  addDiscoveryCandidates(selected, selectedIds, items, targetCount, { differentRestaurant: true, differentCharacter: true });
  addDiscoveryCandidates(selected, selectedIds, items, targetCount, { differentRestaurant: true });
  addDiscoveryCandidates(selected, selectedIds, items, targetCount, { differentCharacter: true });
  addDiscoveryCandidates(selected, selectedIds, items, targetCount);
}

function selectDiscoveryRecommendations(allItems, { seenIds = new Set(), previousIds = new Set() } = {}) {
  if (!allItems.length) return [];
  const targetCount = Math.min(3, allItems.length);
  const selected = [];
  const selectedIds = new Set();
  const unseen = allItems.filter((item) => !seenIds.has(item.id));
  const reusable = allItems.filter((item) => seenIds.has(item.id) && !previousIds.has(item.id));
  const previous = allItems.filter((item) => previousIds.has(item.id));

  fillDiscoveryCandidates(selected, selectedIds, unseen, targetCount);
  fillDiscoveryCandidates(selected, selectedIds, reusable, targetCount);
  fillDiscoveryCandidates(selected, selectedIds, previous, targetCount);

  return selected.slice(0, targetCount);
}

function updateQuickRecommendations({ reroll = false, applyWeather = true, locationBase } = {}) {
  const mode = quickRecommendationMode();
  const resolvedLocationBase = locationBase || currentBase();
  if (state.quickMode !== mode) {
    state.quickItems = [];
    state.quickSeenIds = new Set();
    resetDiscoveryNudgeCycle();
  }
  state.quickMode = mode;
  const all = mode === "discovery"
    ? getDiscoveryMenus({ applyWeather, locationBase: resolvedLocationBase })
    : getRecommendedMenus({ mode: "custom", applyWeather, locationBase: resolvedLocationBase });
  const previousIds = new Set(state.quickItems.map((item) => item.id));
  const keepTop = !reroll && !state.quickSeenIds.size;
  state.quickItems =
    mode === "discovery"
      ? selectDiscoveryRecommendations(all, {
          seenIds: state.quickSeenIds,
          previousIds,
        })
      : selectQuickRecommendations(all, {
          keepTop,
          seenIds: reroll || state.quickSeenIds.size ? state.quickSeenIds : new Set(),
          previousIds,
        });
  state.quickItems.forEach((item) => state.quickSeenIds.add(item.id));
  state.quickAppliedWeather = Boolean(applyWeather && weatherFreshForRecommendation());
  state.quickLocationBase = { ...resolvedLocationBase };
  if (!state.suppressDiscoveryPickCount) {
    state.discoveryPickCount = mode === "discovery" ? state.discoveryPickCount + 1 : 0;
  }
  state.alternativesExpanded = false;
  state.page = 0;
  setAnalyticsRecommendationState();
}

function refreshQuickItemDerivedValues({ applyWeather = state.quickAppliedWeather, locationBase = currentBase() } = {}) {
  if (!state.quickItems.length) return;
  if (state.sharedPickStatus === "valid") {
    state.quickItems = resolveSharedPickItems(state.sharedPickIds, locationBase);
    state.quickAppliedWeather = false;
    state.quickLocationBase = { ...locationBase };
    return;
  }
  const all = state.quickMode === "discovery"
    ? getDiscoveryMenus({ applyWeather, locationBase })
    : getRecommendedMenus({ mode: "custom", applyWeather, locationBase });
  const byId = new Map(all.map((item) => [item.id, item]));
  state.quickItems = state.quickItems.map((item) => byId.get(item.id) || item);
  state.quickAppliedWeather = Boolean(applyWeather && weatherFreshForRecommendation());
  state.quickLocationBase = { ...locationBase };
}

function mapSearchConfig(item) {
  const restaurant = item?.restaurant || restaurantsById.get(item?.restaurantId) || item;
  const restaurantName = restaurant?.name || item?.restaurantName || "";
  const keyword = typeof restaurant?.mapSearchKeyword === "string" ? restaurant.mapSearchKeyword.trim() : "";
  return {
    disabled: restaurant?.mapSearchDisabled === true,
    query: keyword || `창원대 ${restaurantName}`,
  };
}

function mapUrl(item) {
  const config = mapSearchConfig(item);
  if (config.disabled) return null;
  return `https://map.naver.com/p/search/${encodeURIComponent(config.query)}`;
}

function mapActionHtml(item, { label = "네이버 지도", content = "", className = "", analyticsContext = null } = {}) {
  const url = mapUrl(item);
  const body = content || escapeHtml(label);
  const classAttribute = className ? ` class="${escapeHtml(className)}"` : "";
  if (!url) {
    const unavailableClass = [className, "map-action-unavailable"].filter(Boolean).join(" ");
    return `<button type="button" class="${escapeHtml(unavailableClass)}" data-map-unavailable title="현재 네이버 지도에 등록된 가게 정보가 없어요.">${body}</button>`;
  }
  return `<a${classAttribute}${analyticsMapAttributes(item, analyticsContext)} href="${url}" target="_blank" rel="noreferrer">${body}</a>`;
}

function tags(item) {
  const base = [];
  if (item.customTaste) base.push("내 입맛");
  else if (item.publicTaste?.vote_count > 0) base.push("평균 입맛");
  if (item.reviewSummary?.review_count > 0) base.push(`★ ${Number(item.reviewSummary.avg_rating).toFixed(1)}`);
  if (item.openNow) base.push("영업 가능");
  if (item.restaurant?.alone) base.push("혼밥");
  if (item.restaurant?.takeout) base.push("포장");
  if (item.restaurant?.delivery) base.push("배달");
  if (item.meat) base.push("고기");
  base.push(distanceLabel(item.distance));
  return uniqueTags([...base, ...item.tags.slice(0, 3)]);
}

function uniqueTags(values) {
  return values.filter((tag, index, arr) => tag && arr.indexOf(tag) === index);
}

function compactTags(item, limit = 4) {
  return tags(item).slice(0, limit);
}

function compactTagsExcluding(item, excludedTags, limit = 4) {
  const excluded = new Set(excludedTags);
  return tags(item)
    .filter((tag) => !excluded.has(tag))
    .slice(0, limit);
}

function recommendationReasons(item) {
  const conditions = appliedRecommendationConditions();
  const reasons = [];
  const tasteDiff = Math.abs(item.taste.spicy - conditions.spicy) + Math.abs(item.taste.salty - conditions.salty) + Math.abs(item.taste.sweet - conditions.sweet);
  if (item.weatherBoost?.reason) reasons.push(item.weatherBoost.reason);
  if (tastePreferenceReasonEnabled(item, conditions) && tasteDiff <= 2) reasons.push("선택한 맛 취향과 잘 맞아요.");
  if (budgetPreferenceEnabled(conditions) && item.price <= conditions.budget) reasons.push(`예산 ${money(conditions.budget)} 안에 들어요.`);
  if (Number.isFinite(item.distance)) reasons.push(`${meters(item.distance)} 거리라 이동 부담이 적어요.`);
  if (conditions.needAlone && item.restaurant?.alone) reasons.push("혼밥 조건에 맞는 곳이에요.");
  if (conditions.needTakeout && item.restaurant?.takeout) reasons.push("포장 가능한 곳이에요.");
  if (conditions.needDelivery && item.restaurant?.delivery) reasons.push("배달 가능한 곳이에요.");
  if (conditions.wantMeat && item.meat) reasons.push("고기 메뉴 조건에 맞아요.");
  if (item.value >= 4) reasons.push("가격 대비 만족도가 좋아요.");
  const uniqueReasons = uniqueTags(reasons);
  return uniqueReasons.length ? uniqueReasons.slice(0, 4) : ["현재 조건에서 추천 점수가 높은 메뉴예요."];
}

function discoveryReasons(item) {
  const reasons = [];
  if (item.weatherBoost?.reason) reasons.push(item.weatherBoost.reason);
  if (Number.isFinite(item.distance) && item.distance <= 700) reasons.push("가까운 곳에서 먹을 수 있어요.");
  if (item.openNow) reasons.push("현재 영업 정보를 확인할 수 있는 가게예요.");
  if (item.signature || item.value >= 4) reasons.push("오늘은 이런 메뉴 어때요?");
  const uniqueReasons = uniqueTags(reasons);
  return uniqueReasons.length ? uniqueReasons.slice(0, 3) : ["오늘은 이런 메뉴 어때요?"];
}

function displayReasons(item, context = "custom") {
  return context === "discovery" ? discoveryReasons(item) : recommendationReasons(item);
}

function cardHtml(item, rank, context = "custom") {
  const wished = isWished(item.id);
  const reviewLine = item.reviewSummary?.review_count
    ? `<p class="review-line">별점 ${Number(item.reviewSummary.avg_rating).toFixed(1)} · 위생 ${Number(item.reviewSummary.avg_hygiene).toFixed(1)} · 친절 ${Number(item.reviewSummary.avg_kindness).toFixed(1)} · 후기 ${item.reviewSummary.review_count}</p>`
    : "";
  const reasonText = displayReasons(item, context).slice(0, 2).join(" ");
  const reasonTags = context === "discovery" ? [] : uniqueTags(item.reasons).slice(0, 3);
  const metaTags = compactTagsExcluding(item, reasonTags);
  return `
    <div class="menu-card__top">
      <div>
        <h3>${rank}. ${item.name}</h3>
        <p class="store-line">${item.restaurant?.name || item.restaurantName} · ${item.category} · ${meters(item.distance)}</p>
        ${reviewLine}
        <p class="recommend-copy">${reasonText || "현재 조건과 가까운 메뉴예요."}</p>
      </div>
      <div class="card-side">
        <button class="heart-button ${wished ? "is-wished" : ""}" data-wish="${item.id}" aria-label="${wished ? "찜 해제" : "찜하기"}">${wished ? "♥" : "♡"}</button>
        <div class="price">${money(item.price)}</div>
      </div>
    </div>
    <div class="reason-list">${reasonTags.map((reason) => `<span>${reason}</span>`).join("")}</div>
    <div class="meta-tags">${metaTags.map((tag) => `<span>${tag}</span>`).join("")}</div>
    <div class="card-actions">
      <button data-detail="${item.id}">상세 보기</button>
      <button data-ate="${item.id}">먹었어요</button>
      ${mapActionHtml(item)}
    </div>
  `;
}

function quickReasonText(item) {
  if (item.weatherBoost?.label) {
    return {
      "비 오는 날": "비 오는 날 잘 어울리는 메뉴예요.",
      "더운 날": "더운 날 잘 어울리는 메뉴예요.",
      "추운 날": "쌀쌀한 날 잘 어울리는 메뉴예요.",
      "흐린 날": "흐린 날 잘 어울리는 메뉴예요.",
    }[item.weatherBoost.label] || item.weatherBoost.reason;
  }
  const reasons = state.quickMode === "discovery" ? discoveryReasons(item) : recommendationReasons(item);
  const reason = reasons[0] || "";
  if (reason.startsWith("예산 ")) return "설정한 예산 안에 들어요.";
  if (reason.includes("거리라 이동 부담")) return `${meters(item.distance)} 거리예요.`;
  if (reason === "현재 영업 정보를 확인할 수 있는 가게예요.") return "영업 정보를 확인할 수 있어요.";
  return reason || (state.quickMode === "discovery" ? "오늘은 이런 메뉴 어때요?" : "선택한 조건에 잘 맞는 메뉴예요.");
}

function mukjjiEmptyHtml(message, className = "") {
  return `
    <div class="empty-state mukjji-empty ${className}">
      <img src="./assets/mukjji/04_mukjji_thinking_512.webp" alt="묵찌가 고민 중이에요" width="72" height="72" loading="lazy" />
      <span>${message}</span>
    </div>
  `;
}

function quickHeroHtml(item) {
  const wished = isWished(item.id);
  const badge = state.sharedPickStatus === "valid"
    ? "후보 1"
    : state.quickMode === "discovery"
      ? "오늘의 픽"
      : "맞춤 추천 1순위";
  const mobileBadge = state.sharedPickStatus === "valid" ? "후보 1" : "추천 1";
  const mukjjiSrc = state.quickMode === "discovery"
    ? "./assets/mukjji/05_mukjji_recommend_bowl_512.webp"
    : "./assets/mukjji/07_mukjji_best_pick_512.webp";
  return `
    <article class="quick-hero-card">
      <button type="button" class="quick-card-detail-hit" data-detail="${item.id}" data-detail-context="${state.quickMode}" aria-label="${escapeHtml(item.name)} 상세 보기"></button>
      <div class="quick-hero-head">
        <div class="quick-rank-badge"><span class="quick-rank-label-desktop">${badge}</span><span class="quick-rank-label-mobile">${mobileBadge}</span></div>
        <button class="heart-button ${wished ? "is-wished" : ""}" data-wish="${item.id}" aria-label="${wished ? "찜 해제" : "찜하기"}">${wished ? "♥" : "♡"}</button>
      </div>
      <div class="quick-hero-main">
        <div>
          <h3>${escapeHtml(item.name)}</h3>
          <p class="store-line">${escapeHtml(item.restaurant?.name || item.restaurantName)} · ${money(item.price)} · ${meters(item.distance)}</p>
          <p class="recommend-copy">${quickReasonText(item)}</p>
        </div>
        <img class="quick-card-mukjji quick-hero-mukjji" src="${mukjjiSrc}" alt="" width="108" height="108" loading="lazy" aria-hidden="true" />
      </div>
      <div class="card-actions quick-actions">
        <button data-ate="${item.id}" aria-label="${escapeHtml(item.name)} 먹었어요">먹었어요</button>
        ${mapActionHtml(item, { content: '<span class="quick-map-label-desktop">네이버 지도</span><span class="quick-map-label-mobile">지도</span>', analyticsContext: state.quickMode })}
      </div>
    </article>
  `;
}

function quickAlternativeHtml(item, rank) {
  const wished = isWished(item.id);
  const label = state.sharedPickStatus === "valid"
    ? `후보 ${rank}`
    : state.quickMode === "discovery"
      ? (rank === 2 ? "다른 선택" : "또 다른 선택")
      : `맞춤 추천 ${rank}순위`;
  const mobileLabel = state.sharedPickStatus === "valid" ? `후보 ${rank}` : `추천 ${rank}`;
  const mukjjiSrc = rank === 2
    ? "./assets/mukjji/09_mukjji_greeting_plain_512.webp"
    : "./assets/mukjji/06_mukjji_eating_happy_512.webp";
  return `
    <article class="quick-alt-card">
      <button type="button" class="quick-card-detail-hit" data-detail="${item.id}" data-detail-context="${state.quickMode}" aria-label="${escapeHtml(item.name)} 상세 보기"></button>
      <div class="quick-alt-top">
        <span><img class="quick-alt-badge-mukjji" src="${mukjjiSrc}" alt="" width="30" height="30" loading="lazy" aria-hidden="true" /><b class="quick-rank-label-desktop">${label}</b><b class="quick-rank-label-mobile">${mobileLabel}</b></span>
        <button class="heart-button ${wished ? "is-wished" : ""}" data-wish="${item.id}" aria-label="${wished ? "찜 해제" : "찜하기"}">${wished ? "♥" : "♡"}</button>
      </div>
      <h3>${escapeHtml(item.name)}</h3>
      <p class="store-line">${escapeHtml(item.restaurant?.name || item.restaurantName)} · ${money(item.price)} · ${meters(item.distance)}</p>
      <img class="quick-card-mukjji quick-alt-card-mukjji" src="${mukjjiSrc}" alt="" width="72" height="72" loading="lazy" aria-hidden="true" />
      <p class="recommend-copy">${quickReasonText(item)}</p>
      <div class="card-actions quick-alt-actions">
        <button data-ate="${item.id}" aria-label="${escapeHtml(item.name)} 먹었어요">먹었어요</button>
        ${mapActionHtml(item, { content: '<span class="quick-map-label-desktop">지도</span><span class="quick-map-label-mobile">지도</span>', analyticsContext: state.quickMode })}
      </div>
    </article>
  `;
}

function quickRecommendationsHtml(items) {
  if (!items.length) {
    return mukjjiEmptyHtml("지금 먹을 메뉴 추천해 줘 버튼을 누르면 바로 3개를 골라드려요.", "quick-empty");
  }
  const [hero, ...alternatives] = items;
  const alternativeGrid = alternatives.length
    ? `<div class="quick-alt-grid">${alternatives.map((item, index) => quickAlternativeHtml(item, index + 2)).join("")}</div>`
    : "";
  const preferenceNote = discoveryStoredPreferenceNoteHtml();
  const returnDiscovery = returnDiscoveryButtonHtml();
  return `
    <div class="quick-recommend-grid">
      ${quickHeroHtml(hero)}
      ${alternativeGrid}
      ${preferenceNote}
      ${returnDiscovery}
    </div>
  `;
}

function shouldShowDiscoveryNudge() {
  return state.quickMode === "discovery" && state.rerollPromptVisible;
}

function discoveryStoredPreferenceNoteHtml() {
  if (state.sharedPickStatus !== "none" || state.quickMode !== "discovery" || !hasCustomRecommendationConditions(appliedRecommendationConditions())) return "";
  return `<p class="discovery-mode-note">저장된 취향은 맞춤 추천을 선택하면 반영돼요.</p>`;
}

function returnDiscoveryButtonHtml() {
  if (state.quickMode !== "custom") return "";
  return `<button type="button" class="discovery-preference-link return-discovery-link" data-return-discovery>랜덤 추천으로 돌아가기</button>`;
}

function restaurantReviewSummary(restaurantId) {
  const menuIds = DATA.menus.filter((menu) => menu.restaurantId === restaurantId).map((menu) => menu.id);
  const summaries = menuIds.map((id) => state.publicReviewSummary[id]).filter((summary) => summary?.review_count > 0);
  const local = Object.values(state.reviews).filter((review) => menuIds.includes(review.menuId));
  const rows = [
    ...summaries.map((summary) => ({
      rating: Number(summary.avg_rating) * Number(summary.review_count),
      hygiene: Number(summary.avg_hygiene) * Number(summary.review_count),
      kindness: Number(summary.avg_kindness) * Number(summary.review_count),
      count: Number(summary.review_count),
    })),
    ...local.map((review) => ({
      rating: Number(review.rating || 0),
      hygiene: Number(review.hygiene || 0),
      kindness: Number(review.kindness || 0),
      count: 1,
    })),
  ];
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (!total) return null;
  return {
    rating: rows.reduce((sum, row) => sum + row.rating, 0) / total,
    hygiene: rows.reduce((sum, row) => sum + row.hygiene, 0) / total,
    kindness: rows.reduce((sum, row) => sum + row.kindness, 0) / total,
    count: total,
  };
}

function storeMenuMatches(menu, term) {
  if (!term) return false;
  return `${menu.name} ${menu.category} ${(menu.tags || []).join(" ")}`.toLowerCase().includes(term);
}

function setStoreSearchTerm(value) {
  if (state.storeSearchTerm !== value) resetStoreMenuExpansions();
  state.storeSearchTerm = value;
}

function toggleStoreMenuExpansion(restaurantId) {
  state.expandedStoreMenus.has(restaurantId) ? state.expandedStoreMenus.delete(restaurantId) : state.expandedStoreMenus.add(restaurantId);
  renderStoreSearch();
}

function renderStoreSearch() {
  if (!els.storeSearchResults) return;
  const term = state.storeSearchTerm.trim().toLowerCase();
  const restaurants = DATA.restaurants
    .map((restaurant) => {
      const menus = DATA.menus.filter((menu) => menu.restaurantId === restaurant.id);
      const haystack = `${restaurant.name} ${restaurant.category || ""} ${menus.map((menu) => `${menu.name} ${menu.category} ${menu.tags.join(" ")}`).join(" ")}`.toLowerCase();
      return { restaurant, menus, summary: restaurantReviewSummary(restaurant.id), matches: !term || haystack.includes(term) };
    })
    .filter((row) => row.matches)
    .slice(0, 20);

  const guide = `<p class="store-search-note">현재는 각 가게의 대표 메뉴 일부를 기준으로 보여줘요.</p>`;
  els.storeSearchResults.innerHTML = restaurants.length
    ? guide +
      restaurants
        .map(({ restaurant, menus, summary }) => {
          const availableMenus = menus.filter((menu) => menu.available);
          const restaurantMatched = term && `${restaurant.name} ${restaurant.category || ""}`.toLowerCase().includes(term);
          const matchedMenus = term ? availableMenus.filter((menu) => storeMenuMatches(menu, term)) : [];
          const sourceMenus = term ? (restaurantMatched ? availableMenus : matchedMenus) : availableMenus;
          const scoredMenus = sourceMenus.map(scoreMenu).sort((a, b) => a.price - b.price);
          const expanded = state.expandedStoreMenus.has(restaurant.id);
          const visibleMenus = term || expanded ? scoredMenus : scoredMenus.slice(0, 3);
          const toggleButton =
            !term && scoredMenus.length > 3
              ? `<button class="store-menu-toggle" data-store-menu-toggle="${restaurant.id}" aria-expanded="${expanded}" aria-label="${escapeHtml(restaurant.name)} 대표 메뉴 ${expanded ? "접기" : "더보기"}">${expanded ? "대표 메뉴 접기" : "대표 메뉴 더보기"}</button>`
              : "";
          const searchHint = term && restaurantMatched ? `<p class="store-search-match-note">가게 이름과 일치해 등록 메뉴를 보여줘요.</p>` : "";
          const statLine = summary
            ? `별점 ${summary.rating.toFixed(1)} · 위생 ${summary.hygiene.toFixed(1)} · 친절 ${summary.kindness.toFixed(1)} · 후기 ${summary.count}개`
            : "아직 등록된 평점이 없어요.";
          return `
            <article class="store-card">
              <div class="menu-card__top">
                <div>
                  <h3>${escapeHtml(restaurant.name)}</h3>
                  <p class="store-line">${restaurant.category || "음식점"} · ${meters(haversine(currentBase(), restaurant))}</p>
                  <p class="review-line">${statLine}</p>
                </div>
                ${mapActionHtml({ restaurant, restaurantName: restaurant.name }, { label: "지도", className: "store-map-button", analyticsContext: "search" })}
              </div>
              ${searchHint}
              <div class="store-menu-list">
                ${visibleMenus
                  .map((menu) => `<button data-detail="${menu.id}" data-detail-context="search"><span>${escapeHtml(menu.name)}</span><strong>${money(menu.price)}</strong></button>`)
                  .join("")}
              </div>
              ${toggleButton}
              <div class="info-footer">
                <span>정보 기준일 ${DATA_UPDATED_AT}</span>
                <button data-report-open data-report-type="wrong_info" data-report-target-type="restaurant" data-report-target-id="${restaurant.id}" data-report-target-label="${escapeHtml(restaurant.name)}">이 가게 정보 제보</button>
              </div>
            </article>
          `;
        })
        .join("")
    : `${guide}<div class="empty-state">검색 결과가 없어요. 가게 이름이나 메뉴명을 조금 다르게 입력해보세요.</div>`;
}

function renderRecommendations() {
  const sharedView = state.sharedPickStatus !== "none";
  const sharedError = state.sharedPickStatus === "error";
  const hasResults = Boolean(state.hasSearched && (state.quickItems.length || sharedError));
  els.recommendSection?.classList.toggle("is-pristine", !state.hasSearched);
  document.body.classList.toggle("has-recommendations", hasResults);
  if (els.recommendActionDock) els.recommendActionDock.hidden = !hasResults;
  if (els.sharePickButton) els.sharePickButton.hidden = state.quickItems.length !== 3;
  if (!state.hasSearched) {
    els.recommendTitle.textContent = "메뉴 추천";
    if (els.recommendSubtitle) els.recommendSubtitle.hidden = true;
    els.quickRecommendPanel.innerHTML = "";
    if (els.sharePickButton) els.sharePickButton.hidden = true;
    els.rerollQuickButton.style.display = "none";
    els.toggleAlternativesButton.style.display = "none";
    els.menuList.innerHTML = "";
    els.nextRecommendButton.style.display = "none";
    return;
  }
  const { all } = sharedView ? { all: state.quickItems } : pageMenus();
  const mode = sharedView ? "discovery" : quickRecommendationMode();
  state.quickMode = mode;
  els.recommendTitle.textContent = sharedView
    ? "친구가 보낸 메뉴 후보예요"
    : all.length
      ? (mode === "discovery" ? "오늘의 메뉴 3개" : "맞춤 메뉴 3개")
      : "추천 결과 없음";
  if (els.recommendSubtitle) {
    els.recommendSubtitle.textContent = sharedView ? "이 중에 뭐 먹을까요?" : "";
    els.recommendSubtitle.hidden = !sharedView;
  }
  els.quickRecommendPanel.innerHTML = sharedError
    ? `<div class="empty-state shared-pick-error" role="status">공유된 메뉴 정보를 불러올 수 없어요.</div>`
    : state.quickItems.length
      ? quickRecommendationsHtml(state.quickItems)
      : `<div class="empty-state">조건에 맞는 메뉴가 없어요. 예산이나 조건을 조금 풀어보세요.</div>`;
  if (!sharedError && state.quickItems.length === 3) analyticsClient?.recordRecommendationShown();
  const nudgeVisible = Boolean(!sharedView && state.quickItems.length && shouldShowDiscoveryNudge());
  const rerollAvailable = sharedView || all.length > 3;
  if (els.recommendActionDock) els.recommendActionDock.hidden = !hasResults || (!rerollAvailable && !nudgeVisible);
  els.rerollQuickButton.style.display = rerollAvailable && !nudgeVisible ? "block" : "none";
  els.rerollQuickButton.textContent = "다른 메뉴 추천해줘";
  if (els.recommendNudge) els.recommendNudge.hidden = !nudgeVisible;
  els.toggleAlternativesButton.style.display = "none";
  els.menuList.innerHTML = "";
  els.nextRecommendButton.style.display = "none";
}

function openRoulette() {
  if (!state.hasSearched) {
    toast("먼저 조건에 맞게 찾아주세요!");
    return;
  }
  const pool = getRecommendedMenus().slice(0, 10);
  if (pool.length < 2) {
    toast("룰렛 후보가 없어요");
    return;
  }
  state.roulette = {
    active: true,
    items: pool,
    selected: null,
    selectedIndex: -1,
    rotation: 0,
    spinning: true,
  };
  renderRoulette();
  pushAppState("roulette");
  els.roulettePanel?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function stopRoulette() {
  if (!state.roulette.active || !state.roulette.spinning) return;
  const items = state.roulette.items;
  const selectedIndex = Math.floor(Math.random() * items.length);
  const selected = items[selectedIndex];
  const segment = 360 / items.length;
  const targetCenter = selectedIndex * segment + segment / 2;
  const extraTurns = 5 * 360;
  state.roulette.selected = selected;
  state.roulette.selectedIndex = selectedIndex;
  state.roulette.rotation = extraTurns - targetCenter;
  state.roulette.spinning = false;
  renderRoulette();
  window.setTimeout(() => {
    state.roulette.selected = selected;
    renderRoulette();
  }, 1200);
}

function closeRoulette() {
  state.roulette = { active: false, items: [], selected: null, selectedIndex: -1, rotation: 0, spinning: false };
  renderRoulette();
}

function rerollRoulette() {
  if (!state.roulette.active) {
    openRoulette();
    return;
  }
  const pool = getRecommendedMenus().slice(0, 10);
  state.roulette = {
    active: true,
    items: pool.length ? pool : state.roulette.items,
    selected: null,
    selectedIndex: -1,
    rotation: 0,
    spinning: true,
  };
  renderRoulette();
}

function renderRoulette() {
  if (!els.roulettePanel || !els.rouletteWheel) return;
  const roulette = state.roulette;
  els.roulettePanel.classList.toggle("is-active", roulette.active);
  if (!roulette.active) return;
  const items = roulette.items;
  els.rouletteWheel.classList.toggle("is-spinning", roulette.spinning);
  els.rouletteWheel.classList.toggle("is-stopping", Boolean(roulette.selected) && !roulette.spinning);
  els.rouletteWheel.style.setProperty("--roulette-rotation", `${roulette.rotation}deg`);
  els.rouletteWheel.innerHTML = items
    .map(
      (item, index) => `
        <div class="roulette-segment ${index === roulette.selectedIndex ? "is-picked" : ""}" style="--i:${index}; --count:${items.length};">
          <span>${escapeHtml(item.name)}</span>
        </div>
      `,
    )
    .join("");
  els.rouletteStatus.textContent = roulette.spinning
    ? "룰렛이 돌아가고 있어요. 원하는 순간 STOP!"
      : roulette.selected
      ? `${roulette.selected.name} 선택!`
      : "추천 후보로 룰렛을 준비했어요.";
  els.stopRouletteButton.disabled = !roulette.spinning;
  els.stopRouletteButton.style.display = roulette.spinning ? "block" : "none";
  els.rerollRouletteButton.style.display = roulette.spinning ? "none" : "block";
  els.rouletteResult.innerHTML =
    roulette.selected && !roulette.spinning
      ? `<article class="menu-card">${cardHtml(roulette.selected, 1)}</article>`
      : "";
}

function renderChips() {
  const counts = countBy(DATA.menus, (menu) => menu.category);
  const countMap = new Map(counts);
  const categories = [...new Set(DATA.menus.map((menu) => menu.category))].sort((a, b) => {
    const orderA = CATEGORY_META[a]?.order || 99;
    const orderB = CATEGORY_META[b]?.order || 99;
    return orderA - orderB || a.localeCompare(b, "ko");
  });
  els.categoryGrid.innerHTML = categories
    .map((category) => {
      const meta = CATEGORY_META[category] || { icon: "korean.png" };
      return `
        <button class="category-chip" data-category="${category}" aria-pressed="false">
          <img src="./assets/categories/${meta.icon}" alt="" loading="lazy" />
          <span>${category}</span>
          <small>메뉴 ${countMap.get(category) || 0}개</small>
        </button>
      `;
    })
    .join("");
  els.moodGrid.innerHTML = MOOD_OPTIONS.map((mood) => `<button class="choice-chip" data-mood="${mood}" aria-pressed="false">${mood}</button>`).join("");
  els.worldcupCategoryGrid.innerHTML = categories.map((category) => `<button class="choice-chip" data-worldcup-category="${category}" aria-pressed="false">${category}</button>`).join("");
}

function syncConditionDetailsAccessibility() {
  const summary = els.conditionDetails?.querySelector("summary");
  if (!summary) return;
  summary.setAttribute("aria-expanded", String(els.conditionDetails.open));
}

function syncControls() {
  if (els.quickRecommendButton) {
    const quickDisabled = !state.appReady || state.isSearching;
    els.quickRecommendButton.disabled = quickDisabled;
    els.quickRecommendButton.setAttribute("aria-busy", String(!state.appReady || state.isSearching));
    els.quickRecommendButton.textContent = !state.appReady
      ? "추천 준비 중..."
      : state.isSearching
        ? "추천 고르는 중..."
        : "메뉴 3개 추천받기";
  }
  if (els.searchButton) els.searchButton.disabled = state.isSearching;
  if (els.rerollQuickButton) els.rerollQuickButton.disabled = state.isSearching;
  els.budgetRange.value = String(state.budget);
  els.budgetValue.textContent = `${Number(state.budget).toLocaleString("ko-KR")}원 이하`;
  els.spicyPreference.value = String(state.spicy);
  els.saltyPreference.value = String(state.salty);
  els.sweetPreference.value = String(state.sweet);
  els.spicyValue.textContent = String(state.spicy);
  els.saltyValue.textContent = String(state.salty);
  els.sweetValue.textContent = String(state.sweet);
  els.onlyOpen.checked = state.onlyOpen;
  els.needTakeout.checked = state.needTakeout;
  els.needDelivery.checked = state.needDelivery;
  els.needAlone.checked = state.needAlone;
  els.wantMeat.checked = state.wantMeat;

  document.querySelectorAll("[data-category]").forEach((button) => {
    const selected = state.categories.has(button.dataset.category);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll("[data-mood]").forEach((button) => {
    const selected = state.moods.has(button.dataset.mood);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll("[data-worldcup-category]").forEach((button) => {
    const selected = state.worldcupCategories.has(button.dataset.worldcupCategory);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  syncConditionDetailsAccessibility();
}

function renderConditionSummary() {
  if (!state.hasSearched) {
    els.conditionSummary.textContent = "창원대 앞 메뉴를 빠르게 3개 골라드려요.";
    return;
  }
  if (quickRecommendationMode() === "discovery") {
    els.conditionSummary.textContent = "전체 음식 · 예산 자유 · 상황 자유";
    return;
  }
  const conditions = appliedRecommendationConditions();
  const categoryText = conditions.categories.length ? conditions.categories.join(", ") : "전체 음식";
  const moodText = conditions.moods.length ? conditions.moods.slice(0, 2).join(", ") : "상황 자유";
  const moreMood = conditions.moods.length > 2 ? ` 외 ${conditions.moods.length - 2}` : "";
  const budgetText = budgetPreferenceEnabled(conditions) ? `${Number(conditions.budget).toLocaleString("ko-KR")}원 이하` : "예산 자유";
  els.conditionSummary.textContent = `${categoryText} · ${budgetText} · ${moodText}${moreMood}`;
}

function renderLocationStatus() {
  if (state.locationStatus === "ready") {
    els.locationStatus.textContent = "현재 위치 기준 거리";
    els.locationButton.textContent = "위치";
    els.locationButton.setAttribute("aria-label", "위치 갱신");
  } else if (state.locationStatus === "denied") {
    els.locationStatus.textContent = "창원대 정문 기준 거리";
    els.locationButton.textContent = "허용";
    els.locationButton.setAttribute("aria-label", "위치 허용");
  } else if (state.locationStatus === "unsupported") {
    els.locationStatus.textContent = "창원대 정문 기준 거리";
    els.locationButton.textContent = "불가";
    els.locationButton.setAttribute("aria-label", "위치 사용 불가");
  } else if (state.locationStatus === "idle") {
    els.locationStatus.textContent = "창원대 정문 기준 거리";
    els.locationButton.textContent = "위치";
    els.locationButton.setAttribute("aria-label", "내 위치 기준 선택");
  } else {
    els.locationStatus.textContent = "거리 계산 중";
    els.locationButton.textContent = "확인";
    els.locationButton.setAttribute("aria-label", "위치 확인 중");
  }
}

function renderWeatherCard() {
  if (!els.weatherCard) return;
  const weather = state.weather;
  const toggleText = state.weatherEnabled ? "ON" : "OFF";
  const toggleLabel = state.weatherEnabled ? "현재 날씨 참고 끄기" : "현재 날씨 참고 켜기";
  const toggle = `
    <button class="weather-toggle ${state.weatherEnabled ? "is-on" : ""}" data-weather-toggle aria-pressed="${state.weatherEnabled}" aria-label="${toggleLabel}">
      현재 날씨 참고 ${toggleText}
    </button>
  `;
  if (!state.weatherEnabled) {
    els.weatherCard.innerHTML = `
      <div class="weather-main">
        <span class="weather-symbol" aria-hidden="true">${weatherIcon(null)}</span>
        <div>
          <p class="eyebrow">Weather</p>
          <strong>현재 날씨 참고 OFF</strong>
          <span>직접 켠 경우에만 작은 추천 가산점으로 참고해요.</span>
        </div>
      </div>
      ${toggle}
    `;
    return;
  }
  if (!weather) {
    els.weatherCard.innerHTML = `
      <div class="weather-main">
        <span class="weather-symbol" aria-hidden="true">${weatherIcon(null)}</span>
        <div>
          <p class="eyebrow">Weather</p>
          <strong>${state.weatherStatus === "loading" ? "창원대 앞 날씨 확인 중" : "날씨 정보를 준비하지 못했어요"}</strong>
          <span>날씨 정보가 없어서 추천 점수에는 반영하지 않아요.</span>
        </div>
      </div>
      ${toggle}
    `;
    return;
  }
  const kind = weatherKind(weather);
  const fetchedAt = formatDateTime(weather.fetchedAt);
  const isFresh = cachedWeatherFresh(weather) && ["cached", "synced"].includes(state.weatherStatus);
  const helper = !state.weatherEnabled
    ? "설정이 꺼져 있어 추천 점수에는 반영하지 않아요."
    : !isFresh
      ? "최근 날씨가 아니라 추천 점수에는 반영하지 않아요."
      : kind === "rain"
        ? "비 오는 날 어울리는 메뉴에만 작은 가산점을 줘요."
        : kind === "hot"
          ? "더운 날 가볍게 먹기 좋은 메뉴에만 작은 가산점을 줘요."
          : kind === "cold"
            ? "쌀쌀한 날 어울리는 든든한 메뉴에만 작은 가산점을 줘요."
            : "현재 날씨는 추천 점수에 반영하지 않아요.";
  els.weatherCard.innerHTML = `
    <div class="weather-main">
      <span class="weather-symbol" aria-hidden="true">${weatherIcon(kind)}</span>
      <div>
        <p class="eyebrow">Weather</p>
        <strong>${escapeHtml(weather.location || "창원대 앞")} · ${Number(weather.temp).toFixed(0)}°C · ${escapeHtml(weather.description || "날씨")}</strong>
        <span>${helper} ${fetchedAt ? `최근 갱신 ${fetchedAt}` : ""}</span>
      </div>
    </div>
    ${toggle}
  `;
}

function saveWeather(weather) {
  state.weather = weather;
  localStorage.setItem("changwonFoodWeather", JSON.stringify(weather));
}

function cachedWeatherFresh(weather = state.weather) {
  const time = new Date(weather?.fetchedAt || 0).getTime();
  return Number.isFinite(time) && Date.now() - time < WEATHER_CACHE_MS;
}

async function loadWeather() {
  if (cachedWeatherFresh()) {
    state.weatherStatus = "cached";
    renderWeatherCard();
    return;
  }
  state.weatherStatus = "loading";
  renderWeatherCard();
  try {
    const response = await fetch("/api/weather", { headers: { Accept: "application/json" } });
    const result = await response.json();
    if (!response.ok || !result?.ok || !result.weather) throw new Error(result?.error || "날씨 조회 실패");
    if (result.stale) {
      state.weather = result.weather;
      state.weatherStatus = "stale";
    } else {
      saveWeather(result.weather);
      state.weatherStatus = result.cached ? "cached" : "synced";
    }
    render();
  } catch (error) {
    state.weatherStatus = "failed";
    console.warn("weather load failed", error);
    renderWeatherCard();
  }
}

function toggleWeatherReference() {
  state.weatherEnabled = !state.weatherEnabled;
  localStorage.setItem(WEATHER_SETTING_KEY, String(state.weatherEnabled));
  markConditionsChanged();
  if (!state.weatherEnabled) {
    refreshQuickItemDerivedValues({ applyWeather: false, locationBase: state.quickLocationBase || currentBase() });
    render();
  } else {
    renderConditionDraft();
  }
  if (state.weatherEnabled && !cachedWeatherFresh()) loadWeather();
}

function render() {
  syncControls();
  renderSavedPreferenceCard();
  renderConditionSummary();
  renderLocationStatus();
  renderWeatherCard();
  renderRecommendations();
  renderWorldcup();
  renderWishlist();
  renderDashboard();
  renderRoulette();
  renderStoreSearch();
  els.searchOverlay?.classList.toggle("is-visible", state.isSearching);
}

function renderConditionDraft() {
  syncControls();
  renderSavedPreferenceCard();
  renderWeatherCard();
}

function copyAppliedConditionsToDraft() {
  applyRecommendationPreferences(appliedRecommendationConditions());
  renderConditionDraft();
}

function handleConditionDetailsToggle() {
  syncConditionDetailsAccessibility();
  if (!els.conditionDetails?.open) return;
  if (state.preserveDraftOnNextConditionOpen) {
    state.preserveDraftOnNextConditionOpen = false;
    return;
  }
  copyAppliedConditionsToDraft();
}

function renderSavedPreferenceCard() {
  if (!els.savedPreferenceCard) return;
  if (!hasSavedRecommendationPreferences()) {
    els.savedPreferenceCard.innerHTML = "";
    return;
  }
  els.savedPreferenceCard.innerHTML = `
    <section class="saved-preference-card" aria-label="저장된 추천 조건">
      <img src="./assets/mukjji/04_mukjji_thinking_512.webp" alt="" width="44" height="44" loading="lazy" aria-hidden="true" />
      <div>
        <strong>지난번 취향 설정이 있어요</strong>
        <p>불러온 뒤 원하는 부분을 바꿔서 다시 추천받을 수 있어요.</p>
      </div>
      <div class="saved-preference-actions">
        <button type="button" data-load-saved-preferences>지난 취향 불러오기</button>
        <button type="button" data-reset-saved-preferences>조건 초기화</button>
      </div>
    </section>
  `;
}

function resetFilters() {
  const preserveSharedPick = state.sharedPickStatus !== "none";
  state.budget = 8000;
  setBudgetCustomized(false);
  refreshDiscoverySeed();
  setActiveRecommendationMode("discovery");
  state.categories.clear();
  state.moods.clear();
  state.onlyOpen = false;
  state.needTakeout = false;
  state.needDelivery = false;
  state.needAlone = false;
  state.wantMeat = false;
  state.spicy = 2;
  state.salty = 3;
  state.sweet = 2;
  state.rangeInputPendingChange = {};
  setTastePreferenceCustomized(false);
  clearRecommendationPreferences();
  savedRecommendationPreferences = null;
  appliedRecommendationPreferences = recommendationPreferencesSnapshot();
  markConditionsChanged();
  if (!preserveSharedPick) {
    state.hasSearched = false;
    state.quickItems = [];
    state.quickSeenIds = new Set();
    clearAnalyticsRecommendationState();
  }
  state.rerollCount = 0;
  state.rerollPromptVisible = false;
  state.alternativesExpanded = false;
  if (els.conditionDetails) els.conditionDetails.open = false;
  render();
}

function loadSavedRecommendationPreferences() {
  if (!applyRecommendationPreferences(savedRecommendationPreferences)) {
    toast("불러올 지난 취향이 없어요");
    render();
    return;
  }
  if (els.conditionDetails) {
    state.preserveDraftOnNextConditionOpen = !els.conditionDetails.open;
    els.conditionDetails.open = true;
    syncConditionDetailsAccessibility();
  }
  toast("지난번 취향을 불러왔어요. 확인 후 조건에 맞게 찾기를 눌러 주세요.");
  renderConditionDraft();
}

function finishRecommendation(delay, options = {}) {
  if (!state.appReady) {
    toast("추천 준비가 끝나면 눌러주세요");
    return;
  }
  if (state.recommendTimer) return;
  const suppressDiscoveryPickCount = Boolean(options.suppressDiscoveryPickCount);
  const recommendationOptions = {
    applyWeather: options.applyWeather ?? true,
    locationBase: options.locationBase,
  };
  state.isSearching = true;
  state.hasSearched = false;
  state.page = 0;
  render();
  state.recommendTimer = window.setTimeout(() => {
    state.recommendTimer = null;
    state.isSearching = false;
    state.hasSearched = true;
    state.suppressDiscoveryPickCount = suppressDiscoveryPickCount;
    try {
      updateQuickRecommendations(recommendationOptions);
    } finally {
      state.suppressDiscoveryPickCount = false;
    }
    render();
    if (options.collapseConditions && els.conditionDetails) {
      els.conditionDetails.open = false;
      syncConditionDetailsAccessibility();
    }
    document.querySelector(".recommend-section").scrollIntoView({ behavior: "smooth", block: "start" });
  }, delay);
}

function searchMenus() {
  clearSharedPickState({ pushHistory: true });
  appliedRecommendationPreferences = recommendationPreferencesSnapshot();
  saveRecommendationPreferences(appliedRecommendationPreferences);
  setActiveRecommendationMode("personalized");
  state.quickItems = [];
  state.quickSeenIds = new Set();
  clearAnalyticsRecommendationState();
  state.rerollPromptVisible = false;
  state.rerollCount = 0;
  finishRecommendation(900, { collapseConditions: true });
}

function quickRecommend() {
  clearSharedPickState({ pushHistory: true });
  setActiveRecommendationMode("discovery");
  clearAnalyticsRecommendationState();
  state.rerollPromptVisible = false;
  state.rerollCount = 0;
  finishRecommendation(600, {
    applyWeather: false,
    locationBase: FALLBACK_LOCATION,
  });
}

function rerollQuickRecommendations() {
  analyticsClient?.recordRecommendationRefresh();
  if (state.sharedPickStatus !== "none") {
    clearSharedPickState({ pushHistory: true });
    state.hasSearched = false;
    state.quickItems = [];
    state.quickSeenIds = new Set();
    quickRecommend();
    return;
  }
  if (!state.hasSearched) {
    quickRecommend();
    return;
  }
  state.rerollCount += 1;
  if (state.quickMode === "discovery" && state.rerollCount % 4 === 0) {
    state.rerollPromptVisible = true;
    renderRecommendations();
    return;
  }
  state.rerollPromptVisible = false;
  updateQuickRecommendations({ reroll: true });
  renderRecommendations();
  document.querySelector(".recommend-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

function openPreferenceSettings() {
  state.rerollPromptVisible = false;
  if (els.conditionDetails) {
    copyAppliedConditionsToDraft();
    state.preserveDraftOnNextConditionOpen = !els.conditionDetails.open;
    els.conditionDetails.open = true;
    syncConditionDetailsAccessibility();
    renderRecommendations();
    els.conditionDetails.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function dismissDiscoveryNudge() {
  state.rerollPromptVisible = false;
  if (state.hasSearched) {
    updateQuickRecommendations({ reroll: true });
  }
  renderRecommendations();
}

function returnToDiscoveryRecommendations() {
  clearSharedPickState({ pushHistory: true });
  setActiveRecommendationMode("discovery");
  state.quickItems = [];
  state.quickSeenIds = new Set();
  resetDiscoveryNudgeCycle();
  state.rerollCount = 0;
  state.rerollPromptVisible = false;
  state.alternativesExpanded = false;
  state.page = 0;
  state.hasSearched = true;
  updateQuickRecommendations();
  render();
  document.querySelector(".recommend-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

function restoreDiscoveryModeAfterPageShow() {
  setActiveRecommendationMode("discovery");
  state.quickItems = [];
  state.quickSeenIds = new Set();
  resetDiscoveryNudgeCycle();
  state.rerollCount = 0;
  state.rerollPromptVisible = false;
  state.alternativesExpanded = false;
  state.page = 0;
  state.hasSearched = false;
  clearAnalyticsRecommendationState();
  render();
}

function rememberExternalLinkClick(event) {
  const link = event.target.closest("a[href]");
  if (!link) return;
  try {
    const url = new URL(link.href, window.location.href);
    if (["http:", "https:"].includes(url.protocol) && url.origin !== window.location.origin) {
      state.externalLinkClickAt = Date.now();
      state.pagehideAfterExternalLink = false;
    }
  } catch {
    state.externalLinkClickAt = 0;
    state.pagehideAfterExternalLink = false;
  }
}

function handlePageHideForRestore() {
  state.pagehideAfterExternalLink = Boolean(state.externalLinkClickAt && Date.now() - state.externalLinkClickAt <= 2000);
}

function handlePageShowRestore(event) {
  if (!event.persisted) return;
  const shouldKeepCurrentState = state.pagehideAfterExternalLink;
  state.externalLinkClickAt = 0;
  state.pagehideAfterExternalLink = false;
  if (shouldKeepCurrentState) return;
  const sharedPick = parseSharedPickFromUrl();
  if (sharedPick.present) {
    setSharedPickState(sharedPick, FALLBACK_LOCATION);
    render();
    return;
  }
  restoreDiscoveryModeAfterPageShow();
}

function toggleAlternativeMenus() {
  if (!state.hasSearched) return;
  state.alternativesExpanded = !state.alternativesExpanded;
  state.page = 0;
  renderRecommendations();
}

function applyLocationBasis(location, status) {
  state.location = location ? { ...location } : null;
  state.locationStatus = status;
  const locationBase = currentBase();
  refreshQuickItemDerivedValues({
    applyWeather: state.quickAppliedWeather,
    locationBase,
  });
  render();
}

function requestLocation() {
  const requestId = ++state.locationRequestId;
  if (!navigator.geolocation) {
    applyLocationBasis(null, "unsupported");
    return;
  }
  state.locationStatus = "requesting";
  renderLocationStatus();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (requestId !== state.locationRequestId) return;
      applyLocationBasis({
        label: "현재 위치",
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      }, "ready");
    },
    () => {
      if (requestId !== state.locationRequestId) return;
      applyLocationBasis(null, "denied");
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
  );
}

function getCurrentGpsLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const location = {
          label: "현재 위치",
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        resolve(location);
      },
      (error) => reject(error),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

function canWriteVisitReview(userLat, userLon, restaurantLat, restaurantLon) {
  const distance = getDistanceMeters(userLat, userLon, restaurantLat, restaurantLon);
  return {
    ok: distance <= VISIT_REVIEW_RADIUS_M,
    distance,
  };
}

async function verifyVisitReviewLocation(restaurant) {
  if (!restaurant?.lat || !restaurant?.lng) {
    alert("가게 위치 정보가 없어 방문 인증 후기를 작성할 수 없습니다.");
    return false;
  }
  let userLocation;
  try {
    toast("방문 위치 확인 중...");
    userLocation = await getCurrentGpsLocation();
  } catch {
    state.locationStatus = "denied";
    renderLocationStatus();
    alert("방문 인증 후기를 작성하려면 위치 권한이 필요합니다.");
    return false;
  }
  const result = canWriteVisitReview(userLocation.lat, userLocation.lng, restaurant.lat, restaurant.lng);
  if (!result.ok) {
    alert("가게 반경 50m 이내에서만 방문 인증 후기를 작성할 수 있습니다.");
    return false;
  }
  return true;
}

function showLocationDialog() {
  if (els.locationDialog && !els.locationDialog.open) {
    els.locationDialog.showModal();
  }
}

function chooseLocationPreference(choice) {
  els.locationDialog?.close();
  if (choice === "always") {
    state.locationPreference = "always";
    localStorage.setItem("changwonFoodLocationPreference", "always");
    requestLocation();
    return;
  }
  if (choice === "deny") {
    state.locationRequestId += 1;
    state.locationPreference = "deny";
    localStorage.setItem("changwonFoodLocationPreference", "deny");
    applyLocationBasis(null, "denied");
    return;
  }
  state.locationPreference = "once";
  requestLocation();
}

function handleLocationAfterSplash() {
  state.locationRequestId += 1;
  applyLocationBasis(null, "idle");
}

function showDetail(id, context = "custom") {
  const detailWasOpen = els.detailDialog.open;
  const analyticsSourceContext = detailWasOpen
    ? state.detailAnalyticsContext
    : getAnalyticsSourceContext(context);
  const detailContext = context === "discovery" ? "discovery" : "custom";
  state.detailContext = detailContext;
  if (!detailWasOpen) state.detailAnalyticsContext = analyticsSourceContext;
  const scoreOptions = detailContext === "discovery"
    ? { applyBudget: false, applyTaste: false, applyMoods: false }
    : { conditions: appliedRecommendationConditions() };
  const item = DATA.menus.map((menu) => scoreMenu(menu, scoreOptions)).find((menu) => menu.id === id);
  if (!item) return;
  const wished = isWished(item.id);
  const base = baseTaste(item);
  const publicTaste = state.publicTasteSummary[item.id];
  const summary = reviewSummary(item.id);
  const myReview = state.reviews[item.id] || {};
  const reviewList = menuReviews(item.id);
  const reviewTotal = menuReviewTotal(item.id);
  const reviewLimit = state.reviewVisibleCount[item.id] || 5;
  const detailReasons = displayReasons(item, detailContext);
  const reasonTags = detailContext === "discovery" ? [] : uniqueTags(item.reasons).slice(0, 3);
  const metaTags = compactTagsExcluding(item, reasonTags);
  els.dialogContent.innerHTML = `
    <p class="eyebrow">Menu detail</p>
    <h2>${item.name}</h2>
    <p class="store-line">${item.restaurant?.name || item.restaurantName} · ${item.category} · ${meters(item.distance)}</p>
    <div class="reason-list">${reasonTags.map((reason) => `<span>${reason}</span>`).join("")}</div>
    <div class="meta-tags">${metaTags.map((tag) => `<span>${tag}</span>`).join("")}</div>
    <section class="taste-summary">
      <h3>왜 추천했나요?</h3>
      <ul class="reason-copy-list">
        ${detailReasons.map((reason) => `<li>${reason}</li>`).join("")}
      </ul>
    </section>
    <section class="taste-summary">
      <h3>입맛 기준</h3>
      <p>현재 추천 기준: ${item.taste.source} · 맵기 ${Number(item.taste.spicy).toFixed(1)} · 짠맛 ${Number(item.taste.salty).toFixed(1)} · 단맛 ${Number(item.taste.sweet).toFixed(1)}</p>
      <p>기본값: 맵기 ${base.spicy} · 짠맛 ${base.salty} · 단맛 ${base.sweet}</p>
      <p>${publicTaste?.vote_count ? `모두 평균: 맵기 ${Number(publicTaste.avg_spicy).toFixed(1)} · 짠맛 ${Number(publicTaste.avg_salty).toFixed(1)} · 단맛 ${Number(publicTaste.avg_sweet).toFixed(1)} · ${publicTaste.vote_count}명` : "모두 평균: 아직 데이터가 없어요."}</p>
    </section>
    <section class="taste-summary">
      <h3>후기 평균</h3>
      <p>${summary?.review_count ? `별점 ${Number(summary.avg_rating).toFixed(1)} · 위생 ${Number(summary.avg_hygiene).toFixed(1)} · 친절 ${Number(summary.avg_kindness).toFixed(1)} · 후기 ${summary.review_count}개` : "아직 후기가 없어요."}</p>
    </section>
    <details class="detail-fold">
      <summary>내 입맛 수정</summary>
    <section class="personal-taste" data-taste-editor="${item.id}">
      <div class="control-title">
        <strong>내 입맛으로 수정</strong>
        <span>기기 저장 후 모두의 평균에 반영</span>
      </div>
      ${["spicy", "salty", "sweet"]
        .map((field) => {
          const label = { spicy: "맵기", salty: "짠맛", sweet: "단맛" }[field];
          return `
            <label>
              <span>${label} <b data-taste-output="${field}">${item.taste[field]}</b></span>
              <input type="range" min="0" max="5" value="${item.taste[field]}" data-taste-field="${field}" />
            </label>
          `;
        })
        .join("")}
      <div class="taste-actions">
        <button data-save-taste="${item.id}">내 입맛 저장</button>
        <button data-reset-taste="${item.id}">기본값으로</button>
      </div>
    </section>
    </details>
    <details class="detail-fold">
      <summary>후기 남기기</summary>
    <section class="review-form" data-review-editor="${item.id}">
      <div class="control-title">
        <strong>후기 남기기</strong>
        <span>방문 인증 필요 · 300자 이내</span>
      </div>
      <p class="visit-review-note">가게 반경 ${VISIT_REVIEW_RADIUS_M}m 이내에서만 방문 인증 후기를 작성할 수 있어요.</p>
      <label>
        <span>닉네임</span>
        <input type="text" data-review-field="nickname" maxlength="20" value="${escapeHtml(myReview.nickname || state.nickname || "")}" placeholder="닉네임" />
      </label>
      <div class="rating-grid">
        <label>
          <span>별점 <b data-review-output="rating">${myReview.rating || 5}</b></span>
          <div class="star-rating" data-rating-stars="${item.id}">
            ${starButtons(myReview.rating || 5)}
          </div>
          <input type="hidden" min="1" max="5" value="${myReview.rating || 5}" data-review-field="rating" />
        </label>
        <label>
          <span>위생도 <b data-review-output="hygiene">${myReview.hygiene ?? 3}</b></span>
          <input type="range" min="0" max="5" value="${myReview.hygiene ?? 3}" data-review-field="hygiene" />
        </label>
        <label>
          <span>친절도 <b data-review-output="kindness">${myReview.kindness ?? 3}</b></span>
          <input type="range" min="0" max="5" value="${myReview.kindness ?? 3}" data-review-field="kindness" />
        </label>
      </div>
      <textarea data-review-field="review_text" maxlength="300" placeholder="후기를 300자 이내로 남겨주세요.">${escapeHtml(myReview.review_text || "")}</textarea>
      <button data-save-review="${item.id}">후기 저장</button>
    </section>
    </details>
    <section class="review-list">
      <h3>최근 후기</h3>
      ${
        reviewList.length
          ? reviewList
              .map(
                (review) => `
                  <article>
                    <strong>${escapeHtml(review.nickname || "익명")} · ★ ${review.rating}</strong>
                    <p>위생 ${review.hygiene}/5 · 친절 ${review.kindness}/5</p>
                    <p>${escapeHtml(review.review_text || "작성한 후기가 없어요.")}</p>
                  </article>
                `,
              )
              .join("")
          : "<p>아직 작성된 후기가 없어요.</p>"
      }
      ${
        reviewTotal > reviewLimit
          ? `<button class="text-button more-review-button" data-more-reviews="${item.id}">후기 더 보기 ${reviewLimit}/${reviewTotal}</button>`
          : ""
      }
    </section>
    <div class="card-actions">
      <button data-wish="${item.id}">${wished ? "찜 해제" : "찜하기"}</button>
      <button data-ate="${item.id}">먹었어요</button>
      ${mapActionHtml(item, { label: "네이버 지도에서 보기", analyticsContext: state.detailAnalyticsContext })}
    </div>
    <div class="info-footer">
      <span>정보 기준일 ${DATA_UPDATED_AT}</span>
      <button data-report-open data-report-type="wrong_info" data-report-target-type="menu" data-report-target-id="${item.id}" data-report-target-label="${escapeHtml(item.restaurant?.name || item.restaurantName)} · ${escapeHtml(item.name)}">정보 제보/오류 신고</button>
    </div>
  `;
  if (!els.detailDialog.open) els.detailDialog.showModal();
  if (!detailWasOpen && analyticsSourceContext) {
    analyticsClient?.recordMenuCardOpen({
      menuId: item.id,
      restaurantId: item.restaurant?.id || item.restaurantId,
      sourceContext: analyticsSourceContext,
    });
  }
  pushAppState("detail");
}

function saveWishlist() {
  localStorage.setItem("changwonFoodWishlist", JSON.stringify(state.wishlist));
}

function saveHistory() {
  localStorage.setItem("changwonFoodHistory", JSON.stringify(state.history));
}

function saveTasteOverrides() {
  localStorage.setItem("changwonFoodTasteOverrides", JSON.stringify(state.tasteOverrides));
}

function recommendationPreferencesSnapshot() {
  return {
    version: 1,
    budget: clampNumber(state.budget, 3000, 30000, 8000, 500),
    spicy: clampNumber(state.spicy, 0, 5, 2),
    salty: clampNumber(state.salty, 0, 5, 3),
    sweet: clampNumber(state.sweet, 0, 5, 2),
    categories: safePreferenceList([...state.categories], VALID_RECOMMENDATION_CATEGORIES),
    moods: safePreferenceList([...state.moods], VALID_RECOMMENDATION_MOODS),
    onlyOpen: Boolean(state.onlyOpen),
    needTakeout: Boolean(state.needTakeout),
    needDelivery: Boolean(state.needDelivery),
    needAlone: Boolean(state.needAlone),
    wantMeat: Boolean(state.wantMeat),
    budgetCustomized: Boolean(state.budgetCustomized),
    tastePreferenceCustomized: Boolean(state.tastePreferenceCustomized),
  };
}

function saveRecommendationPreferences(preferences = recommendationPreferencesSnapshot()) {
  savedRecommendationPreferences = cloneRecommendationPreferences(preferences);
  localStorage.setItem(RECOMMENDATION_PREFERENCES_KEY, JSON.stringify(savedRecommendationPreferences));
}

function clearRecommendationPreferences() {
  localStorage.removeItem(RECOMMENDATION_PREFERENCES_KEY);
  localStorage.removeItem(BUDGET_CUSTOMIZED_KEY);
  localStorage.removeItem(TASTE_CUSTOMIZED_KEY);
}

function rangeInputForKey(key) {
  return {
    budget: els.budgetRange,
    spicy: els.spicyPreference,
    salty: els.saltyPreference,
    sweet: els.sweetPreference,
  }[key];
}

function commitRangePreference(key, eventOrValue, source = "input") {
  const isBudget = key === "budget";
  const target = eventOrValue?.target || null;
  const rawValue = target ? target.value : eventOrValue;
  const value = isBudget ? clampNumber(rawValue, 3000, 30000, 8000, 500) : clampNumber(rawValue, 0, 5, key === "salty" ? 3 : 2);
  const currentInput = rangeInputForKey(key);
  const isCurrentInput = !target || target === currentInput;
  const confirmsState = state[key] === value;

  if (source === "change" && !isCurrentInput) {
    state.rangeInputPendingChange[key] = false;
    syncControls();
    return false;
  }

  if (source === "change" && state.rangeInputPendingChange[key] && confirmsState) {
    state.rangeInputPendingChange[key] = false;
    syncControls();
    return false;
  }
  if (source === "change") state.rangeInputPendingChange[key] = false;
  if (source === "input") state.rangeInputPendingChange[key] = true;

  if (state[key] === value && (isBudget ? state.budgetCustomized : state.tastePreferenceCustomized)) {
    syncControls();
    return false;
  }

  state[key] = value;
  if (isBudget) setBudgetCustomized(true);
  else setTastePreferenceCustomized(true);
  markConditionsChanged();
  renderConditionDraft();
  return true;
}

function setTastePreferenceCustomized(value) {
  state.tastePreferenceCustomized = Boolean(value);
}

function setBudgetCustomized(value) {
  state.budgetCustomized = Boolean(value);
}

function saveReviews() {
  localStorage.setItem("changwonFoodReviews", JSON.stringify(state.reviews));
}

function saveNickname(nickname) {
  state.nickname = nickname.slice(0, 20);
  localStorage.setItem("changwonFoodNickname", state.nickname);
}

function toggleWishlist(id) {
  if (state.wishlist.includes(id)) {
    state.wishlist = state.wishlist.filter((itemId) => itemId !== id);
    toast("찜 해제!");
  } else {
    state.wishlist.unshift(id);
    toast("찜~!");
  }
  saveWishlist();
  render();
}

function addHistory(id) {
  state.history.unshift({ historyId: createHistoryId(), id, eatenAt: new Date().toISOString() });
  state.history = state.history.slice(0, 200);
  state.historyVisibleCount = Math.max(5, state.historyVisibleCount);
  saveHistory();
  toast("먹은기록저장!", "happy");
  render();
}

function closeEatenConfirmDialog() {
  state.pendingEatenMenuId = null;
  if (els.eatenConfirmDialog?.open) els.eatenConfirmDialog.close();
}

function openEatenConfirmDialog(id) {
  if (els.eatenConfirmDialog?.open) return;
  const menu = DATA.menus.find((item) => item.id === id);
  if (!menu || !els.eatenConfirmDialog || !els.eatenConfirmMenuName) return;
  state.pendingEatenMenuId = id;
  els.eatenConfirmMenuName.textContent = menu.name;
  els.eatenConfirmDialog.showModal();
  els.cancelEatenConfirm?.focus();
}

function confirmEatenRecord() {
  const id = state.pendingEatenMenuId;
  state.pendingEatenMenuId = null;
  if (els.eatenConfirmDialog?.open) els.eatenConfirmDialog.close();
  if (id) addHistory(id);
}

function updateHistoryEntry(key, localDateTime) {
  const index = historyIndexFromKey(key);
  if (index < 0 || !localDateTime) return;
  const date = new Date(localDateTime);
  if (Number.isNaN(date.getTime())) return;
  state.history[index] = {
    ...state.history[index],
    historyId: state.history[index].historyId || createHistoryId(),
    eatenAt: date.toISOString(),
  };
  saveHistory();
  toast("식사기록수정!");
  render();
}

function deleteHistoryEntry(key) {
  const index = historyIndexFromKey(key);
  if (index < 0) return;
  state.history.splice(index, 1);
  saveHistory();
  toast("식사기록삭제!");
  render();
}

function saveTaste(id) {
  const editor = document.querySelector(`[data-taste-editor="${id}"]`);
  if (!editor) return;
  state.tasteOverrides[id] = Object.fromEntries(
    [...editor.querySelectorAll("[data-taste-field]")].map((input) => [input.dataset.tasteField, clampScore(input.value)]),
  );
  saveTasteOverrides();
  upsertRemoteTaste(id, state.tasteOverrides[id]);
  if (state.tastePreferenceCustomized) markConditionsChanged();
  toast("내 입맛 저장!");
  render();
  showDetail(id, state.detailContext);
}

function resetTaste(id) {
  delete state.tasteOverrides[id];
  saveTasteOverrides();
  if (state.tastePreferenceCustomized) markConditionsChanged();
  toast("기본맛으로 변경!");
  render();
  showDetail(id, state.detailContext);
}

async function saveReview(id) {
  const editor = document.querySelector(`[data-review-editor="${id}"]`);
  const menu = DATA.menus.find((item) => item.id === id);
  if (!editor || !menu) return;
  const restaurant = restaurantsById.get(menu.restaurantId);
  const isVisitVerified = await verifyVisitReviewLocation(restaurant);
  if (!isVisitVerified) return;
  const field = (name) => editor.querySelector(`[data-review-field="${name}"]`);
  const nickname = field("nickname")?.value.trim().slice(0, 20) || "익명";
  const review = {
    menuId: id,
    restaurantId: menu.restaurantId,
    nickname,
    rating: clampScore(field("rating")?.value, 1, 5),
    hygiene: clampScore(field("hygiene")?.value, 0, 5),
    kindness: clampScore(field("kindness")?.value, 0, 5),
    review_text: (field("review_text")?.value || "").trim().slice(0, 300),
    updatedAt: new Date().toISOString(),
  };
  saveNickname(nickname);
  state.reviews[id] = review;
  saveReviews();
  state.syncStatus = "saving";
  state.pendingReviewRetry = null;
  render();
  toast("서버 공유 중...");
  const synced = await upsertRemoteReview(review);
  state.syncStatus = synced ? "synced" : "failed";
  state.pendingReviewRetry = synced ? null : review;
  toast(synced ? "후기 공유 완료!" : "서버 공유 실패");
  render();
  showDetail(id, state.detailContext);
}

async function deleteReview(id) {
  if (!state.reviews[id]) return;
  delete state.reviews[id];
  saveReviews();
  state.syncStatus = "saving";
  toast("후기 삭제!");
  if (state.supabase && state.supabaseUserId) {
    const result = await supabaseRest(`/menu_reviews?user_id=eq.${encodeURIComponent(state.supabaseUserId)}&menu_id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    if (!result.ok) console.warn("review delete failed", result.error);
    await loadRemoteSummaries();
  }
  state.syncStatus = "synced";
  render();
}

async function ensureSupabaseReady() {
  if (state.supabase && state.supabaseUserId) return true;
  const config = window.CHANGWON_SUPABASE_CONFIG;
  if (!config?.enabled || !config.url || !config.anonKey) {
    state.supabaseError = "Supabase 설정이 꺼져 있어요.";
    return false;
  }
  if (!window.supabase?.createClient) {
    await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2").catch(() => null);
  }
  if (!window.supabase?.createClient) {
    state.supabaseError = "Supabase 라이브러리를 불러오지 못했어요.";
    return false;
  }
  if (!state.supabase) {
    state.supabase = window.supabase.createClient(config.url, config.anonKey);
  }
  const auth = await state.supabase.auth.getSession().catch(() => null);
  if (!auth?.data?.session && state.supabase.auth.signInAnonymously) {
    const signIn = await state.supabase.auth.signInAnonymously().catch((error) => ({ error }));
    if (signIn?.error) {
      state.supabaseError = signIn.error.message || "익명 로그인에 실패했어요.";
      console.warn("anonymous sign-in failed", signIn.error);
    }
  }
  const user = await state.supabase.auth.getUser().catch(() => null);
  state.supabaseUserId = user?.data?.user?.id || null;
  state.supabaseReady = Boolean(state.supabaseUserId);
  if (!state.supabaseReady && !state.supabaseError) {
    state.supabaseError = "익명 사용자 정보를 만들지 못했어요.";
  }
  return state.supabaseReady;
}

async function initSupabase() {
  if (state.supabaseInitPromise) return state.supabaseInitPromise;
  state.supabaseInitPromise = (async () => {
    const ready = await ensureSupabaseReady();
    if (ready) {
      await loadRemoteCatalog();
      await loadRemoteSummaries();
    }
    return ready;
  })().finally(() => {
    state.supabaseInitPromise = null;
  });
  return state.supabaseInitPromise;
}

function loadScript(src) {
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

async function loadRemoteCatalog() {
  if (!state.supabase) return false;
  const [restaurantResult, menuResult] = await Promise.all([
    state.supabase.from("restaurants").select("*").eq("active", true).order("name", { ascending: true }),
    state.supabase.from("menus").select("*").eq("available", true).order("name", { ascending: true }),
  ]).catch((error) => {
    console.warn("catalog load failed", error);
    return [];
  });

  if (restaurantResult?.error || menuResult?.error) {
    state.catalogSource = "static";
    state.catalogStatus = "Supabase 가게/메뉴 테이블이 없어 내장 데이터 사용 중";
    console.warn("catalog table unavailable", restaurantResult?.error || menuResult?.error);
    return false;
  }

  const restaurantRows = restaurantResult?.data || [];
  const menuRows = menuResult?.data || [];
  const shouldUseSupabase = window.CHANGWON_CATALOG_POLICY?.shouldUseSupabaseCatalog(restaurantRows, menuRows)
    ?? (restaurantRows.length > 0 && menuRows.length > 0);
  if (!shouldUseSupabase) {
    state.catalogSource = "static";
    state.catalogStatus = "Supabase 데이터가 비어 있어 내장 데이터 사용 중";
    return false;
  }

  const nextRestaurants = restaurantRows.map(dbRestaurantToApp);
  const tempMap = new Map(nextRestaurants.map((restaurant) => [restaurant.id, restaurant]));
  const nextMenus = menuRows.filter((row) => tempMap.has(row.restaurant_id)).map((row) => dbMenuToApp(row, tempMap));
  setCatalogData(nextRestaurants, nextMenus, "supabase");
  renderChips();
  return true;
}

async function loadRemoteSummaries() {
  if (!state.supabase) return;
  state.syncStatus = state.syncStatus === "saving" ? "saving" : "refreshing";
  const [tasteResult, reviewResult, reviewRows, reportRows] = await Promise.all([
    state.supabase.from("menu_taste_summary").select("*"),
    state.supabase.from("menu_review_summary").select("*"),
    state.supabase.from("menu_reviews").select("id,user_id,menu_id,nickname,rating,hygiene,kindness,review_text,created_at,updated_at").eq("status", "visible").order("created_at", { ascending: false }).limit(200),
    state.supabase.from("info_reports").select("id,report_type,target_type,target_id,target_label,message,status,created_at,updated_at").order("created_at", { ascending: false }).limit(30),
  ]).catch(() => []);

  if (tasteResult?.data) {
    state.publicTasteSummary = Object.fromEntries(tasteResult.data.map((row) => [row.menu_id, row]));
  }
  if (reviewResult?.data) {
    state.publicReviewSummary = Object.fromEntries(reviewResult.data.map((row) => [row.menu_id, row]));
  }
  if (reviewRows?.data) {
    state.publicReviews = reviewRows.data.reduce((acc, row) => {
      acc[row.menu_id] ||= [];
      acc[row.menu_id].push(row);
      return acc;
    }, {});
  }
  if (reportRows?.data) {
    state.myReports = reportRows.data;
  }
  state.lastSyncAt = new Date().toISOString();
  state.syncStatus = "synced";
  render();
}

async function refreshRemoteData() {
  const ready = await ensureSupabaseReady();
  if (!ready) {
    state.syncStatus = "failed";
    render();
    toast("서버 연결 실패");
    return;
  }
  await loadRemoteCatalog();
  await loadRemoteSummaries();
  toast("평균 데이터 갱신!");
}

async function retryPendingReview() {
  if (!state.pendingReviewRetry) {
    toast("다시 시도할 후기가 없어요");
    return;
  }
  state.syncStatus = "saving";
  render();
  const synced = await upsertRemoteReview(state.pendingReviewRetry);
  state.syncStatus = synced ? "synced" : "failed";
  state.pendingReviewRetry = synced ? null : state.pendingReviewRetry;
  render();
  toast(synced ? "후기 공유 완료!" : "서버 공유 실패");
}

async function supabaseRest(path, options = {}) {
  const config = window.CHANGWON_SUPABASE_CONFIG;
  if (!config?.url || !config?.anonKey) return { ok: false, error: "Supabase 설정이 없습니다." };
  const sessionResult = await state.supabase?.auth.getSession().catch(() => null);
  const accessToken = sessionResult?.data?.session?.access_token || config.anonKey;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${config.url}/rest/v1${path}`, {
      method: options.method || "GET",
      signal: controller.signal,
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      body: options.body,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!response.ok) {
      return { ok: false, status: response.status, error: data?.message || data?.hint || text || `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status, data };
  } catch (error) {
    return { ok: false, error: error?.name === "AbortError" ? "서버 응답 시간이 초과됐어요." : error?.message || "서버 요청에 실패했어요." };
  } finally {
    window.clearTimeout(timer);
  }
}

async function upsertRemoteTaste(menuId, taste) {
  const ready = await ensureSupabaseReady();
  if (!ready) return false;
  const result = await supabaseRest("/menu_taste_votes?on_conflict=user_id,menu_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      user_id: state.supabaseUserId,
      menu_id: menuId,
      spicy: clampScore(taste.spicy),
      salty: clampScore(taste.salty),
      sweet: clampScore(taste.sweet),
    }),
  });
  if (!result.ok) {
    state.supabaseError = result.error || "입맛 공유 저장에 실패했어요.";
    console.warn("taste sync failed", result.error);
    return false;
  }
  await loadRemoteSummaries();
  return true;
}

async function upsertRemoteReview(review) {
  const ready = await ensureSupabaseReady();
  if (!ready) {
    console.warn("review sync skipped", state.supabaseError || "Supabase is not ready");
    return false;
  }
  const result = await supabaseRest("/menu_reviews?on_conflict=user_id,menu_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      user_id: state.supabaseUserId,
      menu_id: review.menuId,
      restaurant_id: review.restaurantId,
      nickname: review.nickname,
      rating: clampScore(review.rating, 1, 5),
      hygiene: clampScore(review.hygiene, 0, 5),
      kindness: clampScore(review.kindness, 0, 5),
      review_text: review.review_text,
      status: "visible",
    }),
  });
  if (!result.ok) {
    state.supabaseError = result.error || "후기 공유 저장에 실패했어요.";
    console.warn("review sync failed", result.error);
    return false;
  }
  await loadRemoteSummaries();
  return true;
}

function openReportDialog(button) {
  if (!els.reportDialog) return;
  els.reportTargetType.value = button.dataset.reportTargetType || "general";
  els.reportTargetId.value = button.dataset.reportTargetId || "";
  els.reportTargetLabel.value = button.dataset.reportTargetLabel || "전체 데이터";
  els.reportType.value = button.dataset.reportType || "wrong_info";
  els.reportMessage.value = "";
  els.reportReporter.value = state.nickname || "";
  els.reportDialog.showModal();
}

async function submitInfoReport(event) {
  event.preventDefault();
  const message = els.reportMessage.value.trim().slice(0, 500);
  if (!message) {
    toast("제보 내용을 입력해주세요");
    return;
  }
  const ready = await ensureSupabaseReady();
  if (!ready) {
    toast("서버 연결 실패");
    window.open(FEEDBACK_FORM_URL, "_blank", "noopener,noreferrer");
    return;
  }
  const result = await supabaseRest("/info_reports", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: state.supabaseUserId,
      report_type: els.reportType.value,
      target_type: els.reportTargetType.value || "general",
      target_id: els.reportTargetId.value || null,
      target_label: els.reportTargetLabel.value || "전체 데이터",
      reporter: els.reportReporter.value.trim().slice(0, 40) || null,
      message,
      status: "pending",
    }),
  });
  if (!result.ok) {
    console.warn("info report failed", result.error);
    toast("제보 저장 실패");
    return;
  }
  els.reportDialog.close();
  await loadRemoteSummaries();
  toast("제보 접수 완료!");
}

async function copyTextToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through for in-app browsers that expose Clipboard API but reject it.
    }
  }
  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  textArea.remove();
  return copied;
}

async function shareAppLink() {
  const shareUrl = buildOfficialShareUrl();
  const shareData = {
    title: "묵찌 PICK! | 창원대 앞 오늘 뭐 먹지?",
    text: "오늘 뭐 먹을지 고민된다면? 묵찌 PICK!에서 창원대 앞 메뉴 3개를 추천받아봐!",
    url: shareUrl,
  };
  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  const copied = await copyTextToClipboard(shareUrl);
  toast(copied ? "묵찌 PICK! 링크를 복사했어요." : "링크를 복사하지 못했어요. 다시 시도해 주세요.");
}

function sharedPickMessage(items) {
  const rows = items.map((item, index) => {
    const details = [item.name, item.restaurant?.name || item.restaurantName];
    if (Number.isFinite(Number(item.price)) && Number(item.price) > 0) details.push(money(item.price));
    return `${index + 1}. ${details.join(" · ")}`;
  });
  return ["오늘 뭐 먹지? 묵찌가 3개 골랐어!", "", ...rows, "", "우리 뭐 먹을까?"].join("\n");
}

async function shareCurrentPick() {
  if (state.sharePickPending) return;
  if (state.quickItems.length !== 3) {
    toast("공유할 메뉴 3개가 준비되지 않았어요.");
    return;
  }
  const menuIds = state.quickItems.map((item) => String(item.id));
  const sharedUrl = buildSharedPickUrl(menuIds);
  const shareData = {
    title: "묵찌 PICK! 메뉴 3개",
    text: sharedPickMessage(state.quickItems),
    url: sharedUrl,
  };
  state.sharePickPending = true;
  if (els.sharePickButton) els.sharePickButton.disabled = true;
  try {
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        analyticsClient?.recordShareSuccess("web_share");
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    const copied = await copyTextToClipboard(sharedUrl);
    if (copied) analyticsClient?.recordShareSuccess("clipboard");
    toast(copied ? "추천 메뉴 3개 링크를 복사했어요." : "링크를 복사하지 못했어요. 다시 시도해 주세요.");
  } finally {
    state.sharePickPending = false;
    if (els.sharePickButton) els.sharePickButton.disabled = false;
  }
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function toDateTimeLocal(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function createHistoryId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `history-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function historyIndexFromKey(key) {
  const byId = state.history.findIndex((entry) => entry.historyId === key);
  if (byId >= 0) return byId;
  const byIndex = Number(key);
  return Number.isInteger(byIndex) && byIndex >= 0 && byIndex < state.history.length ? byIndex : -1;
}

function historyRows() {
  return state.history
    .map((entry, index) => {
      const menu = DATA.menus.find((item) => item.id === entry.id);
      return menu ? { ...entry, historyIndex: index, historyKey: entry.historyId || String(index), menu } : null;
    })
    .filter(Boolean);
}

function filteredHistoryRows(rows = historyRows()) {
  const days = Number(state.historyRangeDays) || 7;
  const fromTime = Date.now() - days * 24 * 60 * 60 * 1000;
  return rows.filter((entry) => {
    const eatenTime = new Date(entry.eatenAt).getTime();
    return Number.isFinite(eatenTime) && eatenTime >= fromTime;
  });
}

function setHistoryRange(days) {
  state.historyRangeDays = Number(days) || 7;
  state.historyVisibleCount = 5;
  localStorage.setItem("changwonFoodHistoryRangeDays", String(state.historyRangeDays));
  renderDashboard();
}

function showMoreHistory() {
  state.historyVisibleCount += 5;
  renderDashboard();
}

function mostEatenRows() {
  const counts = countBy(historyRows(), (entry) => entry.menu.name).slice(0, 5);
  return counts.length ? barRows(counts) : "<p>아직 먹음 기록이 없습니다.</p>";
}

function myReviewStats() {
  const reviews = Object.values(state.reviews);
  if (!reviews.length) {
    return { count: 0, avgRating: "-", avgHygiene: "-", avgKindness: "-" };
  }
  const avg = (field) => (reviews.reduce((sum, review) => sum + Number(review[field] || 0), 0) / reviews.length).toFixed(1);
  return {
    count: reviews.length,
    avgRating: avg("rating"),
    avgHygiene: avg("hygiene"),
    avgKindness: avg("kindness"),
  };
}

function renderWishlist() {
  const items = state.wishlist.map((id) => DATA.menus.find((menu) => menu.id === id)).filter(Boolean).map(scoreMenu);
  els.wishlistList.innerHTML = items.length
    ? items.map((item, index) => `<article class="menu-card">${cardHtml(item, index + 1)}</article>`).join("")
    : mukjjiEmptyHtml("아직 찜한 메뉴가 없어요.");
}

function startWorldcup() {
  const size = Number(els.worldcupSize.value);
  const pool = getRecommendedMenus()
    .filter((item) => !state.worldcupCategories.size || state.worldcupCategories.has(item.category))
    .slice(0, Math.max(size * 2, 24));
  const round = [...pool].sort(() => Math.random() - 0.5).slice(0, size);
  state.worldcup = { round, winners: [], index: 0, final: null };
  renderWorldcup();
}

function chooseWorldcup(choiceIndex) {
  if (!state.worldcup) return;
  const pair = state.worldcup.round.slice(state.worldcup.index, state.worldcup.index + 2);
  const winner = pair[choiceIndex];
  if (!winner) return;
  state.worldcup.winners.push(winner);
  state.worldcup.index += 2;
  if (state.worldcup.index >= state.worldcup.round.length) {
    if (state.worldcup.winners.length === 1) {
      state.worldcup.final = state.worldcup.winners[0];
    } else {
      state.worldcup.round = state.worldcup.winners;
      state.worldcup.winners = [];
      state.worldcup.index = 0;
    }
  }
  renderWorldcup();
}

function renderWorldcup() {
  if (!state.worldcup) {
    els.worldcupBoard.innerHTML = `
      <div class="worldcup-start">
        <div class="worldcup-trophy" aria-hidden="true">🏆</div>
        <h3>오늘의 메뉴 이상형 월드컵</h3>
        <p>현재 추천 조건과 월드컵 카테고리를 기준으로 후보를 뽑아요.</p>
        <button id="startWorldcup">월드컵 시작</button>
      </div>
    `;
    return;
  }
  if (state.worldcup.final) {
    const item = state.worldcup.final;
    const wished = isWished(item.id);
    els.worldcupBoard.innerHTML = `
      <div class="worldcup-result">
        <div class="menu-card__top">
          <div>
            <p class="eyebrow">Winner</p>
            <h3>${item.name}</h3>
            <p class="store-line">${item.restaurant?.name || item.restaurantName} · ${money(item.price)} · ${meters(item.distance)}</p>
          </div>
          <button class="heart-button ${wished ? "is-wished" : ""}" data-wish="${item.id}" aria-label="${wished ? "찜 해제" : "찜하기"}">${wished ? "♥" : "♡"}</button>
        </div>
        <div class="meta-tags">${compactTags(item, 8).map((tag) => `<span>${tag}</span>`).join("")}</div>
        <div class="card-actions">
          <button data-detail="${item.id}">상세 보기</button>
          <button data-ate="${item.id}">먹었어요</button>
          ${mapActionHtml(item)}
        </div>
      </div>
      <button id="restartWorldcup" class="wide-button">다시하기</button>
    `;
    return;
  }
  const pair = state.worldcup.round.slice(state.worldcup.index, state.worldcup.index + 2);
  const roundName = state.worldcup.round.length === 2 ? "결승" : `${state.worldcup.round.length}강`;
  els.worldcupBoard.innerHTML = `
    <p class="store-line">${roundName} · ${Math.floor(state.worldcup.index / 2) + 1}번째 선택</p>
    <div class="worldcup-match">
      ${pair
        .map(
          (item, index) => `
            <button class="worldcup-choice" data-worldcup-choice="${index}">
              <strong>${item.name}</strong>
              <span>${item.restaurant?.name || item.restaurantName} · ${money(item.price)} · ${meters(item.distance)}</span>
              <div class="meta-tags">${compactTags(item, 4).map((tag) => `<span>${tag}</span>`).join("")}</div>
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function countBy(items, getKey) {
  const map = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function barRows(rows) {
  const max = Math.max(...rows.map((row) => row[1]), 1);
  return rows
    .map(
      ([label, value]) => `
        <div class="bar-row">
          <span>${label}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(value / max) * 100}%"></div></div>
          <strong>${value}</strong>
        </div>
      `,
    )
    .join("");
}

function reportTypeLabel(type) {
  return (
    {
      wrong_info: "잘못된 정보",
      price_update: "가격 변경",
      new_menu: "메뉴 추가",
      new_store: "가게 추가",
      closed_store: "폐업/영업 종료",
      other: "기타",
    }[type] || "정보 제보"
  );
}

function reportStatusMeta(status) {
  return (
    {
      pending: { label: "접수됨", help: "관리자가 아직 확인하기 전이에요." },
      checking: { label: "확인 중", help: "정보를 대조하고 있어요." },
      done: { label: "반영 완료", help: "확인 후 앱 데이터에 반영했어요." },
      rejected: { label: "보류", help: "추가 확인이 필요하거나 반영하지 않았어요." },
    }[status] || { label: "접수됨", help: "관리자가 확인할 예정이에요." }
  );
}

function myReportRows() {
  if (!state.supabaseReady) {
    return `<p>제보 상태 목록은 지금 불러올 수 없어요. 음식점 정보 제보는 아래 버튼으로 보낼 수 있어요.</p>`;
  }
  if (!state.myReports.length) {
    return `<p>아직 확인 가능한 제보 내역이 없어요. 음식점 정보 제보는 아래 버튼으로 보낼 수 있어요.</p>`;
  }
  return `
    <div class="report-status-list">
      ${state.myReports
        .slice(0, 6)
        .map((report) => {
          const status = reportStatusMeta(report.status);
          return `
            <article class="report-status-row">
              <div>
                <strong>${escapeHtml(report.target_label || "전체 데이터")}</strong>
                <p>${reportTypeLabel(report.report_type)} · ${formatDateTime(report.created_at)}</p>
                <p>${escapeHtml(report.message || "")}</p>
                <small>${status.help}</small>
              </div>
              <span class="report-status-badge status-${escapeHtml(report.status || "pending")}">${status.label}</span>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function debugModeEnabled() {
  return new URLSearchParams(window.location.search).get("debug") === "1";
}

function recordMenuRows(items, emptyText) {
  return items.length
    ? `<div class="record-menu-list">
        ${items
          .map(
            (item) => `
              <div class="record-menu-row">
                <div>
                  <strong>${escapeHtml(item.name)}</strong>
                  <span>${escapeHtml(item.restaurant?.name || item.restaurantName)} · ${money(item.price)}</span>
                </div>
                <div class="record-row-actions">
                  <button data-detail="${item.id}">상세 보기</button>
                  <button data-wish="${item.id}">${isWished(item.id) ? "찜 해제" : "찜"}</button>
                  <button data-ate="${item.id}">먹었어요</button>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>`
    : `<p>${emptyText}</p>`;
}

function renderDashboard() {
  const categories = countBy(DATA.menus, (menu) => menu.category).slice(0, 8);
  const moods = countBy(
    DATA.menus.flatMap((menu) => menu.tags),
    (tag) => tag,
  ).slice(0, 8);
  const filteredHistoryItems = filteredHistoryRows();
  const historyItems = filteredHistoryItems.slice(0, state.historyVisibleCount);
  const reviewStats = myReviewStats();
  const myReviews = Object.values(state.reviews).slice(0, 6);
  const wishedItems = state.wishlist.map((id) => DATA.menus.find((menu) => menu.id === id)).filter(Boolean).map(scoreMenu);
  const syncStatusText = {
    idle: "대기 중",
    saving: "저장 중",
    refreshing: "평균 데이터 갱신 중",
    synced: state.lastSyncAt ? `최근 갱신 ${formatDateTime(state.lastSyncAt)}` : "공유 준비됨",
    failed: "공유를 잠시 완료하지 못했어요",
  }[state.syncStatus] || "대기 중";
  const syncNotice =
    state.syncStatus === "failed" || state.pendingReviewRetry
      ? `
        <div class="dashboard-card record-alert-card">
          <h3>동기화 확인이 필요해요</h3>
          <p>후기 공유나 제보 상태 확인이 잠시 완료되지 않았어요.</p>
          <div class="dashboard-actions">
            ${state.pendingReviewRetry ? `<button data-retry-review>후기 공유 다시 시도</button>` : ""}
            ${state.syncStatus === "failed" ? `<button data-refresh-remote>다시 확인</button>` : ""}
          </div>
        </div>
      `
      : "";
  els.dataDashboard.innerHTML = `
    ${syncNotice}
    <div class="dashboard-card privacy-card">
      <h3>내 기록 설정</h3>
      <label class="profile-field">
        <span>후기 닉네임</span>
        <input id="nicknameInput" type="text" maxlength="20" value="${escapeHtml(state.nickname)}" placeholder="닉네임을 입력해주세요" />
      </label>
      <p>찜, 먹음 기록, 입맛 수정은 이 기기 브라우저에 저장돼요.</p>
    </div>
    <div class="dashboard-card">
      <h3>최근 먹은 메뉴</h3>
      <p>전체 ${state.history.length}개 · 선택 기간 ${filteredHistoryItems.length}개</p>
      <div class="history-filter" aria-label="식사 기록 기간">
        ${HISTORY_RANGE_OPTIONS.map(
          (option) => `
            <button class="${Number(state.historyRangeDays) === option.days ? "is-active" : ""}" data-history-range="${option.days}">
              ${option.label}
            </button>
          `,
        ).join("")}
      </div>
      ${
        historyItems.length
          ? `<div class="history-list">
              ${historyItems
                .map(
                  (entry) => `
                    <div class="history-row">
                      <div class="history-row-info">
                        <strong>${escapeHtml(entry.menu.name)}</strong>
                        <span>${escapeHtml(entry.menu.restaurantName)}</span>
                      </div>
                      <label>
                        <span>먹은 시간</span>
                        <input type="datetime-local" value="${toDateTimeLocal(entry.eatenAt)}" data-history-time="${entry.historyKey}" />
                      </label>
                      <button class="inline-danger" data-delete-history="${entry.historyKey}">삭제</button>
                    </div>
                  `,
                )
                .join("")}
            </div>`
          : "<p>선택한 기간에 먹음 기록이 없어요.</p>"
      }
      ${
        filteredHistoryItems.length > historyItems.length
          ? `<button class="history-more-button" data-more-history>더 보기 ${filteredHistoryItems.length - historyItems.length}개 남음</button>`
          : ""
      }
    </div>
    <div class="dashboard-card">
      <h3>찜한 메뉴</h3>
      <p>찜한 메뉴 ${wishedItems.length}개</p>
      ${recordMenuRows(wishedItems.slice(0, 6), "아직 찜한 메뉴가 없어요.")}
    </div>
    <div class="dashboard-card">
      <h3>내가 작성한 후기</h3>
      <p>후기 ${reviewStats.count}개 · 평균 별점 ${reviewStats.avgRating} · 위생 ${reviewStats.avgHygiene} · 친절 ${reviewStats.avgKindness}</p>
      ${
        myReviews.length
          ? myReviews
              .map((review) => {
                const menu = DATA.menus.find((item) => item.id === review.menuId);
                return `
                  <div class="my-review-row">
                    <p>${menu?.name || "메뉴"} · ★ ${review.rating} <span>${escapeHtml(review.review_text || "")}</span></p>
                    <button class="inline-danger" data-delete-review="${review.menuId}">삭제</button>
                  </div>
                `;
              })
              .join("")
          : "<p>아직 작성한 후기가 없어요.</p>"
      }
    </div>
    <div class="dashboard-card">
      <h3>${state.myReports.length ? "내가 보낸 제보" : "음식점 정보 제보하기"}</h3>
      <p>${state.myReports.length ? "가게 추가, 폐업, 가격 변경처럼 내가 보낸 제보의 처리 상태를 확인해요." : "가게 추가, 폐업, 가격 변경처럼 잘못된 정보를 알려주세요."}</p>
      ${myReportRows()}
      <div class="dashboard-actions">
        <button data-report-open data-report-type="wrong_info" data-report-target-type="general" data-report-target-id="" data-report-target-label="전체 데이터">음식점 정보 제보하기</button>
      </div>
    </div>
    ${
      debugModeEnabled()
        ? `
          <details class="dashboard-card stats-detail dashboard-debug-card">
            <summary>디버그 정보 보기</summary>
            <p class="sync-status">동기화 상태: ${syncStatusText}</p>
            <p>카탈로그: ${escapeHtml(state.catalogStatus)} · source=${escapeHtml(state.catalogSource)}</p>
            <p>Supabase ready=${String(state.supabaseReady)} · reports=${state.myReports.length}</p>
            <p>음식점 ${DATA.meta.restaurantCount}곳 · 메뉴 ${DATA.meta.menuCount}개 · 수정일 ${DATA_UPDATED_AT}</p>
            <div class="dashboard-actions">
              <button data-refresh-remote>공유 데이터 새로고침</button>
            </div>
            <h3>자주 먹은 메뉴</h3>
            ${mostEatenRows()}
            <h3>카테고리 분포</h3>
            ${barRows(categories)}
            <h3>상황 태그</h3>
            ${barRows(moods)}
          </details>
        `
        : ""
    }
  `;
}

function switchTab(tabId, options = {}) {
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("is-active", panel.id === tabId));
  document.querySelectorAll(".bottom-nav button").forEach((button) => button.classList.toggle("is-active", button.dataset.tab === tabId));
  state.activeTab = tabId;
  closeRoulette();
  if (options.pushHistory !== false) pushAppState(tabId);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

const ONBOARDING_STEPS = [
  {
    selector: "#quickRecommendButton",
    title: "고민하지 말고 바로 눌러보세요!",
    description: "묵찌가 창원대 앞 메뉴 중 지금 먹기 좋은 메뉴 3개를 골라드려요.",
    helper: "",
    action: "다음",
    radius: 18,
  },
  {
    selector: "#conditionDetails > summary",
    title: "원하는 조건이 있다면 알려주세요!",
    description: "음식 종류, 예산, 맵기·짠맛·단맛과 혼밥·포장 같은 상황을 선택할 수 있어요. 조건 설정은 선택 사항이에요.",
    helper: "",
    action: "다음",
    radius: 18,
  },
  {
    selector: ".quick-hero-card",
    fallbackSelector: "#quickRecommendPanel",
    title: "추천 결과를 이렇게 활용해 보세요!",
    description: "마음에 들면 찜하거나 먹음 기록을 남길 수 있어요. 상세 정보와 네이버 지도에서 가게 위치도 확인할 수 있어요.",
    helper: "",
    action: "다음",
    radius: 22,
  },
  {
    selector: ".bottom-nav",
    title: "다른 방법으로도 메뉴를 골라보세요!",
    description: "월드컵과 검색으로 메뉴를 고르고, 찜한 메뉴와 내 기록도 언제든 확인할 수 있어요.",
    helper: "",
    action: "메뉴 추천받기",
    radius: 24,
  },
];

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function hasSeenOnboarding() {
  try {
    return localStorage.getItem(ONBOARDING_SEEN_KEY) === "true";
  } catch (error) {
    console.warn("onboarding storage unavailable", error);
    return true;
  }
}

function markOnboardingSeen() {
  try {
    localStorage.setItem(ONBOARDING_SEEN_KEY, "true");
  } catch (error) {
    console.warn("onboarding storage unavailable", error);
  }
}

function hasOpenDialog() {
  return Boolean(document.querySelector("dialog[open]"));
}

function hasReusableOnboardingRecommendation() {
  return Boolean(state.hasSearched && state.quickItems.length);
}

function snapshotRecommendationState() {
  return {
    activeRecommendationMode: state.activeRecommendationMode,
    hasSearched: state.hasSearched,
    isSearching: state.isSearching,
    quickItems: [...state.quickItems],
    quickSeenIds: new Set(state.quickSeenIds),
    quickMode: state.quickMode,
    discoveryPickCount: state.discoveryPickCount,
    discoveryNudgeThreshold: state.discoveryNudgeThreshold,
    alternativesExpanded: state.alternativesExpanded,
    rerollCount: state.rerollCount,
    rerollPromptVisible: state.rerollPromptVisible,
    quickAppliedWeather: state.quickAppliedWeather,
    quickLocationBase: { ...state.quickLocationBase },
    page: state.page,
  };
}

function restoreRecommendationSnapshot(snapshot) {
  if (!snapshot) return;
  if (state.recommendTimer) {
    clearTimeout(state.recommendTimer);
    state.recommendTimer = null;
  }
  state.activeRecommendationMode = snapshot.activeRecommendationMode;
  state.hasSearched = snapshot.hasSearched;
  state.isSearching = snapshot.isSearching;
  state.quickItems = [...snapshot.quickItems];
  state.quickSeenIds = new Set(snapshot.quickSeenIds);
  state.quickMode = snapshot.quickMode;
  state.discoveryPickCount = snapshot.discoveryPickCount;
  state.discoveryNudgeThreshold = snapshot.discoveryNudgeThreshold;
  state.alternativesExpanded = snapshot.alternativesExpanded;
  state.rerollCount = snapshot.rerollCount;
  state.rerollPromptVisible = snapshot.rerollPromptVisible;
  state.quickAppliedWeather = snapshot.quickAppliedWeather;
  state.quickLocationBase = { ...snapshot.quickLocationBase };
  state.page = snapshot.page;
  state.suppressDiscoveryPickCount = false;
  render();
}

function cleanupOnboardingTemporaryRecommendation() {
  if (!state.onboarding.createdTemporaryRecommendation) return;
  restoreRecommendationSnapshot(state.onboarding.recommendationSnapshot);
  state.onboarding.createdTemporaryRecommendation = false;
}

function scheduleOnboardingStart(options = {}) {
  const force = Boolean(options.force);
  if (!els.onboardingOverlay) return;
  if (!force && state.sharedPickStatus !== "none") return;
  if (!force && hasSeenOnboarding()) return;
  if (state.onboarding.active || state.onboarding.pending) return;
  state.onboarding.pending = true;

  const attemptStart = () => {
    if (state.onboarding.active) {
      state.onboarding.pending = false;
      return;
    }
    if (!force && hasSeenOnboarding()) {
      state.onboarding.pending = false;
      return;
    }
    if (!force && state.sharedPickStatus !== "none") {
      state.onboarding.pending = false;
      return;
    }
    if (!state.appReady || document.body.classList.contains("splash-active") || hasOpenDialog()) {
      window.setTimeout(attemptStart, 300);
      return;
    }
    state.onboarding.pending = false;
    startOnboarding({ force });
  };

  window.setTimeout(attemptStart, 250);
}

function startOnboarding(options = {}) {
  const force = Boolean(options.force);
  if (!els.onboardingOverlay || state.onboarding.active) return;
  if (!force && hasSeenOnboarding()) return;
  if (!state.appReady || hasOpenDialog()) {
    scheduleOnboardingStart({ force });
    return;
  }

  switchTab("recommendTab");
  window.scrollTo({ top: 0, behavior: "auto" });
  closeRoulette();
  state.onboarding.active = true;
  state.onboarding.force = force;
  state.onboarding.step = 0;
  state.onboarding.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  state.onboarding.recommendationSnapshot = snapshotRecommendationState();
  state.onboarding.createdTemporaryRecommendation = false;
  state.onboarding.hadRecommendationAtStart = hasReusableOnboardingRecommendation();
  document.body.classList.add("onboarding-active");
  els.onboardingOverlay.hidden = false;
  renderOnboardingStep();
}

function currentOnboardingTarget() {
  const step = ONBOARDING_STEPS[state.onboarding.step];
  if (!step) return null;
  return document.querySelector(step.selector) || (step.fallbackSelector ? document.querySelector(step.fallbackSelector) : null);
}

function onboardingHeroCardExists() {
  return Boolean(document.querySelector(".quick-hero-card"));
}

function waitForOnboardingResult(timeout = 3600) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      if (onboardingHeroCardExists()) {
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeout) {
        resolve(false);
        return;
      }
      window.setTimeout(check, 90);
    };
    check();
  });
}

async function prepareOnboardingRecommendationStep() {
  if (state.onboarding.hadRecommendationAtStart || (onboardingHeroCardExists() && state.quickItems.length)) {
    if (!onboardingHeroCardExists()) renderRecommendations();
    return true;
  }
  if (!state.appReady) return false;
  setActiveRecommendationMode("discovery");
  state.onboarding.preparing = true;
  els.onboardingNextButton.disabled = true;
  els.onboardingNextButton.textContent = "추천 준비 중...";

  if (!state.recommendTimer) {
    state.onboarding.createdTemporaryRecommendation = true;
    finishRecommendation(600, {
      suppressDiscoveryPickCount: true,
      applyWeather: false,
      locationBase: FALLBACK_LOCATION,
    });
  }
  const resultReady = await waitForOnboardingResult();
  state.onboarding.preparing = false;
  return resultReady;
}

function isRectMostlyVisible(rect) {
  const topLimit = 24;
  const bottomLimit = window.innerHeight - 24;
  return rect.top >= topLimit && rect.bottom <= bottomLimit;
}

function scrollOnboardingTargetIntoView(target) {
  if (!target || target.matches(".bottom-nav")) return;
  const rect = target.getBoundingClientRect();
  if (isRectMostlyVisible(rect)) return;
  target.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "center",
    inline: "nearest",
  });
}

function clampOnboardingPosition(value, min, max) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function positionOnboarding() {
  if (!state.onboarding.active || !els.onboardingSpotlight || !els.onboardingCard) return;
  const target = currentOnboardingTarget();
  if (!target) return;

  const rect = target.getBoundingClientRect();
  const pad = target.matches(".bottom-nav") ? 4 : 8;
  const left = clampOnboardingPosition(rect.left - pad, 8, window.innerWidth - 24);
  const top = clampOnboardingPosition(rect.top - pad, 8, window.innerHeight - 24);
  const width = Math.min(window.innerWidth - 16, rect.width + pad * 2);
  const height = Math.min(window.innerHeight - 16, rect.height + pad * 2);
  els.onboardingSpotlight.style.setProperty("--spotlight-left", `${left}px`);
  els.onboardingSpotlight.style.setProperty("--spotlight-top", `${top}px`);
  els.onboardingSpotlight.style.setProperty("--spotlight-width", `${Math.max(44, width)}px`);
  els.onboardingSpotlight.style.setProperty("--spotlight-height", `${Math.max(44, height)}px`);
  els.onboardingSpotlight.style.setProperty("--spotlight-radius", `${ONBOARDING_STEPS[state.onboarding.step].radius}px`);

  const card = els.onboardingCard;
  const cardWidth = Math.min(window.innerWidth - 32, 360);
  card.style.width = `${cardWidth}px`;
  const cardHeight = card.offsetHeight || 260;
  const gap = 12;
  const safeBottom = 24;
  const canPlaceBelow = top + height + gap + cardHeight <= window.innerHeight - safeBottom;
  const preferredTop = canPlaceBelow ? top + height + gap : top - cardHeight - gap;
  const cardTop = clampOnboardingPosition(preferredTop, 12, window.innerHeight - safeBottom - cardHeight);
  const targetCenter = left + width / 2;
  const cardLeft = clampOnboardingPosition(targetCenter - cardWidth / 2, 16, window.innerWidth - cardWidth - 16);
  card.style.setProperty("--coach-left", `${cardLeft}px`);
  card.style.setProperty("--coach-top", `${cardTop}px`);
}

function requestOnboardingPosition() {
  if (!state.onboarding.active) return;
  if (state.onboarding.positionFrame) cancelAnimationFrame(state.onboarding.positionFrame);
  state.onboarding.positionFrame = requestAnimationFrame(() => {
    state.onboarding.positionFrame = null;
    positionOnboarding();
  });
}

function renderOnboardingStep() {
  const step = ONBOARDING_STEPS[state.onboarding.step];
  if (!step || !els.onboardingCard) return;
  const target = currentOnboardingTarget();
  if (target) scrollOnboardingTargetIntoView(target);

  els.onboardingStepLabel.textContent = `${state.onboarding.step + 1} / ${ONBOARDING_STEPS.length}`;
  els.onboardingTitle.textContent = step.title;
  els.onboardingDescription.textContent = step.description;
  els.onboardingHelper.textContent = step.helper || "";
  els.onboardingPrevButton.disabled = state.onboarding.step === 0;
  els.onboardingNextButton.disabled = false;
  els.onboardingNextButton.textContent = step.action;

  clearTimeout(state.onboarding.scrollTimer);
  state.onboarding.scrollTimer = window.setTimeout(requestOnboardingPosition, prefersReducedMotion() ? 30 : 260);
  requestOnboardingPosition();
  els.onboardingCard.focus({ preventScroll: true });
}

function finishOnboarding(options = {}) {
  if (!state.onboarding.active) return;
  const scrollToResult = Boolean(options.scrollToResult);
  const startRecommendation = Boolean(options.startRecommendation);
  const createdTemporaryRecommendation = state.onboarding.createdTemporaryRecommendation;
  markOnboardingSeen();
  cleanupOnboardingTemporaryRecommendation();
  state.onboarding.active = false;
  state.onboarding.pending = false;
  state.onboarding.force = false;
  state.onboarding.preparing = false;
  state.onboarding.recommendationSnapshot = null;
  state.onboarding.hadRecommendationAtStart = false;
  clearTimeout(state.onboarding.scrollTimer);
  if (state.onboarding.positionFrame) cancelAnimationFrame(state.onboarding.positionFrame);
  state.onboarding.positionFrame = null;
  els.onboardingOverlay.hidden = true;
  document.body.classList.remove("onboarding-active");

  if (startRecommendation) {
    switchTab("recommendTab");
    quickRecommend();
    return;
  }

  if (scrollToResult) {
    switchTab("recommendTab");
    window.setTimeout(() => {
      const target = createdTemporaryRecommendation
        ? els.quickRecommendButton
        : document.querySelector(".quick-hero-card") || document.querySelector(".recommend-section") || els.quickRecommendButton;
      target?.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: createdTemporaryRecommendation ? "center" : "start",
      });
      if (target instanceof HTMLElement) target.focus?.({ preventScroll: true });
    }, 120);
    return;
  }
  state.onboarding.previousFocus?.focus?.({ preventScroll: true });
}

async function nextOnboardingStep() {
  if (state.onboarding.preparing) return;
  if (state.onboarding.step >= ONBOARDING_STEPS.length - 1) {
    finishOnboarding({ startRecommendation: true });
    return;
  }
  const nextStep = state.onboarding.step + 1;
  if (nextStep === 2) {
    await prepareOnboardingRecommendationStep();
    if (!state.onboarding.active || state.onboarding.step !== 1) return;
  }
  state.onboarding.step = nextStep;
  renderOnboardingStep();
}

function prevOnboardingStep() {
  if (state.onboarding.preparing) return;
  if (state.onboarding.step <= 0) return;
  state.onboarding.step -= 1;
  renderOnboardingStep();
}

function handleOnboardingKeydown(event) {
  if (!state.onboarding.active || !els.onboardingCard) return;
  if (event.key === "Escape") {
    event.preventDefault();
    finishOnboarding();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...els.onboardingCard.querySelectorAll("button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function pushAppState(screen = state.activeTab) {
  if (!history.pushState) return;
  history.pushState({ changwonFoodApp: true, screen }, "", window.location.href);
}

function handleBackNavigation() {
  if (els.reportDialog?.open) {
    els.reportDialog.close();
    pushAppState("reportClosed");
    return;
  }
  if (els.detailDialog?.open) {
    els.detailDialog.close();
    pushAppState(state.activeTab);
    return;
  }
  if (els.locationDialog?.open) {
    els.locationDialog.close();
    pushAppState(state.activeTab);
    return;
  }
  if (state.roulette.active) {
    closeRoulette();
    pushAppState(state.activeTab);
    return;
  }
  if (state.activeTab !== "recommendTab") {
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("is-active", panel.id === "recommendTab"));
    document.querySelectorAll(".bottom-nav button").forEach((button) => button.classList.toggle("is-active", button.dataset.tab === "recommendTab"));
    state.activeTab = "recommendTab";
    pushAppState("recommendTab");
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  const now = Date.now();
  if (now - state.lastBackAt < 1700) {
    history.back();
    return;
  }
  state.lastBackAt = now;
  toast("한 번 더 누르면 종료돼요");
  pushAppState("recommendTab");
}

function handlePopNavigation() {
  const parsed = parseSharedPickFromUrl();
  if (parsed.present) {
    setSharedPickState(parsed, FALLBACK_LOCATION);
    switchTab("recommendTab", { pushHistory: false });
    render();
    return;
  }
  if (state.sharedPickStatus !== "none") {
    clearSharedPickState();
    state.hasSearched = false;
    state.quickItems = [];
    state.quickSeenIds = new Set();
    switchTab("recommendTab", { pushHistory: false });
    quickRecommend();
    return;
  }
  handleBackNavigation();
}

function bindEvents() {
  els.locationButton.addEventListener("click", showLocationDialog);
  els.shareButton.addEventListener("click", shareAppLink);
  els.sharePickButton?.addEventListener("click", shareCurrentPick);
  els.onboardingHelpButton?.addEventListener("click", () => startOnboarding({ force: true }));
  els.quickRecommendButton.addEventListener("click", quickRecommend);
  els.searchButton.addEventListener("click", searchMenus);
  els.resetFiltersButton.addEventListener("click", resetFilters);
  els.rerollQuickButton.addEventListener("click", rerollQuickRecommendations);
  els.toggleAlternativesButton.addEventListener("click", toggleAlternativeMenus);
  els.conditionDetails?.addEventListener("toggle", handleConditionDetailsToggle);
  els.conditionDetails?.addEventListener("click", (event) => {
    if (event.target.closest("[data-load-saved-preferences]")) {
      loadSavedRecommendationPreferences();
      return;
    }
    if (event.target.closest("[data-reset-saved-preferences]")) {
      resetFilters();
    }
  });
  els.budgetRange.addEventListener("input", (event) => {
    commitRangePreference("budget", event, "input");
  });
  els.budgetRange.addEventListener("change", (event) => {
    commitRangePreference("budget", event, "change");
  });
  for (const [key, input] of [
    ["spicy", els.spicyPreference],
    ["salty", els.saltyPreference],
    ["sweet", els.sweetPreference],
  ]) {
    const updateTastePreference = (event) => commitRangePreference(key, event, event.type);
    input.addEventListener("input", updateTastePreference);
    input.addEventListener("change", updateTastePreference);
  }
  for (const key of ["onlyOpen", "needTakeout", "needDelivery", "needAlone", "wantMeat"]) {
    els[key].addEventListener("change", (event) => {
      state[key] = event.target.checked;
      markConditionsChanged();
      renderConditionDraft();
    });
  }
  els.categoryGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    const value = button.dataset.category;
    state.categories.has(value) ? state.categories.delete(value) : state.categories.add(value);
    resetStoreMenuExpansions();
    markConditionsChanged();
    renderConditionDraft();
  });
  els.moodGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mood]");
    if (!button) return;
    const value = button.dataset.mood;
    state.moods.has(value) ? state.moods.delete(value) : state.moods.add(value);
    markConditionsChanged();
    renderConditionDraft();
  });
  els.worldcupCategoryGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-worldcup-category]");
    if (!button) return;
    const value = button.dataset.worldcupCategory;
    state.worldcupCategories.has(value) ? state.worldcupCategories.delete(value) : state.worldcupCategories.add(value);
    state.worldcup = null;
    render();
  });
  els.nextRecommendButton.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(pageMenus().all.length / 10));
    state.page = (state.page + 1) % totalPages;
    renderRecommendations();
    document.querySelector(".recommend-section").scrollIntoView({ behavior: "smooth" });
  });
  els.rouletteButton.addEventListener("click", openRoulette);
  els.stopRouletteButton?.addEventListener("click", stopRoulette);
  els.rerollRouletteButton?.addEventListener("click", rerollRoulette);
  els.closeRouletteButton?.addEventListener("click", closeRoulette);
  els.storeSearchInput?.addEventListener("input", (event) => {
    setStoreSearchTerm(event.target.value);
    renderStoreSearch();
  });
  document.body.addEventListener("click", (event) => {
    rememberExternalLinkClick(event);
    const analyticsMapLink = event.target.closest("[data-analytics-map]");
    if (analyticsMapLink) {
      analyticsClient?.recordMapOpen({
        menuId: analyticsMapLink.dataset.analyticsMenuId || null,
        restaurantId: analyticsMapLink.dataset.analyticsRestaurantId,
        sourceContext: analyticsMapLink.dataset.analyticsContext,
      });
    }
    const unavailableMapButton = event.target.closest("[data-map-unavailable]");
    if (unavailableMapButton) {
      event.preventDefault();
      toast("현재 네이버 지도에 등록된 가게 정보가 없어요.");
      return;
    }
    const weatherToggle = event.target.closest("[data-weather-toggle]");
    if (weatherToggle) {
      toggleWeatherReference();
      return;
    }
    const openLocationButton = event.target.closest("[data-open-location]");
    if (openLocationButton) {
      showLocationDialog();
      return;
    }
    const storeMenuToggle = event.target.closest("[data-store-menu-toggle]");
    if (storeMenuToggle) {
      toggleStoreMenuExpansion(storeMenuToggle.dataset.storeMenuToggle);
      return;
    }
    const openPreferencesButton = event.target.closest("[data-open-preferences]");
    if (openPreferencesButton) {
      openPreferenceSettings();
      return;
    }
    const dismissDiscoveryNudgeButton = event.target.closest("[data-dismiss-discovery-nudge]");
    if (dismissDiscoveryNudgeButton) {
      dismissDiscoveryNudge();
      return;
    }
    const returnDiscoveryButton = event.target.closest("[data-return-discovery]");
    if (returnDiscoveryButton) {
      returnToDiscoveryRecommendations();
      return;
    }
    const locationChoice = event.target.closest("[data-location-choice]");
    if (locationChoice) chooseLocationPreference(locationChoice.dataset.locationChoice);
    const detail = event.target.closest("[data-detail]");
    if (detail) showDetail(detail.dataset.detail, detail.dataset.detailContext || "other");
    const wish = event.target.closest("[data-wish]");
    if (wish) toggleWishlist(wish.dataset.wish);
    const ate = event.target.closest("[data-ate]");
    if (ate) {
      openEatenConfirmDialog(ate.dataset.ate);
      return;
    }
    const saveTasteButton = event.target.closest("[data-save-taste]");
    if (saveTasteButton) saveTaste(saveTasteButton.dataset.saveTaste);
    const resetTasteButton = event.target.closest("[data-reset-taste]");
    if (resetTasteButton) resetTaste(resetTasteButton.dataset.resetTaste);
    const saveReviewButton = event.target.closest("[data-save-review]");
    if (saveReviewButton) saveReview(saveReviewButton.dataset.saveReview);
    const deleteReviewButton = event.target.closest("[data-delete-review]");
    if (deleteReviewButton) deleteReview(deleteReviewButton.dataset.deleteReview);
    const deleteHistoryButton = event.target.closest("[data-delete-history]");
    if (deleteHistoryButton) deleteHistoryEntry(deleteHistoryButton.dataset.deleteHistory);
    const historyRangeButton = event.target.closest("[data-history-range]");
    if (historyRangeButton) setHistoryRange(historyRangeButton.dataset.historyRange);
    const moreHistoryButton = event.target.closest("[data-more-history]");
    if (moreHistoryButton) showMoreHistory();
    const moreReviewsButton = event.target.closest("[data-more-reviews]");
    if (moreReviewsButton) {
      const id = moreReviewsButton.dataset.moreReviews;
      state.reviewVisibleCount[id] = (state.reviewVisibleCount[id] || 5) + 5;
      showDetail(id, state.detailContext);
    }
    const refreshRemoteButton = event.target.closest("[data-refresh-remote]");
    if (refreshRemoteButton) refreshRemoteData();
    const retryReviewButton = event.target.closest("[data-retry-review]");
    if (retryReviewButton) retryPendingReview();
    const reportOpenButton = event.target.closest("[data-report-open]");
    if (reportOpenButton) openReportDialog(reportOpenButton);
    const ratingButton = event.target.closest("[data-rating-value]");
    if (ratingButton) {
      const editor = ratingButton.closest("[data-review-editor]");
      const value = Number(ratingButton.dataset.ratingValue);
      const input = editor?.querySelector('[data-review-field="rating"]');
      const output = editor?.querySelector('[data-review-output="rating"]');
      if (input) input.value = String(value);
      if (output) output.textContent = String(value);
      editor?.querySelectorAll("[data-rating-value]").forEach((button) => {
        const selected = Number(button.dataset.ratingValue) <= value;
        button.classList.toggle("is-selected", selected);
        button.textContent = selected ? "★" : "☆";
      });
    }
    const start = event.target.closest("#startWorldcup");
    if (start) startWorldcup();
    const restart = event.target.closest("#restartWorldcup");
    if (restart) startWorldcup();
    const choice = event.target.closest("[data-worldcup-choice]");
    if (choice) chooseWorldcup(Number(choice.dataset.worldcupChoice));
  });
  document.body.addEventListener("input", (event) => {
    const nicknameInput = event.target.closest("#nicknameInput");
    if (nicknameInput) {
      saveNickname(nicknameInput.value.trim());
      return;
    }
    const input = event.target.closest("[data-taste-field]");
    if (input) {
      const output = input.closest("[data-taste-editor]")?.querySelector(`[data-taste-output="${input.dataset.tasteField}"]`);
      if (output) output.textContent = input.value;
      return;
    }
    const reviewInput = event.target.closest("[data-review-field]");
    if (!reviewInput) return;
    const output = reviewInput.closest("[data-review-editor]")?.querySelector(`[data-review-output="${reviewInput.dataset.reviewField}"]`);
    if (output) output.textContent = reviewInput.value;
  });
  document.body.addEventListener("change", (event) => {
    const historyTimeInput = event.target.closest("[data-history-time]");
    if (historyTimeInput) updateHistoryEntry(historyTimeInput.dataset.historyTime, historyTimeInput.value);
  });
  els.clearWishlist.addEventListener("click", () => {
    state.wishlist = [];
    saveWishlist();
    renderWishlist();
  });
  els.onboardingSkipButton?.addEventListener("click", () => finishOnboarding());
  els.onboardingPrevButton?.addEventListener("click", prevOnboardingStep);
  els.onboardingNextButton?.addEventListener("click", nextOnboardingStep);
  els.worldcupSize.addEventListener("change", () => {
    state.worldcup = null;
    renderWorldcup();
  });
  document.querySelectorAll(".bottom-nav button").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
  els.closeDialog.addEventListener("click", () => {
    els.detailDialog.close();
    state.detailAnalyticsContext = null;
  });
  els.cancelEatenConfirm?.addEventListener("click", closeEatenConfirmDialog);
  els.confirmEatenRecord?.addEventListener("click", confirmEatenRecord);
  els.eatenConfirmDialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeEatenConfirmDialog();
  });
  els.eatenConfirmDialog?.addEventListener("click", (event) => {
    if (event.target === els.eatenConfirmDialog) closeEatenConfirmDialog();
  });
  els.eatenConfirmDialog?.addEventListener("close", () => {
    state.pendingEatenMenuId = null;
  });
  els.closeReportDialog?.addEventListener("click", () => els.reportDialog.close());
  els.reportForm?.addEventListener("submit", submitInfoReport);
  window.addEventListener("popstate", handlePopNavigation);
  window.addEventListener("resize", requestOnboardingPosition);
  window.addEventListener("orientationchange", requestOnboardingPosition);
  window.addEventListener("scroll", requestOnboardingPosition, { passive: true });
  document.addEventListener("keydown", handleOnboardingKeydown);
}

function finishSplash() {
  if (state.splashHideScheduled) return;
  state.splashHideScheduled = true;
  const hideSplash = () => {
    if (state.appReady) return;
    state.appReady = true;
    els.splashScreen?.classList.add("is-hidden");
    document.body.classList.remove("splash-active");
    render();
    handleLocationAfterSplash();
    scheduleOnboardingStart();
  };
  const elapsed = Date.now() - splashStartedAt;
  const remaining = Math.max(0, SPLASH_MIN_DURATION - elapsed);
  window.setTimeout(() => window.requestAnimationFrame(hideSplash), remaining);
}

renderChips();
bindEvents();
analyticsClient?.initialize();
initializeSharedPickFromUrl();
if (history.replaceState && history.pushState) {
  history.replaceState({ changwonFoodApp: true, screen: "entry" }, "", window.location.href);
  history.pushState({ changwonFoodApp: true, screen: "recommendTab" }, "", window.location.href);
}
render();
finishSplash();
initSupabase();

window.addEventListener("pagehide", handlePageHideForRestore);
window.addEventListener("pageshow", handlePageShowRestore);

function checkServiceWorkerUpdate(registration) {
  if (!registration) return;
  registration.update().catch(() => {});
}

if ("serviceWorker" in navigator && ["http:", "https:"].includes(window.location.protocol)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js", { updateViaCache: "none" })
      .then((registration) => {
        checkServiceWorkerUpdate(registration);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") checkServiceWorkerUpdate(registration);
        });
      })
      .catch(() => {});
  });
}
