const DATA = window.CHANGWON_FOOD_DATA;

const FALLBACK_LOCATION = { label: "창원대 정문 임시 기준", lat: 35.24235, lng: 128.68965 };
const MOOD_OPTIONS = ["혼밥", "단체", "가성비", "든든함", "빠른식사", "비오는날", "해장", "시험기간", "데이트", "스트레스", "포장", "배달"];
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

const state = {
  location: null,
  locationStatus: "requesting",
  budget: 8000,
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
  isSearching: false,
  wishlist: JSON.parse(localStorage.getItem("changwonFoodWishlist") || "[]"),
  history: JSON.parse(localStorage.getItem("changwonFoodHistory") || "[]"),
  tasteOverrides: JSON.parse(localStorage.getItem("changwonFoodTasteOverrides") || "{}"),
  reviews: JSON.parse(localStorage.getItem("changwonFoodReviews") || "{}"),
  nickname: localStorage.getItem("changwonFoodNickname") || "",
  publicTasteSummary: {},
  publicReviewSummary: {},
  publicReviews: {},
  reviewVisibleCount: {},
  supabase: null,
  supabaseUserId: null,
  supabaseReady: false,
  supabaseError: "",
  supabaseInitPromise: null,
  worldcup: null,
  worldcupCategories: new Set(),
  roulette: {
    active: false,
    items: [],
    selected: null,
    spinning: false,
  },
  locationPreference: localStorage.getItem("changwonFoodLocationPreference") || "",
};

const els = {
  locationButton: document.querySelector("#locationButton"),
  shareButton: document.querySelector("#shareButton"),
  splashScreen: document.querySelector("#splashScreen"),
  locationStatus: document.querySelector("#locationStatus"),
  conditionSummary: document.querySelector("#conditionSummary"),
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
  menuList: document.querySelector("#menuList"),
  nextRecommendButton: document.querySelector("#nextRecommendButton"),
  rouletteButton: document.querySelector("#rouletteButton"),
  roulettePanel: document.querySelector("#roulettePanel"),
  rouletteWheel: document.querySelector("#rouletteWheel"),
  rouletteStatus: document.querySelector("#rouletteStatus"),
  stopRouletteButton: document.querySelector("#stopRouletteButton"),
  closeRouletteButton: document.querySelector("#closeRouletteButton"),
  rouletteResult: document.querySelector("#rouletteResult"),
  worldcupSize: document.querySelector("#worldcupSize"),
  worldcupCategoryGrid: document.querySelector("#worldcupCategoryGrid"),
  worldcupBoard: document.querySelector("#worldcupBoard"),
  wishlistList: document.querySelector("#wishlistList"),
  clearWishlist: document.querySelector("#clearWishlist"),
  dataDashboard: document.querySelector("#dataDashboard"),
  detailDialog: document.querySelector("#detailDialog"),
  dialogContent: document.querySelector("#dialogContent"),
  closeDialog: document.querySelector("#closeDialog"),
  locationDialog: document.querySelector("#locationDialog"),
  toast: document.querySelector("#toast"),
};

const restaurantsById = new Map(DATA.restaurants.map((restaurant) => [restaurant.id, restaurant]));

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

