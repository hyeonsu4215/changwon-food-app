const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { extractFunctionSource } = require("../scripts/analyze-food-character");
const community = require("../community-mvp");
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function element() {
  const classes = new Set();
  return {
    attributes: {}, hidden: false, disabled: false, textContent: "",
    classList: {
      contains: (name) => classes.has(name),
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
  };
}

function navigation() {
  const ids = ["recommendTab", "worldcupTab", "communityTab", "storeSearchTab", "dataTab", "wishlistTab", "benefitsTab", "myRecordTab"];
  const panels = ids.map((id) => Object.assign(element(), { id }));
  panels.forEach((panel) => panel.classList.toggle("tab-panel", true));
  const buttons = ["recommendTab", "communityTab", "benefitsTab", "dataTab"].map((tab) => Object.assign(element(), { dataset: { tab } }));
  const shortcut = element();
  const document = {
    getElementById: (id) => id === "wishlistShortcut" ? shortcut : panels.find((panel) => panel.id === id),
    querySelectorAll: (selector) => selector === ".tab-panel" ? panels : buttons,
  };
  const state = { activeTab: "recommendTab", roulette: { active: false }, sharedPickStatus: "none" };
  const pushes = [], opened = [], switched = [];
  const switchTab = new Function("document", "state", "closeRoulette", "openCommunityContent", "pushAppState", "window",
    `${extractFunctionSource(app, "switchTab")}; return switchTab;`)(document, state, () => {}, () => opened.push(true), (id) => pushes.push(id), { scrollTo() {} });
  const pop = new Function("document", "state", "els", "closeServiceInfoView", "handleBackNavigation", "parseSharedPickFromUrl", "switchTab", "openCommunityContent", "MY_RECORD_TITLES", "syncMyRecordView",
    `${extractFunctionSource(app, "handlePopNavigation")}; return handlePopNavigation;`)(document, state, {}, () => {}, () => switched.push("fallback"), () => ({ present: false }), (id, options) => { switched.push(id); switchTab(id, options); }, () => {}, { myTasteRecords: "내 입맛 설정" }, () => {});
  return { panels, buttons, shortcut, state, pushes, opened, switchTab, pop, switched };
}

test("B4 navigation has exactly four destinations and keeps search and worldcup on home", () => {
  const nav = html.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...nav.matchAll(/data-tab="([^"]+)"/g)].map((match) => match[1]),
    ["recommendTab", "communityTab", "benefitsTab", "dataTab"]);
  assert.doesNotMatch(nav, /wishlistTab|nav-search-cta/);
  assert.match(html, /data-home-tab="worldcupTab"/);
  assert.match(html, /data-home-tab="storeSearchTab"/);
  assert.match(html, /id="benefitsTab"/);
});

test("existing authentication, share, help and record IDs remain unique", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["quickRecommendButton", "wishlistTab", "communityLogin", "communityLoginOther", "communityLogout", "shareButton", "onboardingHelpButton"]) {
    assert.equal(ids.filter((item) => item === id).length, 1, id);
  }
  const header = html.match(/<header class="app-top">[\s\S]*?<\/header>/)[0];
  assert.match(header, /wishlistShortcut/);
  assert.doesNotMatch(header, /shareButton|onboardingHelpButton/);
  assert.ok(html.indexOf('id="communityLogin"') < html.indexOf('id="dataDashboard"'));
  assert.ok(html.indexOf('id="communityLogin"') > html.indexOf('id="dataTab"'));
});

test("pristine home keeps recommendation, home tools and inline conditions without a benefits banner or map SDK", () => {
  const home = html.slice(html.indexOf('id="recommendTab"'), html.indexOf('id="worldcupTab"'));
  const cta = home.indexOf('id="quickRecommendButton"');
  const tools = home.indexOf('class="home-shortcuts"');
  const conditions = home.indexOf('id="conditionDetails"');
  assert.ok(cta >= 0 && tools > cta && conditions > tools);
  assert.doesNotMatch(home, /home-benefits|학생 혜택|쿠폰·스탬프/);
  assert.match(html, /data-tab="benefitsTab"/);
  assert.match(html, /id="benefitsTab"/);
  assert.doesNotMatch(html, /dapi\.kakao\.com\/v2\/maps\/sdk/);
});

