const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const PRIMARY_VALUES = Object.freeze([
  "rice-meal",
  "noodle-special",
  "hot-soup",
  "quick-snack",
  "main-dish",
]);
const HISTORICAL_FALLBACK_LOCATION = Object.freeze({ lat: 35.24235, lng: 128.68965 });
const DEFAULT_SEED_COUNT = 1000;
const SESSION_COUNT = 100;
const SETS_PER_SESSION = 10;

function extractFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`app.js function not found: ${name}`);
  let bodyStart = -1;
  let parameterDepth = 0;
  let signatureQuote = null;
  let signatureEscaped = false;
  let signatureLineComment = false;
  let signatureBlockComment = false;
  for (let index = source.indexOf("(", start); index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];
    if (signatureLineComment) {
      if (character === "\n") signatureLineComment = false;
      continue;
    }
    if (signatureBlockComment) {
      if (character === "*" && nextCharacter === "/") {
        signatureBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (signatureQuote) {
      if (signatureEscaped) signatureEscaped = false;
      else if (character === "\\") signatureEscaped = true;
      else if (character === signatureQuote) signatureQuote = null;
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      signatureLineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      signatureBlockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      signatureQuote = character;
      continue;
    }
    if (character === "(") parameterDepth += 1;
    else if (character === ")") parameterDepth -= 1;
    else if (character === "{" && parameterDepth === 0) {
      bodyStart = index;
      break;
    }
  }
  if (bodyStart < 0) throw new Error(`app.js function body not found: ${name}`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`app.js function is incomplete: ${name}`);
}

function loadFoodCharacterRuntime(appSource = fs.readFileSync(path.join(root, "app.js"), "utf8")) {
  const blockStart = appSource.indexOf("const PRIMARY_FOOD_CHARACTERS");
  const foodCharacterSource = extractFunctionSource(appSource, "foodCharacter");
  if (blockStart < 0) throw new Error("app.js Food Character constants not found");
  const blockEnd = appSource.indexOf(foodCharacterSource) + foodCharacterSource.length;
  return new Function(
    `${appSource.slice(blockStart, blockEnd)}; return { PRIMARY_FOOD_CHARACTERS, classifyFoodCharacterFallback, foodCharacter };`,
  )();
}

function loadDbMenuToApp(appSource = fs.readFileSync(path.join(root, "app.js"), "utf8")) {
  return new Function(`${extractFunctionSource(appSource, "dbMenuToApp")}; return dbMenuToApp;`)();
}

function loadDiscoveryRuntime(appSource = fs.readFileSync(path.join(root, "app.js"), "utf8")) {
  const selectorNames = [
    "restaurantKey",
    "addDiscoveryCandidates",
    "fillDiscoveryCandidates",
    "selectDiscoveryRecommendations",
  ];
  const selectorSource = selectorNames.map((name) => extractFunctionSource(appSource, name)).join("\n");
  const selectDiscoveryRecommendations = new Function(
    `${selectorSource}; return selectDiscoveryRecommendations;`,
  )();
  const discoveryScoreSource = extractFunctionSource(appSource, "discoveryScore");
  const discoveryScore = new Function(
    "seededNoise",
    `${discoveryScoreSource}; return discoveryScore;`,
  );
  const stableHashSource = extractFunctionSource(appSource, "stableHash");
  const seededNoiseSource = extractFunctionSource(appSource, "seededNoise");
  const seededNoiseFactory = new Function(
    "state",
    `${stableHashSource}\n${seededNoiseSource}; return seededNoise;`,
  );
  const getDistanceMetersSource = extractFunctionSource(appSource, "getDistanceMeters");
  const haversineSource = extractFunctionSource(appSource, "haversine");
  const haversine = new Function(
    `${getDistanceMetersSource}\n${haversineSource}; return haversine;`,
  )();
  return { selectDiscoveryRecommendations, discoveryScore, seededNoiseFactory, haversine };
}

function loadFoodData(dataFile = path.join(root, "data.js")) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(dataFile, "utf8"), sandbox, { filename: dataFile });
  return sandbox.window.CHANGWON_FOOD_DATA;
}

