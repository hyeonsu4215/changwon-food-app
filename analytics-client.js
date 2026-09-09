(function attachMukjjiAnalytics(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MukjjiAnalytics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMukjjiAnalyticsApi(root) {
  "use strict";

  const ANALYTICS_COLLECTION_ENABLED = true;
  const ANALYTICS_PRODUCTION_HOSTNAMES = Object.freeze(["changwon-food-app.vercel.app"]);
  const ACQUISITION_SOURCES = Object.freeze([
    "direct",
    "everytime",
    "kakao",
    "instagram",
    "poster_qr",
    "share",
    "internal_test",
    "other",
  ]);
  const ACQUISITION_SOURCE_VALUES = new Set(ACQUISITION_SOURCES);
  const RPC_FUNCTION_NAME = "log_analytics_event";
  const RPC_PARAMETER_NAMES = Object.freeze([
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
    "p_acquisition_source",
    "p_is_returning",
    "p_return_gap",
    "p_first_acquisition_source",
  ]);
  const EVENT_NAMES = Object.freeze([
    "session_start",
    "recommendation_shown",
    "recommendation_refresh",
    "menu_card_open",
    "map_open",
    "share_recommendation",
    "recommendation_error",
    "eaten_record_added",
  ]);
  const RECOMMENDATION_CONTEXTS = new Set(["discovery", "personalized", "shared_pick"]);
  const SOURCE_CONTEXTS = new Set([...RECOMMENDATION_CONTEXTS, "search"]);
  const ERROR_CODES = Object.freeze({
    INSUFFICIENT_CANDIDATES: "insufficient_candidates",
    INVALID_RESULT: "invalid_result",
    DATA_UNAVAILABLE: "data_unavailable",
    UNKNOWN: "unknown",
  });
  const ERROR_CODE_VALUES = new Set(Object.values(ERROR_CODES));
  const SHARE_METHODS = new Set(["web_share", "clipboard"]);
  const SESSION_ID_KEY = "mukjjiAnalyticsSessionIdV1";
  const LAST_ACTIVITY_KEY = "mukjjiAnalyticsLastActivityAtV1";
  const VISIT_HISTORY_KEY = "changwonFoodVisitHistoryV1";
  const RETURN_GAPS = Object.freeze(["same_day", "1d", "2_3d", "4_7d", "8_30d", "31d_plus"]);
  const RETURN_GAP_VALUES = new Set(RETURN_GAPS);
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 2500;
  const SEOUL_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const UNMEASURED_RETURN_METADATA = Object.freeze({
    isReturning: null,
    returnGap: null,
    firstAcquisitionSource: null,
  });

  function isAnalyticsRuntimeEnabled(locationValue, collectionEnabled = ANALYTICS_COLLECTION_ENABLED) {
    if (collectionEnabled !== true) return false;
    try {
      const runtimeLocation = arguments.length > 0 ? locationValue : root?.location;
      return ANALYTICS_PRODUCTION_HOSTNAMES.includes(runtimeLocation?.hostname);
    } catch {
      return false;
    }
  }

  function getAcquisitionSource(locationValue) {
    try {
      const runtimeLocation = arguments.length > 0 ? locationValue : root?.location;
      if (!runtimeLocation) return "direct";
      let search = runtimeLocation.search;
      if (typeof search !== "string") {
        if (typeof runtimeLocation.href !== "string") return "direct";
        search = new URL(runtimeLocation.href, "https://changwon-food-app.vercel.app/").search;
      }
      const params = new URLSearchParams(search);
      if (!params.has("src")) return "direct";
      const normalized = String(params.get("src") ?? "").trim().toLowerCase();
      return ACQUISITION_SOURCE_VALUES.has(normalized) ? normalized : "other";
    } catch {
      return "direct";
    }
  }

  function secureUuid(cryptoApi) {
    if (typeof cryptoApi?.randomUUID === "function") {
      try {
        return cryptoApi.randomUUID();
      } catch {
        // Continue to the secure getRandomValues fallback.
      }
    }
    if (typeof cryptoApi?.getRandomValues !== "function") return null;
    try {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
    } catch {
      return null;
    }
  }

  function getSeoulDateString(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = Object.fromEntries(
      SEOUL_DATE_FORMATTER.formatToParts(date).map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function calendarDateOrdinal(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const ordinal = Date.UTC(year, month - 1, day);
    const parsed = new Date(ordinal);
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) return null;
    return ordinal;
  }

  function calendarDayDifference(fromDate, toDate) {
    const from = calendarDateOrdinal(fromDate);
    const to = calendarDateOrdinal(toDate);
    if (from === null || to === null) return null;
    return (to - from) / (24 * 60 * 60 * 1000);
  }

  function classifyReturnGap(dayDifference) {
    if (!Number.isInteger(dayDifference) || dayDifference < 0) return null;
    if (dayDifference === 0) return "same_day";
    if (dayDifference === 1) return "1d";
    if (dayDifference <= 3) return "2_3d";
    if (dayDifference <= 7) return "4_7d";
    if (dayDifference <= 30) return "8_30d";
    return "31d_plus";
  }

  function createVisitBaseline(today, acquisitionSource) {
    return {
      firstVisitDate: today,
      lastVisitDate: today,
      firstAcquisitionSource: acquisitionSource,
    };
  }

  function isValidVisitHistory(history, today) {
    if (!history || typeof history !== "object" || Array.isArray(history)) return false;
    const keys = Object.keys(history).sort();
    if (keys.join(",") !== "firstAcquisitionSource,firstVisitDate,lastVisitDate") return false;
    if (!ACQUISITION_SOURCE_VALUES.has(history.firstAcquisitionSource)) return false;
    const firstToLast = calendarDayDifference(history.firstVisitDate, history.lastVisitDate);
    const lastToToday = calendarDayDifference(history.lastVisitDate, today);
    return firstToLast !== null && firstToLast >= 0 && lastToToday !== null && lastToToday >= 0;
  }

  function writeVisitHistory(storage, history) {
    try {
      if (!storage) return false;
      storage.setItem(VISIT_HISTORY_KEY, JSON.stringify(history));
      return true;
    } catch {
      return false;
    }
  }

  function prepareVisitHistory(storage, acquisitionSource, today) {
    if (!ACQUISITION_SOURCE_VALUES.has(acquisitionSource) || calendarDateOrdinal(today) === null) {
      return UNMEASURED_RETURN_METADATA;
    }

    let rawHistory;
    try {
      if (!storage) return UNMEASURED_RETURN_METADATA;
      rawHistory = storage.getItem(VISIT_HISTORY_KEY);
    } catch {
      return UNMEASURED_RETURN_METADATA;
    }

    const baseline = createVisitBaseline(today, acquisitionSource);
    if (rawHistory === null) {
      if (!writeVisitHistory(storage, baseline)) return UNMEASURED_RETURN_METADATA;
      return Object.freeze({
        isReturning: false,
        returnGap: null,
        firstAcquisitionSource: acquisitionSource,
      });
    }

    let history;
    try {
      history = JSON.parse(rawHistory);
    } catch {
      writeVisitHistory(storage, baseline);
      return UNMEASURED_RETURN_METADATA;
    }
    if (!isValidVisitHistory(history, today)) {
      writeVisitHistory(storage, baseline);
      return UNMEASURED_RETURN_METADATA;
    }

    const returnGap = classifyReturnGap(calendarDayDifference(history.lastVisitDate, today));
    const nextHistory = {
      firstVisitDate: history.firstVisitDate,
      lastVisitDate: today,
      firstAcquisitionSource: history.firstAcquisitionSource,
    };
    if (!returnGap || !writeVisitHistory(storage, nextHistory)) return UNMEASURED_RETURN_METADATA;
    return Object.freeze({
      isReturning: true,
      returnGap,
      firstAcquisitionSource: history.firstAcquisitionSource,
    });
  }

  function recommendationItem(item, position) {
    const menuId = String(item?.menuId ?? item?.id ?? "").trim();
    const restaurantId = String(item?.restaurantId ?? item?.restaurant?.id ?? "").trim();
    if (!menuId || !restaurantId) return null;
    return Object.freeze({ menuId, restaurantId, position });
  }

  function buildRpcParameters(event) {
    const params = {
      p_event_id: event.eventId,
      p_event_name: event.eventName,
      p_occurred_at: event.occurredAt,
      p_session_id: event.sessionId,
    };
    const add = (key, value) => {
      if (value !== null && value !== undefined) params[key] = value;
    };

    add("p_recommendation_id", event.recommendationId);
    add("p_restaurant_id", event.restaurantId);
    add("p_menu_id", event.menuId);
    add("p_position", event.position);
    add("p_source_context", event.sourceContext);
    add("p_error_code", event.errorCode);
    add("p_item_count", event.itemCount);
    add("p_share_method", event.shareMethod);
    add("p_acquisition_source", event.acquisitionSource);
    if (event.eventName === "session_start") {
      const validFirstVisit =
        event.isReturning === false &&
        event.returnGap == null &&
        ACQUISITION_SOURCE_VALUES.has(event.firstAcquisitionSource) &&
        event.firstAcquisitionSource === event.acquisitionSource;
      const validReturnVisit =
        event.isReturning === true &&
        RETURN_GAP_VALUES.has(event.returnGap) &&
        ACQUISITION_SOURCE_VALUES.has(event.firstAcquisitionSource);
      const validUnmeasured =
        event.isReturning == null &&
        event.returnGap == null &&
        event.firstAcquisitionSource == null;
      const metadata = validFirstVisit || validReturnVisit || validUnmeasured
        ? event
        : UNMEASURED_RETURN_METADATA;
      params.p_is_returning = metadata.isReturning ?? null;
      params.p_return_gap = metadata.returnGap ?? null;
      params.p_first_acquisition_source = metadata.firstAcquisitionSource ?? null;
    }
    return params;
  }

  function createAnalyticsClient(options = {}) {
    const enabled = options.enabled === true;
    const storage = options.sessionStorage;
    const visitStorage = options.localStorage;
    const cryptoApi = options.crypto;
    const now = options.now || (() => Date.now());
    const getSupabaseClient = options.getSupabaseClient || (() => null);
    const onLogicalEvent = options.onLogicalEvent || (() => {});
    const setTimer = options.setTimeout || setTimeout;
    const clearTimer = options.clearTimeout || clearTimeout;
    const requestTimeoutMs = options.requestTimeoutMs || REQUEST_TIMEOUT_MS;
    const acquisitionSource = ACQUISITION_SOURCE_VALUES.has(options.acquisitionSource)
      ? options.acquisitionSource
      : getAcquisitionSource(options.location);
    let currentRecommendation = null;
    const shownRecommendationIds = new Set();
    let returnMetadataSessionId = null;
    let returnMetadata = UNMEASURED_RETURN_METADATA;

    function readSession() {
      try {
        const sessionId = storage?.getItem(SESSION_ID_KEY);
        const lastActivityAt = Number(storage?.getItem(LAST_ACTIVITY_KEY));
        if (!sessionId || !Number.isFinite(lastActivityAt)) return null;
        return { sessionId, lastActivityAt };
      } catch {
        return null;
      }
    }

    function writeSession(sessionId, activityAt) {
      try {
        if (!storage) return false;
        storage.setItem(SESSION_ID_KEY, sessionId);
        storage.setItem(LAST_ACTIVITY_KEY, String(activityAt));
        return true;
      } catch {
        return false;
      }
    }

    function ensureSession() {
      const activityAt = now();
      const saved = readSession();
      if (saved && activityAt - saved.lastActivityAt < SESSION_TIMEOUT_MS) {
        if (!writeSession(saved.sessionId, activityAt)) return null;
        return { sessionId: saved.sessionId, isNew: false };
      }
      const sessionId = secureUuid(cryptoApi);
      if (!sessionId || !writeSession(sessionId, activityAt)) return null;
      return { sessionId, isNew: true };
    }

    function withTimeout(promise) {
      let timerId;
      const timeout = new Promise((_, reject) => {
        timerId = setTimer(() => reject(new Error("analytics_timeout")), requestTimeoutMs);
      });
      return Promise.race([promise, timeout]).finally(() => clearTimer(timerId));
    }

    async function invokeRpc(params) {
      const client = await getSupabaseClient();
      if (!client || typeof client.rpc !== "function") throw new Error("analytics_client_unavailable");
      const result = await withTimeout(Promise.resolve(client.rpc(RPC_FUNCTION_NAME, params)));
      if (result?.error) throw result.error;
      if (result?.data !== true && result?.data !== false) {
        throw new Error("analytics_invalid_response");
      }
      return result.data;
    }

    function dispatch(event) {
      try {
        onLogicalEvent(Object.freeze({ ...event }));
      } catch {
        // Test/debug hooks cannot affect the user flow.
      }
      if (!enabled) return Promise.resolve(false);
      const params = buildRpcParameters(event);
      return (async () => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            return await invokeRpc(params);
          } catch {
            // One in-memory retry reuses the same event identity and timestamp.
          }
        }
        return false;
      })().catch(() => false);
    }

    function createEvent(eventName, sessionId, fields = {}) {
      const eventId = secureUuid(cryptoApi);
      if (!eventId || !EVENT_NAMES.includes(eventName)) return null;
      return {
        eventId,
        eventName,
        occurredAt: new Date(now()).toISOString(),
        sessionId,
        ...fields,
      };
    }

    function getSessionReturnMetadata(sessionId) {
      if (returnMetadataSessionId === sessionId) return returnMetadata;
      returnMetadataSessionId = sessionId;
      returnMetadata = prepareVisitHistory(
        visitStorage,
        acquisitionSource,
        getSeoulDateString(new Date(now())),
      );
      return returnMetadata;
    }

    function sessionStartEvent(sessionId) {
      const event = createEvent("session_start", sessionId, {
        acquisitionSource,
        ...getSessionReturnMetadata(sessionId),
      });
      return event ? dispatch(event) : Promise.resolve(false);
    }

    function track(eventName, fields = {}) {
      const session = ensureSession();
      if (!session) return Promise.resolve(false);
      if (session.isNew && eventName !== "session_start") sessionStartEvent(session.sessionId);
      const event = createEvent(eventName, session.sessionId, fields);
      return event ? dispatch(event) : Promise.resolve(false);
    }

    function initialize() {
      const session = ensureSession();
      if (!session || !session.isNew) return Promise.resolve(false);
      return sessionStartEvent(session.sessionId);
    }

    function startRecommendation(items, sourceContext) {
      const normalized = Array.isArray(items)
        ? items.map((item, index) => recommendationItem(item, index + 1))
        : [];
      const distinctMenuIds = new Set(normalized.filter(Boolean).map((item) => item.menuId));
      if (
        normalized.length !== 3 ||
        normalized.some((item) => !item) ||
        distinctMenuIds.size !== 3 ||
        !RECOMMENDATION_CONTEXTS.has(sourceContext)
      ) {
        currentRecommendation = null;
        return null;
      }
      const recommendationId = secureUuid(cryptoApi);
      if (!recommendationId) {
        currentRecommendation = null;
        return null;
      }
      currentRecommendation = Object.freeze({
        recommendationId,
        sourceContext,
        items: Object.freeze(normalized),
      });
      return recommendationId;
    }

    function clearRecommendation() {
      currentRecommendation = null;
    }

    function recordRecommendationShown() {
      const recommendation = currentRecommendation;
      if (!recommendation || shownRecommendationIds.has(recommendation.recommendationId)) return Promise.resolve([]);
      shownRecommendationIds.add(recommendation.recommendationId);
      return Promise.all(recommendation.items.map((item) => track("recommendation_shown", {
        recommendationId: recommendation.recommendationId,
        restaurantId: item.restaurantId,
        menuId: item.menuId,
        position: item.position,
        sourceContext: recommendation.sourceContext,
      })));
    }

    function recordRecommendationRefresh() {
      if (!currentRecommendation) return Promise.resolve(false);
      return track("recommendation_refresh", {
        recommendationId: currentRecommendation.recommendationId,
        sourceContext: currentRecommendation.sourceContext,
      });
    }

    function recommendationInteraction(menuId) {
      const recommendation = currentRecommendation;
      if (!recommendation) return null;
      const item = recommendation.items.find((candidate) => candidate.menuId === String(menuId));
      return item ? { recommendation, item } : null;
    }

    function recordMenuCardOpen({ menuId, restaurantId, sourceContext }) {
      if (sourceContext === "search") {
        if (!menuId || !restaurantId) return Promise.resolve(false);
        return track("menu_card_open", { menuId, restaurantId, sourceContext: "search" });
      }
      const match = recommendationInteraction(menuId);
      if (!match || match.recommendation.sourceContext !== sourceContext) return Promise.resolve(false);
      return track("menu_card_open", {
        recommendationId: match.recommendation.recommendationId,
        restaurantId: match.item.restaurantId,
        menuId: match.item.menuId,
        position: match.item.position,
        sourceContext: match.recommendation.sourceContext,
      });
    }

    function recordMapOpen({ menuId, restaurantId, sourceContext }) {
      if (sourceContext === "search") {
        if (!restaurantId) return Promise.resolve(false);
        return track("map_open", {
          restaurantId,
          ...(menuId ? { menuId } : {}),
          sourceContext: "search",
        });
      }
      const match = recommendationInteraction(menuId);
      if (!match || match.recommendation.sourceContext !== sourceContext) return Promise.resolve(false);
      return track("map_open", {
        recommendationId: match.recommendation.recommendationId,
        restaurantId: match.item.restaurantId,
        menuId: match.item.menuId,
        position: match.item.position,
        sourceContext: match.recommendation.sourceContext,
      });
    }

    function recordShareSuccess(shareMethod) {
      if (!currentRecommendation || !SHARE_METHODS.has(shareMethod)) return Promise.resolve(false);
      return track("share_recommendation", {
        recommendationId: currentRecommendation.recommendationId,
        sourceContext: currentRecommendation.sourceContext,
        shareMethod,
      });
    }

    function recordRecommendationError({ sourceContext, errorCode, itemCount }) {
      if (!new Set(["discovery", "personalized"]).has(sourceContext) || !ERROR_CODE_VALUES.has(errorCode)) {
        return Promise.resolve(false);
      }
      const safeCount = Number.isInteger(itemCount) && itemCount >= 0 && itemCount <= 3 ? itemCount : null;
      return track("recommendation_error", {
        sourceContext,
        errorCode,
        ...(safeCount === null ? {} : { itemCount: safeCount }),
      });
    }

    function recordEatenRecordAdded({ menuId, restaurantId } = {}) {
      const safeMenuId = String(menuId ?? "").trim();
      const safeRestaurantId = String(restaurantId ?? "").trim();
      if (!safeMenuId || !safeRestaurantId) return Promise.resolve(false);
      return track("eaten_record_added", {
        restaurantId: safeRestaurantId,
        menuId: safeMenuId,
      });
    }

    return Object.freeze({
      initialize,
      startRecommendation,
      clearRecommendation,
      recordRecommendationShown,
      recordRecommendationRefresh,
      recordMenuCardOpen,
      recordMapOpen,
      recordShareSuccess,
      recordRecommendationError,
      recordEatenRecordAdded,
      getCurrentRecommendation: () => currentRecommendation,
    });
  }

  return Object.freeze({
    ANALYTICS_COLLECTION_ENABLED,
    ANALYTICS_PRODUCTION_HOSTNAMES,
    ACQUISITION_SOURCES,
    RPC_FUNCTION_NAME,
    RPC_PARAMETER_NAMES,
    EVENT_NAMES,
    ERROR_CODES,
    SESSION_ID_KEY,
    LAST_ACTIVITY_KEY,
    VISIT_HISTORY_KEY,
    RETURN_GAPS,
    SESSION_TIMEOUT_MS,
    REQUEST_TIMEOUT_MS,
    isAnalyticsRuntimeEnabled,
    getAcquisitionSource,
    secureUuid,
    getSeoulDateString,
    calendarDayDifference,
    classifyReturnGap,
    isValidVisitHistory,
    prepareVisitHistory,
    buildRpcParameters,
    createAnalyticsClient,
  });
});
