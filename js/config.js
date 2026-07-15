// ─────────────────────────────────────────────────────────
//  MMM Classroom Tools — configuration
//  Fill these in once after you've set up Supabase + the
//  Cloudflare Worker (see README.md for step-by-step help).
//  These values are all meant to be public — they are safe
//  to commit to a public GitHub repo.
// ─────────────────────────────────────────────────────────
window.MMM_CONFIG = {
  // Supabase project URL
  SUPABASE_URL: "https://kxbibqezeppzjgjaowhz.supabase.co",

  // Supabase "anon" public API key (Project Settings → API)
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4YmlicWV6ZXBwempnamFvd2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwODcwMzksImV4cCI6MjA5OTY2MzAzOX0.oL-r0TybMVkwuWPeDH3onSJZ3envQqhHVnWduzVx9XA",

  // URL of your deployed Cloudflare Worker (PDF proxy)
  // e.g. "https://mmm-pdf-proxy.your-subdomain.workers.dev"
  PDF_WORKER_URL: "https://mmm-pdf-proxy.YOUR-SUBDOMAIN.workers.dev"
};
