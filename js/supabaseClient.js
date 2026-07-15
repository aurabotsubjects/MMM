// Requires the Supabase JS UMD build to be loaded first (see <script> tag in HTML)
// and window.MMM_CONFIG to be set (config.js).
window.sb = supabase.createClient(
  window.MMM_CONFIG.SUPABASE_URL,
  window.MMM_CONFIG.SUPABASE_ANON_KEY
);
