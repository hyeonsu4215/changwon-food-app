const DATA = window.CHANGWON_FOOD_DATA;
const catalogPolicy = window.CHANGWON_CATALOG_POLICY;
const ADMIN_FOOD_CHARACTER = window.CHANGWON_ADMIN_FOOD_CHARACTER;
const ADMIN_WEEKLY_HOURS = window.CHANGWON_ADMIN_WEEKLY_HOURS;
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
  adminAuthorized: false,
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
  weeklyHoursGeneration: 0,
  weeklyHoursEditor: {
    generation: null,
    restaurantId: null,
    restaurantName: "",
    loading: false,
    error: "",
    originalRows: [],
    draftRows: [],
    localDraft: false,
    undoRows: null,
    showDiff: false,
    verificationConfirmed: false,
    bulkMessage: "",
    saving: false,
    saveMessage: "",
    saveMessageType: "",
  },
  foodCharacterEditorGeneration: 0,
  foodCharacterEditor: ADMIN_FOOD_CHARACTER?.createEditorState?.() || {
    menuId: null,
    menuName: "",
    restaurantName: "",
    originalValue: null,
    nextValue: null,
    saving: false,
  },
  foodCharacterMessage: "",
  foodCharacterMessageType: "",
  reviewFilter: "all",
  reviewMode: "all",
  reviewRestaurantId: "all",
  reviewPage: 0,
  reviewPageSize: 10,
  reportFilter: "all",
  catalogMode: "restaurants",
  analyticsRequestId: 0,
  analytics: {
    loading: false,
    loaded: false,
    error: false,
    data: null,
  },
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
  analyticsPanel: document.querySelector("#analyticsPanel"),
  analyticsStatus: document.querySelector("#analyticsStatus"),
  analyticsContent: document.querySelector("#analyticsContent"),
  refreshAnalytics: document.querySelector("#refreshAnalytics"),
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
  weeklyHoursEditor: document.querySelector("#weeklyHoursEditor"),
  weeklyHoursContent: document.querySelector("#weeklyHoursContent"),
  menuForm: document.querySelector("#menuForm"),
  foodCharacterSelect: document.querySelector("#foodCharacterSelect"),
  foodCharacterSourceBadge: document.querySelector("#foodCharacterSourceBadge"),
  foodCharacterMenuName: document.querySelector("#foodCharacterMenuName"),
  foodCharacterMenuMeta: document.querySelector("#foodCharacterMenuMeta"),
  foodCharacterChangePreview: document.querySelector("#foodCharacterChangePreview"),
  foodCharacterCurrentLabel: document.querySelector("#foodCharacterCurrentLabel"),
  foodCharacterCurrentValue: document.querySelector("#foodCharacterCurrentValue"),
  foodCharacterNextLabel: document.querySelector("#foodCharacterNextLabel"),
  foodCharacterNextValue: document.querySelector("#foodCharacterNextValue"),
  foodCharacterHelp: document.querySelector("#foodCharacterHelp"),
  foodCharacterSaveStatus: document.querySelector("#foodCharacterSaveStatus"),
  saveFoodCharacter: document.querySelector("#saveFoodCharacter"),
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

const ANALYTICS_ACQUISITION_LABELS = Object.freeze([
  ["direct", "직접 접속"],
  ["everytime", "에브리타임"],
  ["kakao", "카카오"],
  ["instagram", "인스타"],
  ["poster_qr", "포스터 QR"],
  ["share", "묵찌 공유"],
  ["other", "기타"],
]);

function analyticsCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeAnalyticsDashboard(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const today = payload.today;
  const acquisition = payload.acquisition;
  const lastSevenDays = payload.last_7_days;
  if (!today || !acquisition || !lastSevenDays || !Array.isArray(payload.restaurants)) return null;

  const normalizedToday = {
    sessions: analyticsCount(today.sessions),
    completedSessions: analyticsCount(today.completed_sessions),
    completionRate: today.completion_rate === null
      ? null
      : Number.isFinite(today.completion_rate) && today.completion_rate >= 0 && today.completion_rate <= 100
        ? Number(today.completion_rate)
        : undefined,
    refreshes: analyticsCount(today.refreshes),
    menuDetailOpens: analyticsCount(today.menu_detail_opens),
    mapOpens: analyticsCount(today.map_opens),
    shares: analyticsCount(today.shares),
    errors: analyticsCount(today.errors),
  };
  if (Object.values(normalizedToday).some((value) => value === undefined)) return null;
  if (Object.entries(normalizedToday).some(([key, value]) => key !== "completionRate" && value === null)) return null;

  const normalizedAcquisition = {};
  for (const [slug] of ANALYTICS_ACQUISITION_LABELS) {
    const count = analyticsCount(acquisition[slug]);
    if (count === null) return null;
    normalizedAcquisition[slug] = count;
  }
  const internalTest = analyticsCount(acquisition.internal_test);
  if (internalTest === null) return null;
  normalizedAcquisition.internalTest = internalTest;

  const normalizedLastSevenDays = {
    sessions: analyticsCount(lastSevenDays.sessions),
    completedSessions: analyticsCount(lastSevenDays.completed_sessions),
    mapOpens: analyticsCount(lastSevenDays.map_opens),
  };
  if (Object.values(normalizedLastSevenDays).some((value) => value === null)) return null;

  const restaurants = [];
  for (const restaurant of payload.restaurants) {
    const restaurantId = String(restaurant?.restaurant_id || "").trim();
    const restaurantName = String(restaurant?.restaurant_name || "").trim();
    const recommendationExposures = analyticsCount(restaurant?.recommendation_exposures);
    const menuDetailOpens = analyticsCount(restaurant?.menu_detail_opens);
    const mapOpens = analyticsCount(restaurant?.map_opens);
    if (!restaurantId || !restaurantName || [recommendationExposures, menuDetailOpens, mapOpens].includes(null)) return null;
    restaurants.push({ restaurantId, restaurantName, recommendationExposures, menuDetailOpens, mapOpens });
  }

  return Object.freeze({
    today: Object.freeze(normalizedToday),
    acquisition: Object.freeze(normalizedAcquisition),
    lastSevenDays: Object.freeze(normalizedLastSevenDays),
    restaurants: Object.freeze(restaurants),
  });
}

