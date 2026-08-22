const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { extractFunctionSource } = require("../scripts/analyze-food-character.js");

const root = path.resolve(__dirname, "..");
const analyticsSource = fs.readFileSync(path.join(root, "analytics-client.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const {
  ANALYTICS_COLLECTION_ENABLED,
  RPC_FUNCTION_NAME,
  RPC_PARAMETER_NAMES,
  EVENT_NAMES,
  ERROR_CODES,
  SESSION_ID_KEY,
  LAST_ACTIVITY_KEY,
  SESSION_TIMEOUT_MS,
  secureUuid,
  createAnalyticsClient,
  buildRpcParameters,
} = require("../analytics-client.js");

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

function deterministicCrypto() {
  let index = 0;
  return {
    randomUUID() {
      index += 1;
      return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    },
  };
}

function recommendationItems(suffix = "A") {
  return [1, 2, 3].map((position) => ({
    id: `M${suffix}${position}`,
    restaurantId: `C${suffix}${position}`,
  }));
}

function migrationFunctionParameters() {
  let migration;
  try {
    migration = execFileSync(
      "git",
      [
        "show",
        "origin/feature/analytics-v1-foundation:supabase/migrations/20260822173904_create_analytics_events.sql",
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    return null;
  }
  const signature = migration.match(/CREATE FUNCTION public\.log_analytics_event\(([\s\S]*?)\)\s*RETURNS boolean/i);
  assert.ok(signature, "Stage 5A RPC signature must be readable from the remote feature blob");
  return [...signature[1].matchAll(/^\s*(p_[a-z_]+)\s+/gm)].map((match) => match[1]);
}

async function run() {
  const expectedRpcParameters = [
    "p_event_id",
    "p_event_name",
    "p_occurred_at",
    "p_session_id",
    "p_recommendation_id",
    "p_restaurant_id",
    "p_menu_id",
    "p_position",
    "p_source_context",
    "p_error_code",
    "p_item_count",
    "p_share_method",
  ];
  assert.equal(ANALYTICS_COLLECTION_ENABLED, false);
  assert.equal(RPC_FUNCTION_NAME, "log_analytics_event");
  assert.deepEqual(RPC_PARAMETER_NAMES, expectedRpcParameters);
  const remoteContractParameters = migrationFunctionParameters();
  if (remoteContractParameters) assert.deepEqual(RPC_PARAMETER_NAMES, remoteContractParameters);
  assert.deepEqual(EVENT_NAMES, [
    "session_start",
    "recommendation_shown",
    "recommendation_refresh",
    "menu_card_open",
    "map_open",
    "share_recommendation",
    "recommendation_error",
  ]);
  assert.ok(indexSource.indexOf("analytics-client.js") < indexSource.indexOf("app.js"));
  const fallbackUuid = secureUuid({
    getRandomValues(bytes) {
      bytes.fill(0xab);
      return bytes;
    },
  });
  assert.match(fallbackUuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const fallbackAfterRandomUuidFailure = secureUuid({
    randomUUID() {
      throw new Error("blocked");
    },
    getRandomValues(bytes) {
      bytes.fill(0xcd);
      return bytes;
    },
  });
  assert.match(fallbackAfterRandomUuidFailure, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(secureUuid({
    randomUUID() {
      throw new Error("blocked");
    },
    getRandomValues() {
      throw new Error("blocked");
    },
  }), null);
  assert.equal(secureUuid({}), null);
  const safeStorageGetter = new Function(
    "window",
    `${extractFunctionSource(appSource, "getAnalyticsSessionStorage")}; return getAnalyticsSessionStorage;`,
  )({
    get sessionStorage() {
      throw new Error("blocked");
    },
  });
  assert.equal(safeStorageGetter(), null, "a throwing window.sessionStorage getter must fail closed");
  const throwingStorageClient = createAnalyticsClient({
    enabled: false,
    sessionStorage: {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    },
    crypto: deterministicCrypto(),
  });
  assert.equal(await throwingStorageClient.initialize(), false);
  const sourceContextFor = (sharedPickStatus, context) => new Function(
    "state",
    `${extractFunctionSource(appSource, "getAnalyticsSourceContext")}; return getAnalyticsSourceContext;`,
  )({ sharedPickStatus })(context);
  assert.equal(sourceContextFor("none", "discovery"), "discovery");
  assert.equal(sourceContextFor("none", "custom"), "personalized");
  assert.equal(sourceContextFor("valid", "discovery"), "shared_pick");
  assert.equal(sourceContextFor("valid", "search"), "search");

  const disabledRpcCalls = [];
  const disabledLogicalEvents = [];
  const disabledStorage = new MemoryStorage();
  let disabledClientLookups = 0;
  let disabledTimerCalls = 0;
  const disabledClient = createAnalyticsClient({
    enabled: ANALYTICS_COLLECTION_ENABLED,
    sessionStorage: disabledStorage,
    crypto: deterministicCrypto(),
    now: () => Date.UTC(2026, 7, 22, 12),
    getSupabaseClient: async () => {
      disabledClientLookups += 1;
      return {
        rpc(name, params) {
          disabledRpcCalls.push({ name, params });
          return { data: true, error: null };
        },
      };
    },
    setTimeout: () => { disabledTimerCalls += 1; return 1; },
    clearTimeout: () => {},
    onLogicalEvent: (event) => disabledLogicalEvents.push(event),
  });
  await disabledClient.initialize();
  disabledClient.startRecommendation(recommendationItems(), "discovery");
  await disabledClient.recordRecommendationShown();
  assert.equal(disabledRpcCalls.length, 0, "default-OFF collection gate must prevent every RPC call");
  assert.equal(disabledClientLookups, 0, "default-OFF collection gate must not initialize an Analytics network client");
  assert.equal(disabledTimerCalls, 0, "default-OFF collection gate must not start request retry timers");
  assert.equal(disabledLogicalEvents.filter((event) => event.eventName === "session_start").length, 1);
  assert.ok(disabledStorage.getItem(SESSION_ID_KEY));
  assert.ok(disabledStorage.getItem(LAST_ACTIVITY_KEY));

  let currentTime = Date.UTC(2026, 7, 22, 13);
  const sessionEvents = [];
  const sessionStorage = new MemoryStorage();
  const sessionClient = createAnalyticsClient({
    enabled: false,
    sessionStorage,
    crypto: deterministicCrypto(),
    now: () => currentTime,
    onLogicalEvent: (event) => sessionEvents.push(event),
  });
  await sessionClient.initialize();
  const firstSessionId = sessionStorage.getItem(SESSION_ID_KEY);
  currentTime += SESSION_TIMEOUT_MS - 1;
  await sessionClient.recordRecommendationError({
    sourceContext: "discovery",
    errorCode: ERROR_CODES.INSUFFICIENT_CANDIDATES,
    itemCount: 2,
  });
  assert.equal(sessionStorage.getItem(SESSION_ID_KEY), firstSessionId, "activity under 30 minutes keeps the session");
  currentTime += SESSION_TIMEOUT_MS + 1;
  await sessionClient.recordRecommendationError({
    sourceContext: "discovery",
    errorCode: ERROR_CODES.DATA_UNAVAILABLE,
    itemCount: 0,
  });
  assert.notEqual(sessionStorage.getItem(SESSION_ID_KEY), firstSessionId, "activity after 30 minutes creates a session");
  assert.equal(sessionEvents.filter((event) => event.eventName === "session_start").length, 2);

  const retryStorage = new MemoryStorage();
  retryStorage.setItem(SESSION_ID_KEY, "10000000-0000-4000-8000-000000000001");
  retryStorage.setItem(LAST_ACTIVITY_KEY, String(currentTime));
  const retryCalls = [];
  const retryClient = createAnalyticsClient({
    enabled: true,
    sessionStorage: retryStorage,
    crypto: deterministicCrypto(),
    now: () => currentTime,
    getSupabaseClient: async () => ({
      rpc(name, params) {
        retryCalls.push({ name, params: { ...params } });
        return retryCalls.length === 1
          ? { data: null, error: new Error("temporary") }
          : { data: true, error: null };
      },
    }),
  });
  assert.equal(await retryClient.recordRecommendationError({
    sourceContext: "personalized",
    errorCode: ERROR_CODES.UNKNOWN,
    itemCount: 0,
  }), true);
  assert.equal(retryCalls.length, 2, "one failure produces at most one retry");
  assert.deepEqual(retryCalls[0], retryCalls[1], "retry must reuse event_id and occurred_at");

  const failedClient = createAnalyticsClient({
    enabled: true,
    sessionStorage: retryStorage,
    crypto: deterministicCrypto(),
    now: () => currentTime,
    getSupabaseClient: async () => ({ rpc: async () => { throw new Error("offline"); } }),
  });
  assert.equal(await failedClient.recordRecommendationError({
    sourceContext: "discovery",
    errorCode: ERROR_CODES.UNKNOWN,
    itemCount: 0,
  }), false, "analytics failure is isolated from callers");

  const recommendationEvents = [];
  const recommendationClient = createAnalyticsClient({
    enabled: false,
    sessionStorage: new MemoryStorage(),
    crypto: deterministicCrypto(),
    now: () => currentTime,
    onLogicalEvent: (event) => recommendationEvents.push(event),
  });
  await recommendationClient.initialize();
  recommendationEvents.length = 0;
  const firstRecommendationId = recommendationClient.startRecommendation(recommendationItems("A"), "discovery");
  await recommendationClient.recordRecommendationShown();
  const shown = recommendationEvents.filter((event) => event.eventName === "recommendation_shown");
  assert.equal(shown.length, 3);
  assert.deepEqual(shown.map((event) => event.position), [1, 2, 3]);
  assert.equal(new Set(shown.map((event) => event.recommendationId)).size, 1);
  assert.equal(new Set(shown.map((event) => event.menuId)).size, 3);
  await recommendationClient.recordRecommendationShown();
  assert.equal(recommendationEvents.filter((event) => event.eventName === "recommendation_shown").length, 3, "rerender is deduped");
  await recommendationClient.recordRecommendationRefresh();
  const refresh = recommendationEvents.find((event) => event.eventName === "recommendation_refresh");
  assert.equal(refresh.recommendationId, firstRecommendationId, "refresh records the previous recommendation ID");
  const secondRecommendationId = recommendationClient.startRecommendation(recommendationItems("B"), "personalized");
  assert.notEqual(secondRecommendationId, firstRecommendationId);

  recommendationEvents.length = 0;
  await recommendationClient.recordMenuCardOpen({
    menuId: "MB2",
    restaurantId: "CB2",
    sourceContext: "personalized",
  });
  await recommendationClient.recordMapOpen({
    menuId: "MB3",
    restaurantId: "CB3",
    sourceContext: "personalized",
  });
  await recommendationClient.recordMenuCardOpen({
    menuId: "MSEARCH",
    restaurantId: "CSEARCH",
    sourceContext: "search",
  });
  const menuOpenEvents = recommendationEvents.filter((event) => event.eventName === "menu_card_open");
  const mapOpenEvent = recommendationEvents.find((event) => event.eventName === "map_open");
  assert.equal(menuOpenEvents[0].recommendationId, secondRecommendationId);
  assert.equal(menuOpenEvents[0].position, 2);
  assert.equal(mapOpenEvent.position, 3);
  assert.equal(menuOpenEvents[1].sourceContext, "search");
  assert.equal(menuOpenEvents[1].recommendationId, undefined);
  assert.equal(menuOpenEvents[1].position, undefined);

  recommendationEvents.length = 0;
  await recommendationClient.recordShareSuccess("web_share");
  await recommendationClient.recordShareSuccess("clipboard");
  await recommendationClient.recordShareSuccess("invalid");
  assert.deepEqual(
    recommendationEvents.filter((event) => event.eventName === "share_recommendation").map((event) => event.shareMethod),
    ["web_share", "clipboard"],
  );
  const eventCountBeforeInvalidError = recommendationEvents.length;
  await recommendationClient.recordRecommendationError({
    sourceContext: "discovery",
    errorCode: "raw exception text",
    itemCount: 0,
  });
  assert.equal(recommendationEvents.length, eventCountBeforeInvalidError, "non-allowlisted error text is rejected");

  function createShareRuntime(navigatorValue, copyResult) {
    const recordedMethods = [];
    let copyCalls = 0;
    const shareCurrentPick = new Function(
      "state",
      "navigator",
      "buildSharedPickUrl",
      "sharedPickMessage",
      "els",
      "toast",
      "copyTextToClipboard",
      "analyticsClient",
      `${extractFunctionSource(appSource, "shareCurrentPick").replace(/^function /, "async function ")}; return shareCurrentPick;`,
    )(
      { sharePickPending: false, quickItems: recommendationItems("S") },
      navigatorValue,
      () => "https://example.test/shared",
      () => "shared",
      { sharePickButton: { disabled: false } },
      () => {},
      async () => { copyCalls += 1; return copyResult; },
      { recordShareSuccess: (method) => recordedMethods.push(method) },
    );
    return { shareCurrentPick, recordedMethods, getCopyCalls: () => copyCalls };
  }

  const cancelledShare = createShareRuntime({
    share: async () => { throw Object.assign(new Error("cancelled"), { name: "AbortError" }); },
  }, true);
  await cancelledShare.shareCurrentPick();
  assert.deepEqual(cancelledShare.recordedMethods, [], "share cancellation records no event");
  assert.equal(cancelledShare.getCopyCalls(), 0, "share cancellation does not fall back to clipboard");

  const resolvedShare = createShareRuntime({ share: async () => {} }, true);
  await resolvedShare.shareCurrentPick();
  assert.deepEqual(resolvedShare.recordedMethods, ["web_share"]);

  const clipboardShare = createShareRuntime({}, true);
  await clipboardShare.shareCurrentPick();
  assert.deepEqual(clipboardShare.recordedMethods, ["clipboard"]);

  const failedShareAndCopy = createShareRuntime({ share: async () => { throw new Error("failed"); } }, false);
  await failedShareAndCopy.shareCurrentPick();
  assert.deepEqual(failedShareAndCopy.recordedMethods, [], "failed Web Share and failed clipboard record no event");

  const failedShareWithClipboardFallback = createShareRuntime({ share: async () => { throw new Error("failed"); } }, true);
  await failedShareWithClipboardFallback.shareCurrentPick();
  assert.deepEqual(failedShareWithClipboardFallback.recordedMethods, ["clipboard"], "a successful clipboard fallback records only clipboard");

  const safeParams = buildRpcParameters({
    eventId: "event",
    eventName: "menu_card_open",
    occurredAt: "2026-08-22T00:00:00.000Z",
    sessionId: "session",
    restaurantId: "C001",
    menuId: "M001",
    sourceContext: "search",
    clientId: "forbidden",
    nickname: "forbidden",
    searchText: "forbidden",
    metadata: { forbidden: true },
  });
  assert.deepEqual(Object.keys(safeParams), [
    "p_event_id",
    "p_event_name",
    "p_occurred_at",
    "p_session_id",
    "p_restaurant_id",
    "p_menu_id",
    "p_source_context",
  ]);
  const common = {
    eventId: "event",
    occurredAt: "2026-08-22T00:00:00.000Z",
    sessionId: "session",
  };
  const semanticMatrix = [
    [{ ...common, eventName: "session_start" }, []],
    [{ ...common, eventName: "recommendation_shown", recommendationId: "rec", restaurantId: "C001", menuId: "M001", position: 1, sourceContext: "discovery" }, ["p_recommendation_id", "p_restaurant_id", "p_menu_id", "p_position", "p_source_context"]],
    [{ ...common, eventName: "recommendation_refresh", recommendationId: "rec", sourceContext: "personalized" }, ["p_recommendation_id", "p_source_context"]],
    [{ ...common, eventName: "menu_card_open", restaurantId: "C001", menuId: "M001", sourceContext: "search" }, ["p_restaurant_id", "p_menu_id", "p_source_context"]],
    [{ ...common, eventName: "map_open", restaurantId: "C001", sourceContext: "search" }, ["p_restaurant_id", "p_source_context"]],
    [{ ...common, eventName: "share_recommendation", recommendationId: "rec", sourceContext: "shared_pick", shareMethod: "clipboard" }, ["p_recommendation_id", "p_source_context", "p_share_method"]],
    [{ ...common, eventName: "recommendation_error", sourceContext: "discovery", errorCode: "invalid_result", itemCount: 3 }, ["p_source_context", "p_error_code", "p_item_count"]],
  ];
  const commonRpcKeys = ["p_event_id", "p_event_name", "p_occurred_at", "p_session_id"];
  semanticMatrix.forEach(([event, eventKeys]) => {
    assert.deepEqual(Object.keys(buildRpcParameters(event)), [...commonRpcKeys, ...eventKeys]);
  });
  semanticMatrix.forEach(([event]) => {
    const params = buildRpcParameters(event);
    assert.equal(Object.hasOwn(params, "server_received_at"), false);
    assert.equal(Object.hasOwn(params, "event_version"), false);
  });
  assert.doesNotMatch(analyticsSource, /localStorage|indexedDB|document\.cookie|client_id|user_id|nickname|search_text|user_agent/i);
  assert.match(appSource, /recordRecommendationShown\(\)/);
  assert.match(appSource, /recordRecommendationRefresh\(\)/);
  assert.match(appSource, /recordMenuCardOpen\(/);
  assert.match(appSource, /recordMapOpen\(/);
  assert.match(appSource, /recordShareSuccess\("web_share"\)/);
  assert.match(appSource, /recordShareSuccess\("clipboard"\)/);
  assert.match(appSource, /recordRecommendationError\(/);
  assert.match(appSource, /data-map-unavailable/);
  assert.match(appSource, /if \(error\?\.name === "AbortError"\) return;/);
  assert.match(appSource, /if \(copied\) analyticsClient\?\.recordShareSuccess\("clipboard"\)/);
  const genericCardSource = extractFunctionSource(appSource, "cardHtml");
  assert.doesNotMatch(genericCardSource, /data-detail-context|analyticsContext/);

  console.log("analytics client: default-off gate, sessions, retry, recommendation lifecycle, contract, privacy passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
