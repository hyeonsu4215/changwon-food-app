const PRODUCTION_SUPABASE_URL = "https://poxvxxwtrblkjfrqqnrw.supabase.co";
const PRODUCTION_HOST = "changwon-food-app.vercel.app";

function isAllowedSupabaseConfig(config) {
  if (!config?.enabled || !config.url || !config.anonKey) return false;
  let url;
  try {
    url = new URL(config.url);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) return false;
  const isProduction = window.location.hostname === PRODUCTION_HOST;
  if (isProduction) return url.origin === PRODUCTION_SUPABASE_URL;
  return url.origin !== PRODUCTION_SUPABASE_URL && /^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) && config.anonKey.startsWith("sb_publishable_");
}

window.CHANGWON_IS_SUPABASE_CONFIG_ALLOWED = isAllowedSupabaseConfig;
window.CHANGWON_SUPABASE_CONFIG = { enabled: false };
window.CHANGWON_COMMUNITY_PREVIEW_ENABLED = false;

if (window.location.hostname === PRODUCTION_HOST) {
  window.CHANGWON_SUPABASE_CONFIG = {
    enabled: true,
    url: PRODUCTION_SUPABASE_URL,
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBveHZ4eHd0cmJsa2pmcnFxbnJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNjEzMzYsImV4cCI6MjA5NzYzNzMzNn0.d6EV42RnqCPy-qnGfhUgcNDFoOkkD7ii_G3lbSPm-Mg",
  };
  window.CHANGWON_SUPABASE_CONFIG_READY = Promise.resolve();
} else {
  window.CHANGWON_SUPABASE_CONFIG_READY = fetch("./api/community-test-config", { cache: "no-store" })
    .then((response) => response.ok ? response.json() : null)
    .then((config) => {
      if (!isAllowedSupabaseConfig(config)) return;
      window.CHANGWON_SUPABASE_CONFIG = config;
      window.CHANGWON_COMMUNITY_PREVIEW_ENABLED = true;
    })
    .catch(() => {});
}
