const TEST_URL = "https://ocqffcambljzhymlfwmh.supabase.co";

function previewConfig(env) {
  if (env.VERCEL_ENV !== "preview" || env.VERCEL_GIT_COMMIT_REF !== "feature/kakao-community-mvp") return null;
  if (env.MUKJJI_TEST_SUPABASE_URL?.replace(/\/$/, "") !== TEST_URL) return null;
  const publishableKey = env.MUKJJI_TEST_SUPABASE_PUBLISHABLE_KEY;
  if (!publishableKey?.startsWith("sb_publishable_")) return null;
  return { enabled: true, project: "ocqffcambljzhymlfwmh", url: TEST_URL, publishableKey };
}

module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Vercel-CDN-Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const config = req.method === "GET" ? previewConfig(process.env) : null;
  res.statusCode = config ? 200 : 403;
  res.end(JSON.stringify(config || { enabled: false }));
};

module.exports.previewConfig = previewConfig;