function haversine(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function currentBase() {
  return state.location || FALLBACK_LOCATION;
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

function menuReviews(menuId) {
  const remote = state.publicReviews[menuId] || [];
  const local = Object.values(state.reviews).filter((review) => review.menuId === menuId);
  const seen = new Set();
  const merged = [...local, ...remote]
    .filter((review) => {
      const key = review.id || `${review.menuId || review.menu_id}:${review.user_id || review.nickname || ""}:${review.updatedAt || review.updated_at || review.created_at || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.created_at || b.updatedAt || b.updated_at || 0) - new Date(a.created_at || a.updatedAt || a.updated_at || 0));
  const limit = state.reviewVisibleCount[menuId] || 5;
  return merged.slice(0, limit);
}

function menuReviewTotal(menuId) {
  const remote = state.publicReviews[menuId] || [];
  const local = Object.values(state.reviews).filter((review) => review.menuId === menuId);
  const seen = new Set();
  return [...local, ...remote].filter((review) => {
    const key = review.id || `${review.menuId || review.menu_id}:${review.user_id || review.nickname || ""}:${review.updatedAt || review.updated_at || review.created_at || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).length;
}

function starButtons(value) {
  const rating = clampScore(value || 5, 1, 5);
  return Array.from({ length: 5 }, (_, index) => {
    const score = index + 1;
    return `<button type="button" class="${score <= rating ? "is-selected" : ""}" data-rating-value="${score}" aria-label="${score}점">★</button>`;
  }).join("");
}

function isWished(id) {
  return state.wishlist.includes(id);
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("is-visible");
  window.requestAnimationFrame(() => {
    els.toast.classList.add("is-visible");
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => els.toast.classList.remove("is-visible"), 1200);
  });
}

function markConditionsChanged() {
  state.page = 0;
  state.hasSearched = false;
}

function scoreMenu(menu) {
  const restaurant = restaurantsById.get(menu.restaurantId);
  const distance = restaurant?.lat && restaurant?.lng ? haversine(currentBase(), restaurant) : Infinity;
  const taste = menuTaste(menu);
  const tasteDiff = Math.abs(taste.spicy - state.spicy) + Math.abs(taste.salty - state.salty) + Math.abs(taste.sweet - state.sweet);
  const budgetDiff = Math.max(0, menu.price - state.budget);
  let score = 0;
  const reasons = [];

  score += tasteDiff * 9;
  score += budgetDiff / 160;
  score += Math.min(distance / 35, 30);
  score -= menu.value * 3;
  score -= menu.portion * 1.6;
  score -= menu.signature ? 4 : 0;

  if (tasteDiff <= 2) reasons.push("입맛 근접");
  if (menu.price <= state.budget) reasons.push("예산 안");
  if (distance <= 300) reasons.push("가까움");
  if (menu.value >= 4) reasons.push("가성비");
  if (menu.portion >= 4) reasons.push("든든함");

  if (state.moods.size) {
    for (const mood of state.moods) {
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
    score,
    reasons: reasons.slice(0, 4),
  };
}

function getRecommendedMenus() {
  return DATA.menus
    .filter((menu) => menu.available)
    .map(scoreMenu)
    .filter((item) => {
      if (state.categories.size && !state.categories.has(item.category)) return false;
      if (state.moods.size && ![...state.moods].some((mood) => item.tags.includes(mood))) return false;
      if (item.price > state.budget) return false;
      if (state.onlyOpen && !item.openNow) return false;
      if (state.needTakeout && !item.restaurant?.takeout) return false;
      if (state.needDelivery && !item.restaurant?.delivery) return false;
      if (state.needAlone && !item.restaurant?.alone) return false;
      if (state.wantMeat && !item.meat) return false;
      return true;
    })
    .sort((a, b) => a.score - b.score);
}

function pageMenus() {
  const all = getRecommendedMenus();
  const start = state.page * 10;
  return { all, items: all.slice(start, start + 10), start };
}

function mapUrl(item) {
  const restaurantName = item.restaurant?.name || item.restaurantName;
  return `https://map.naver.com/p/search/${encodeURIComponent(`창원대 ${restaurantName}`)}`;
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
  return [...base, ...item.tags.slice(0, 3)];
}

function cardHtml(item, rank) {
  const wished = isWished(item.id);
  const reviewLine = item.reviewSummary?.review_count
    ? `<p class="review-line">별점 ${Number(item.reviewSummary.avg_rating).toFixed(1)} · 위생 ${Number(item.reviewSummary.avg_hygiene).toFixed(1)} · 친절 ${Number(item.reviewSummary.avg_kindness).toFixed(1)} · 후기 ${item.reviewSummary.review_count}</p>`
    : "";
  return `
    <div class="menu-card__top">
      <div>
        <h3>${rank}. ${item.name}</h3>
        <p class="store-line">${item.restaurant?.name || item.restaurantName} · ${item.category} · ${meters(item.distance)}</p>
        ${reviewLine}
      </div>
      <div class="card-side">
        <button class="heart-button ${wished ? "is-wished" : ""}" data-wish="${item.id}" aria-label="${wished ? "찜 해제" : "찜하기"}">${wished ? "♥" : "♡"}</button>
        <div class="price">${money(item.price)}</div>
      </div>
    </div>
    <div class="reason-list">${item.reasons.map((reason) => `<span>${reason}</span>`).join("")}</div>
    <div class="meta-tags">${tags(item).slice(0, 8).map((tag) => `<span>${tag}</span>`).join("")}</div>
    <div class="card-actions">
      <button data-detail="${item.id}">상세</button>
      <button data-ate="${item.id}">먹음</button>
      <a href="${mapUrl(item)}" target="_blank" rel="noreferrer">지도</a>
    </div>
  `;
}

function renderRecommendations() {
  if (!state.hasSearched) {
    els.recommendTitle.textContent = "조건을 선택해 주세요";
    els.menuList.innerHTML = `
      <div class="empty-state search-ready">
        음식 종류와 예산, 맛 취향을 고른 뒤 아래의 조건에 맞게 찾기를 눌러주세요.
      </div>
    `;
    els.nextRecommendButton.style.display = "none";
    return;
  }
  const { all, items, start } = pageMenus();
  els.recommendTitle.textContent = all.length ? `추천 ${start + 1}-${Math.min(start + 10, all.length)}위` : "추천 결과 없음";
  els.menuList.innerHTML = items.length
    ? items.map((item, index) => `<article class="menu-card">${cardHtml(item, start + index + 1)}</article>`).join("")
    : `<div class="empty-state">조건에 맞는 메뉴가 없어요. 예산이나 조건을 조금 풀어보세요.</div>`;
  els.nextRecommendButton.style.display = all.length > 10 ? "block" : "none";
}

function openRoulette() {
  if (!state.hasSearched) {
    toast("먼저 조건에 맞게 찾아주세요!");
    return;
  }
  const pool = getRecommendedMenus().slice(0, 20);
  if (!pool.length) {
    toast("룰렛 후보가 없어요");
    return;
  }
  state.roulette = {
    active: true,
    items: pool.slice(0, Math.min(8, pool.length)),
    selected: null,
    spinning: true,
  };
  renderRoulette();
  els.roulettePanel?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function stopRoulette() {
  if (!state.roulette.active || !state.roulette.spinning) return;
  const items = state.roulette.items;
  const selected = items[Math.floor(Math.random() * items.length)];
  state.roulette.selected = selected;
  state.roulette.spinning = false;
  renderRoulette();
  window.setTimeout(() => {
    state.roulette.selected = selected;
    renderRoulette();
  }, 1200);
}

function closeRoulette() {
  state.roulette = { active: false, items: [], selected: null, spinning: false };
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
  els.rouletteWheel.innerHTML = items
    .map(
      (item, index) => `
        <span style="--i:${index}; --count:${items.length};">
          ${escapeHtml(item.name)}
        </span>
      `,
    )
    .join("");
  els.rouletteStatus.textContent = roulette.spinning
    ? "룰렛이 돌아가고 있어요. 원하는 순간 STOP!"
    : roulette.selected
      ? `${roulette.selected.name} 선택!`
      : "추천 후보로 룰렛을 준비했어요.";
  els.stopRouletteButton.disabled = !roulette.spinning;
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
          <small>${countMap.get(category) || 0}개</small>
        </button>
      `;
    })
    .join("");
  els.moodGrid.innerHTML = MOOD_OPTIONS.map((mood) => `<button class="choice-chip" data-mood="${mood}" aria-pressed="false">${mood}</button>`).join("");
  els.worldcupCategoryGrid.innerHTML = categories.map((category) => `<button class="choice-chip" data-worldcup-category="${category}" aria-pressed="false">${category}</button>`).join("");
}

function syncControls() {
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
}

function renderConditionSummary() {
  const categoryText = state.categories.size ? [...state.categories].join(", ") : "전체 음식";
  const moodText = state.moods.size ? [...state.moods].slice(0, 2).join(", ") : "상황 자유";
  const moreMood = state.moods.size > 2 ? ` 외 ${state.moods.size - 2}` : "";
  els.conditionSummary.textContent = `${categoryText} · ${Number(state.budget).toLocaleString("ko-KR")}원 이하 · ${moodText}${moreMood}`;
}

function renderLocationStatus() {
  if (state.locationStatus === "ready") {
    els.locationStatus.textContent = "현재 위치 기준으로 거리 계산 중";
    els.locationButton.textContent = "위치 갱신";
  } else if (state.locationStatus === "denied") {
    els.locationStatus.textContent = "위치 권한이 없어 창원대 정문을 임시 기준으로 계산 중";
    els.locationButton.textContent = "위치 허용";
  } else if (state.locationStatus === "unsupported") {
    els.locationStatus.textContent = "이 브라우저에서는 위치 서비스를 사용할 수 없어 정문 기준으로 계산 중";
    els.locationButton.textContent = "위치 불가";
  } else if (state.locationStatus === "idle") {
    els.locationStatus.textContent = "위치를 허용하면 현재 위치 기준 거리로 추천해요.";
    els.locationButton.textContent = "위치 선택";
  } else {
    els.locationStatus.textContent = "위치 서비스를 사용해 거리 계산을 준비하고 있어요.";
    els.locationButton.textContent = "위치 확인 중";
  }
}

function render() {
  syncControls();
  renderConditionSummary();
  renderLocationStatus();
  renderRecommendations();
  renderWorldcup();
  renderWishlist();
  renderDashboard();
  renderRoulette();
  els.searchOverlay?.classList.toggle("is-visible", state.isSearching);
}

function resetFilters() {
  state.budget = 8000;
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
  markConditionsChanged();
  render();
}

function searchMenus() {
  state.isSearching = true;
  state.hasSearched = false;
  state.page = 0;
  render();
  window.setTimeout(() => {
    state.isSearching = false;
    state.hasSearched = true;
    render();
    document.querySelector(".recommend-section").scrollIntoView({ behavior: "smooth", block: "start" });
  }, 900);
}

function requestLocation() {
  if (!navigator.geolocation) {
    state.locationStatus = "unsupported";
    render();
    return;
  }
  state.locationStatus = "requesting";
  renderLocationStatus();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.location = {
        label: "현재 위치",
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      };
      state.locationStatus = "ready";
      state.page = 0;
      render();
    },
    () => {
      state.location = null;
      state.locationStatus = "denied";
      render();
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
  );
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
    state.locationPreference = "deny";
    localStorage.setItem("changwonFoodLocationPreference", "deny");
    state.location = null;
    state.locationStatus = "denied";
    render();
    return;
  }
  state.locationPreference = "once";
  requestLocation();
}

function handleLocationAfterSplash() {
  if (state.locationPreference === "always") {
    requestLocation();
    return;
  }
  if (state.locationPreference === "deny") {
    state.locationStatus = "denied";
    render();
    return;
  }
  state.locationStatus = "idle";
  render();
  showLocationDialog();
}

function showDetail(id) {
  const item = DATA.menus.map(scoreMenu).find((menu) => menu.id === id);
  if (!item) return;
  const wished = isWished(item.id);
  const base = baseTaste(item);
  const publicTaste = state.publicTasteSummary[item.id];
  const summary = reviewSummary(item.id);
  const myReview = state.reviews[item.id] || {};
  const reviewList = menuReviews(item.id);
  const reviewTotal = menuReviewTotal(item.id);
  const reviewLimit = state.reviewVisibleCount[item.id] || 5;
  els.dialogContent.innerHTML = `
    <p class="eyebrow">Menu detail</p>
    <h2>${item.name}</h2>
    <p class="store-line">${item.restaurant?.name || item.restaurantName} · ${item.category} · ${meters(item.distance)}</p>
    <div class="reason-list">${item.reasons.map((reason) => `<span>${reason}</span>`).join("")}</div>
    <div class="meta-tags">${tags(item).map((tag) => `<span>${tag}</span>`).join("")}</div>
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
    <section class="personal-taste" data-taste-editor="${item.id}">
      <div class="control-title">
        <strong>내 입맛으로 수정</strong>
        <span>기기 저장 + Supabase 연결 시 평균 반영</span>
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
    <section class="review-form" data-review-editor="${item.id}">
      <div class="control-title">
        <strong>후기 남기기</strong>
        <span>300자 이내</span>
      </div>
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
      <button data-ate="${item.id}">먹은 기록 추가</button>
      <a href="${mapUrl(item)}" target="_blank" rel="noreferrer">지도에서 보기</a>
    </div>
  `;
  if (!els.detailDialog.open) els.detailDialog.showModal();
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
  state.history.unshift({ id, eatenAt: new Date().toISOString() });
  state.history = state.history.slice(0, 200);
  saveHistory();
  toast("먹음 기록 저장!");
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
  toast("내 입맛 저장!");
  render();
  showDetail(id);
}

function resetTaste(id) {
  delete state.tasteOverrides[id];
  saveTasteOverrides();
  toast("기본맛으로 변경!");
  render();
  showDetail(id);
}

async function saveReview(id) {
  const editor = document.querySelector(`[data-review-editor="${id}"]`);
  const menu = DATA.menus.find((item) => item.id === id);
  if (!editor || !menu) return;
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
  toast("서버 공유 중...");
  const synced = await upsertRemoteReview(review);
  toast(synced ? "후기 공유 완료!" : "서버 공유 실패");
  render();
  showDetail(id);
}

async function deleteReview(id) {
  if (!state.reviews[id]) return;
  delete state.reviews[id];
  saveReviews();
  toast("후기 삭제!");
  if (state.supabase && state.supabaseUserId) {
    const result = await supabaseRest(`/menu_reviews?user_id=eq.${encodeURIComponent(state.supabaseUserId)}&menu_id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    if (!result.ok) console.warn("review delete failed", result.error);
    await loadRemoteSummaries();
  }
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
    if (ready) await loadRemoteSummaries();
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

async function loadRemoteSummaries() {
  if (!state.supabase) return;
  const [tasteResult, reviewResult, reviewRows] = await Promise.all([
    state.supabase.from("menu_taste_summary").select("*"),
    state.supabase.from("menu_review_summary").select("*"),
    state.supabase.from("menu_reviews").select("id,user_id,menu_id,nickname,rating,hygiene,kindness,review_text,created_at,updated_at").eq("status", "visible").order("created_at", { ascending: false }).limit(200),
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
  render();
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

async function shareAppLink() {
  const url = "https://changwon-food-app.vercel.app/";
  const shareData = {
    title: "창대앞 뭐먹지",
    text: "창원대 앞에서 뭐 먹을지 고민될 때 쓰는 메뉴 추천 앱",
    url,
  };
  if (navigator.share) {
    await navigator.share(shareData).catch(() => {});
    return;
  }
  await navigator.clipboard?.writeText(url).catch(() => {});
  toast("링크 복사!");
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function historyRows() {
  return state.history
    .map((entry) => {
      const menu = DATA.menus.find((item) => item.id === entry.id);
      return menu ? { ...entry, menu } : null;
    })
    .filter(Boolean);
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
    : `<div class="empty-state">아직 찜한 메뉴가 없어요.</div>`;
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
        <div class="meta-tags">${tags(item).slice(0, 8).map((tag) => `<span>${tag}</span>`).join("")}</div>
        <div class="card-actions">
          <button data-detail="${item.id}">상세</button>
          <button data-ate="${item.id}">먹은 기록 추가</button>
          <a href="${mapUrl(item)}" target="_blank" rel="noreferrer">지도</a>
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
              <div class="meta-tags">${tags(item).slice(0, 4).map((tag) => `<span>${tag}</span>`).join("")}</div>
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

function renderDashboard() {
  const categories = countBy(DATA.menus, (menu) => menu.category).slice(0, 8);
  const moods = countBy(
    DATA.menus.flatMap((menu) => menu.tags),
    (tag) => tag,
  ).slice(0, 8);
  const historyItems = historyRows().slice(0, 8);
  const reviewStats = myReviewStats();
  const myReviews = Object.values(state.reviews).slice(0, 6);
  const reviewServerCount = Object.values(state.publicReviews).reduce((sum, reviews) => sum + reviews.length, 0);
  const syncLabel = state.supabaseReady
    ? `서버 연결됨 · 공개 후기 ${reviewServerCount}개 불러옴`
    : `서버 연결 안 됨${state.supabaseError ? ` · ${escapeHtml(state.supabaseError)}` : ""}`;
  els.dataDashboard.innerHTML = `
    <div class="dashboard-card privacy-card">
      <h3>내 프로필</h3>
      <label class="profile-field">
        <span>닉네임</span>
        <input id="nicknameInput" type="text" maxlength="20" value="${escapeHtml(state.nickname)}" placeholder="닉네임을 입력해주세요" />
      </label>
      <p>찜, 먹은 기록, 내 입맛 수정은 서버가 아니라 이 기기 브라우저 안에만 저장돼요.</p>
      <p class="sync-status">${syncLabel}</p>
    </div>
    <div class="dashboard-card">
      <h3>내 식사 기록</h3>
      <p>기록 ${state.history.length}개</p>
      ${historyItems.length ? historyItems.map((entry) => `<p>${entry.menu.name} · ${entry.menu.restaurantName} <span>${formatDateTime(entry.eatenAt)}</span></p>`).join("") : "<p>아직 기록이 없습니다.</p>"}
    </div>
    <div class="dashboard-card">
      <h3>자주 먹은 메뉴</h3>
      ${mostEatenRows()}
    </div>
    <div class="dashboard-card">
      <h3>내 입맛 수정</h3>
      <p>${Object.keys(state.tasteOverrides).length}개 메뉴의 맛 기준을 내 입맛으로 바꿨어요.</p>
    </div>
    <div class="dashboard-card">
      <h3>내 후기와 별점</h3>
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
          : "<p>아직 남긴 후기가 없습니다.</p>"
      }
    </div>
    <div class="dashboard-card">
      <h3>데이터 현황</h3>
      <p>음식점 ${DATA.meta.restaurantCount}곳, 대표 메뉴 ${DATA.meta.menuCount}개를 기준으로 추천해요.</p>
    </div>
    <details class="dashboard-card stats-detail">
      <summary>데이터 기록 통계 보기</summary>
      <h3>카테고리 분포</h3>
      ${barRows(categories)}
      <h3>상황 태그</h3>
      ${barRows(moods)}
    </details>
  `;
}

function switchTab(tabId) {
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("is-active", panel.id === tabId));
  document.querySelectorAll(".bottom-nav button").forEach((button) => button.classList.toggle("is-active", button.dataset.tab === tabId));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindEvents() {
  els.locationButton.addEventListener("click", showLocationDialog);
  els.shareButton.addEventListener("click", shareAppLink);
  els.searchButton.addEventListener("click", searchMenus);
  els.resetFiltersButton.addEventListener("click", resetFilters);
  els.budgetRange.addEventListener("input", (event) => {
    state.budget = Number(event.target.value);
    markConditionsChanged();
    render();
  });
  for (const [key, input, label] of [
    ["spicy", els.spicyPreference, els.spicyValue],
    ["salty", els.saltyPreference, els.saltyValue],
    ["sweet", els.sweetPreference, els.sweetValue],
  ]) {
    input.addEventListener("input", (event) => {
      state[key] = Number(event.target.value);
      markConditionsChanged();
      label.textContent = event.target.value;
      render();
    });
  }
  for (const key of ["onlyOpen", "needTakeout", "needDelivery", "needAlone", "wantMeat"]) {
    els[key].addEventListener("change", (event) => {
      state[key] = event.target.checked;
      markConditionsChanged();
      render();
    });
  }
  els.categoryGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    const value = button.dataset.category;
    state.categories.has(value) ? state.categories.delete(value) : state.categories.add(value);
    markConditionsChanged();
    render();
  });
  els.moodGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mood]");
    if (!button) return;
    const value = button.dataset.mood;
    state.moods.has(value) ? state.moods.delete(value) : state.moods.add(value);
    markConditionsChanged();
    render();
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
    const totalPages = Math.max(1, Math.ceil(getRecommendedMenus().length / 10));
    state.page = (state.page + 1) % totalPages;
    renderRecommendations();
    document.querySelector(".recommend-section").scrollIntoView({ behavior: "smooth" });
  });
  els.rouletteButton.addEventListener("click", openRoulette);
  els.stopRouletteButton?.addEventListener("click", stopRoulette);
  els.closeRouletteButton?.addEventListener("click", closeRoulette);
  document.body.addEventListener("click", (event) => {
    const locationChoice = event.target.closest("[data-location-choice]");
    if (locationChoice) chooseLocationPreference(locationChoice.dataset.locationChoice);
    const detail = event.target.closest("[data-detail]");
    if (detail) showDetail(detail.dataset.detail);
    const wish = event.target.closest("[data-wish]");
    if (wish) toggleWishlist(wish.dataset.wish);
    const ate = event.target.closest("[data-ate]");
    if (ate) addHistory(ate.dataset.ate);
    const saveTasteButton = event.target.closest("[data-save-taste]");
    if (saveTasteButton) saveTaste(saveTasteButton.dataset.saveTaste);
    const resetTasteButton = event.target.closest("[data-reset-taste]");
    if (resetTasteButton) resetTaste(resetTasteButton.dataset.resetTaste);
    const saveReviewButton = event.target.closest("[data-save-review]");
    if (saveReviewButton) saveReview(saveReviewButton.dataset.saveReview);
    const deleteReviewButton = event.target.closest("[data-delete-review]");
    if (deleteReviewButton) deleteReview(deleteReviewButton.dataset.deleteReview);
    const moreReviewsButton = event.target.closest("[data-more-reviews]");
    if (moreReviewsButton) {
      const id = moreReviewsButton.dataset.moreReviews;
      state.reviewVisibleCount[id] = (state.reviewVisibleCount[id] || 5) + 5;
      showDetail(id);
    }
    const ratingButton = event.target.closest("[data-rating-value]");
    if (ratingButton) {
      const editor = ratingButton.closest("[data-review-editor]");
      const value = Number(ratingButton.dataset.ratingValue);
      const input = editor?.querySelector('[data-review-field="rating"]');
      const output = editor?.querySelector('[data-review-output="rating"]');
      if (input) input.value = String(value);
      if (output) output.textContent = String(value);
      editor?.querySelectorAll("[data-rating-value]").forEach((button) => {
        button.classList.toggle("is-selected", Number(button.dataset.ratingValue) <= value);
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
  els.clearWishlist.addEventListener("click", () => {
    state.wishlist = [];
    saveWishlist();
    renderWishlist();
  });
  els.worldcupSize.addEventListener("change", () => {
    state.worldcup = null;
    renderWorldcup();
  });
  document.querySelectorAll(".bottom-nav button").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
  els.closeDialog.addEventListener("click", () => els.detailDialog.close());
}

function finishSplash() {
  const hideSplash = () => {
    els.splashScreen?.classList.add("is-hidden");
    document.body.classList.remove("splash-active");
    handleLocationAfterSplash();
  };
  window.setTimeout(hideSplash, 2400);
}

renderChips();
bindEvents();
render();
finishSplash();
initSupabase();

if ("serviceWorker" in navigator && ["http:", "https:"].includes(window.location.protocol)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
