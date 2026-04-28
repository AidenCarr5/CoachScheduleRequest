# LaSalle Titans Coach Scheduler

Coach-facing Titans scheduling web app with a password-protected approval area.

## What it does

- Loads Titans games from the public Turtle Club category schedule.
- Loads verified Titans practices from the Turtle Club calendar where publicly accessible.
- Shows only the selected coach/team schedule.
- Lets a coach queue cancellation requests.
- Lets a coach request a new game or practice.
- Lets a coach request that an existing game be replaced with a practice, or a practice with a game.
- Checks new/replacement events against the published Turtle Club diamond availability blocks.
- Also checks for an existing Turtle Club event conflict on the same diamond and time.
- Stores coach requests on the server, with optional Supabase storage for hosting.
- Shows pending and approved requests back on the shared schedule.
- Includes an admin-only approval page protected by a password.
- Exports the current admin request list to an Excel workbook.

## Run locally

Start the web app server from the project root:

```powershell
$env:ADMIN_PASSWORD="your-password"
node server.js
```

Then visit `http://127.0.0.1:4173/`.

Admin approval is at `http://127.0.0.1:4173/admin.html`.

If you do not set `ADMIN_PASSWORD`, the local default is `55aiden55`.

Local development still works without Supabase. In that case the app falls back to `storage/requests.json`.

## Reuse Next Season

Most of the app is driven by `data.js`, so the front end does not need season-specific edits.

1. Open `config.json`.
2. Leave `seasonYear` as `"auto"` to use the current calendar year, or set a specific year if you are preparing early.
3. If Turtle Club changes the Titans category, availability page, or active months, update `teamCategoryId`, `availabilityId`, `scheduleMonths`, or `practiceMonths`.
4. Regenerate the schedule data:

```powershell
node site\update-data.js
```

The date picker, month sections, team list, diamonds, availability checks, and admin export all adapt to the regenerated data.

## Put It Online

Deploy the whole project as a Node app, not just the `site` folder.

- Set `ADMIN_PASSWORD` in the host environment.
- Optionally set `PORT` if your host requires it.
- Set `SESSION_SECRET` to a long random value.
- For free hosting, set up Supabase and provide `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

This current version can still run on a VPS with local storage, but for free-style hosting the recommended setup is Supabase-backed storage so coach requests survive deploys and restarts.

### Easiest path: Render + Supabase

This repo now includes [render.yaml](</C:/Users/aiden/Documents/Codex/2026-04-27/okay-i-need-to-build-a/render.yaml>) for a free Render web service, and [supabase-schema.sql](</C:/Users/aiden/Documents/Codex/2026-04-27/okay-i-need-to-build-a/site/supabase-schema.sql>) for the hosted request table.

1. Create a free Supabase project at [supabase.com](https://supabase.com/).
2. In the Supabase SQL editor, run the contents of [supabase-schema.sql](</C:/Users/aiden/Documents/Codex/2026-04-27/okay-i-need-to-build-a/site/supabase-schema.sql>).
3. In Supabase project settings, copy:
   `Project URL` -> `SUPABASE_URL`
   `service_role` secret key -> `SUPABASE_SERVICE_ROLE_KEY`
4. Put this project in a GitHub repo.
5. In Render, create a new Blueprint or Web Service from that repo.
6. If you use the included `render.yaml`, Render will pick up `npm install` and `npm start`.
7. Set these environment variables in Render:
   `ADMIN_PASSWORD=` choose your admin password
   `SESSION_SECRET=` a long random string
   `SUPABASE_URL=` your Supabase project URL
   `SUPABASE_SERVICE_ROLE_KEY=` your Supabase service role key
8. Deploy. Render will give you a public `onrender.com` URL.
9. Open `/admin.html` on that URL to approve coach requests.
10. Add your own domain later if you want, from Render's custom domain settings.

### Upload walkthrough

1. Create a new empty GitHub repository.
2. From this project folder, run:

```powershell
git init
git add .
git commit -m "Initial Titans scheduler"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

3. Create a Supabase project.
4. Open Supabase SQL editor and run [supabase-schema.sql](</C:/Users/aiden/Documents/Codex/2026-04-27/okay-i-need-to-build-a/site/supabase-schema.sql>).
5. In Render, click `New +` then `Blueprint`.
6. Connect your GitHub account if asked, then pick the repo you just pushed.
7. Render will detect `render.yaml`. Continue with that setup.
8. In the Render environment settings, add:
   `ADMIN_PASSWORD`
   `SESSION_SECRET`
   `SUPABASE_URL`
   `SUPABASE_SERVICE_ROLE_KEY`
9. Click deploy and wait for the first build to finish.
10. Open the public site URL Render gives you.
11. Test the coach side first, then visit `/admin.html` and log in.

After that, every time you update the repo and push to GitHub, Render can redeploy the site automatically.

Important:
Render's docs say web services can deploy from GitHub and get a public URL. Supabase provides the hosted Postgres/database layer for the saved requests. Sources:
[Web Services](https://render.com/docs/web-services)
[Supabase Docs](https://supabase.com/docs)

## Data source

The current `data.js` was generated from:

- `https://turtleclubbaseball.com/Categories/1017/Schedule/`
- `https://turtleclubbaseball.com/Calendar/`
- `https://turtleclubbaseball.com/Availabilities/3497/`

The site does not write back to Turtle Club. It only queues coach requests and exports them.

## Excel export

The admin Excel export still works the same way after moving storage to Supabase. It exports the current request list shown in the admin page, regardless of whether those requests came from the local JSON file or the hosted database.