function loadApprovedCharacters(file = path.join(root, "docs", "food-character", "food-character-approved-candidate.json")) {
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  return new Map(rows.map((row) => [row.id, row.food_character]));
}

function loadFallbackLocation(appSource = fs.readFileSync(path.join(root, "app.js"), "utf8")) {
  const match = appSource.match(/const FALLBACK_LOCATION\s*=\s*(\{[^;]+\});/);
  if (!match) throw new Error("app.js FALLBACK_LOCATION not found");
  const location = new Function(`return (${match[1]});`)();
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
    throw new Error("app.js FALLBACK_LOCATION is invalid");
  }
  return location;
}

function oldRuntimeFoodCharacter(item = {}) {
  const text = `${item.name || ""} ${item.category || ""} ${(item.tags || []).join(" ")}`;
  const normalized = text.replace(/\s+/g, "");
  const has = (words) => words.some((word) => normalized.includes(word.replace(/\s+/g, "")));
  if (has(["냉면", "밀면", "냉국수", "메밀국수", "열무국수", "샐러드", "콩국수", "소바", "모밀"])) return "cool-light";
  if (has(["순두부", "김치찌개", "육개장", "찌개", "국밥", "탕", "해장", "마라", "라멘", "우동", "칼국수", "찜"])) return "hot-soup";
  if (has(["덮밥", "볶음밥", "비빔밥", "정식", "백반", "컵밥", "도시락", "밥"])) return "rice-meal";
  if (has(["김밥", "떡볶이", "튀김", "분식", "핫도그", "햄버거", "버거", "샌드위치"])) return "quick-snack";
  if (has(["면", "국수", "파스타", "쌀국수", "짜장", "짬뽕", "라면"])) return "noodle-special";
  return item.category || "other";
}

