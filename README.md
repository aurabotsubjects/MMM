# MMM Classroom Tools

A rebuild of your Mad Math Minute app that:

- Automatically pulls the correct PDF (skills sheets or Friday tests) — no file picking
- Stores students, levels, and test scores in Supabase instead of the browser
- Auto-advances a student's level when you enter a score of 15/15
- Lets teachers request their own account, which you approve (or decline) from one admin login
- Gives students/parents a read-only "enter your class code" page to see levels/results — no login

It's a static site (plain HTML/CSS/JS) meant to be hosted for free on **GitHub Pages**, backed by a free **Supabase** project (auth + database) and a free **Cloudflare Worker** that privately serves your two PDFs out of your **R2** bucket.

Nothing here needs a build step — you just fill in a few values and push to GitHub.

---

## How the pieces fit together

```
GitHub Pages (this repo)  →  Supabase (login + student/score data)
        │                          │
        └── Cloudflare Worker  ────┘── reads PDFs privately from your R2 bucket (/mmm folder)
```

- **Supabase** holds teacher accounts, the one admin account, students, positions, and test scores.
- **Cloudflare R2** stores your two PDFs privately (not public). A small **Cloudflare Worker**
  is the only thing allowed to read them — it checks that the request comes from a signed-in
  teacher before handing back the file, so the bucket itself never needs to be public.
- **GitHub Pages** just serves the HTML/CSS/JS files in this repo — no server of your own to run.

---

## 1. Your R2 bucket is already set up

Your PDFs are in the **`aurabotsubjects`** bucket, inside a folder called **`MMM`**:
- `MMM/MMM Skills for Printing.pdf`
- `MMM/Mad Math Minute Tests.pdf`

(These paths are already filled into `cloudflare-worker/wrangler.toml` and `cloudflare-worker/worker.js` for you.)

**One thing to double-check:** you mentioned a public URL for this bucket
(`https://pub-c9d54ec1efa04cfeaa3041eebb9144db.r2.dev`). That's Cloudflare's "public bucket access"
feature — if it's turned on, anyone with that URL (or a guessed file path under it) could open the
PDFs directly, bypassing the teacher-login check entirely. Since we're using the private + Worker
approach, you don't need public access turned on at all. In the Cloudflare dashboard, go to your
bucket → **Settings → Public Access**, and if "Allow Access" is enabled for the `r2.dev` subdomain,
turn it off. The Worker will keep working fine either way, since it reads the bucket directly
through its own binding, not through that public URL.

---

## 2. Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com) (or use one you already have — a
   new **project** inside your existing account is fine; it won't touch any other app's data).
2. Go to **SQL Editor**, paste in the contents of `supabase/schema.sql`, and run it.
   This creates the `profiles`, `students`, and `score_records` tables, locks them down with
   row-level security, and adds the `get_class_view` function used by the public class-code page.
3. Turn off email confirmation so teacher sign-up finishes in one step:
   **Authentication → Providers → Email → toggle "Confirm email" off.**
   (You can leave it on if you prefer — a teacher will just need to click the confirmation
   link in their inbox, then use "Request an account" one more time to finish creating their profile.)
4. Create your admin account:
   - Go to **Authentication → Users → Add user**, enter your admin email + password, and toggle
     **Auto Confirm User** on.
   - Copy the new user's UUID (shown in the user list).
   - Back in **SQL Editor**, run:
     ```sql
     insert into public.profiles (id, email, role, status, display_name)
     values ('PASTE-THE-UUID-HERE', 'admin@example.com', 'admin', 'approved', 'Your Name');
     ```
5. Grab these two values from **Project Settings → API** — you'll need them in step 5 below:
   - Project URL
   - `anon` public key

That's it for Supabase — **no command line, no CLI, no Edge Function needed.** Teachers create
their own accounts from the sign-in page, and you approve them from the Admin Panel.

---

## 3. Deploy the Cloudflare Worker (PDF proxy)

From the `cloudflare-worker/` folder:

1. Install Wrangler if you don't have it: `npm install -g wrangler`
2. Everything in `wrangler.toml` is already filled in (bucket name, Supabase URL/key) except
   `ALLOWED_ORIGIN` — set that to your GitHub Pages URL (e.g. `https://yourname.github.io`).
   You can come back and set this after step 4 if you don't know it yet.
