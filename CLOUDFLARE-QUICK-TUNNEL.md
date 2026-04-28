# Cloudflare Quick Tunnel Setup

Use this if you want coaches to reach the scheduler from different Wi-Fi networks without paying for hosting.

## What this does

- runs the scheduler on your laptop
- opens a public `trycloudflare.com` URL
- lets coaches use that public link from anywhere

## What the host laptop needs

1. Node.js installed
2. `cloudflared` installed

Cloudflare Quick Tunnel is created with:

```powershell
cloudflared tunnel --url http://localhost:4173
```

## Easiest way to run it

On the host laptop, double-click:

- `start-public.bat`

That script:

1. starts the local scheduler server
2. checks that it is healthy
3. starts a Cloudflare Quick Tunnel

## What to share

Cloudflare prints a public URL like:

```text
https://random-name.trycloudflare.com
```

Share that URL with coaches.

## Important

1. The host laptop must stay on.
2. The laptop must stay connected to the internet.
3. Keep the PowerShell / tunnel windows open.
4. The Quick Tunnel URL usually changes whenever you restart it.

## If cloudflared is not installed

Install `cloudflared` on the host laptop from Cloudflare's docs:

- [https://developers.cloudflare.com/tunnel/setup/](https://developers.cloudflare.com/tunnel/setup/)
- [https://try.cloudflare.com/](https://try.cloudflare.com/)

## Good fit for this project

Cloudflare's docs say Quick Tunnels are free, do not require your own domain, and are intended for sharing a local application over a generated `trycloudflare.com` URL.

For this scheduler, that is a good fit for light usage.
