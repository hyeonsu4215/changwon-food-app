const CACHE_ID = "changwon_univ";
const CACHE_TTL_MS = 60 * 60 * 1000;
const CHANGWON_UNIV = { lat: 35.24235, lon: 128.68965, label: "창원대 앞" };

let memoryCache = null;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("CDN-Cache-Control", "no-store");
  res.setHeader("Vercel-CDN-Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function kstHour() {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false }).format(new Date()));
}

function isFresh(fetchedAt) {
  const time = new Date(fetchedAt).getTime();
  return Number.isFinite(time) && Date.now() - time < CACHE_TTL_MS;
}

async function readCache() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return memoryCache;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/weather_cache?id=eq.${CACHE_ID}&select=*`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!response.ok) return memoryCache;
  const rows = await response.json();
  return rows?.[0] || memoryCache;
}

async function writeCache(payload) {
  const row = { id: CACHE_ID, payload, fetched_at: payload.fetchedAt };
  memoryCache = row;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/weather_cache?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  }).catch(() => {});
}

async function fetchOpenWeather() {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) throw new Error("OPENWEATHER_API_KEY is missing");
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${CHANGWON_UNIV.lat}&lon=${CHANGWON_UNIV.lon}&appid=${key}&units=metric&lang=kr`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`OpenWeather ${response.status}`);
  const data = await response.json();
  return {
    location: CHANGWON_UNIV.label,
    temp: Math.round(Number(data.main?.temp || 0)),
    feelsLike: Math.round(Number(data.main?.feels_like || 0)),
    humidity: Number(data.main?.humidity || 0),
    windSpeed: Number(data.wind?.speed || 0),
    main: data.weather?.[0]?.main || "",
    description: data.weather?.[0]?.description || "",
    icon: data.weather?.[0]?.icon || "",
    rain1h: Number(data.rain?.["1h"] || 0),
    snow1h: Number(data.snow?.["1h"] || 0),
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = async function handler(req, res) {
  const force = req.query?.force === "1";
  const cache = await readCache().catch(() => null);
  const inUpdateWindow = kstHour() >= 8 && kstHour() <= 21;
  if (!force && cache?.payload && (isFresh(cache.fetched_at) || !inUpdateWindow)) {
    json(res, 200, { ok: true, cached: true, weather: cache.payload });
    return;
  }
  try {
    const weather = await fetchOpenWeather();
    await writeCache(weather);
    json(res, 200, { ok: true, cached: false, weather });
  } catch (error) {
    if (cache?.payload) {
      json(res, 200, { ok: true, cached: true, stale: true, weather: cache.payload, warning: error.message });
      return;
    }
    json(res, 500, { ok: false, error: error.message || "weather fetch failed" });
  }
};
