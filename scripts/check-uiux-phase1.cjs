const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = path.resolve(__dirname, "..");
const origin = "https://uiux-local-check.vercel.app";
const widths = [[360, 740], [375, 667], [390, 844], [412, 915], [430, 932], [480, 1040], [1024, 768], [1280, 800]];

// Every request is fulfilled locally. No OAuth, Supabase or deployment is contacted.
const sdk = `(() => {
  let user = { id: 'mock-anonymous', is_anonymous: true };
  const listeners = [];
  let posts = [{ id: '11111111-1111-4111-8111-111111111111', author_id: 'other-user', title: '오늘 점심 이야기', body: '가볍게 메뉴를 골라요.', created_at: '2026-10-27T03:00:00Z' }];
  window.__mockLogins = [];
  window.__listMode = 'normal';
  window.__setMockUser = (next) => { user = next; listeners.forEach((fn) => fn('SIGNED_IN', { user })); };
  const auth = {
    async getUser() { return { data: { user } }; },
    async getSession() { return { data: { session: user ? { user, access_token: 'mock-not-a-real-token' } : null } }; },
    async signInAnonymously() { window.__setMockUser({ id: 'mock-anonymous', is_anonymous: true }); return { data: { user } }; },
    async signOut() { window.__setMockUser(null); return {}; },
    async signInWithOAuth(options) { window.__mockLogins.push(options); return { data: { url: 'https://provider.invalid/mock-only' } }; },
    async linkIdentity(options) { window.__mockLogins.push(options); return { data: { url: 'https://provider.invalid/mock-only' } }; },
    onAuthStateChange(callback) { listeners.push(callback); return { data: { subscription: { unsubscribe() {} } } }; }
  };
  window.supabase = { createClient() { return {
    auth, async rpc() { return { data: true }; },
    from(table) {
      let id, authorId, operation, input;
      const builder = {
        select() { return this; }, order() { return this; }, limit() { return this; },
        eq(key, value) { if (key === 'id') id = value; if (key === 'author_id') authorId = value; return this; },
        insert(value) { operation = 'insert'; input = value; return this; },
        delete() { operation = 'delete'; return this; },
        single() { return this; },
        then(resolve, reject) {
          let data = table === 'community_posts' ? [...posts] : [];
          if (authorId && Array.isArray(data)) data = data.filter((post) => post.author_id === authorId);
          if (table === 'community_posts' && !id && !operation) {
            if (window.__listMode === 'delayed') {
              return new Promise((done) => { window.__releaseMockList = () => done({ data: [], error: null }); }).then(resolve, reject);
            }
            if (window.__listMode === 'error') return Promise.resolve({ data: null, error: new Error('mock list failure') }).then(resolve, reject);
            if (window.__listMode === 'empty') data = [];
          }
          if (table === 'community_posts' && operation === 'insert') {
            data = { ...input, id: '22222222-2222-4222-8222-222222222222', author_id: user.id, created_at: '2026-10-27T04:00:00Z' };
            posts.unshift(data);
          } else if (table === 'community_posts' && operation === 'delete') {
            posts = posts.filter((post) => post.id !== id); data = { id };
          } else if (table === 'community_posts' && id) data = posts.find((post) => post.id === id);
          return Promise.resolve({ data, error: null, count: Array.isArray(data) ? data.length : 1 }).then(resolve, reject);
        }
      };
      return builder;
    }
  }; } };
})();`;

async function checkLayout(page, label) {
  const result = await page.evaluate(() => {
    const nav = document.querySelector(".bottom-nav").getBoundingClientRect();
    const dock = document.getElementById("recommendActionDock");
    const dockRect = dock.getBoundingClientRect();
    const visibleDock = dock.checkVisibility();
    const controls = [...document.querySelectorAll('.bottom-nav button, .top-actions button, .my-profile button, .my-food-menu button, .my-tools button')]
      .filter((button) => button.checkVisibility()).map((button) => ({ label: button.textContent.trim() || button.getAttribute('aria-label'), width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height }));
    return { overflow: document.documentElement.scrollWidth > innerWidth, nav: nav.bottom <= innerHeight && nav.left >= 0 && nav.right <= innerWidth,
      dock: !visibleDock || dockRect.bottom <= nav.top, controls };
  });
  assert.equal(result.overflow, false, `${label}: horizontal overflow`);
  assert.equal(result.nav, true, `${label}: navigation outside viewport`);
  assert.equal(result.dock, true, `${label}: dock/navigation overlap`);
  assert.deepEqual(result.controls.filter((item) => item.width < 43.9 || item.height < 43.9), [], `${label}: touch target below 44px`);
}