function analyticsMetric(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function renderAnalyticsDashboardMarkup(data) {
  const completionRate = data.today.completionRate === null ? "-" : `${data.today.completionRate.toFixed(1).replace(/\.0$/, "")}%`;
  const regularAcquisitionTotal = ANALYTICS_ACQUISITION_LABELS.reduce(
    (sum, [slug]) => sum + data.acquisition[slug],
    0,
  );
  const acquisitionRows = ANALYTICS_ACQUISITION_LABELS.map(([slug, label]) => {
    const count = data.acquisition[slug];
    const percentage = regularAcquisitionTotal > 0 ? Math.min(100, (count / regularAcquisitionTotal) * 100) : 0;
    return `
      <div class="analytics-acquisition-row">
        <div><span>${escapeHtml(label)}</span><strong>${count}</strong></div>
        <div class="analytics-acquisition-track" aria-label="${escapeHtml(label)} ${count}세션">
          <span style="width: ${percentage.toFixed(1)}%"></span>
        </div>
      </div>
    `;
  }).join("");
  const restaurantRows = data.restaurants.length
    ? `
      <div class="analytics-restaurant-table" role="table" aria-label="최근 7일 가게별 관심">
        <div class="analytics-restaurant-head" role="row">
          <span role="columnheader">가게</span><span role="columnheader">추천 노출</span><span role="columnheader">메뉴 상세 확인</span><span role="columnheader">지도 열기</span>
        </div>
        ${data.restaurants.map((restaurant) => `
          <div class="analytics-restaurant-row" role="row" data-restaurant-id="${escapeHtml(restaurant.restaurantId)}">
            <strong role="cell">${escapeHtml(restaurant.restaurantName)}</strong>
            <span role="cell" data-label="추천 노출">${restaurant.recommendationExposures}</span>
            <span role="cell" data-label="메뉴 상세 확인">${restaurant.menuDetailOpens}</span>
            <span role="cell" data-label="지도 열기">${restaurant.mapOpens}</span>
          </div>
        `).join("")}
      </div>
    `
    : `<p class="analytics-empty">아직 기록된 관심 데이터가 없습니다.</p>`;

  return `
    <section class="analytics-section" aria-labelledby="analyticsTodayTitle">
      <h3 id="analyticsTodayTitle">오늘의 묵찌</h3>
      <dl class="analytics-kpi-grid">
        ${analyticsMetric("오늘 이용 세션", data.today.sessions)}
        ${analyticsMetric("추천 완료 세션", data.today.completedSessions)}
        ${analyticsMetric("추천 완료율", completionRate)}
        ${analyticsMetric("다른 메뉴 추천", data.today.refreshes)}
        ${analyticsMetric("메뉴 자세히 보기", data.today.menuDetailOpens)}
        ${analyticsMetric("지도 열기", data.today.mapOpens)}
        ${analyticsMetric("추천 공유", data.today.shares)}
        ${analyticsMetric("추천 오류", data.today.errors)}
      </dl>
    </section>
    <section class="analytics-section" aria-labelledby="analyticsAcquisitionTitle">
      <div class="analytics-section-heading">
        <h3 id="analyticsAcquisitionTitle">유입 경로</h3>
        <span>태그가 붙은 링크로 시작된 세션</span>
      </div>
      <div class="analytics-acquisition-list">${acquisitionRows}</div>
      <p class="analytics-internal-test">내부 테스트 ${data.acquisition.internalTest}세션 · 일반 이용 합계에서 제외</p>
    </section>
    <section class="analytics-section" aria-labelledby="analyticsSevenDayTitle">
      <h3 id="analyticsSevenDayTitle">최근 7일</h3>
      <dl class="analytics-kpi-grid analytics-kpi-grid-compact">
        ${analyticsMetric("이용 세션", data.lastSevenDays.sessions)}
        ${analyticsMetric("추천 완료 세션", data.lastSevenDays.completedSessions)}
        ${analyticsMetric("지도 열기", data.lastSevenDays.mapOpens)}
      </dl>
    </section>
    <section class="analytics-section" aria-labelledby="analyticsRestaurantTitle">
      <h3 id="analyticsRestaurantTitle">가게별 관심 · 최근 7일</h3>
      ${restaurantRows}
    </section>
  `;
}

function renderAnalyticsDashboard() {
  if (!els.analyticsStatus || !els.analyticsContent) return;
  if (state.analytics.loading) {
    els.analyticsStatus.hidden = false;
    els.analyticsStatus.textContent = "사용 현황을 불러오는 중...";
    els.analyticsContent.hidden = true;
    return;
  }
  if (state.analytics.error || !state.analytics.data) {
    els.analyticsStatus.hidden = false;
    els.analyticsStatus.textContent = "사용 현황을 불러오지 못했습니다.";
    els.analyticsContent.hidden = true;
    return;
  }
  els.analyticsStatus.hidden = true;
  els.analyticsContent.innerHTML = renderAnalyticsDashboardMarkup(state.analytics.data);
  els.analyticsContent.hidden = false;
}

function resetAnalyticsDashboardState() {
  state.analyticsRequestId += 1;
  state.analytics = { loading: false, loaded: false, error: false, data: null };
  if (els.analyticsStatus) {
    els.analyticsStatus.hidden = false;
    els.analyticsStatus.textContent = "사용 현황을 불러오는 중...";
  }
  if (els.analyticsContent) {
    els.analyticsContent.replaceChildren();
    els.analyticsContent.hidden = true;
  }
}

async function loadAnalyticsDashboard({ force = false } = {}) {
  if (!state.adminAuthorized || !state.supabase) return false;
  if (state.analytics.loading || (state.analytics.loaded && !force)) return true;
  const requestId = ++state.analyticsRequestId;
  const userId = state.user?.id || null;
  state.analytics = { ...state.analytics, loading: true, error: false };
  renderAnalyticsDashboard();

  let response;
  try {
    response = await state.supabase.rpc("get_admin_analytics_dashboard");
  } catch {
    response = { data: null, error: true };
  }
  if (requestId !== state.analyticsRequestId || !state.adminAuthorized || state.user?.id !== userId) return false;
  const normalized = response.error ? null : normalizeAnalyticsDashboard(response.data);
  if (!normalized) console.warn("admin dashboard load failed");
  state.analytics = {
    loading: false,
    loaded: Boolean(normalized),
    error: !normalized,
    data: normalized,
  };
  renderAnalyticsDashboard();
  return Boolean(normalized);
}

function setAdminTab(target) {
  const panels = {
    analytics: els.analyticsPanel,
    reviews: els.reviewsPanel,
    reports: els.reportsPanel,
    catalog: els.catalogPanel,
  };
  if (!Object.hasOwn(panels, target)) return false;
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    const active = button.dataset.adminTab === target;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  Object.entries(panels).forEach(([name, panel]) => {
    if (panel) panel.hidden = name !== target;
  });
  if (target === "catalog") renderCatalog();
  return true;
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

function createWeeklyHoursEditorState(overrides = {}) {
  return {
    generation: null,
    restaurantId: null,
    restaurantName: "",
    loading: false,
    error: "",
    originalRows: [],
    draftRows: [],
    localDraft: false,
    undoRows: null,
    showDiff: false,
    verificationConfirmed: false,
    bulkMessage: "",
    saving: false,
    saveMessage: "",
    saveMessageType: "",
    ...overrides,
  };
}

function invalidateWeeklyHoursContext() {
  state.weeklyHoursGeneration += 1;
  return state.weeklyHoursGeneration;
}

function resetWeeklyHoursEditingState({ render = true } = {}) {
  invalidateWeeklyHoursContext();
  state.weeklyHoursEditor = createWeeklyHoursEditorState();
  if (render) renderWeeklyHoursEditor();
}

function isCurrentWeeklyHoursRequest(requestContext) {
  return ADMIN_WEEKLY_HOURS?.isRequestCurrent?.(
    {
      generation: state.weeklyHoursGeneration,
      source: state.catalogSource,
      restaurantId: state.selectedRestaurantId,
    },
    requestContext,
  );
}

function weeklyLegacyValue(value) {
  if (value == null || value === "" || value === "X") return "정보 미확인";
  return String(value);
}

function renderWeeklyLegacyReference(restaurant) {
  if (!restaurant) return "";
  const open = weeklyLegacyValue(restaurant.openTime);
  const close = weeklyLegacyValue(restaurant.closeTime);
  const hours = open === "정보 미확인" || close === "정보 미확인" ? "정보 미확인" : `${open} ~ ${close}`;
  const hasSpecialClosure = ADMIN_WEEKLY_HOURS?.hasSpecialClosureRule?.(restaurant.closedDays);
  return `
    <section class="weekly-legacy-reference" aria-labelledby="weeklyLegacyReferenceTitle">
      <div>
        <span>현재 사용자 앱에서 사용 중</span>
        <strong id="weeklyLegacyReferenceTitle">기존 영업정보 참고</strong>
      </div>
      <dl>
        <div><dt>영업</dt><dd>${escapeHtml(hours)}</dd></div>
        <div><dt>브레이크</dt><dd>${escapeHtml(weeklyLegacyValue(restaurant.breakTime))}</dd></div>
        <div><dt>휴무</dt><dd>${escapeHtml(weeklyLegacyValue(restaurant.closedDays))}</dd></div>
      </dl>
      ${hasSpecialClosure ? `
        <p class="weekly-special-closure" role="status">
          <strong>특수 휴무 규칙 확인 필요</strong>
          <span>기존 정보: ${escapeHtml(restaurant.closedDays)}. 요일별 정기휴무로 자동 변환하지 않습니다.</span>
        </p>
      ` : ""}
    </section>
  `;
}

function weeklyStatusClass(kind) {
  if (kind === "verified") return "is-complete";
  if (kind === "incomplete") return "is-error";
  if (kind === "legacy") return "is-legacy";
  return "is-warning";
}

function weeklySourceLabel(rows) {
  const sources = [...new Set(rows.map((row) => row.source).filter(Boolean))];
  if (sources.length === 1 && sources[0] === "legacy_migration") return "기존 데이터 이관";
  if (sources.length === 1) return sources[0];
  if (sources.length > 1) return "여러 출처";
  return "임시 편집 · 미저장";
}

function weeklyVerifiedLabel(rows) {
  const verified = rows.filter((row) => row.last_verified_at);
  if (!verified.length) return "아직 확인되지 않음";
  if (verified.length !== rows.length) return `${verified.length}/7일 확인됨`;
  return "월~일 확인됨";
}

function weeklyDayOptions(selected) {
  return [
    ["open", "영업"],
    ["closed", "정기휴무"],
    ["unknown", "정보 미확인"],
  ].map(([value, label]) => `<option value="${value}"${selected === value ? " selected" : ""}>${label}</option>`).join("");
}

function weeklyBreakOptions(selected) {
  return [
    ["scheduled", "브레이크 있음"],
    ["none", "브레이크 없음"],
    ["unknown", "정보 미확인"],
  ].map(([value, label]) => `<option value="${value}"${selected === value ? " selected" : ""}>${label}</option>`).join("");
}

function renderWeeklyTimePart(id, label, part, value, options, disabled) {
  const listboxId = `${id}-${part}-options`;
  const disabledAttribute = disabled ? " disabled" : "";
  return `
    <div class="weekly-time-part" data-weekly-time-combobox>
      <label for="${id}-${part}">${part === "hour" ? "시" : "분"}</label>
      <div class="weekly-time-input-row">
        <input id="${id}-${part}" type="text" inputmode="numeric" maxlength="2" autocomplete="off" value="${escapeHtml(value)}" role="combobox" aria-autocomplete="none" aria-haspopup="listbox" aria-expanded="false" aria-controls="${listboxId}" aria-label="${label} ${part === "hour" ? "시" : "분"}" data-weekly-time-part="${part}"${disabledAttribute} />
        <button type="button" class="weekly-time-toggle" data-weekly-time-toggle aria-label="${label} ${part === "hour" ? "시" : "분"} 전체 목록 열기" aria-expanded="false" aria-controls="${listboxId}" title="전체 목록"${disabledAttribute}>▼</button>
      </div>
      <div id="${listboxId}" class="weekly-time-options" role="listbox" aria-label="${label} ${part === "hour" ? "시" : "분"} 선택" hidden>
        ${options.map((option) => `<button type="button" role="option" tabindex="-1" data-weekly-time-option="${option}" aria-selected="${option === value}">${option}</button>`).join("")}
      </div>
    </div>
  `;
}

function renderWeeklyTimeControl(row, field, label, { disabled = false, allow24 = false } = {}) {
  const value = ADMIN_WEEKLY_HOURS.formatAdminTimeInput(row[field], {
    allow24,
    closesNextDay: row.closes_next_day,
  });
  const id = `weeklyDay${row.iso_weekday}${field.replaceAll("_", "-")}`;
  const hourOptions = ADMIN_WEEKLY_HOURS.adminTimeOptions("hour", { allow24 });
  const minuteOptions = ADMIN_WEEKLY_HOURS.adminTimeOptions("minute");
  return `
    <fieldset class="weekly-time-control" data-weekly-time-control data-weekly-day="${row.iso_weekday}" data-weekly-time-field="${field}">
      <legend>${label}</legend>
      <div class="weekly-time-parts">
        ${renderWeeklyTimePart(id, label, "hour", value.hour, hourOptions, disabled)}
        <span aria-hidden="true">:</span>
        ${renderWeeklyTimePart(id, label, "minute", value.minute, minuteOptions, disabled)}
      </div>
    </fieldset>
  `;
}

function weeklyCardSummary(row) {
  if (row.day_status === "closed") return "시간 입력 없음";
  if (row.day_status === "unknown") return "영업시간 확인 필요";
  return ADMIN_WEEKLY_HOURS.formatWeeklySummary(row);
}

function renderWeeklyDayCard(row, openDays) {
  const weekday = ADMIN_WEEKLY_HOURS.WEEKDAYS.find((item) => item.isoWeekday === row.iso_weekday);
  const isOpen = row.day_status === "open";
  const hasScheduledBreak = isOpen && row.break_status === "scheduled";
  const idPrefix = `weeklyDay${row.iso_weekday}`;
  const openAttribute = openDays.has(row.iso_weekday) ? " open" : "";
  return `
    <details class="weekly-day-card status-${escapeHtml(row.day_status)}" data-weekly-day-card="${row.iso_weekday}"${openAttribute}>
      <summary>
        <span class="weekly-day-name">${weekday.label}</span>
        <span class="weekly-day-state status-${escapeHtml(row.day_status)}">${escapeHtml(ADMIN_WEEKLY_HOURS.dayStatusLabel(row.day_status))}</span>
        <span class="weekly-day-summary">${escapeHtml(weeklyCardSummary(row))}</span>
        <span class="weekly-expand-label">편집</span>
      </summary>
      <div class="weekly-day-controls">
        <label>
          <span>요일 상태</span>
          <select id="${idPrefix}Status" data-weekly-day="${row.iso_weekday}" data-weekly-field="day_status">
            ${weeklyDayOptions(row.day_status)}
          </select>
        </label>
        <div class="weekly-time-row">
          ${renderWeeklyTimeControl(row, "open_time", "오픈", { disabled: !isOpen })}
          <span aria-hidden="true">~</span>
          ${renderWeeklyTimeControl(row, "close_time", "마감", { disabled: !isOpen, allow24: true })}
        </div>
        <div class="weekly-overnight">
          <label class="weekly-checkbox">
            <input type="checkbox" data-weekly-day="${row.iso_weekday}" data-weekly-field="closes_next_day"${row.closes_next_day ? " checked" : ""}${isOpen ? "" : " disabled"} />
            <span>자정을 넘어 영업해요</span>
          </label>
          <small>예: 18:00 ~ 다음 날 02:00</small>
        </div>
        <label>
          <span>브레이크</span>
          <select data-weekly-day="${row.iso_weekday}" data-weekly-field="break_status"${isOpen ? "" : " disabled"}>
            ${weeklyBreakOptions(row.break_status)}
          </select>
        </label>
        <div class="weekly-time-row">
          ${renderWeeklyTimeControl(row, "break_start", "브레이크 시작", { disabled: !hasScheduledBreak })}
          <span aria-hidden="true">~</span>
          ${renderWeeklyTimeControl(row, "break_end", "브레이크 종료", { disabled: !hasScheduledBreak })}
        </div>
        <label class="weekly-note-field">
          <span>메모</span>
          <input value="${escapeHtml(row.note || "")}" placeholder="필요한 경우만 입력" data-weekly-day="${row.iso_weekday}" data-weekly-field="note" />
        </label>
      </div>
    </details>
  `;
}

function weeklyDiffValue(value) {
  if (value == null || value === "") return "없음";
  if (value === true) return "예";
  if (value === false) return "아니오";
  const labels = {
    open: "영업",
    closed: "정기휴무",
    unknown: "정보 미확인",
    scheduled: "브레이크 있음",
    none: "브레이크 없음",
    legacy_migration: "기존 데이터 이관",
  };
  return labels[value] || String(value);
}

function renderWeeklyDiff(diff) {
  if (!diff.length) return `<p class="weekly-no-diff">변경된 요일이 없습니다.</p>`;
  const fieldLabels = {
    day_status: "요일 상태",
    open_time: "오픈",
    close_time: "마감",
    closes_next_day: "자정을 넘어 영업",
    break_status: "브레이크",
    break_start: "브레이크 시작",
    break_end: "브레이크 종료",
    note: "메모",
    source: "출처",
    last_verified_at: "마지막 확인",
  };
  return `<div class="weekly-diff-list">${diff.map((day) => `
    <section>
      <strong>${day.label}</strong>
      <ul>${day.changes.map((change) => `<li><span>${fieldLabels[change.field] || change.field}</span><b>${escapeHtml(weeklyDiffValue(change.previousValue))}</b><i aria-hidden="true">→</i><b>${escapeHtml(weeklyDiffValue(change.nextValue))}</b></li>`).join("")}</ul>
    </section>
  `).join("")}</div>`;
}

function weeklySaveAssessment(restaurant, editor, { verifiedAt = null } = {}) {
  return ADMIN_WEEKLY_HOURS.assessWeeklySave({
    source: state.catalogSource,
    adminAuthorized: state.adminAuthorized,
    catalogEditable: canEditSupabaseCatalog(),
    restaurantExists: Boolean(restaurant && restaurant.id === editor.restaurantId),
    restaurantId: editor.restaurantId,
    selectedRestaurantId: state.selectedRestaurantId,
    generation: editor.generation,
    currentGeneration: state.weeklyHoursGeneration,
    saving: editor.saving,
    hasSpecialClosure: Boolean(
      restaurant?.id === "C024" || ADMIN_WEEKLY_HOURS.hasSpecialClosureRule(restaurant?.closedDays),
    ),
    originalRows: editor.originalRows,
    draftRows: editor.draftRows,
    verificationConfirmed: editor.verificationConfirmed,
    verifiedAt: editor.verificationConfirmed ? verifiedAt || new Date().toISOString() : null,
  });
}

function renderWeeklySavePreview(restaurant, editor, diff, assessment) {
  const changedCount = assessment.plan?.changedRows.length || 0;
  const modeLabel = assessment.plan?.mode === "insert" ? "신규 7일 시간표 생성" : "변경 요일만 수정";
  return `
    <section class="weekly-save-preview" aria-label="영업시간 저장 확인">
      <div class="weekly-save-preview-head">
        <div><span>저장 대상</span><strong>${escapeHtml(restaurant?.name || editor.restaurantName)} (${escapeHtml(editor.restaurantId)})</strong></div>
        <div><span>저장 후보</span><strong>${changedCount}일 · ${escapeHtml(modeLabel)}</strong></div>
      </div>
      ${renderWeeklyDiff(diff)}
      ${editor.verificationConfirmed ? `<p class="weekly-save-metadata">월~일 7일에 같은 확인 시각과 <strong>admin_manual</strong> 출처를 적용하는 후보입니다.</p>` : ""}
      <div class="weekly-save-preview-actions">
        <button type="button" data-weekly-preview>취소</button>
        <button type="button" class="weekly-save-button" data-weekly-save${assessment.canSave ? "" : " disabled"}>영업시간 저장</button>
      </div>
    </section>
  `;
}

function renderWeeklyDraft(restaurant, editor, openDays) {
  const rows = editor.draftRows;
  const summary = ADMIN_WEEKLY_HOURS.summarizeWeeklyStatus(rows);
  const diff = ADMIN_WEEKLY_HOURS.diffWeeklyHours(editor.originalRows, rows);
  const validation = ADMIN_WEEKLY_HOURS.validateWeeklyDraft(rows);
  const assessment = weeklySaveAssessment(restaurant, editor);
  const saveCandidateCount = assessment.plan?.changedRows.length || 0;
  const validationContent = validation.valid
    ? `<p class="weekly-validation-ok">월~일 초안 구조가 올바릅니다. 저장 전 변경 내용을 확인해주세요.</p>`
    : `<ul class="weekly-validation-errors">${validation.errors.map((error) => {
        const day = ADMIN_WEEKLY_HOURS.WEEKDAYS.find((item) => item.isoWeekday === error.isoWeekday);
        return `<li>${day ? `${day.shortLabel}요일 · ` : ""}${escapeHtml(error.message)}</li>`;
      }).join("")}</ul>`;
  return `
    <div class="weekly-summary-row">
      <span class="weekly-status ${weeklyStatusClass(summary.kind)}">${escapeHtml(summary.label)}</span>
      <strong>${editor.localDraft ? "아직 저장되지 않은 임시 편집입니다." : `불러온 행 ${summary.rowCount}/7`}</strong>
    </div>
    ${renderWeeklyLegacyReference(restaurant)}
    <div class="weekly-metadata">
      <span>데이터 출처 <strong>${escapeHtml(weeklySourceLabel(rows))}</strong></span>
      <span>마지막 확인 <strong>${escapeHtml(weeklyVerifiedLabel(rows))}</strong></span>
    </div>
    <section class="weekly-bulk-tools" aria-labelledby="weeklyBulkTitle">
      <div>
        <strong id="weeklyBulkTitle">일괄 적용</strong>
        <span>선택한 요일 설정을 현재 임시 편집에만 복사합니다.</span>
      </div>
      <label><span>기준 요일</span><select id="weeklyBulkSource">${ADMIN_WEEKLY_HOURS.WEEKDAYS.map((day) => `<option value="${day.isoWeekday}">${day.label}</option>`).join("")}</select></label>
      <div class="weekly-target-days" aria-label="적용 대상 요일">
        ${ADMIN_WEEKLY_HOURS.WEEKDAYS.map((day) => `<label><input type="checkbox" data-weekly-target="${day.isoWeekday}" /> ${day.shortLabel}</label>`).join("")}
      </div>
      <div class="weekly-bulk-actions">
        <button type="button" data-weekly-bulk="weekdays">월~금 적용</button>
        <button type="button" data-weekly-bulk="all">모든 요일 적용</button>
        <button type="button" data-weekly-bulk="selected">선택 요일 적용</button>
        <button type="button" data-weekly-undo${editor.undoRows ? "" : " disabled"}>일괄 변경 되돌리기</button>
      </div>
      <p class="weekly-bulk-message" role="status">${escapeHtml(editor.bulkMessage || "일괄 적용은 DB 저장을 실행하지 않습니다.")}</p>
    </section>
    <div class="weekly-day-list">
      ${rows.map((row) => renderWeeklyDayCard(row, openDays)).join("")}
    </div>
    <section class="weekly-verification-draft">
      <label>
        <input type="checkbox" data-weekly-verification${editor.verificationConfirmed ? " checked" : ""} />
        <span>영업시간 확인 완료</span>
      </label>
      <small>네이버 지도·가게 공지·전화 등으로 월~일 영업시간을 확인했다면 체크하세요. 현재는 저장 전 임시 상태입니다.</small>
    </section>
    <section class="weekly-validation" aria-label="영업시간 초안 검사">${validationContent}</section>
    <div class="weekly-draft-actions">
      <strong>저장 후보 ${saveCandidateCount}일</strong>
      <button type="button" data-weekly-preview>${editor.showDiff ? "미리보기 닫기" : "변경 미리보기"}</button>
      <button type="button" data-weekly-reset>변경 취소</button>
      <button type="button" class="weekly-save-button" data-weekly-save${assessment.canSave ? "" : " disabled"}>영업시간 저장</button>
    </div>
    <p class="weekly-save-help">${escapeHtml(assessment.message)}</p>
    ${editor.saveMessage ? `<p class="weekly-save-status ${escapeHtml(editor.saveMessageType || "info")}" role="status">${escapeHtml(editor.saveMessage)}</p>` : ""}
    ${editor.showDiff ? renderWeeklySavePreview(restaurant, editor, diff, assessment) : ""}
  `;
}

function renderWeeklyHoursEditor({ preserveOpen = false } = {}) {
  if (!els.weeklyHoursContent) return;
  if (!ADMIN_WEEKLY_HOURS) {
    els.weeklyHoursContent.innerHTML = `<p class="weekly-hours-error">요일별 영업시간 편집 모듈을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 확인해주세요.</p>`;
    return;
  }
  const previousOpenDays = preserveOpen
    ? new Set([...els.weeklyHoursContent.querySelectorAll("details[open][data-weekly-day-card]")].map((item) => Number(item.dataset.weeklyDayCard)))
    : new Set([1]);
  if (state.catalogSource !== "supabase") {
    els.weeklyHoursContent.innerHTML = `<p class="weekly-hours-empty">요일별 영업시간은 Supabase 원본에서 관리합니다. 정적 기준 데이터에서는 임시 편집과 저장 기능을 사용할 수 없습니다.</p>`;
    return;
  }
  const editor = state.weeklyHoursEditor;
  if (!editor.restaurantId) {
    els.weeklyHoursContent.innerHTML = `<p class="weekly-hours-empty">Supabase 가게를 선택하면 월요일부터 일요일까지 영업시간을 확인할 수 있습니다.</p>`;
    return;
  }
  const restaurant = restaurantsById.get(editor.restaurantId);
  if (editor.loading) {
    els.weeklyHoursContent.innerHTML = `<p class="weekly-hours-empty">${escapeHtml(editor.restaurantName)}의 요일별 영업시간을 불러오는 중입니다.</p>`;
    return;
  }
  if (editor.error) {
    els.weeklyHoursContent.innerHTML = `
      <div class="weekly-summary-row"><span class="weekly-status is-error">조회 오류</span><strong>${escapeHtml(editor.restaurantName)}</strong></div>
      ${renderWeeklyLegacyReference(restaurant)}
      <p class="weekly-hours-error">요일별 영업시간을 불러오지 못했습니다. 다른 관리자 기능은 계속 사용할 수 있습니다.</p>
    `;
    return;
  }
  if (editor.draftRows.length === 0) {
    els.weeklyHoursContent.innerHTML = `
      <div class="weekly-summary-row"><span class="weekly-status is-legacy">새 시간표 미등록 · 기존 영업정보 사용 중</span><strong>${escapeHtml(editor.restaurantName)}</strong></div>
      ${renderWeeklyLegacyReference(restaurant)}
      <p class="weekly-hours-empty compact">DB 행을 자동 생성하지 않습니다. 저장되지 않는 임시 편집으로 화면 구성을 먼저 검토할 수 있습니다.</p>
      <button type="button" data-weekly-start-draft>요일별 시간표 작성 시작</button>
    `;
    return;
  }
  const summary = ADMIN_WEEKLY_HOURS.summarizeWeeklyStatus(editor.draftRows);
  if (summary.kind === "incomplete") {
    els.weeklyHoursContent.innerHTML = `
      <div class="weekly-summary-row"><span class="weekly-status is-error">${escapeHtml(summary.label)}</span><strong>${escapeHtml(editor.restaurantName)}</strong></div>
      ${renderWeeklyLegacyReference(restaurant)}
      <p class="weekly-hours-error">행을 자동 추가하거나 삭제하지 않았습니다. DB 데이터를 확인한 뒤 별도 승인된 절차로 정리해야 합니다.</p>
      <button type="button" class="weekly-save-button" disabled>영업시간 저장</button>
      <p class="weekly-save-help">영업시간 데이터가 7일 기준과 맞지 않아 저장할 수 없습니다. 데이터를 먼저 확인해주세요.</p>
    `;
    return;
  }
  els.weeklyHoursContent.innerHTML = renderWeeklyDraft(restaurant, editor, previousOpenDays);
}

async function loadWeeklyHoursForRestaurant(restaurantId) {
  if (!ADMIN_WEEKLY_HOURS) {
    renderWeeklyHoursEditor();
    return false;
  }
  invalidateWeeklyHoursContext();
  const restaurant = restaurantsById.get(restaurantId);
  const requestContext = Object.freeze({
    generation: state.weeklyHoursGeneration,
    source: state.catalogSource,
    restaurantId,
  });
  state.weeklyHoursEditor = createWeeklyHoursEditorState({
    generation: requestContext.generation,
    restaurantId,
    restaurantName: restaurant?.name || restaurantId,
    loading: true,
  });
  renderWeeklyHoursEditor();
  if (state.catalogSource !== "supabase" || !state.supabase || !restaurant) return false;
  try {
    const { data, error } = await state.supabase
      .from("restaurant_weekly_hours")
      .select("restaurant_id,iso_weekday,day_status,open_time,close_time,closes_next_day,break_status,break_start,break_end,note,source,last_verified_at,updated_at")
      .eq("restaurant_id", restaurantId)
      .order("iso_weekday", { ascending: true });
    if (!isCurrentWeeklyHoursRequest(requestContext)) return false;
    if (error) {
      console.warn("weekly hours load failed", error);
      state.weeklyHoursEditor = createWeeklyHoursEditorState({
        generation: requestContext.generation,
        restaurantId,
        restaurantName: restaurant.name,
        error: "load-failed",
      });
      renderWeeklyHoursEditor();
      return false;
    }
    const originalRows = ADMIN_WEEKLY_HOURS.normalizeWeeklyRows(data, restaurantId);
    state.weeklyHoursEditor = createWeeklyHoursEditorState({
      generation: requestContext.generation,
      restaurantId,
      restaurantName: restaurant.name,
      originalRows: ADMIN_WEEKLY_HOURS.cloneRows(originalRows),
      draftRows: ADMIN_WEEKLY_HOURS.cloneRows(originalRows),
    });
    renderWeeklyHoursEditor();
    return true;
  } catch (error) {
    if (!isCurrentWeeklyHoursRequest(requestContext)) return false;
    console.warn("weekly hours load failed", error);
    state.weeklyHoursEditor = createWeeklyHoursEditorState({
      generation: requestContext.generation,
      restaurantId,
      restaurantName: restaurant?.name || restaurantId,
      error: "load-failed",
    });
    renderWeeklyHoursEditor();
    return false;
  }
}

function foodCharacterMeta(value) {
  return ADMIN_FOOD_CHARACTER?.definitionsByValue?.[value] || null;
}

function renderFoodCharacterEditor() {
  const field = els.foodCharacterSelect;
  if (!field || !ADMIN_FOOD_CHARACTER?.definitions || !ADMIN_FOOD_CHARACTER?.getEditorStatus) return;
  const options = ADMIN_FOOD_CHARACTER.definitions
    .map((definition) => `<option value="${definition.value}">${definition.label} — ${definition.value}</option>`)
    .join("");
  const editor = state.foodCharacterEditor;
  const status = ADMIN_FOOD_CHARACTER.getEditorStatus(editor, state.catalogSource);
  const currentMeta = foodCharacterMeta(editor.originalValue);
  const nextMeta = foodCharacterMeta(editor.nextValue);

  field.innerHTML = `<option value="">선택할 수 없음</option>${options}`;
  field.value = status.nextValid ? editor.nextValue : "";
  field.disabled = !status.selectEnabled;
  field.setAttribute("aria-invalid", String(status.menuSelected && !status.originalValid));
  els.saveFoodCharacter.disabled = !status.saveEnabled;
  els.saveFoodCharacter.textContent = editor.saving ? "저장 중" : "Food Character 저장";
  els.foodCharacterSourceBadge.textContent = state.catalogSource === "static"
    ? "정적 data.js · 읽기 전용"
    : "Supabase · 단건 편집";
  els.foodCharacterMenuName.textContent = status.menuSelected ? editor.menuName || "이름 없는 메뉴" : "선택된 메뉴 없음";
  els.foodCharacterMenuMeta.textContent = status.menuSelected
    ? `${editor.menuId} · ${editor.restaurantName || "가게 정보 없음"}`
    : "메뉴 ID와 가게명을 확인할 수 있습니다.";
  els.foodCharacterChangePreview.hidden = !status.menuSelected;
  els.foodCharacterCurrentLabel.textContent = currentMeta?.label || "유효하지 않은 현재값";
  els.foodCharacterCurrentValue.textContent = editor.originalValue || "미설정";
  els.foodCharacterNextLabel.textContent = nextMeta?.label || "선택 필요";
  els.foodCharacterNextValue.textContent = status.nextValid ? editor.nextValue : "-";

  if (state.catalogSource === "static") {
    els.foodCharacterHelp.textContent = "정적 데이터는 읽기 전용입니다. Food Character를 저장할 수 없습니다.";
  } else if (!status.menuSelected) {
    els.foodCharacterHelp.textContent = "Supabase 메뉴 목록에서 수정 버튼을 눌러 현재 저장값을 불러오세요.";
  } else if (!status.originalValid) {
    els.foodCharacterHelp.textContent = "현재 DB 값이 Primary 5종에 포함되지 않아 저장을 차단했습니다. 데이터를 새로고침해 확인하세요.";
  } else {
    els.foodCharacterHelp.textContent = "이 전용 저장은 선택한 메뉴의 food_character 컬럼 하나만 변경합니다.";
  }

  let message = state.foodCharacterMessage;
  let messageType = state.foodCharacterMessageType;
  if (!message) {
    if (editor.saving) message = "Supabase 저장 후 값을 다시 확인하는 중입니다.";
    else if (state.catalogSource === "static") message = "정적 원본에서는 저장할 수 없습니다.";
    else if (!status.menuSelected) message = "메뉴를 선택해주세요.";
    else if (!status.originalValid) {
      message = "현재 Food Character가 유효하지 않습니다.";
      messageType = "error";
    } else if (status.dirty) message = "변경 내용을 확인한 뒤 저장하세요.";
    else message = "변경 사항 없음";
  }
  els.foodCharacterSaveStatus.textContent = message;
  els.foodCharacterSaveStatus.className = messageType ? `is-${messageType}` : "";
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
    mapSearchKeyword: typeof row.map_search_keyword === "string" ? row.map_search_keyword.trim() || null : null,
    mapSearchDisabled: row.map_search_disabled === true,
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
    foodCharacter: row.food_character ?? null,
  };
}

function normalizeMapSearchSettings(keyword, disabled) {
  const mapSearchDisabled = disabled === true;
  const normalizedKeyword = typeof keyword === "string" ? keyword.trim() : "";
  return {
    mapSearchKeyword: mapSearchDisabled || !normalizedKeyword ? null : normalizedKeyword,
    mapSearchDisabled,
  };
}

function appRestaurantToDb(restaurant) {
  const mapSearch = normalizeMapSearchSettings(restaurant.mapSearchKeyword, restaurant.mapSearchDisabled);
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
    map_search_keyword: mapSearch.mapSearchKeyword,
    map_search_disabled: mapSearch.mapSearchDisabled,
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
    resetAnalyticsDashboardState();
    state.adminAuthorized = false;
    els.adminStatus.textContent = "관리자 권한이 없는 계정입니다.";
    els.loginPanel.hidden = false;
    els.adminPanel.hidden = true;
    els.signOutButton.hidden = false;
    return;
  }
  state.adminAuthorized = true;
  els.adminStatus.textContent = `${state.user.email || "관리자"} 로그인 중`;
  els.loginPanel.hidden = true;
  els.adminPanel.hidden = false;
  setAdminTab("analytics");
  els.signOutButton.hidden = false;
  await loadCatalog();
  await Promise.all([loadReviews(), loadReports(), loadAnalyticsDashboard({ force: true })]);
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
  resetWeeklyHoursEditingState();
  resetAnalyticsDashboardState();
  state.user = null;
  state.adminAuthorized = false;
  state.reviews = [];
  state.reports = [];
  els.adminStatus.textContent = "로그인이 필요합니다.";
  els.loginPanel.hidden = false;
  els.adminPanel.hidden = true;
  els.signOutButton.hidden = true;
}