3. Also requires Node.js on your computer — see the "installing Node" notes from earlier in
   our conversation if you don't have it yet.
4. Deploy:
   ```bash
   wrangler login
   wrangler deploy
   ```
5. Wrangler prints a URL like `https://mmm-pdf-proxy.yoursubdomain.workers.dev` — save it for step 5.

---

## 4. Publish this repo on GitHub Pages

1. Push this whole folder to a new GitHub repository.
2. In the repo, go to **Settings → Pages**, set the source to your default branch (root folder).
3. GitHub gives you a URL like `https://yourname.github.io/your-repo/`. If your Worker's
   `ALLOWED_ORIGIN` needs updating to match this exactly, update `wrangler.toml` and run
   `wrangler deploy` again.

---

## 5. Fill in `js/config.js`

Open `js/config.js` in the repo and fill in the three values you collected above:

```js
window.MMM_CONFIG = {
  SUPABASE_URL: "https://your-project-ref.supabase.co",
  SUPABASE_ANON_KEY: "your-anon-public-key",
  PDF_WORKER_URL: "https://mmm-pdf-proxy.yoursubdomain.workers.dev"
};
```

These are all safe to commit publicly — none of them are secret keys.

Commit and push. Your site is live.

**If you're updating from an earlier version:** run `supabase/migration_class_view_history.sql`
in the SQL Editor, and redeploy the Cloudflare Worker (`wrangler deploy` from `cloudflare-worker/`)
so it picks up the change that lets students print their practice sheet without logging in.

---

## Using the app

- **Teacher** (`index.html`): click "Request an account" the first time, fill in your name,
  class name, email, and a password — then wait for your admin to approve you (see below).
  Once approved, sign in normally. Forgot your password? Use the "Forgot password?" link to
  get a reset email.
  - **Student Tracker**: add students, double-click a name to advance them a level, or
    click once for rename/move/delete options.
  - **Test Scores**: enter each student's Friday score. A 15/15 automatically advances
    them to the next skill.
  - **Print Skills / Print Tests**: switch between the two documents — the correct PDF
    is fetched automatically from your R2 bucket via the Worker. No file picking.
- **Admin** (`admin.html`): sign in with the admin account you created. New teacher
  requests show up under **Pending Requests** — click ✓ to approve or ✗ to decline.
  Once approved, a teacher shows up in the main table where you can rename them, send
  them a password reset email, regenerate their class code, or remove their access.
  You can also change your own admin password from here.
- **Class results** (`class-view.html`): share the class code (shown on the teacher's
  header and in the admin table) with your class/parents. Anyone with the code can see
  the whole class's current levels — click a student's name to see their full score
  history, a progress chart, and an accuracy percentage, and to print just their current
  practice sheet (the Friday test PDF stays teacher-only and still requires signing in).

---

## Notes on security

- The R2 bucket stays private. Only the Worker can read it, and only after confirming the
  request carries a valid Supabase session for a signed-in teacher/admin.
- Row-level security in Supabase means a teacher's queries only ever return their own
  students and scores — even though everyone shares one database.
- The public class-code page uses a single database function (`get_class_view`) that only
  returns the one class matching the code given — it can't be used to browse other classes
  or reach the raw tables.
- Teacher self-signup always creates a *pending* account, never an approved one or an
  admin one — this is enforced both by a database rule on the signup itself and, as a
  second layer of protection, by a trigger that blocks anyone but an admin from ever
  changing a profile's role or approval status.
- Removing a teacher from the Admin Panel deletes their students/scores/access, but not
  their underlying Supabase login — if you want that gone too, remove them from
  **Authentication → Users** in the Supabase dashboard as well.

## Files in this repo

```
index.html                    Teacher sign-in / sign-up + app (tracker / scores / printing)
admin.html                    Admin sign-in + approve/manage teacher accounts
class-view.html                Public class-code lookup (no login)
css/style.css                  Shared styles
js/config.js                   Fill-in-the-blanks config (Supabase + Worker URLs)
js/supabaseClient.js           Creates the Supabase client
js/auth.js                     Shared login/signup/session helpers
js/app.js                      Teacher app logic
js/admin.js                    Admin panel logic
supabase/schema.sql             Database tables, RLS policies, class-view function
cloudflare-worker/worker.js      R2 → PDF proxy
cloudflare-worker/wrangler.toml  Worker configuration
```