test("community and wishlist highlight their correct navigation destinations", () => {
  const h = navigation();
  h.switchTab("communityTab");
  assert.equal(h.opened.length, 1);
  assert.equal(h.buttons.find((button) => button.dataset.tab === "communityTab").attributes["aria-current"], "page");
  assert.equal(h.buttons.filter((button) => button.attributes["aria-current"]).length, 1);
  h.switchTab("wishlistTab");
  assert.equal(h.buttons.find((button) => button.dataset.tab === "dataTab").attributes["aria-current"], "page");
  assert.equal(h.shortcut.attributes["aria-pressed"], "true");
  assert.equal(h.panels.filter((panel) => panel.classList.contains("is-active"))[0].id, "wishlistTab");
  h.switchTab("missingTab");
  assert.equal(h.state.activeTab, "wishlistTab");
});

test("home tools retain the recommendation parent tab and benefits has its own tab", () => {
  const h = navigation();
  for (const tab of ["worldcupTab", "storeSearchTab"]) {
    h.switchTab(tab);
    assert.equal(h.state.activeTab, tab);
    assert.equal(h.buttons.find((button) => button.dataset.tab === "recommendTab").attributes["aria-current"], "page");
  }
  h.switchTab("benefitsTab");
  assert.equal(h.buttons.find((button) => button.dataset.tab === "benefitsTab").attributes["aria-current"], "page");
});

test("back and forward restore tab state without pushing another entry", () => {
  const h = navigation();
  h.switchTab("communityTab");
  h.switchTab("dataTab");
  const count = h.pushes.length;
  h.pop({ state: { screen: "communityTab" } });
  assert.equal(h.state.activeTab, "communityTab");
  h.pop({ state: { screen: "dataTab" } });
  assert.equal(h.state.activeTab, "dataTab");
  assert.equal(h.pushes.length, count);
  assert.deepEqual(h.switched, ["communityTab", "dataTab"]);
});

test("MY displays only confirmed Kakao profile names as text and keeps anonymous users separate", () => {
  const elements = Object.fromEntries(["myProfileName", "myProfileDescription", "myProfileImage", "communityAuthStatus", "communityLogin", "communityLoginOther"].map((id) => [id, element()]));
  const state = { communityController: {} };
  const renderMyProfile = new Function("document", "state", "window", `${extractFunctionSource(app, "renderMyProfile")}; return renderMyProfile;`)(
    { getElementById: (id) => elements[id] }, state, { MukjjiCommunity: community });
  renderMyProfile({ is_anonymous: true, user_metadata: { nickname: "anonymous" } });
  assert.equal(elements.myProfileName.textContent, "묵찌와 함께 골라볼까요?");
  renderMyProfile({ is_anonymous: false, identities: [{ provider: "kakao" }], user_metadata: { nickname: "<img onerror=alert(1)>" } });
  assert.equal(elements.myProfileName.textContent, "<img onerror=alert(1)>");
  assert.match(elements.myProfileDescription.textContent, /자동 동기화하지/);
  renderMyProfile();
  assert.equal(elements.myProfileName.textContent, "묵찌와 함께 골라볼까요?");
  const verified = { is_anonymous: false, identities: [{ provider: "kakao" }], user_metadata: { avatar_url: "https://img.kakaocdn.net/test-photo.png" } };
  renderMyProfile(verified);
  assert.equal(elements.myProfileImage.src, verified.user_metadata.avatar_url);
  elements.myProfileImage.onerror();
  assert.match(elements.myProfileImage.src, /02_mukjji_greeting/);
  renderMyProfile({ ...verified, user_metadata: { avatar_url: "javascript:alert(1)" } });
  assert.match(elements.myProfileImage.src, /02_mukjji_greeting/);
  renderMyProfile();
  assert.match(elements.myProfileImage.src, /02_mukjji_greeting/);
  state.communityController = null;
  renderMyProfile();
  assert.equal(elements.communityLogin.disabled, true);
  assert.equal(elements.communityLoginOther.disabled, true);
  assert.match(elements.communityAuthStatus.textContent, /이 환경에서는 로그인을 이용할 수 없어요/);
});

test("route snapshots deduplicate identical screens while retaining MY and community subroutes", () => {
  const state = { activeTab: "dataTab", myRecordTarget: "myTasteRecords" };
  const history = { state: { screen: "dataTab" }, pushes: [], pushState(route) { this.state = route; this.pushes.push(route); }, replaceState(route) { this.state = route; } };
  const push = new Function("state", "history", "window", `${extractFunctionSource(app, "pushAppState")}; return pushAppState;`)(state, history, { location: { href: "https://preview.invalid/?communityAuth=1" } });
  push("myRecordTab"); push("myRecordTab");
  assert.equal(history.pushes.length, 1);
  assert.equal(history.state.record, "myTasteRecords");
  assert.equal(history.state.parent, "dataTab");
  push("communityTab", { community: { view: "compose", mine: true } });
  push("communityTab", { community: { view: "detail", id: "post-id", mine: true }, replace: true });
  assert.equal(history.pushes.length, 2);
  assert.equal(history.state.community.view, "detail");
});