async function loadCatalog() {
  if (!els.catalogList) return;
  if (state.weeklyHoursEditor?.saving) {
    state.weeklyHoursEditor = {
      ...state.weeklyHoursEditor,
      saveMessage: "저장 중에는 카탈로그를 새로고침할 수 없습니다.",
      saveMessageType: "error",
    };
    renderWeeklyHoursEditor({ preserveOpen: true });
    return false;
  }
  resetCatalogEditingState();
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
  els.weeklyHoursEditor.hidden = !isRestaurantMode;
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
  renderFoodCharacterEditor();
  renderWeeklyHoursEditor();
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
  resetWeeklyHoursEditingState();
  els.restaurantForm.reset();
  els.restaurantForm.elements.id.value = nextId("C", state.restaurants);
  els.restaurantForm.elements.area.value = "정문";
  els.restaurantForm.elements.takeout.checked = true;
  els.restaurantForm.elements.delivery.checked = false;
  els.restaurantForm.elements.alone.checked = true;
  els.restaurantForm.elements.group.checked = true;
  els.restaurantForm.elements.mapSearchDisabled.checked = false;
  els.restaurantForm.elements.active.checked = true;
  syncMapSearchFormState();
}

function syncMapSearchFormState() {
  if (!els.restaurantForm) return;
  const form = els.restaurantForm.elements;
  const disabled = form.mapSearchDisabled.checked;
  form.mapSearchKeyword.disabled = disabled;
  if (disabled) form.mapSearchKeyword.value = "";
}

