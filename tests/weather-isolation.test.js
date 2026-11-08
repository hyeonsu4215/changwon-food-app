const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "api", "weather.js"), "utf8");
const databaseUrl = "https://poxvxxwtrblkjfrqqnrw.supabase.co";

function createWeather(environment, { cached = null, failWeather = false, credentials = true } = {}) {
  const calls = [];
  let weatherFails = failWeather;
  const env = { OPENWEATHER_API_KEY: "mock-weather-key" };
  if (environment !== undefined) env.VERCEL_ENV = environment;
  if (credentials) {
    env.SUPABASE_URL = databaseUrl;
    env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-key";
  }
  const context = {
    module: { exports: {} },
    process: { env },
    fetch: async (raw, options = {}) => {
      const url = new URL(raw);
      calls.push({ url, options });
      if (url.origin === databaseUrl) {
        return { ok: true, json: async () => cached ? [cached] : [] };
      }
      assert.equal(url.hostname, "api.openweathermap.org");
      if (weatherFails) throw new Error("weather unavailable");
      return {
        ok: true,
        json: async () => ({ main: { temp: 21.4 }, weather: [{ main: "Clear" }] }),
      };
    },
  };
  vm.runInNewContext(source, context, { filename: "api/weather.js" });
  return {
    calls,
    failWeather() { weatherFails = true; },
    async request(force = false) {
      const response = {
        setHeader() {},
        end(text) { this.body = JSON.parse(text); },
      };
      await context.module.exports({ query: force ? { force: "1" } : {} }, response);
      return response;
    },
  };
}

for (const environment of ["preview", "development", undefined, "", "unknown", "Production"]) {
  test(`${String(environment)} never reads or writes Supabase, even with Production credentials`, async () => {
    const weather = createWeather(environment);
    const first = await weather.request(true);
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.cached, false);
    assert.equal(first.body.weather.temp, 21);
    const second = await weather.request();
    assert.equal(second.statusCode, 200);
    assert.equal(second.body.cached, true);
    assert.deepEqual(second.body.weather, first.body.weather);
    assert.equal(weather.calls.filter(({ url }) => url.origin === databaseUrl).length, 0);
    assert.equal(weather.calls.length, 1);
  });
}

test("Preview falls back to memory when an explicit weather refresh fails", async () => {
  const weather = createWeather("preview");
  await weather.request(true);
  weather.failWeather();
  const response = await weather.request(true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.stale, true);
  assert.equal(weather.calls.filter(({ url }) => url.origin === databaseUrl).length, 0);
});

test("Preview weather failure without cache returns an error without Supabase access", async () => {
  const weather = createWeather("preview", { failWeather: true });
  const response = await weather.request();
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.ok, false);
  assert.equal(weather.calls.filter(({ url }) => url.origin === databaseUrl).length, 0);
});

test("Production still reads a fresh Supabase cache without fetching weather", async () => {
  const cached = { payload: { temp: 18 }, fetched_at: new Date().toISOString() };
  const weather = createWeather("production", { cached });
  const response = await weather.request();
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.cached, true);
  assert.equal(response.body.weather.temp, 18);
  assert.equal(weather.calls.length, 1);
  assert.equal(weather.calls[0].url.origin, databaseUrl);
  assert.equal(weather.calls[0].options.headers.apikey, "mock-service-key");
});

test("Production still reads and upserts Supabase cache when refreshing weather", async () => {
  const weather = createWeather("production");
  const response = await weather.request(true);
  assert.equal(response.statusCode, 200);
  const databaseCalls = weather.calls.filter(({ url }) => url.origin === databaseUrl);
  assert.equal(databaseCalls.length, 2);
  assert.equal(databaseCalls[0].options.method || "GET", "GET");
  assert.equal(databaseCalls[1].options.method, "POST");
  assert.equal(databaseCalls[1].url.searchParams.get("on_conflict"), "id");
  assert.equal(databaseCalls[1].options.headers.Authorization, "Bearer mock-service-key");
  const row = JSON.parse(databaseCalls[1].options.body);
  assert.equal(row.id, "changwon_univ");
  assert.deepEqual(row.payload, response.body.weather);
});

test("Production preserves cached weather on upstream failure", async () => {
  const cached = { payload: { temp: 18 }, fetched_at: new Date().toISOString() };
  const weather = createWeather("production", { cached, failWeather: true });
  const response = await weather.request(true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.stale, true);
  assert.equal(response.body.weather.temp, 18);
  assert.equal(weather.calls.filter(({ url }) => url.origin === databaseUrl).length, 1);
});

test("Production without DB credentials keeps using memory cache", async () => {
  const weather = createWeather("production", { credentials: false });
  assert.equal((await weather.request(true)).statusCode, 200);
  assert.equal((await weather.request()).body.cached, true);
  assert.equal(weather.calls.length, 1);
});
