# CoachScheduleRequest

LaSalle Titans coach scheduling site with:

- coach logins by team
- admin approval workflow
- live Turtle Club schedule refresh
- Turtle Club create/cancel writeback after approval
- Discord request notifications
- email notifications for:
  - new coach requests
  - approval / rejection decisions
  - diamond status alerts

## Best hosting option

This app is best hosted on a real VM, not static hosting.

Recommended:

- DigitalOcean Droplet
- Ubuntu 24.04 LTS
- 2 GB RAM / 1 vCPU

Deployment guide:

- [DIGITALOCEAN-DEPLOY.md](</C:/Users/aiden/Documents/Codex/2026-04-27/okay-i-need-to-build-a/DIGITALOCEAN-DEPLOY.md>)

## Important files

- Windows local env example:
  - [local-env.example.ps1](</C:/Users/aiden/Documents/Codex/2026-04-27/okay-i-need-to-build-a/local-env.example.ps1>)
- Linux server env example:
  - [.env.example](</C:/Users/aiden/Documents/Codex/2026-04-27/okay-i-need-to-build-a/.env.example>)
- PM2 process config:
  - [ecosystem.config.js](</C:/Users/aiden/Documents/Codex/2026-04-27/okay-i-need-to-build-a/ecosystem.config.js>)
- Nginx reverse proxy config:
  - [deploy/nginx/titans-coach-scheduler.conf](</C:/Users/aiden/Documents/Codex/2026-04-27/okay-i-need-to-build-a/deploy/nginx/titans-coach-scheduler.conf>)

## Local run

```bash
npm install
npm start
```

Server health check:

```bash
http://127.0.0.1:4173/api/health
```

## Environment variables

Required for production:

- `ADMIN_PASSWORD`
- `COACH_PASSWORD`
- `SESSION_SECRET`
- `DISCORD_WEBHOOK_URL`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `EMAIL_FROM`
- `EMAIL_ALERT_CC`
- `TURTLE_CLUB_USERNAME`
- `TURTLE_CLUB_PASSWORD`

Optional fallback:

- `RESEND_API_KEY`
- `EMAIL_USER`
- `EMAIL_APP_PASSWORD`

## Notes

- coach usernames are generated from team names, for example `10U T1 (Picco)` becomes `Picco10U`
- admin password defaults to `55aiden55` unless overridden
- coach default password is `password` unless overridden
- back-dated event creation is blocked by Turtle Club itself