function invalidateFoodCharacterEditorContext() {
  state.foodCharacterEditorGeneration += 1;
  return state.foodCharacterEditorGeneration;
}

function isCurrentFoodCharacterRequest(requestContext) {
  return (
    state.foodCharacterEditorGeneration === requestContext.generation &&
    state.catalogSource === requestContext.source &&
    state.selectedMenuId === requestContext.menuId &&
    state.foodCharacterEditor.menuId === requestContext.menuId
  );
}

function resetFoodCharacterEditingState() {
  invalidateFoodCharacterEditorContext();
  state.foodCharacterEditor = ADMIN_FOOD_CHARACTER?.createEditorState?.() || {
    menuId: null,
    menuName: "",
    restaurantName: "",
    originalValue: null,
    nextValue: null,
    saving: false,
  };
  state.foodCharacterMessage = "";
  state.foodCharacterMessageType = "";
  renderFoodCharacterEditor();
}

function clearMenuForm() {
  resetFoodCharacterEditingState();
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
  if (state.weeklyHoursEditor?.saving) {
    state.weeklyHoursEditor = {
      ...state.weeklyHoursEditor,
      saveMessage: "저장 중에는 다른 가게로 이동할 수 없습니다.",
      saveMessageType: "error",
    };
    renderWeeklyHoursEditor({ preserveOpen: true });
    return false;
  }
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
  form.mapSearchKeyword.value = restaurant.mapSearchKeyword || "";
  form.mapSearchDisabled.checked = restaurant.mapSearchDisabled === true;
  form.takeout.checked = Boolean(restaurant.takeout);
  form.delivery.checked = Boolean(restaurant.delivery);
  form.alone.checked = Boolean(restaurant.alone);
  form.group.checked = Boolean(restaurant.group);
  form.active.checked = restaurant.active !== false;
  syncMapSearchFormState();
  loadWeeklyHoursForRestaurant(id);
  els.restaurantEditor.scrollIntoView({ behavior: "smooth", block: "start" });
}

