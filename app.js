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
  wishlist: JSON.parse(localStorage.getItem("changwonFoodWishlist") || "[]"),
  history: JSON.parse(localStorage.getItem("changwonFoodHistory") || "[]"),
  tasteOverrides: JSON.parse(localStorage.getItem("changwonFoodTasteOverrides") || "{}"),
  worldcup: null,
};

const els = {
  locationButton: document.querySelector("#locationButton"),
  shareButton: document.querySelector("#shareButton"),
  splashScreen: document.querySelector("#splashScreen"),
  locationStatus: document.querySelector("#locationStatus"),
  conditionSummary: document.querySelector("#conditionSummary"),
  quickRecommendButton: document.querySelector("#quickRecommendButton"),
  resetFiltersButton: document.querySelector("#resetFiltersButton"),
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
  worldcupSize: document.querySelector("#worldcupSize"),
  worldcupBoard: document.querySelector("#worldcupBoard"),
  wishlistList: document.querySelector("#wishlistList"),
  clearWishlist: document.querySelector("#clearWishlist"),
  dataDashboard: document.querySelector("#dataDashboard"),
  detailDialog: document.querySelector("#detailDialog"),
  dialogContent: document.querySelector("#dialogContent"),
  closeDialog: document.querySelector("#closeDialog"),
  toast: document.querySelector("#toast"),
};

const restaurantsById = new Map(DATA.restaurants.map((restaurant) => [restaurant.id, restaurant]));

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
  return state.tasteOverrides[menu.id] || { spicy: menu.spicy, salty: menu.salty, sweet: menu.sweet };
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
  return `https://map.naver.com/p/search/${encodeURIComponent(`창원대학교 정문 ${restaurantName}`)}`;
}

function tags(item) {
  const base = [];
  if (item.customTaste) base.push("내 입맛");
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
  return `
    <div class="menu-card__top">
      <div>
        <h3>${rank}. ${item.name}</h3>
        <p class="store-line">${item.restaurant?.name || item.restaurantName} · ${item.category} · ${meters(item.distance)}</p>
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
  const { all, items, start } = pageMenus();
  els.recommendTitle.textContent = all.length ? `추천 ${start + 1}-${Math.min(start + 10, all.length)}위` : "추천 결과 없음";
  els.menuList.innerHTML = items.length
    ? items.map((item, index) => `<article class="menu-card">${cardHtml(item, start + index + 1)}</article>`).join("")
    : `<div class="empty-state">조건에 맞는 메뉴가 없어요. 예산이나 조건을 조금 풀어보세요.</div>`;
  els.nextRecommendButton.style.display = all.length > 10 ? "block" : "none";
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
  state.page = 0;
  render();
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

function showDetail(id) {
  const item = DATA.menus.map(scoreMenu).find((menu) => menu.id === id);
  if (!item) return;
  const wished = isWished(item.id);
  els.dialogContent.innerHTML = `
    <p class="eyebrow">Menu detail</p>
    <h2>${item.name}</h2>
    <p class="store-line">${item.restaurant?.name || item.restaurantName} · ${item.category} · ${meters(item.distance)}</p>
    <div class="reason-list">${item.reasons.map((reason) => `<span>${reason}</span>`).join("")}</div>
    <div class="meta-tags">${tags(item).map((tag) => `<span>${tag}</span>`).join("")}</div>
    <p class="store-line" style="margin-top:12px">맵기 ${item.taste.spicy}/5 · 짠맛 ${item.taste.salty}/5 · 단맛 ${item.taste.sweet}/5 · 든든함 ${item.portion}/5</p>
    <section class="personal-taste" data-taste-editor="${item.id}">
      <div class="control-title">
        <strong>내 입맛으로 수정</strong>
        <span>이 기기에만 저장</span>
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
    [...editor.querySelectorAll("[data-taste-field]")].map((input) => [input.dataset.tasteField, Number(input.value)]),
  );
  saveTasteOverrides();
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

function renderWishlist() {
  const items = state.wishlist.map((id) => DATA.menus.find((menu) => menu.id === id)).filter(Boolean).map(scoreMenu);
  els.wishlistList.innerHTML = items.length
    ? items.map((item, index) => `<article class="menu-card">${cardHtml(item, index + 1)}</article>`).join("")
    : `<div class="empty-state">아직 찜한 메뉴가 없어요.</div>`;
}

