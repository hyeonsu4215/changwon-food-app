const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { extractFunctionSource, loadFallbackLocation } = require("../scripts/analyze-food-character.js");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const weatherSource = fs.readFileSync(path.join(root, "api", "weather.js"), "utf8");
const expected = { lat: 35.2438, lng: 128.6916 };

const fallback = loadFallbackLocation(appSource);
assert.equal(fallback.lat, expected.lat);
assert.equal(fallback.lng, expected.lng);
assert.equal(fallback.label, "국립창원대학교 정문");

const weatherMatch = weatherSource.match(/const CHANGWON_UNIV\s*=\s*(\{[^;]+\});/);
assert.ok(weatherMatch, "weather API campus location must exist");
const weatherLocation = new Function(`return (${weatherMatch[1]});`)();
assert.equal(weatherLocation.lat, expected.lat);
assert.equal(weatherLocation.lon, expected.lng);

const state = { location: null };
const currentBase = new Function(
  "state",
  "FALLBACK_LOCATION",
  `${extractFunctionSource(appSource, "currentBase")}; return currentBase;`,
)(state, fallback);
assert.deepEqual(currentBase(), fallback);

state.location = { label: "현재 위치", lat: 35.25, lng: 128.7 };
assert.deepEqual(currentBase(), state.location);
state.location = null;
assert.deepEqual(currentBase(), fallback);

const splashLocationSource = extractFunctionSource(appSource, "handleLocationAfterSplash");
assert.match(splashLocationSource, /applyLocationBasis\(null,\s*"idle"\)/);
assert.doesNotMatch(splashLocationSource, /requestLocation\s*\(/);

const locationChoiceSource = extractFunctionSource(appSource, "chooseLocationPreference");
assert.match(locationChoiceSource, /choice === "always"[\s\S]*requestLocation\(\)/);
assert.match(locationChoiceSource, /choice === "deny"[\s\S]*applyLocationBasis\(null,\s*"denied"\)/);

const sharedPickSource = [
  extractFunctionSource(appSource, "initializeSharedPickFromUrl"),
  extractFunctionSource(appSource, "handlePopNavigation"),
].join("\n");
assert.match(sharedPickSource, /FALLBACK_LOCATION/);

console.log("default location: corrected gate coordinates, explicit geolocation, fallback, and shared picks passed");
