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

## Run It On Your Computer

Start the web app server from the project root:

```powershell
$env:ADMIN_PASSWORD="55aiden55"
node server.js
```

Then open:

- Coach view: `http://127.0.0.1:4173/`
- Admin view: `http://127.0.0.1:4173/admin.html`

If you do not set `ADMIN_PASSWORD`, the default is `55aiden55`.

Requests are stored locally in:

- [requests.json](</C:/Users/aiden/Documents/Codex/2026-04-27/okay-i-need-to-build-a/storage/requests.json>)

## Let Coaches Connect To Your Computer

When the server starts, it now prints one or more local network links such as:

```text
http://192.168.1.25:4173
```

That is the link coaches on the same Wi-Fi or office network should use.

For this to work:

1. Your computer must stay on while coaches are using the site.
2. Your computer and the coaches must be on the same local network.
3. Windows Firewall may ask whether to allow Node on private networks. Allow it.

If coaches need access from outside your building or home network, you would need a more advanced setup such as port forwarding, a VPN, Tailscale, or a hosted deployment.

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

## Optional Hosted Setup

The app can still be hosted later if you want, and the server already supports either:

- local file storage through `storage/requests.json`
- Supabase storage when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set

For now, if you just want something you can run on your own computer, you do not need Render or Supabase.

## Data Source

The current `data.js` was generated from:

- `https://turtleclubbaseball.com/Categories/1017/Schedule/`
- `https://turtleclubbaseball.com/Calendar/`
- `https://turtleclubbaseball.com/Availabilities/3497/`

The site does not write back to Turtle Club. It only queues coach requests and exports them.

## Excel Export

The admin Excel export still works locally. It exports the current request list shown in the admin page.