async function setup(browser, viewport, enabled = true) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block", reducedMotion: "reduce" });
  const errors = [], unexpected = [];
  await context.addInitScript(() => {
    localStorage.setItem("changwonFoodOnboardingSeenV1", "true");
    localStorage.setItem("changwonFoodWishlist", '["M001"]');
    localStorage.setItem("changwonFoodHistory", "[]");
    localStorage.setItem("changwonFoodTasteOverrides", '{"M001":{"spicy":2,"salty":3,"sweet":2}}');
    window.__locationCalls = 0;
    navigator.geolocation.getCurrentPosition = () => { window.__locationCalls += 1; throw new Error("Unexpected automatic location request"); };
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'profile.kakaocdn.net') return route.fulfill({ contentType: 'image/webp', body: fs.readFileSync(path.join(root, 'assets/mukjji/02_mukjji_greeting_512.webp')) });
    if (url.hostname === "cdn.jsdelivr.net") return route.fulfill({ contentType: "application/javascript", body: sdk });
    if (url.origin !== origin) { unexpected.push(url.hostname); return route.abort(); }
    if (url.pathname === "/api/community-test-config") return route.fulfill({ contentType: "application/json", status: enabled ? 200 : 503,
      body: JSON.stringify(enabled ? { enabled: true, url: "https://ocqffcambljzhymlfwmh.supabase.co", anonKey: "sb_publishable_mock_only" } : { enabled: false }) });
    if (url.pathname === "/api/weather") return route.fulfill({ status: 503, contentType: "application/json", body: '{"ok":false}' });
    const file = path.resolve(root, "." + (url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: "Not found" });
    const type = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".webmanifest": "application/manifest+json" }[path.extname(file)] || "text/plain";
    return route.fulfill({ contentType: type, body: fs.readFileSync(file) });
  });
  await page.goto(origin);
  await page.waitForFunction(() => document.getElementById("splashScreen").classList.contains("is-hidden") && !document.getElementById("quickRecommendButton").disabled);
  return { context, page, errors, unexpected };
}