function editMenu(id) {
  const menu = state.menus.find((item) => item.id === id);
  if (!menu) return;
  invalidateFoodCharacterEditorContext();
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
  state.foodCharacterEditor = ADMIN_FOOD_CHARACTER.createEditorState({
    ...menu,
    restaurantName: restaurantsById.get(menu.restaurantId)?.name || menu.restaurantName || "",
  });
  state.foodCharacterMessage = "";
  state.foodCharacterMessageType = "";
  renderFoodCharacterEditor();
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
  if (state.weeklyHoursEditor?.saving) {
    state.weeklyHoursEditor = {
      ...state.weeklyHoursEditor,
      saveMessage: "저장 중에는 데이터 원본을 전환할 수 없습니다.",
      saveMessageType: "error",
    };
    renderWeeklyHoursEditor({ preserveOpen: true });
    return false;
  }
  state.catalogSource = nextSource;
  resetCatalogEditingState();
  renderCatalog();
  return true;
}

function canEditSupabaseCatalog() {
  return state.catalogSource === "supabase" && currentCatalogData().editable;
}

function canEditWeeklyDraft() {
  const editor = state.weeklyHoursEditor;
  return Boolean(
    ADMIN_WEEKLY_HOURS &&
    canEditSupabaseCatalog() &&
    editor.restaurantId &&
    editor.restaurantId === state.selectedRestaurantId &&
    !editor.loading &&
    !editor.error &&
    !editor.saving &&
    editor.draftRows.length === 7 &&
    ADMIN_WEEKLY_HOURS.summarizeWeeklyStatus(editor.draftRows).kind !== "incomplete",
  );
}