function startWorldcup() {
  const size = Number(els.worldcupSize.value);
  const pool = getRecommendedMenus().slice(0, Math.max(size * 2, 24));
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
        <p>현재 추천 조건을 기준으로 후보를 뽑아 월드컵을 시작해요.</p>
        <button id="startWorldcup">월드컵 시작</button>
      </div>
    `;
    return;
  }
  if (state.worldcup.final) {
    const item = state.worldcup.final;
    els.worldcupBoard.innerHTML = `
      <div class="worldcup-result">
        <p class="eyebrow">Winner</p>
        <h3>${item.name}</h3>
        <p class="store-line">${item.restaurant?.name || item.restaurantName} · ${money(item.price)} · ${meters(item.distance)}</p>
        <div class="meta-tags">${tags(item).slice(0, 8).map((tag) => `<span>${tag}</span>`).join("")}</div>
        <div class="card-actions">
          <button data-wish="${item.id}">관심목록 추가</button>
          <button data-ate="${item.id}">먹은 기록 추가</button>
          <a href="${mapUrl(item)}" target="_blank" rel="noreferrer">지도</a>
        </div>
        <button id="restartWorldcup">다시 하기</button>
      </div>
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
  els.dataDashboard.innerHTML = `
    <div class="dashboard-card privacy-card">
      <h3>개인 기록 안내</h3>
      <p>찜, 먹은 기록, 내 입맛 수정은 서버가 아니라 이 기기 브라우저 안에만 저장돼요.</p>
    </div>
    <div class="dashboard-card">
      <h3>카테고리 분포</h3>
      ${barRows(categories)}
    </div>
    <div class="dashboard-card">
      <h3>상황 태그</h3>
      ${barRows(moods)}
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
      <h3>데이터 현황</h3>
      <p>음식점 ${DATA.meta.restaurantCount}곳, 대표 메뉴 ${DATA.meta.menuCount}개를 기준으로 추천해요.</p>
    </div>
  `;
}

function switchTab(tabId) {
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("is-active", panel.id === tabId));
  document.querySelectorAll(".bottom-nav button").forEach((button) => button.classList.toggle("is-active", button.dataset.tab === tabId));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindEvents() {
  els.locationButton.addEventListener("click", requestLocation);
  els.shareButton.addEventListener("click", shareAppLink);
  els.quickRecommendButton.addEventListener("click", () => {
    state.page = 0;
    renderRecommendations();
    document.querySelector(".recommend-section").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  els.resetFiltersButton.addEventListener("click", resetFilters);
  els.budgetRange.addEventListener("input", (event) => {
    state.budget = Number(event.target.value);
    state.page = 0;
    render();
  });
  for (const [key, input, label] of [
    ["spicy", els.spicyPreference, els.spicyValue],
    ["salty", els.saltyPreference, els.saltyValue],
    ["sweet", els.sweetPreference, els.sweetValue],
  ]) {
    input.addEventListener("input", (event) => {
      state[key] = Number(event.target.value);
      state.page = 0;
      label.textContent = event.target.value;
      render();
    });
  }
  for (const key of ["onlyOpen", "needTakeout", "needDelivery", "needAlone", "wantMeat"]) {
    els[key].addEventListener("change", (event) => {
      state[key] = event.target.checked;
      state.page = 0;
      render();
    });
  }
  els.categoryGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    const value = button.dataset.category;
    state.categories.has(value) ? state.categories.delete(value) : state.categories.add(value);
    state.page = 0;
    render();
  });
  els.moodGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mood]");
    if (!button) return;
    const value = button.dataset.mood;
    state.moods.has(value) ? state.moods.delete(value) : state.moods.add(value);
    state.page = 0;
    render();
  });
  els.nextRecommendButton.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(getRecommendedMenus().length / 10));
    state.page = (state.page + 1) % totalPages;
    renderRecommendations();
    document.querySelector(".recommend-section").scrollIntoView({ behavior: "smooth" });
  });
  els.rouletteButton.addEventListener("click", () => {
    const pool = getRecommendedMenus().slice(0, 20);
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    showDetail(pick.id);
  });
  document.body.addEventListener("click", (event) => {
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
    const start = event.target.closest("#startWorldcup");
    if (start) startWorldcup();
    const restart = event.target.closest("#restartWorldcup");
    if (restart) startWorldcup();
    const choice = event.target.closest("[data-worldcup-choice]");
    if (choice) chooseWorldcup(Number(choice.dataset.worldcupChoice));
  });
  document.body.addEventListener("input", (event) => {
    const input = event.target.closest("[data-taste-field]");
    if (!input) return;
    const output = input.closest("[data-taste-editor]")?.querySelector(`[data-taste-output="${input.dataset.tasteField}"]`);
    if (output) output.textContent = input.value;
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
    requestLocation();
  };
  window.setTimeout(hideSplash, 2400);
}

renderChips();
bindEvents();
render();
finishSplash();

if ("serviceWorker" in navigator && ["http:", "https:"].includes(window.location.protocol)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
