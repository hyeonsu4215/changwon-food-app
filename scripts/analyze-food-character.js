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
  const rank = (index) => results.map((result) => result.picks[index].rank);
  const rank2 = rank(1);
  const rank3 = rank(2);
  return {
    averageRank1: average(rank(0)),
    averageRank2: average(rank2),
    averageRank3: average(rank3),
    medianRank2: percentile(rank2, 0.5),
    medianRank3: percentile(rank3, 0.5),
    p90Rank3: percentile(rank3, 0.9),
    worstRank3: Math.max(...rank3),
    averageDistinctRestaurants: average(results.map((result) => result.distinctRestaurants)),
    averageDistinctCharacters: average(results.map((result) => result.distinctCharacters)),
    averageDistinctPrimaryCharacters: average(results.map((result) => result.distinctPrimaryCharacters)),
    threeDistinctRestaurantsRate: results.filter((result) => result.distinctRestaurants === 3).length / results.length,
    threeDistinctCharactersRate: results.filter((result) => result.distinctCharacters === 3).length / results.length,
    threeDistinctPrimaryCharactersRate: results.filter((result) => result.distinctPrimaryCharacters === 3).length / results.length,
  };
}

function buildDiscoveryComparison({ seeds = 100 } = {}) {
  const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const data = loadFoodData();
  const approved = loadApprovedCharacters();
  const foodCharacterRuntime = loadFoodCharacterRuntime(appSource);
  const discoveryRuntime = loadDiscoveryRuntime(appSource);
  const restaurantsById = new Map(data.restaurants.map((restaurant) => [restaurant.id, restaurant]));
  const location = { lat: 35.24235, lng: 128.68965 };
  const modes = {
    old: (menu) => oldRuntimeFoodCharacter(menu),
    explicit: (menu) => approved.get(menu.id),
    fallback: (menu) => foodCharacterRuntime.classifyFoodCharacterFallback(menu).value,
  };
  const results = Object.fromEntries(Object.keys(modes).map((mode) => [mode, []]));

  for (let seed = 1; seed <= seeds; seed += 1) {
    const state = { discoverySeed: seed };
    const seededNoise = discoveryRuntime.seededNoiseFactory(state);
    const score = discoveryRuntime.discoveryScore(seededNoise);
    const sorted = data.menus
      .filter((menu) => menu.available)
      .map((menu) => {
        const restaurant = restaurantsById.get(menu.restaurantId);
        const item = {
          ...menu,
          restaurant,
          distance: restaurant ? discoveryRuntime.haversine(location, restaurant) : Infinity,
          openNow: true,
          weatherBoost: null,
        };
        return { ...item, discoveryScore: score(item) };
      })
      .sort((left, right) => left.discoveryScore - right.discoveryScore);
    const rankById = new Map(sorted.map((item, index) => [item.id, index + 1]));

    Object.entries(modes).forEach(([mode, getCharacter]) => {
      const candidates = sorted.map((item) => ({ ...item, discoveryCharacter: getCharacter(item) }));
      const selected = discoveryRuntime.selectDiscoveryRecommendations(candidates);
      const picks = selected.map((item) => ({
        id: item.id,
        name: item.name,
        restaurant: item.restaurantName || item.restaurant?.name || "",
        character: item.discoveryCharacter,
        rank: rankById.get(item.id),
      }));
      results[mode].push({
        seed,
        picks,
        distinctRestaurants: new Set(picks.map((item) => item.restaurant)).size,
        distinctCharacters: new Set(picks.map((item) => item.character)).size,
        distinctPrimaryCharacters: new Set(
          picks.map((item) => item.character).filter((character) => PRIMARY_VALUES.includes(character)),
        ).size,
      });
    });
  }

  return {
    summaries: Object.fromEntries(Object.entries(results).map(([mode, rows]) => [mode, summarizeSeedResults(rows)])),
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

function printAnalysis() {
  const audit = buildClassificationAudit();
  const discovery = buildDiscoveryComparison();
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
  console.log("DISCOVERY_SUMMARIES");
  console.log(JSON.stringify(discovery.summaries, null, 2));
  console.log("REPRESENTATIVE_SEEDS");
  console.log(JSON.stringify(discovery.representativeSeeds, null, 2));
}

if (require.main === module) printAnalysis();

module.exports = Object.freeze({
  PRIMARY_VALUES,
  extractFunctionSource,
  loadFoodCharacterRuntime,
  loadDbMenuToApp,
  loadDiscoveryRuntime,
  loadFoodData,
  loadApprovedCharacters,
  oldRuntimeFoodCharacter,
  buildClassificationAudit,
  buildDiscoveryComparison,
});