function startWeeklyHoursLocalDraft() {
  const editor = state.weeklyHoursEditor;
  if (!ADMIN_WEEKLY_HOURS || !canEditSupabaseCatalog() || !editor.restaurantId || editor.originalRows.length !== 0) return false;
  state.weeklyHoursEditor = {
    ...editor,
    draftRows: ADMIN_WEEKLY_HOURS.createUnknownDraft(editor.restaurantId),
    localDraft: true,
    undoRows: null,
    showDiff: false,
    verificationConfirmed: false,
    bulkMessage: "7일짜리 임시 초안을 만들었습니다. DB에는 저장되지 않았습니다.",
    saveMessage: "",
    saveMessageType: "",
  };
  renderWeeklyHoursEditor();
  return true;
}

function updateWeeklyHoursDraft(event) {
  const field = event.target.dataset.weeklyField;
  const isoWeekday = Number(event.target.dataset.weeklyDay);
  if (!field || !isoWeekday || !canEditWeeklyDraft()) return false;
  const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
  state.weeklyHoursEditor = {
    ...state.weeklyHoursEditor,
    draftRows: ADMIN_WEEKLY_HOURS.updateDayField(state.weeklyHoursEditor.draftRows, isoWeekday, field, value),
    undoRows: null,
    showDiff: false,
    bulkMessage: "",
    saveMessage: "",
    saveMessageType: "",
  };
  renderWeeklyHoursEditor({ preserveOpen: true });
  return true;
}

function updateWeeklyHoursTimeInput(target, { render = true } = {}) {
  if (!target?.matches?.("[data-weekly-time-part]") || !canEditWeeklyDraft()) return false;
  const control = target.closest("[data-weekly-time-control]");
  const field = control?.dataset.weeklyTimeField;
  const isoWeekday = Number(control?.dataset.weeklyDay);
  if (!field || !isoWeekday) return false;
  const hour = control.querySelector('[data-weekly-time-part="hour"]')?.value ?? "";
  const minute = control.querySelector('[data-weekly-time-part="minute"]')?.value ?? "";
  state.weeklyHoursEditor = {
    ...state.weeklyHoursEditor,
    draftRows: ADMIN_WEEKLY_HOURS.updateAdminTimeField(
      state.weeklyHoursEditor.draftRows,
      isoWeekday,
      field,
      hour,
      minute,
    ),
    undoRows: null,
    showDiff: false,
    bulkMessage: "",
    saveMessage: "",
    saveMessageType: "",
  };
  if (render) renderWeeklyHoursEditor({ preserveOpen: true });
  return true;
}

function closeWeeklyTimeCombobox(combobox) {
  if (!combobox) return false;
  const listbox = combobox.querySelector('[role="listbox"]');
  const input = combobox.querySelector('[role="combobox"]');
  const toggle = combobox.querySelector("[data-weekly-time-toggle]");
  if (listbox) listbox.hidden = true;
  combobox.classList.remove("is-open");
  input?.setAttribute("aria-expanded", "false");
  toggle?.setAttribute("aria-expanded", "false");
  const dayCard = combobox.closest("[data-weekly-day-card]");
  if (dayCard && !dayCard.querySelector("[data-weekly-time-combobox].is-open")) {
    dayCard.classList.remove("has-open-time-list");
  }
  return true;
}

function closeOtherWeeklyTimeComboboxes(current) {
  els.weeklyHoursContent.querySelectorAll("[data-weekly-time-combobox]").forEach((combobox) => {
    if (combobox !== current) closeWeeklyTimeCombobox(combobox);
  });
}

function openWeeklyTimeCombobox(combobox) {
  const input = combobox?.querySelector('[role="combobox"]');
  const listbox = combobox?.querySelector('[role="listbox"]');
  const toggle = combobox?.querySelector("[data-weekly-time-toggle]");
  if (!input || input.disabled || !listbox) return false;
  closeOtherWeeklyTimeComboboxes(combobox);
  listbox.hidden = false;
  combobox.classList.add("is-open");
  combobox.closest("[data-weekly-day-card]")?.classList.add("has-open-time-list");
  input.setAttribute("aria-expanded", "true");
  toggle?.setAttribute("aria-expanded", "true");
  const selectedOption = listbox.querySelector('[data-weekly-time-option][aria-selected="true"]');
  if (selectedOption) {
    listbox.scrollTop = Math.max(0, selectedOption.offsetTop - ((listbox.clientHeight - selectedOption.offsetHeight) / 2));
  } else {
    listbox.scrollTop = 0;
  }
  return true;
}

function selectWeeklyTimeOption(option) {
  const combobox = option?.closest?.("[data-weekly-time-combobox]");
  const input = combobox?.querySelector("[data-weekly-time-part]");
  if (!input || input.disabled) return false;
  input.value = option.dataset.weeklyTimeOption;
  return updateWeeklyHoursTimeInput(input);
}

