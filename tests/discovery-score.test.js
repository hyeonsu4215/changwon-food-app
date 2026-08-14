const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { extractFunctionSource, loadDiscoveryRuntime } = require("../scripts/analyze-food-character.js");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const runtime = loadDiscoveryRuntime(appSource);
const seededNoise = runtime.seededNoiseFactory({ discoverySeed: 47 });
const score = runtime.discoveryScore(seededNoise);
const common = {
  id: "MTEST",
  restaurantId: "CTEST",
  restaurant: { id: "CTEST", name: "테스트 식당" },
  distance: 275,
  openNow: true,
  signature: true,
  weatherBoost: null,
  price: 9000,
};

const lowValueAndPortion = score({ ...common, value: 1, portion: 1 });
const highValueAndPortion = score({ ...common, value: 5, portion: 5 });
assert.equal(
  lowValueAndPortion,
  highValueAndPortion,
  "default Discovery Score must ignore value and portion",
);

const discoveryScoreSource = extractFunctionSource(appSource, "discoveryScore");
assert.doesNotMatch(discoveryScoreSource, /item\.value|item\.portion/);
assert.match(discoveryScoreSource, /item\.distance/);
assert.match(discoveryScoreSource, /seededNoise\(item\.id,\s*item\.restaurantId\)\s*\*\s*16/);

const personalizedScoreSource = extractFunctionSource(appSource, "scoreMenu");
assert.match(personalizedScoreSource, /score\s*-=\s*menu\.value\s*\*\s*3/);
assert.match(personalizedScoreSource, /score\s*-=\s*menu\.portion\s*\*\s*1\.6/);

const dbMenuToAppSource = extractFunctionSource(appSource, "dbMenuToApp");
assert.match(dbMenuToAppSource, /portion:\s*Number\(row\.portion/);
assert.match(dbMenuToAppSource, /value:\s*Number\(row\.value/);

console.log("discovery score: value and portion ignored, personalized scoring and data mapping preserved");
