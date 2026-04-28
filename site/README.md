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
- Stores coach requests on the server.
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
- Keep the `storage/requests.json` file on persistent storage, or replace it later with a database if you want multi-device durability across redeploys.

This current version is a good fit for a small VPS or a simple Node host. If you want, we can make the next step a production deployment version with a real database so requests stay safe even after server restarts or redeploys.

### Easiest path: Render

This repo now includes [render.yaml](</C:/Users/aiden/Documents/Codex/2026-04-27/okay-i-need-to-build-a/render.yaml>) for a Render web service with a persistent disk.

1. Put this project in a GitHub repo.
2. In Render, create a new Blueprint or Web Service from that repo.
3. If you use the included `render.yaml`, Render will pick up:
   `npm install`, `npm start`, and a persistent disk mounted at `/opt/render/project/src/storage`.
4. Set these environment variables in Render:
   `ADMIN_PASSWORD=` choose your admin password
   `SESSION_SECRET=` a long random string
5. Deploy. Render will give you a public `onrender.com` URL.
6. Open `/admin.html` on that URL to approve coach requests.
7. Add your own domain later if you want, from Render's custom domain settings.

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

3. In Render, click `New +` then `Blueprint`.
4. Connect your GitHub account if asked, then pick the repo you just pushed.
5. Render will detect `render.yaml`. Continue with that setup.
6. In the Render environment settings, add:
   `ADMIN_PASSWORD`
   `SESSION_SECRET`
7. Click deploy and wait for the first build to finish.
8. Open the public site URL Render gives you.
9. Test the coach side first, then visit `/admin.html` and log in.

After that, every time you update the repo and push to GitHub, Render can redeploy the site automatically.

Important:
Render's docs say web services can deploy from GitHub and get a public URL, and persistent disks preserve filesystem changes across restarts and deploys. Sources:
[Web Services](https://render.com/docs/web-services)
[Persistent Disks](https://render.com/docs/disks)

## Data source

The current `data.js` was generated from:

- `https://turtleclubbaseball.com/Categories/1017/Schedule/`
- `https://turtleclubbaseball.com/Calendar/`
- `https://turtleclubbaseball.com/Availabilities/3497/`

The site does not write back to Turtle Club. It only queues coach requests and exports them.