function handleWeeklyTimeComboboxKeydown(event) {
  const input = event.target.closest?.('[role="combobox"][data-weekly-time-part]');
  const option = event.target.closest?.("[data-weekly-time-option]");
  const combobox = (input || option)?.closest?.("[data-weekly-time-combobox]");
  if (!combobox) return false;
  const options = [...combobox.querySelectorAll("[data-weekly-time-option]")];
  if (input && ["ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    openWeeklyTimeCombobox(combobox);
    const selectedIndex = options.findIndex((item) => item.getAttribute("aria-selected") === "true");
    const fallbackIndex = event.key === "ArrowUp" ? options.length - 1 : 0;
    options[selectedIndex >= 0 ? selectedIndex : fallbackIndex]?.focus();
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeWeeklyTimeCombobox(combobox);
    combobox.querySelector('[role="combobox"]')?.focus();
    return true;
  }
  if (!option) return false;
  const index = options.indexOf(option);
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? options.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[nextIndex]?.focus();
    return true;
  }
  if (["Enter", " "].includes(event.key)) {
    event.preventDefault();
    return selectWeeklyTimeOption(option);
  }
  return false;
}

function selectedWeeklyBulkTargets(mode, sourceIsoWeekday) {
  if (mode === "weekdays") return [1, 2, 3, 4, 5].filter((day) => day !== sourceIsoWeekday);
  if (mode === "all") return [1, 2, 3, 4, 5, 6, 7].filter((day) => day !== sourceIsoWeekday);
  return [...els.weeklyHoursContent.querySelectorAll("[data-weekly-target]:checked")]
    .map((input) => Number(input.dataset.weeklyTarget))
    .filter((day) => day !== sourceIsoWeekday);
}

function applyWeeklyHoursBulk(mode) {
  if (!canEditWeeklyDraft() || !["weekdays", "all", "selected"].includes(mode)) return false;
  const sourceIsoWeekday = Number(els.weeklyHoursContent.querySelector("#weeklyBulkSource")?.value || 1);
  const targets = selectedWeeklyBulkTargets(mode, sourceIsoWeekday);
  if (!targets.length) return false;
  const weekday = ADMIN_WEEKLY_HOURS.WEEKDAYS.find((day) => day.isoWeekday === sourceIsoWeekday);
  const targetLabels = targets.map((target) => ADMIN_WEEKLY_HOURS.WEEKDAYS.find((day) => day.isoWeekday === target)?.shortLabel).filter(Boolean);
  const before = ADMIN_WEEKLY_HOURS.cloneRows(state.weeklyHoursEditor.draftRows);
  state.weeklyHoursEditor = {
    ...state.weeklyHoursEditor,
    draftRows: ADMIN_WEEKLY_HOURS.applyDayToTargets(before, sourceIsoWeekday, targets),
    undoRows: before,
    showDiff: false,
    bulkMessage: `${weekday.label} 설정을 ${targetLabels.join("·")}요일에 적용했습니다. 아직 저장되지 않았습니다.`,
    saveMessage: "",
    saveMessageType: "",
  };
  renderWeeklyHoursEditor({ preserveOpen: true });
  return true;
}

function undoWeeklyHoursBulk() {
  if (!canEditWeeklyDraft() || !state.weeklyHoursEditor.undoRows) return false;
  state.weeklyHoursEditor = {
    ...state.weeklyHoursEditor,
    draftRows: ADMIN_WEEKLY_HOURS.cloneRows(state.weeklyHoursEditor.undoRows),
    undoRows: null,
    showDiff: false,
    bulkMessage: "직전 일괄 변경을 되돌렸습니다. DB에는 변화가 없습니다.",
    saveMessage: "",
    saveMessageType: "",
  };
  renderWeeklyHoursEditor({ preserveOpen: true });
  return true;
}

function resetWeeklyHoursDraft() {
  if (!canEditWeeklyDraft()) return false;
  const editor = state.weeklyHoursEditor;
  state.weeklyHoursEditor = editor.localDraft
    ? createWeeklyHoursEditorState({ restaurantId: editor.restaurantId, restaurantName: editor.restaurantName })
    : {
        ...editor,
        draftRows: ADMIN_WEEKLY_HOURS.cloneRows(editor.originalRows),
        undoRows: null,
        showDiff: false,
        verificationConfirmed: false,
        bulkMessage: "불러온 원본 상태로 되돌렸습니다. DB에는 변화가 없습니다.",
        saveMessage: "",
        saveMessageType: "",
      };
  renderWeeklyHoursEditor();
  return true;
}

function toggleWeeklyHoursDiff() {
  if (!canEditWeeklyDraft()) return false;
  state.weeklyHoursEditor = {
    ...state.weeklyHoursEditor,
    showDiff: !state.weeklyHoursEditor.showDiff,
  };
  renderWeeklyHoursEditor({ preserveOpen: true });
  return true;
}

function updateWeeklyVerificationDraft(checked) {
  if (!canEditWeeklyDraft()) return false;
  state.weeklyHoursEditor = {
    ...state.weeklyHoursEditor,
    verificationConfirmed: checked === true,
    saveMessage: "",
    saveMessageType: "",
  };
  renderWeeklyHoursEditor({ preserveOpen: true });
  return true;
}

function weeklySaveFailureMessage(error) {
  const message = String(error?.message || "");
  if (error?.status === 403 || error?.code === "42501" || /row-level security|permission denied/i.test(message)) {
    return "영업시간을 수정할 관리자 권한이 없습니다.";
  }
  return message || "영업시간 저장에 실패했습니다.";
}

async function saveWeeklyHours() {
  const editor = state.weeklyHoursEditor;
  if (editor.saving) return false;
  const restaurant = restaurantsById.get(editor.restaurantId);
  const verifiedAt = editor.verificationConfirmed ? new Date().toISOString() : null;
  const assessment = weeklySaveAssessment(restaurant, editor, { verifiedAt });
  if (!assessment.canSave) {
    state.weeklyHoursEditor = {
      ...editor,
      saveMessage: assessment.message,
      saveMessageType: "error",
    };
    renderWeeklyHoursEditor({ preserveOpen: true });
    return false;
  }

  const confirmed = confirm(
    `${restaurant?.name || editor.restaurantName} (${editor.restaurantId})\n\n변경된 요일: ${assessment.plan.changedRows.length}일\n저장 방식: ${assessment.plan.mode === "insert" ? "7일 신규 생성" : "변경 요일 수정"}\n\n요일별 영업시간을 저장할까요?`,
  );
  if (!confirmed) return false;

  const requestContext = Object.freeze({
    generation: state.weeklyHoursGeneration,
    source: state.catalogSource,
    restaurantId: editor.restaurantId,
  });
  state.weeklyHoursEditor = {
    ...editor,
    saving: true,
    saveMessage: "관리자 권한과 최신 영업시간을 확인하고 있습니다.",
    saveMessageType: "info",
  };
  renderWeeklyHoursEditor({ preserveOpen: true });

  try {
    const adminStillAuthorized = await isAdminUser();
    if (!isCurrentWeeklyHoursRequest(requestContext)) return false;
    if (!adminStillAuthorized) {
      state.adminAuthorized = false;
      state.weeklyHoursEditor = {
        ...editor,
        saving: false,
        saveMessage: "영업시간을 수정할 관리자 권한이 없습니다.",
        saveMessageType: "error",
      };
      renderWeeklyHoursEditor({ preserveOpen: true });
      return false;
    }
    state.adminAuthorized = true;
    const currentRestaurant = restaurantsById.get(state.weeklyHoursEditor.restaurantId);
    const finalAssessment = weeklySaveAssessment(
      currentRestaurant,
      { ...state.weeklyHoursEditor, saving: false },
      { verifiedAt },
    );
    if (!finalAssessment.canSave) {
      state.weeklyHoursEditor = {
        ...editor,
        saving: false,
        saveMessage: finalAssessment.message,
        saveMessageType: "error",
      };
      renderWeeklyHoursEditor({ preserveOpen: true });
      return false;
    }
    state.weeklyHoursEditor = {
      ...state.weeklyHoursEditor,
      saveMessage: "영업시간 저장 전 최신 데이터를 확인하고 있습니다.",
    };
    renderWeeklyHoursEditor({ preserveOpen: true });

    const persistence = ADMIN_WEEKLY_HOURS.createWeeklyHoursPersistence(state.supabase);
    const readBackRows = await ADMIN_WEEKLY_HOURS.executeWeeklyHoursSave({
      permissionGranted: finalAssessment.canSave,
      persistence,
      plan: finalAssessment.plan,
      isCurrent: () => isCurrentWeeklyHoursRequest(requestContext),
    });
    if (!isCurrentWeeklyHoursRequest(requestContext)) return false;
    state.weeklyHoursEditor = createWeeklyHoursEditorState({
      generation: requestContext.generation,
      restaurantId: editor.restaurantId,
      restaurantName: editor.restaurantName,
      originalRows: ADMIN_WEEKLY_HOURS.cloneRows(readBackRows),
      draftRows: ADMIN_WEEKLY_HOURS.cloneRows(readBackRows),
      saveMessage: "영업시간이 저장되었습니다.",
      saveMessageType: "success",
    });
    renderWeeklyHoursEditor({ preserveOpen: true });
    return true;
  } catch (error) {
    if (isCurrentWeeklyHoursRequest(requestContext)) {
      state.weeklyHoursEditor = {
        ...editor,
        saving: false,
        saveMessage: weeklySaveFailureMessage(error),
        saveMessageType: "error",
      };
      renderWeeklyHoursEditor({ preserveOpen: true });
    }
    return false;
  }
}