function countBy(items, getValue) {
  return items.reduce((counts, item) => {
    const value = getValue(item);
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function buildClassificationAudit(data = loadFoodData(), approved = loadApprovedCharacters(), runtime = loadFoodCharacterRuntime()) {
  const restaurantsById = new Map(data.restaurants.map((restaurant) => [restaurant.id, restaurant]));
  const items = data.menus.map((menu) => {
    const diagnostic = runtime.classifyFoodCharacterFallback(menu);
    const explicit = approved.get(menu.id);
    const oldCharacter = oldRuntimeFoodCharacter(menu);
    return {
      id: menu.id,
      restaurant: menu.restaurantName || restaurantsById.get(menu.restaurantId)?.name || "",
      name: menu.name,
      category: menu.category,
      tags: [...(menu.tags || [])],
      explicit,
      oldCharacter,
      fallbackCharacter: diagnostic.value,
      oldMatchesExplicit: oldCharacter === explicit,
      fallbackMatchesExplicit: diagnostic.value === explicit,
      matchedRule: diagnostic.matchedRule,
      fallbackSource: diagnostic.source,
    };
  });
  const oldMatches = items.filter((item) => item.oldMatchesExplicit).length;
  const fallbackMatches = items.filter((item) => item.fallbackMatchesExplicit).length;
  return {
    items,
    stats: {
      total: items.length,
      explicitDistribution: countBy(items, (item) => item.explicit),
      oldDistribution: countBy(items, (item) => item.oldCharacter),
      fallbackDistribution: countBy(items, (item) => item.fallbackCharacter),
      oldMatches,
      oldMismatches: items.length - oldMatches,
      oldAccuracy: oldMatches / items.length,
      fallbackMatches,
      fallbackMismatches: items.length - fallbackMatches,
      fallbackAccuracy: fallbackMatches / items.length,
    },
  };
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarizeSeedResults(results) {
  const rank = (index) => results.map((result) => result.picks[index]?.rank).filter(Number.isFinite);
  const rank2 = rank(1);
  const rank3 = rank(2);
  const tailRisk = Object.fromEntries([10, 15, 20, 30, 40].map((threshold) => {
    const count = rank3.filter((value) => value > threshold).length;
    return [`rank3Over${threshold}`, { count, rate: count / results.length }];
  }));
  return {
    averageRank1: average(rank(0)),
    averageRank2: average(rank2),
    averageRank3: average(rank3),
    medianRank2: percentile(rank2, 0.5),
    medianRank3: percentile(rank3, 0.5),
    p90Rank3: percentile(rank3, 0.9),
    p95Rank3: percentile(rank3, 0.95),
    p99Rank3: percentile(rank3, 0.99),
    worstRank3: Math.max(...rank3),
    averageDistinctRestaurants: average(results.map((result) => result.distinctRestaurants)),
    averageDistinctCharacters: average(results.map((result) => result.distinctCharacters)),
    averageDistinctPrimaryCharacters: average(results.map((result) => result.distinctPrimaryCharacters)),
    threeDistinctRestaurantsRate: results.filter((result) => result.distinctRestaurants === 3).length / results.length,
    threeDistinctCharactersRate: results.filter((result) => result.distinctCharacters === 3).length / results.length,
    threeDistinctPrimaryCharactersRate: results.filter((result) => result.distinctPrimaryCharacters === 3).length / results.length,
    averageSelectedDistance: average(results.flatMap((result) => result.picks.map((pick) => pick.distance))),
    tailRisk,
    errors: {
      emptyRecommendation: results.filter((result) => result.errors.emptyRecommendation).length,
      duplicateMenuId: results.filter((result) => result.errors.duplicateMenuId).length,
      invalidMenu: results.filter((result) => result.errors.invalidMenu).length,
      selectorFailure: results.filter((result) => result.errors.selectorFailure).length,
    },
  };
}

function createAnalysisContext() {
  const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const data = loadFoodData();
  const approved = loadApprovedCharacters();
  const foodCharacterRuntime = loadFoodCharacterRuntime(appSource);
  const discoveryRuntime = loadDiscoveryRuntime(appSource);
  const restaurantsById = new Map(data.restaurants.map((restaurant) => [restaurant.id, restaurant]));
  return { appSource, data, approved, foodCharacterRuntime, discoveryRuntime, restaurantsById };
}

function buildScoredCandidates(context, seed, location) {
  const state = { discoverySeed: seed };
  const seededNoise = context.discoveryRuntime.seededNoiseFactory(state);
  const score = context.discoveryRuntime.discoveryScore(seededNoise);
  return context.data.menus
    .filter((menu) => menu.available)
    .map((menu) => {
      const restaurant = context.restaurantsById.get(menu.restaurantId);
      const item = {
        ...menu,
        restaurant,
        distance: restaurant ? context.discoveryRuntime.haversine(location, restaurant) : Infinity,
        openNow: true,
        weatherBoost: null,
      };
      return { ...item, discoveryScore: score(item) };
    })
    .sort((left, right) => left.discoveryScore - right.discoveryScore)
    .map((item, index) => ({ ...item, originalRank: index + 1 }));
}

function resultForCandidates(context, seed, candidates, seenIds = new Set(), previousIds = new Set()) {
  const selected = context.discoveryRuntime.selectDiscoveryRecommendations(candidates, { seenIds, previousIds });
  const picks = selected.map((item) => ({
    id: item.id,
    name: item.name,
    restaurantId: item.restaurantId,
    restaurant: item.restaurantName || item.restaurant?.name || "",
    character: item.discoveryCharacter,
    rank: item.originalRank,
    distance: item.distance,
  }));
  const expectedCount = Math.min(3, candidates.length);
  const selectedIds = new Set(picks.map((item) => item.id));
  const validIds = new Set(candidates.map((item) => item.id));
  return {
    seed,
    picks,
    topCandidates: candidates.slice(0, 15).map((item) => ({
      rank: item.originalRank,
      id: item.id,
      name: item.name,
      restaurantId: item.restaurantId,
      restaurant: item.restaurantName || item.restaurant?.name || "",
      character: item.discoveryCharacter,
      selected: selectedIds.has(item.id),
    })),
    distinctRestaurants: new Set(picks.map((item) => item.restaurantId || item.restaurant)).size,
    distinctCharacters: new Set(picks.map((item) => item.character)).size,
    distinctPrimaryCharacters: new Set(
      picks.map((item) => item.character).filter((character) => PRIMARY_VALUES.includes(character)),
    ).size,
    errors: {
      emptyRecommendation: candidates.length > 0 && picks.length === 0,
      duplicateMenuId: selectedIds.size !== picks.length,
      invalidMenu: picks.some((item) => !validIds.has(item.id) || !Number.isFinite(item.rank)),
      selectorFailure: picks.length !== expectedCount,
    },
  };
}

function runIndependentModes(context, { seeds, location, modes }) {
  const results = Object.fromEntries(Object.keys(modes).map((mode) => [mode, []]));

  for (let seed = 1; seed <= seeds; seed += 1) {
    const sorted = buildScoredCandidates(context, seed, location);

    Object.entries(modes).forEach(([mode, getCharacter]) => {
      const candidates = sorted.map((item) => ({ ...item, discoveryCharacter: getCharacter(item) }));
      results[mode].push(resultForCandidates(context, seed, candidates));
    });
  }
  return results;
}

function countExposure(rows, getKey) {
  const counts = new Map();
  rows.forEach((row) => row.picks.forEach((pick) => {
    const key = getKey(pick);
    counts.set(key, (counts.get(key) || 0) + 1);
  }));
  return counts;
}

function summarizeExposure(rows, context) {
  const menuCounts = countExposure(rows, (pick) => pick.id);
  const restaurantCounts = countExposure(rows, (pick) => pick.restaurantId || pick.restaurant);
  const characterCounts = countExposure(rows, (pick) => pick.character);
  const totalSlots = rows.reduce((sum, row) => sum + row.picks.length, 0);
  const menusById = new Map(context.data.menus.map((menu) => [menu.id, menu]));
  const allMenus = context.data.menus.filter((menu) => menu.available).map((menu) => {
    const restaurant = context.restaurantsById.get(menu.restaurantId);
    return {
      id: menu.id,
      name: menu.name,
      restaurant: menu.restaurantName || restaurant?.name || "",
      character: context.approved.get(menu.id),
      appearances: menuCounts.get(menu.id) || 0,
    };
  });
  const allRestaurants = context.data.restaurants.map((restaurant) => ({
    id: restaurant.id,
    name: restaurant.name,
    appearances: restaurantCounts.get(restaurant.id) || 0,
  }));
  const descending = (left, right) => right.appearances - left.appearances || left.id.localeCompare(right.id);
  const ascending = (left, right) => left.appearances - right.appearances || left.id.localeCompare(right.id);
  const characterExposure = Object.fromEntries(
    [...new Set([...PRIMARY_VALUES, ...characterCounts.keys()])].map((character) => {
      const count = characterCounts.get(character) || 0;
      return [character, { count, rate: totalSlots ? count / totalSlots : 0 }];
    }),
  );
  return {
    totalSlots,
    characterExposure,
    menus: {
      top10: [...allMenus].sort(descending).slice(0, 10),
      bottom10: allMenus.filter((item) => item.appearances > 0).sort(ascending).slice(0, 10),
      neverSelected: allMenus.filter((item) => item.appearances === 0),
      coverageCount: allMenus.filter((item) => item.appearances > 0).length,
      coverageRate: allMenus.filter((item) => item.appearances > 0).length / allMenus.length,
    },
    restaurants: {
      top10: [...allRestaurants].sort(descending).slice(0, 10),
      bottom10: allRestaurants.filter((item) => item.appearances > 0).sort(ascending).slice(0, 10),
      neverSelected: allRestaurants.filter((item) => item.appearances === 0),
      coverageCount: allRestaurants.filter((item) => item.appearances > 0).length,
      coverageRate: allRestaurants.filter((item) => item.appearances > 0).length / allRestaurants.length,
    },
    menuCounts: Object.fromEntries([...menuCounts.entries()].filter(([id]) => menusById.has(id))),
  };
}

function compareRank3(oldRows, explicitRows) {
  const counts = { improved: 0, same: 0, worse: 0 };
  const worseSeeds = [];
  explicitRows.forEach((row, index) => {
    const oldRow = oldRows[index];
    const oldRank = oldRow.picks[2]?.rank;
    const explicitRank = row.picks[2]?.rank;
    if (explicitRank < oldRank) counts.improved += 1;
    else if (explicitRank === oldRank) counts.same += 1;
    else {
      counts.worse += 1;
      if (worseSeeds.length < 20) {
        worseSeeds.push({ seed: row.seed, old: oldRow.picks, explicit: row.picks });
      }
    }
  });
  const total = explicitRows.length;
  return {
    ...counts,
    improvedRate: counts.improved / total,
    sameRate: counts.same / total,
    worseRate: counts.worse / total,
    worseSeeds,
  };
}

function compareExplicitFallback(explicitRows, fallbackRows) {
  const mismatches = [];
  let mismatchCount = 0;
  explicitRows.forEach((explicit, index) => {
    const fallback = fallbackRows[index];
    const explicitSignature = explicit.picks.map((pick) => [pick.id, pick.rank, pick.character]);
    const fallbackSignature = fallback.picks.map((pick) => [pick.id, pick.rank, pick.character]);
    if (JSON.stringify(explicitSignature) !== JSON.stringify(fallbackSignature)) {
      mismatchCount += 1;
      if (mismatches.length < 20) {
        mismatches.push({ seed: explicit.seed, explicit: explicit.picks, fallback: fallback.picks });
      }
    }
  });
  return { matches: explicitRows.length - mismatchCount, mismatches: mismatchCount, details: mismatches };
}

function explainExtremeRows(rows) {
  return [...rows]
    .sort((left, right) => right.picks[2].rank - left.picks[2].rank || left.seed - right.seed)
    .slice(0, 10)
    .map((row) => {
      const anchors = row.picks.slice(0, 2);
      const thirdRank = row.picks[2].rank;
      const reasonCounts = { restaurant: 0, character: 0, both: 0, other: 0 };
      const top15 = row.topCandidates.map((candidate) => {
        let reason = candidate.selected ? "selected" : "after-selection";
        if (!candidate.selected && candidate.rank < thirdRank) {
          const restaurantConflict = anchors.some(
            (pick) => (pick.restaurantId || pick.restaurant) === (candidate.restaurantId || candidate.restaurant),
          );
          const characterConflict = anchors.some((pick) => pick.character === candidate.character);
          reason = restaurantConflict && characterConflict
            ? "both"
            : restaurantConflict
              ? "restaurant"
              : characterConflict
                ? "character"
                : "other";
          reasonCounts[reason] += 1;
        }
        return { ...candidate, reason };
      });
      return { seed: row.seed, rank3: thirdRank, picks: row.picks, reasonCounts, top15 };
    });
}

function buildDiscoveryComparison({ seeds = DEFAULT_SEED_COUNT, location = loadFallbackLocation() } = {}) {
  const context = createAnalysisContext();
  const modes = {
    old: (menu) => oldRuntimeFoodCharacter(menu),
    explicit: (menu) => context.approved.get(menu.id),
    fallback: (menu) => context.foodCharacterRuntime.classifyFoodCharacterFallback(menu).value,
  };
  const results = runIndependentModes(context, { seeds, location, modes });

  return {
    seeds,
    location,
    summaries: Object.fromEntries(Object.entries(results).map(([mode, rows]) => [mode, summarizeSeedResults(rows)])),
    improvement: compareRank3(results.old, results.explicit),
    explicitFallbackParity: compareExplicitFallback(results.explicit, results.fallback),
    exposure: {
      old: summarizeExposure(results.old, context),
      explicit: summarizeExposure(results.explicit, context),
      fallback: summarizeExposure(results.fallback, context),
    },
    extremeExplicitSeeds: explainExtremeRows(results.explicit),
    representativeSeeds: [1, 2, 3, 25, 50, 100]
      .filter((seed) => seed <= seeds)
      .map((seed) => ({
        seed,
        old: results.old[seed - 1].picks,
        explicit: results.explicit[seed - 1].picks,
        fallback: results.fallback[seed - 1].picks,
      })),
  };
}

function summarizeNumberSeries(values) {
  return {
    average: average(values),
    median: percentile(values, 0.5),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function buildSessionAnalysis({ sessions = SESSION_COUNT, setsPerSession = SETS_PER_SESSION, location = loadFallbackLocation() } = {}) {
  const context = createAnalysisContext();
  const rows = [];
  const sessionRows = [];
  for (let session = 1; session <= sessions; session += 1) {
    const sorted = buildScoredCandidates(context, session, location);
    const candidates = sorted.map((item) => ({ ...item, discoveryCharacter: context.approved.get(item.id) }));
    const seenIds = new Set();
    let previousIds = new Set();
    const sessionPicks = [];
    for (let setIndex = 1; setIndex <= setsPerSession; setIndex += 1) {
      const result = resultForCandidates(context, session, candidates, seenIds, previousIds);
      const previousRestaurants = new Set(
        rows.at(-1)?.session === session ? rows.at(-1).picks.map((pick) => pick.restaurantId || pick.restaurant) : [],
      );
      result.picks.forEach((pick) => seenIds.add(pick.id));
      const previousMenuRepeats = result.picks.filter((pick) => previousIds.has(pick.id)).length;
      const previousRestaurantRepeats = result.picks.filter(
        (pick) => previousRestaurants.has(pick.restaurantId || pick.restaurant),
      ).length;
      previousIds = new Set(result.picks.map((pick) => pick.id));
      sessionPicks.push(...result.picks);
      rows.push({ ...result, session, setIndex, previousMenuRepeats, previousRestaurantRepeats });
    }
    sessionRows.push({
      session,
      uniqueMenus: new Set(sessionPicks.map((pick) => pick.id)).size,
      uniqueRestaurants: new Set(sessionPicks.map((pick) => pick.restaurantId || pick.restaurant)).size,
      primaryCharacterCoverage: new Set(sessionPicks.map((pick) => pick.character)).size,
    });
  }
  return {
    sessions,
    setsPerSession,
    totalSets: rows.length,
    successfulSets: rows.filter((row) => !Object.values(row.errors).some(Boolean)).length,
    failedSets: rows.filter((row) => Object.values(row.errors).some(Boolean)).length,
    duplicateMenuIdErrors: rows.filter((row) => row.errors.duplicateMenuId).length,
    averageDistinctRestaurants: average(rows.map((row) => row.distinctRestaurants)),
    threeDistinctRestaurantsRate: rows.filter((row) => row.distinctRestaurants === 3).length / rows.length,
    averageDistinctPrimaryCharacters: average(rows.map((row) => row.distinctPrimaryCharacters)),
    threeDistinctPrimaryCharactersRate: rows.filter((row) => row.distinctPrimaryCharacters === 3).length / rows.length,
    previousSetMenuRepeats: rows.reduce((sum, row) => sum + row.previousMenuRepeats, 0),
    previousSetRestaurantRepeats: rows.reduce((sum, row) => sum + row.previousRestaurantRepeats, 0),
    averagePreviousSetMenuRepeats: average(rows.map((row) => row.previousMenuRepeats)),
    averagePreviousSetRestaurantRepeats: average(rows.map((row) => row.previousRestaurantRepeats)),
    sessionUniqueMenus: summarizeNumberSeries(sessionRows.map((row) => row.uniqueMenus)),
    sessionUniqueRestaurants: summarizeNumberSeries(sessionRows.map((row) => row.uniqueRestaurants)),
    sessionPrimaryCharacterCoverage: summarizeNumberSeries(sessionRows.map((row) => row.primaryCharacterCoverage)),
    exposure: summarizeExposure(rows, context),
  };
}

function sameSet(left, right, getKey) {
  return [...left.picks.map(getKey)].sort().join("|") === [...right.picks.map(getKey)].sort().join("|");
}

function buildGateImpact({ seeds = DEFAULT_SEED_COUNT } = {}) {
  const context = createAnalysisContext();
  const newLocation = loadFallbackLocation(context.appSource);
  const modes = { explicit: (menu) => context.approved.get(menu.id) };
  const oldRows = runIndependentModes(context, {
    seeds,
    location: HISTORICAL_FALLBACK_LOCATION,
    modes,
  }).explicit;
  const newRows = runIndependentModes(context, { seeds, location: newLocation, modes }).explicit;
  const menuChangedCount = newRows.filter((row, index) => !sameSet(row, oldRows[index], (pick) => pick.id)).length;
  const restaurantChangedCount = newRows.filter(
    (row, index) => !sameSet(row, oldRows[index], (pick) => pick.restaurantId || pick.restaurant),
  ).length;
  const orderedPickChangedCount = newRows.filter((row, index) => (
    row.picks.map((pick) => pick.id).join("|") !== oldRows[index].picks.map((pick) => pick.id).join("|")
  )).length;
  const restaurantIndexes = [0, 4, 9, 19, 28].filter((index) => index < context.data.restaurants.length);
  const distanceExamples = restaurantIndexes.map((index) => {
    const restaurant = context.data.restaurants[index];
    const oldDistance = context.discoveryRuntime.haversine(HISTORICAL_FALLBACK_LOCATION, restaurant);
    const newDistance = context.discoveryRuntime.haversine(newLocation, restaurant);
    return {
      id: restaurant.id,
      name: restaurant.name,
      oldDistance,
      newDistance,
      delta: newDistance - oldDistance,
    };
  });
  return {
    seeds,
    oldLocation: HISTORICAL_FALLBACK_LOCATION,
    newLocation,
    gateDistance: context.discoveryRuntime.haversine(HISTORICAL_FALLBACK_LOCATION, newLocation),
    oldSummary: summarizeSeedResults(oldRows),
    newSummary: summarizeSeedResults(newRows),
    menuChangedCount,
    menuChangedRate: menuChangedCount / seeds,
    restaurantChangedCount,
    restaurantChangedRate: restaurantChangedCount / seeds,
    orderedPickChangedCount,
    orderedPickChangedRate: orderedPickChangedCount / seeds,
    oldTopMenus: summarizeExposure(oldRows, context).menus.top10,
    newTopMenus: summarizeExposure(newRows, context).menus.top10,
    distanceExamples,
  };
}

function printAnalysis() {
  const audit = buildClassificationAudit();
  const discovery = buildDiscoveryComparison();
  const sessions = buildSessionAnalysis();
  const gateImpact = buildGateImpact();
  console.log("CLASSIFICATION_STATS");
  console.log(JSON.stringify(audit.stats, null, 2));
  console.log("CLASSIFICATION_ITEMS");
  audit.items.forEach((item) => {
    console.log([
      item.id,
      item.restaurant,
      item.name,
      item.category,
      item.tags.join("|"),
      item.explicit,
      item.oldCharacter,
      item.fallbackCharacter,
      item.oldMatchesExplicit,
      item.fallbackMatchesExplicit,
      item.matchedRule,
      item.fallbackSource,
    ].join("\t"));
  });
  console.log("FALLBACK_MISMATCHES");
  audit.items.filter((item) => !item.fallbackMatchesExplicit).forEach((item) => {
    console.log([item.id, item.name, item.category, item.explicit, item.fallbackCharacter, item.matchedRule, item.fallbackSource].join("\t"));
  });
  console.log("DISCOVERY_ANALYSIS");
  console.log(JSON.stringify(discovery, null, 2));
  console.log("SESSION_ANALYSIS");
  console.log(JSON.stringify(sessions, null, 2));
  console.log("GATE_IMPACT");
  console.log(JSON.stringify(gateImpact, null, 2));
}

if (require.main === module) printAnalysis();

module.exports = Object.freeze({
  PRIMARY_VALUES,
  HISTORICAL_FALLBACK_LOCATION,
  DEFAULT_SEED_COUNT,
  SESSION_COUNT,
  SETS_PER_SESSION,
  extractFunctionSource,
  loadFoodCharacterRuntime,
  loadDbMenuToApp,
  loadDiscoveryRuntime,
  loadFoodData,
  loadApprovedCharacters,
  loadFallbackLocation,
  oldRuntimeFoodCharacter,
  buildClassificationAudit,
  buildDiscoveryComparison,
  buildSessionAnalysis,
  buildGateImpact,
});
