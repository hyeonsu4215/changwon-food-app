const DATA = window.CHANGWON_FOOD_DATA;

const state = {
  supabase: null,
  user: null,
  reviews: [],
  reports: [],
  reviewFilter: "all",
  reportFilter: "all",
};

const els = {
  adminStatus: document.querySelector("#adminStatus"),
  signOutButton: document.querySelector("#signOutButton"),
  loginPanel: document.querySelector("#loginPanel"),
  loginForm: document.querySelector("#loginForm"),
  adminEmail: document.querySelector("#adminEmail"),
  adminPassword: document.querySelector("#adminPassword"),
  adminPanel: document.querySelector("#adminPanel"),
  reviewsPanel: document.querySelector("#reviewsPanel"),
  reportsPanel: document.querySelector("#reportsPanel"),
  reviewList: document.querySelector("#reviewList"),
  reportList: document.querySelector("#reportList"),
  refreshReviews: document.querySelector("#refreshReviews"),
  refreshReports: document.querySelector("#refreshReports"),
};

const restaurantsById = new Map(DATA.restaurants.map((restaurant) => [restaurant.id, restaurant]));
const menusById = new Map(DATA.menus.map((menu) => [menu.id, menu]));

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

function menuLabel(menuId) {
  const menu = menusById.get(menuId);
  const restaurant = menu ? restaurantsById.get(menu.restaurantId) : null;
  if (!menu) return menuId || "메뉴 없음";
  return `${restaurant?.name || menu.restaurantName} · ${menu.name}`;
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
    return false;
  }
  if (!window.supabase?.createClient) {
    await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2").catch(() => null);
  }
  if (!window.supabase?.createClient) {
    els.adminStatus.textContent = "Supabase 라이브러리를 불러오지 못했습니다.";
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
  renderReviews();
}

function renderReviews() {
  const rows = state.reviews.filter((review) => state.reviewFilter === "all" || review.status === state.reviewFilter);
  els.reviewList.innerHTML = rows.length
    ? rows
        .map(
          (review) => `
            <article class="admin-row">
              <div class="row-top">
                <strong>${escapeHtml(menuLabel(review.menu_id))}</strong>
                <span class="badge ${review.status}">${review.status === "visible" ? "공개" : "숨김"}</span>
              </div>
              <div class="meta">
                ${escapeHtml(review.nickname)} · 별점 ${review.rating} · 위생 ${review.hygiene} · 친절 ${review.kindness} · ${formatDate(review.created_at)}
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
                <button data-report-status="${report.id}" data-status="pending">대기</button>
                <button data-report-status="${report.id}" data-status="checking">확인중</button>
                <button data-report-status="${report.id}" data-status="done">반영완료</button>
                <button class="danger" data-report-status="${report.id}" data-status="rejected">보류</button>
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

function bindEvents() {
  els.loginForm.addEventListener("submit", handleLogin);
  els.signOutButton.addEventListener("click", signOut);
  els.refreshReviews.addEventListener("click", loadReviews);
  els.refreshReports.addEventListener("click", loadReports);

  document.body.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-admin-tab]");
    if (tab) {
      document.querySelectorAll("[data-admin-tab]").forEach((button) => button.classList.toggle("is-active", button === tab));
      const target = tab.dataset.adminTab;
      els.reviewsPanel.hidden = target !== "reviews";
      els.reportsPanel.hidden = target !== "reports";
    }
    const reviewFilter = event.target.closest("[data-review-filter]");
    if (reviewFilter) {
      state.reviewFilter = reviewFilter.dataset.reviewFilter;
      document.querySelectorAll("[data-review-filter]").forEach((button) => button.classList.toggle("is-active", button === reviewFilter));
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
  });
}

bindEvents();
initSupabase();