function handleFoodCharacterChange(nextValue) {
  const currentStatus = ADMIN_FOOD_CHARACTER?.getEditorStatus?.(state.foodCharacterEditor, state.catalogSource);
  if (!currentStatus?.selectEnabled) return false;
  if (!ADMIN_FOOD_CHARACTER?.updateEditorValue || !ADMIN_FOOD_CHARACTER?.isAllowedFoodCharacter(nextValue)) {
    state.foodCharacterMessage = "허용되지 않은 Food Character입니다.";
    state.foodCharacterMessageType = "error";
    renderFoodCharacterEditor();
    return false;
  }
  state.foodCharacterEditor = ADMIN_FOOD_CHARACTER.updateEditorValue(state.foodCharacterEditor, nextValue);
  state.foodCharacterMessage = "";
  state.foodCharacterMessageType = "";
  renderFoodCharacterEditor();
  return true;
}

async function saveSelectedFoodCharacter() {
  if (!canEditSupabaseCatalog()) {
    state.foodCharacterMessage = state.catalogSource === "static"
      ? "정적 데이터는 읽기 전용입니다."
      : "Supabase 연결 상태를 확인한 뒤 다시 시도해주세요.";
    state.foodCharacterMessageType = "error";
    renderFoodCharacterEditor();
    return false;
  }

  if (state.foodCharacterEditor.saving) return false;

  const editor = state.foodCharacterEditor;
  const status = ADMIN_FOOD_CHARACTER?.getEditorStatus?.(editor, state.catalogSource);
  if (!status?.saveEnabled) {
    state.foodCharacterMessage = !status?.menuSelected
      ? "Food Character를 변경할 메뉴를 먼저 선택해주세요."
      : !status?.originalValid
        ? "현재 Food Character가 유효하지 않아 저장할 수 없습니다."
        : !status?.nextValid
          ? "허용되지 않은 Food Character입니다."
          : "저장할 Food Character 변경 사항이 없습니다.";
    state.foodCharacterMessageType = "error";
    renderFoodCharacterEditor();
    return false;
  }

  const confirmed = confirm(
    `[${editor.menuName}]\n\nFood Character를\n\n${editor.originalValue}\n→\n${editor.nextValue}\n\n로 변경합니다.\n\n이 작업은 이 메뉴의 Food Character만 수정합니다.`,
  );
  if (!confirmed) return false;

  const requestContext = Object.freeze({
    generation: state.foodCharacterEditorGeneration,
    source: state.catalogSource,
    menuId: editor.menuId,
    originalValue: editor.originalValue,
    nextValue: editor.nextValue,
  });
  state.foodCharacterEditor = { ...editor, saving: true };
  state.foodCharacterMessage = "";
  state.foodCharacterMessageType = "";
  renderFoodCharacterEditor();

  try {
    const result = await ADMIN_FOOD_CHARACTER.saveFoodCharacterChange({
      supabase: state.supabase,
      source: requestContext.source,
      menuId: requestContext.menuId,
      originalValue: requestContext.originalValue,
      nextValue: requestContext.nextValue,
    });
    if (!isCurrentFoodCharacterRequest(requestContext)) return false;

    let verifiedMenu = null;
    state.menus = state.menus.map((menu) => {
      if (menu.id !== result.menuId) return menu;
      verifiedMenu = { ...menu, foodCharacter: result.foodCharacter };
      return verifiedMenu;
    });
    if (!verifiedMenu) {
      state.foodCharacterEditor = { ...editor, saving: false };
      state.foodCharacterMessage = "저장 후 로컬 메뉴를 확인하지 못했습니다. 데이터를 새로고침해주세요.";
      state.foodCharacterMessageType = "error";
      renderFoodCharacterEditor();
      return false;
    }
    refreshCatalogMaps();
    state.foodCharacterEditor = ADMIN_FOOD_CHARACTER.createEditorState(verifiedMenu);
    state.foodCharacterMessage = "Food Character가 저장되었습니다.";
    state.foodCharacterMessageType = "success";
    renderFoodCharacterEditor();
    return true;
  } catch (error) {
    if (isCurrentFoodCharacterRequest(requestContext)) {
      state.foodCharacterEditor = { ...editor, saving: false };
      state.foodCharacterMessage = error?.message || "Food Character 저장에 실패했습니다.";
      state.foodCharacterMessageType = "error";
      renderFoodCharacterEditor();
    }
    return false;
  }
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
    mapSearchKeyword: form.mapSearchKeyword.value,
    mapSearchDisabled: form.mapSearchDisabled.checked,
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
  els.refreshAnalytics?.addEventListener("click", () => loadAnalyticsDashboard({ force: true }));
  els.refreshReviews.addEventListener("click", loadReviews);
  els.refreshReports.addEventListener("click", loadReports);
  els.refreshCatalog?.addEventListener("click", loadCatalog);
  els.refreshDataStatus?.addEventListener("click", loadCatalog);
  els.seedCatalog?.addEventListener("click", seedCatalogFromStatic);
  els.restaurantForm?.addEventListener("submit", saveRestaurant);
  els.restaurantForm?.elements.mapSearchDisabled?.addEventListener("change", syncMapSearchFormState);
  els.menuForm?.addEventListener("submit", saveMenu);
  els.foodCharacterSelect?.addEventListener("change", (event) => handleFoodCharacterChange(event.target.value));
  els.saveFoodCharacter?.addEventListener("click", saveSelectedFoodCharacter);
  els.weeklyHoursContent?.addEventListener("change", (event) => {
    if (event.target.matches("[data-weekly-verification]")) {
      updateWeeklyVerificationDraft(event.target.checked);
      return;
    }
    if (event.target.matches("[data-weekly-time-part]")) {
      updateWeeklyHoursTimeInput(event.target, { render: false });
      return;
    }
    updateWeeklyHoursDraft(event);
  });
  els.weeklyHoursContent?.addEventListener("focusin", (event) => {
    if (event.target.matches('[role="combobox"][data-weekly-time-part]')) {
      openWeeklyTimeCombobox(event.target.closest("[data-weekly-time-combobox]"));
    }
  });
  els.weeklyHoursContent?.addEventListener("focusout", (event) => {
    const combobox = event.target.closest?.("[data-weekly-time-combobox]");
    const dayCard = event.target.closest?.("[data-weekly-day-card]");
    const wasTimeInput = event.target.matches?.("[data-weekly-time-part]");
    setTimeout(() => {
      if (combobox?.isConnected && !combobox.contains(document.activeElement)) closeWeeklyTimeCombobox(combobox);
      if (wasTimeInput && dayCard?.isConnected && !dayCard.contains(document.activeElement)) {
        renderWeeklyHoursEditor({ preserveOpen: true });
      }
    }, 0);
  });
  els.weeklyHoursContent?.addEventListener("keydown", handleWeeklyTimeComboboxKeydown);
  els.weeklyHoursContent?.addEventListener("click", (event) => {
    if (event.target.closest("[data-weekly-save]")) {
      saveWeeklyHours();
      return;
    }
    const timeOption = event.target.closest("[data-weekly-time-option]");
    if (timeOption) {
      selectWeeklyTimeOption(timeOption);
      return;
    }
    const timeToggle = event.target.closest("[data-weekly-time-toggle]");
    if (timeToggle) {
      const combobox = timeToggle.closest("[data-weekly-time-combobox]");
      const listbox = combobox?.querySelector('[role="listbox"]');
      if (listbox?.hidden) openWeeklyTimeCombobox(combobox);
      else closeWeeklyTimeCombobox(combobox);
      return;
    }
    if (event.target.matches('[role="combobox"][data-weekly-time-part]')) {
      openWeeklyTimeCombobox(event.target.closest("[data-weekly-time-combobox]"));
      return;
    }
    if (event.target.closest("[data-weekly-start-draft]")) startWeeklyHoursLocalDraft();
    const bulkButton = event.target.closest("[data-weekly-bulk]");
    if (bulkButton) applyWeeklyHoursBulk(bulkButton.dataset.weeklyBulk);
    if (event.target.closest("[data-weekly-undo]")) undoWeeklyHoursBulk();
    if (event.target.closest("[data-weekly-preview]")) toggleWeeklyHoursDiff();
    if (event.target.closest("[data-weekly-reset]")) resetWeeklyHoursDraft();
  });

  document.body.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-admin-tab]");
    if (tab) {
      setAdminTab(tab.dataset.adminTab);
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
      if (state.catalogMode !== catalogMode.dataset.catalogMode) {
        state.catalogMode = catalogMode.dataset.catalogMode;
        resetCatalogEditingState();
      }
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
renderFoodCharacterEditor();
renderWeeklyHoursEditor();
bindEvents();
initSupabase();
