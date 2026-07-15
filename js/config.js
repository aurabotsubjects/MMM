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

  // Your R2 bucket's public URL (Cloudflare dashboard → your bucket →
  // Settings → Public Access). PDFs are fetched straight from here —
  // no server or Worker involved.
  R2_PUBLIC_URL: "https://pub-c9d54ec1efa04cfeaa3041eebb9144db.r2.dev"
};
