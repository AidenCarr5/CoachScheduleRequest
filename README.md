# CoachScheduleRequest

Windows host-laptop setup is here:

- [HOST-LAPTOP-SETUP.md](</C:/Users/aiden/Documents/Codex/2026-04-27/okay-i-need-to-build-a/HOST-LAPTOP-SETUP.md>)

Public access with Cloudflare Quick Tunnel is here:

- [CLOUDFLARE-QUICK-TUNNEL.md](</C:/Users/aiden/Documents/Codex/2026-04-27/okay-i-need-to-build-a/CLOUDFLARE-QUICK-TUNNEL.md>)

Local secret/config example is here:

- [local-env.example.ps1](</C:/Users/aiden/Documents/Codex/2026-04-27/okay-i-need-to-build-a/local-env.example.ps1>)

## Vercel

This repo is now structured to run on Vercel:

- static frontend files are in `public/`
- API routes are in `api/`
- the admin password still defaults to `55aiden55`

For Vercel, the important environment variables are:

- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DISCORD_WEBHOOK_URL`

For reliable online request storage on Vercel, use Supabase instead of the local JSON fallback.
