const PRODUCTION_REF = "poxvxxwtrblkjfrqqnrw";

function testConfig() {
  if (process.env.VERCEL_ENV !== "preview") return null;
  const url = process.env.MUKJJI_TEST_SUPABASE_URL;
  const anonKey = process.env.MUKJJI_TEST_SUPABASE_PUBLISHABLE_KEY;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
  if (!/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname) || parsed.hostname === `${PRODUCTION_REF}.supabase.co`) return null;
  if (!anonKey?.startsWith("sb_publishable_")) return null;
  return { enabled: true, url: parsed.origin, anonKey };
}

module.exports = function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  const config = testConfig();
  response.statusCode = config ? 200 : 503;
  response.end(JSON.stringify(config || { enabled: false }));
};

module.exports.testConfig = testConfig;