test("unavailable community shows an honest message without starting a request", () => {
  const elements = { communityMessage: element(), communityEmpty: element() };
  const state = { communityController: null };
  const open = new Function("document", "state", `${extractFunctionSource(app, "openCommunityContent")}; return openCommunityContent;`)(
    { getElementById: (id) => elements[id] }, state);
  open();
  assert.match(elements.communityMessage.textContent, /불러올 수 없어요/);
  assert.equal(elements.communityEmpty.hidden, true);
});

test("authentication failure is also visible in MY using the existing controller", () => {
  const message = element(), authMessage = element();
  const controller = community.createController({}, { message, authMessage });
  controller.setMessage("카카오 인증을 완료하지 못했어요.");
  assert.equal(message.textContent, authMessage.textContent);
  controller.setMessage("");
  assert.equal(authMessage.textContent, "");
});

test("MY links target actual record sections and never automatically load saved preferences", () => {
  for (const [, target] of html.matchAll(/data-my-target="([^"]+)"/g)) {
    if (target !== "wishlist") assert.ok(app.includes(`id="${target}"`), target);
  }
  const myHandler = app.slice(app.indexOf('if (event.target.closest("[data-my-open-preferences]"))'), app.indexOf("const serviceInfoButton", app.indexOf("function bindEvents")));
  assert.match(myHandler, /switchTab\("recommendTab"\)/);
  assert.match(myHandler, /openPreferenceSettings\(\)/);
  assert.doesNotMatch(myHandler, /loadSavedRecommendationPreferences|searchMenus\(/);
  assert.match(app, /recordMenuRows\(tasteItems,/);
});

test("temporary RLS tools are not reintroduced", () => {
  for (const file of ["tools/preview-rls", "api/preview-rls-config.js", "tests/preview-rls.test.js"]) assert.equal(fs.existsSync(path.join(root, file)), false);
  assert.doesNotMatch(html + app, /preview-rls|MukjjiRlsCheck/);
});

function focusHarness({ previousVisible = false, previousDisabled = false, quickVisible = false, cardVisible = false } = {}) {
  let focused = null;
  class FakeHTMLElement {
    constructor(name, visible, disabled = false) { this.name = name; this.visible = visible; this.disabled = disabled; this.isConnected = true; }
    matches(selector) { return selector === ":disabled" ? this.disabled : true; }
    closest() { return null; }
    getClientRects() { return this.visible ? [{}] : []; }
    focus() { focused = this.name; }
  }
  const previous = new FakeHTMLElement("previous", previousVisible, previousDisabled);
  const quick = new FakeHTMLElement("quick", quickVisible);
  const card = new FakeHTMLElement("card-detail", cardVisible);
  const nav = new FakeHTMLElement("recommend-nav", true);
  const state = { onboarding: { previousFocus: previous } };
  const document = { querySelector: (selector) => selector.startsWith(".quick-hero-card") ? card : nav };
  const window = { getComputedStyle: () => ({ visibility: "visible" }) };
  const restore = new Function("state", "els", "document", "window", "HTMLElement",
    `${extractFunctionSource(app, "restoreOnboardingFocus")}; return restoreOnboardingFocus;`)(state, { quickRecommendButton: quick }, document, window, FakeHTMLElement);
  return { state, restore, focused: () => focused };
}

test("onboarding restores the previous target only when it is visible and enabled", () => {
  const h = focusHarness({ previousVisible: true, quickVisible: true });
  h.restore();
  assert.equal(h.focused(), "previous");
  assert.equal(h.state.onboarding.previousFocus, null);
  const disabled = focusHarness({ previousVisible: true, previousDisabled: true, quickVisible: true });
  disabled.restore();
  assert.equal(disabled.focused(), "quick");
});

test("onboarding falls back to a visible recommendation control when MY is hidden", () => {
  const fresh = focusHarness({ quickVisible: true });
  fresh.restore();
  assert.equal(fresh.focused(), "quick");
  const results = focusHarness({ cardVisible: true });
  results.restore();
  assert.equal(results.focused(), "card-detail");
  const missing = focusHarness();
  missing.restore();
  assert.equal(missing.focused(), "recommend-nav");
});