async function run() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const [width, height] of widths) {
      const { context, page, errors, unexpected } = await setup(browser, { width, height });
      const keys = ["changwonFoodWishlist", "changwonFoodHistory", "changwonFoodTasteOverrides", "changwonFoodRecommendationPreferencesV1"];
      const snapshot = () => page.evaluate((names) => names.map((name) => localStorage.getItem(name)), keys);
      const initial = await snapshot();
      await checkLayout(page, `${width}: home`);
      assert.equal(await page.locator('.home-benefits').count(), 0);
      assert.equal(await page.locator('#conditionDetails > summary').isVisible(), true);
      if (process.env.B4_SCREENSHOT_DIR && [360, 390, 480].includes(width)) await page.screenshot({ path: path.join(process.env.B4_SCREENSHOT_DIR, `b4-home-${width}.png`), fullPage: true });
      assert.equal(await page.locator('.bottom-nav button').count(), 4);
      await page.click('.bottom-nav [data-tab="benefitsTab"]');
      assert.match(await page.locator('#benefitsTab').textContent(), /준비 중/);
      await checkLayout(page, `${width}: benefits`);
      await page.goBack();
      await page.waitForFunction(() => state.activeTab === 'recommendTab');
      await page.goForward();
      await page.waitForFunction(() => state.activeTab === 'benefitsTab');
      await page.locator('#benefitsTab > .home-back').click();
      assert.equal(await page.evaluate(() => state.activeTab), 'recommendTab');
      await page.click('.bottom-nav [data-tab="communityTab"]');
      await page.waitForFunction(() => !document.getElementById('communityEmpty').textContent.includes('불러오고'));
      await page.goBack();
      await page.waitForFunction(() => state.activeTab === 'recommendTab');
      await page.click('.bottom-nav [data-tab="communityTab"]');
      await page.locator('#communityTab .home-back').click();
      assert.equal(await page.evaluate(() => document.getElementById("quickRecommendButton").getBoundingClientRect().bottom < innerHeight), true);
      await page.click('.bottom-nav [data-tab="dataTab"]');
      await checkLayout(page, `${width}: MY signed out`);
      assert.equal(await page.locator("#communityLogin").isVisible(), true);
      assert.equal(await page.locator('#dataTab #dataDashboard').count(), 0);
      assert.match(await page.locator('#communityLogin').textContent(), /카카오 로그인/);
      if (process.env.B4_SCREENSHOT_DIR && [360, 390, 480].includes(width)) await page.screenshot({ path: path.join(process.env.B4_SCREENSHOT_DIR, `b4-my-${width}.png`), fullPage: true });
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      assert.equal(await page.evaluate(() => document.querySelector(".record-official-note").getBoundingClientRect().bottom <= document.querySelector(".bottom-nav").getBoundingClientRect().top), true);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ fullPage: true });
      await page.evaluate(() => window.__setMockUser({ id: "mock-user-A", is_anonymous: false, identities: [{ provider: "kakao" }], user_metadata: { nickname: "묵찌를 좋아하는 창원대학교 학생", avatar_url: 'https://profile.kakaocdn.net/test.webp' } }));
      await page.waitForFunction(() => document.getElementById("communityLogout").hidden === false);
      await checkLayout(page, `${width}: MY signed in`);
      assert.equal(await page.locator('#myProfileImage').getAttribute('src'), 'https://profile.kakaocdn.net/test.webp');
      if (width === 390) {
        page.once('dialog', (dialog) => dialog.dismiss());
        await page.click('#communityLoginOther');
        assert.equal(await page.evaluate(() => window.__mockLogins.length), 0);
        page.once('dialog', (dialog) => dialog.accept());
        await page.click('#communityLoginOther');
        await page.waitForFunction(() => window.__mockLogins.length === 1);
        assert.equal(await page.evaluate(() => window.__mockLogins[0].options.queryParams.prompt), 'login');
        await page.evaluate(() => { window.dispatchEvent(new Event('pageshow')); window.__mockLogins.length = 0; });
      }
      await page.click("#wishlistShortcut");
      assert.equal(await page.locator("#wishlistTab").evaluate((el) => el.classList.contains("is-active")), true);
      assert.equal(await page.locator('.bottom-nav [aria-current="page"]').getAttribute("data-tab"), "dataTab");
      await page.goBack();
      await page.waitForFunction(() => state.activeTab === 'dataTab');
      for (const target of ['myEatenRecords', 'myTasteRecords']) {
        await page.click(`[data-my-target="${target}"]`);
        await page.waitForFunction((id) => state.activeTab === 'myRecordTab' && state.myRecordTarget === id, target);
        await checkLayout(page, `${width}: ${target}`);
        assert.equal(await page.locator('#'+target).isVisible(), true);
        await page.goBack();
        await page.waitForFunction(() => state.activeTab === 'dataTab');
        await page.goForward();
        await page.waitForFunction(() => state.activeTab === 'myRecordTab');
        await page.locator('#myRecordTab [data-my-back]').click();
        await page.waitForFunction(() => state.activeTab === 'dataTab');
      }
      await page.click('.bottom-nav [data-tab="communityTab"]');
      await page.waitForFunction(() => document.querySelectorAll(".community-post-row").length === 1);
      await checkLayout(page, `${width}: community`);
      if (process.env.B4_SCREENSHOT_DIR && width === 390) await page.screenshot({ path: path.join(process.env.B4_SCREENSHOT_DIR, "b4-community-390.png"), fullPage: true });
      assert.equal(await page.locator("#communityForm").isVisible(), false);
      await page.locator('.community-post-row').first().click();
      await page.waitForFunction(() => !document.getElementById('communityDetail').hidden);
      await page.goBack();
      await page.waitForFunction(() => document.getElementById('communityDetail').hidden);
      await page.goForward();
      await page.waitForFunction(() => !document.getElementById('communityDetail').hidden);
      await page.click('#communityBack');
      await page.waitForFunction(() => document.getElementById('communityDetail').hidden);
      await page.click('#communityCompose');
      await page.fill('#communityTitleInput', 'draft kept on back');
      await page.goBack();
      await page.waitForFunction(() => document.getElementById('communityForm').hidden);
      await page.goForward();
      await page.waitForFunction(() => !document.getElementById('communityForm').hidden);
      assert.equal(await page.locator('#communityTitleInput').inputValue(), 'draft kept on back');
      await page.click('#communityBack');
      await page.waitForFunction(() => document.getElementById('communityForm').hidden);
      await page.click('.bottom-nav [data-tab="recommendTab"]');
      await page.click('[data-home-tab="worldcupTab"]');
      assert.equal(await page.locator("#startWorldcup").isVisible(), true);
      assert.equal(await page.locator('.bottom-nav [aria-current="page"]').getAttribute('data-tab'), 'recommendTab');
      await page.locator('#worldcupTab [data-home-tab="recommendTab"]').click();
      await page.click('[data-home-tab="storeSearchTab"]');
      await page.fill("#storeSearchInput", "김밥");
      assert.equal((await page.locator("#storeSearchResults").textContent()).length > 0, true);
      await page.click('.bottom-nav [data-tab="recommendTab"]');
      await page.click("#quickRecommendButton");
      await page.waitForFunction(() => state.hasSearched && state.quickItems.length === 3);
      await page.waitForFunction(() => getComputedStyle(document.getElementById("searchOverlay")).opacity === "0");
      await checkLayout(page, `${width}: recommendation`);
      assert.equal(await page.locator(".quick-hero-card, .quick-alt-card").count(), 3);
      assert.equal(await page.locator('.home-shortcuts [data-home-tab="worldcupTab"]').isVisible(), true);
      assert.equal(await page.locator('.home-shortcuts [data-home-tab="storeSearchTab"]').isVisible(), true);
      await page.screenshot({ fullPage: true });
      await page.click("#rouletteButton");
      assert.equal(await page.locator("#roulettePanel").evaluate((el) => el.classList.contains("is-active")), true);
      await page.click("#closeRouletteButton");
      if (width === 390) {
        for (let count = 0; count < 4; count += 1) await page.click("#rerollQuickButton");
        assert.equal(await page.locator("#recommendNudge").isVisible(), true);
        await checkLayout(page, "390: fourth reroll");
        await page.click("[data-dismiss-discovery-nudge]");
        assert.equal(await page.locator("#rerollQuickButton").isVisible(), true);
        await page.click('.bottom-nav [data-tab="dataTab"]');
        await page.click('[data-my-target="myEatenRecords"]');
        await page.waitForFunction(() => document.activeElement.id === "myEatenRecords");
        assert.equal(await page.evaluate(() => document.activeElement.id), "myEatenRecords");
        await page.locator('#myRecordTab [data-my-back]').click();
        await page.waitForFunction(() => state.activeTab === 'dataTab');
        await page.click('[data-my-target="myTasteRecords"]');
        await page.waitForFunction(() => document.activeElement.id === "myTasteRecords");
        assert.equal(await page.evaluate(() => document.activeElement.id), "myTasteRecords");
        await page.locator('#myRecordTab [data-my-back]').click();
        await page.waitForFunction(() => state.activeTab === 'dataTab');
        await page.click('[data-my-target="myRecordSettings"]');
        await page.click('[data-my-target="myPreferenceRecords"]');
        await page.click("[data-my-open-preferences]");
        assert.equal(await page.locator("#conditionDetails").evaluate((el) => el.open), true);
        assert.equal(await page.evaluate(() => state.quickItems.length), 3);
        await page.click('.bottom-nav [data-tab="dataTab"]');
        await page.click('.bottom-nav [data-tab="communityTab"]');
        await page.goBack();
        assert.equal(await page.locator('.bottom-nav [aria-current="page"]').getAttribute("data-tab"), "dataTab");
        await page.goForward();
        assert.equal(await page.locator('.bottom-nav [aria-current="page"]').getAttribute("data-tab"), "communityTab");
        await page.click('#communityCompose');
        await page.fill("#communityTitleInput", "로컬 화면 검사");
        await page.fill("#communityBodyInput", "실제 DB에는 전송하지 않는 모의 게시글입니다.");
        await page.locator('#communityForm button[type="submit"]').click();
        await page.waitForFunction(() => !document.getElementById("communityDetail").hidden);
        await page.click('.bottom-nav [data-tab="dataTab"]');
        await page.click('[data-open-my-stories]');
        await page.waitForFunction(() => document.getElementById('communityMine').getAttribute('aria-pressed') === 'true' && document.querySelectorAll('.community-post-row').length === 1);
        await page.locator('.community-post-row').click();
        await page.waitForFunction(() => !document.getElementById('communityDetail').hidden);
        await page.click("#communityDelete");
        await page.click("#communityConfirmDelete");
        await page.waitForFunction(() => !document.getElementById("communityListSection").hidden);
        assert.equal(await page.locator(".community-post-row").count(), 0);
        await page.click('#communityAll');
        await page.waitForFunction(() => document.querySelectorAll('.community-post-row').length === 1);
        await page.click('.bottom-nav [data-tab="dataTab"]');
        await page.click("#communityLogout");
        await page.waitForFunction(() => !document.getElementById("communityLogin").hidden);
        assert.equal(await page.locator("#myProfileName").textContent(), "묵찌와 함께 골라볼까요?");
        await page.evaluate(() => { window.__listMode = "delayed"; });
        await page.click('.bottom-nav [data-tab="communityTab"]');
        await page.waitForFunction(() => typeof window.__releaseMockList === "function");
        assert.match(await page.locator("#communityEmpty").textContent(), /불러오고 있어요/);
        await page.click('.bottom-nav [data-tab="dataTab"]');
        assert.equal(await page.locator("#communityLogin").isDisabled(), true);
        assert.match(await page.locator("#communityAuthStatus").textContent(), /처리하고 있어요/);
        assert.equal(await page.evaluate(() => window.__mockLogins.length), 0);
        await page.evaluate(() => window.__releaseMockList());
        await page.waitForFunction(() => !document.getElementById("communityLogin").disabled);
        await page.click("#communityLogin");
        await page.waitForFunction(() => window.__mockLogins.length === 1);
        await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
        await page.click("#communityLoginOther");
        await page.waitForFunction(() => window.__mockLogins.length === 2);
        assert.equal(await page.evaluate(() => window.__mockLogins[1].options.queryParams.prompt), "login");
        await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
        await page.evaluate(() => { window.__listMode = "error"; });
        await page.click('.bottom-nav [data-tab="communityTab"]');
        await page.waitForFunction(() => !document.getElementById("communityRetry").hidden);
        assert.equal(await page.locator("#communityEmpty").isHidden(), true);
        assert.match(await page.locator("#communityMessage").textContent(), /목록을 불러오지 못했어요/);
        await page.evaluate(() => { window.__listMode = "empty"; });
        await page.click("#communityRetry");
        await page.waitForFunction(() => document.getElementById("communityEmpty").textContent.includes("아직 등록된"));
        assert.equal(await page.locator("#communityEmpty").isVisible(), true);
        assert.equal(await page.locator("#communityRetry").isHidden(), true);
        await page.click('.bottom-nav [data-tab="dataTab"]');
        await page.click('[data-my-target="myRecordSettings"]');
        await page.click('[data-my-target="myServiceInfo"]');
        await page.click('[data-open-service-info="privacy"]');
        assert.equal(await page.locator("#serviceInfoView").isVisible(), true);
        await page.click("#serviceInfoBackButton");
        await page.waitForFunction(() => document.getElementById("serviceInfoView").hidden);
        await page.click('.bottom-nav [data-tab="dataTab"]');
        await page.locator("#onboardingHelpButton").focus();
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => state.onboarding.active);
        await page.keyboard.press("Tab");
        assert.equal(await page.evaluate(() => document.activeElement.id), "onboardingSkipButton");
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => !state.onboarding.active && document.activeElement.matches(".quick-card-detail-hit"));
        assert.equal(await page.evaluate(() => document.activeElement.checkVisibility()), true);
        await page.click('.bottom-nav [data-tab="dataTab"]');
        await page.locator("#onboardingHelpButton").focus();
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => state.onboarding.active);
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !state.onboarding.active && document.activeElement.matches(".quick-card-detail-hit"));
        assert.equal(await page.evaluate(() => document.activeElement.checkVisibility()), true);
      }
      assert.deepEqual(await snapshot(), initial, `${width}: local records changed`);
      assert.equal(await page.evaluate(() => window.__locationCalls), 0);
      assert.deepEqual(errors, [], `${width}: browser errors`);
      assert.deepEqual(unexpected, [], `${width}: unexpected network requests`);
      console.log(`PASS ${width}x${height}: navigation, MY/auth, wishlist, story, search, worldcup, picks, roulette, layout; no real remote requests`);
      await context.close();
    }
    const { page, context, errors, unexpected } = await setup(browser, { width: 360, height: 740 }, false);
    await page.click('.bottom-nav [data-tab="dataTab"]');
    assert.equal(await page.locator("#communityLogin").isDisabled(), true);
    await page.click('.bottom-nav [data-tab="communityTab"]');
    assert.match(await page.locator("#communityMessage").textContent(), /지금은 이야기를 불러올 수 없어요/);
    await page.click('.bottom-nav [data-tab="recommendTab"]');
    await page.click("#quickRecommendButton");
    await page.waitForFunction(() => state.quickItems.length === 3);
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    console.log("PASS missing test configuration: disabled auth, honest community state, recommendations still available");
    await context.close();
  } finally { await browser.close(); }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
