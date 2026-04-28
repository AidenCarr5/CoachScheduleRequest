# Host Laptop Setup

Use this if you want another Windows laptop to act as the Titans scheduler server.

## What to copy to the other laptop

Copy the whole project folder, including:

- `server.js`
- `package.json`
- `site\`
- `storage\`
- `start-server.bat`
- `start-server.ps1`

## What the other laptop needs

Install Node.js on that laptop if it does not already have it:

- [https://nodejs.org/](https://nodejs.org/)

## How to start it

On the other laptop, double-click:

- `start-server.bat`

That starts the local server on port `4173`.

## Email notifications

If you want the app to email `titansupdate@gmail.com` whenever a coach submits a request:

1. Copy `local-env.example.ps1`
2. Rename it to `local-env.ps1`
3. Put the Gmail app password for `titansupdate@gmail.com` into:
   `$env:EMAIL_APP_PASSWORD`

The launcher reads `local-env.ps1` automatically.

## How coaches connect

When the server starts, it prints one or more network addresses like:

```text
http://192.168.1.25:4173
```

Give coaches that address if they are on the same network as the host laptop.

## Important

1. The host laptop must stay powered on.
2. The host laptop must stay connected to the same network the coaches are using.
3. If Windows Firewall asks whether to allow Node.js on private networks, allow it.
4. Keep the black PowerShell window open. Closing it stops the server.

## Make it start when the laptop boots

You can place a shortcut to `start-server.bat` in the Windows Startup folder on the host laptop:

1. Press `Win + R`
2. Run: `shell:startup`
3. Put a shortcut to `start-server.bat` in that folder

Then the server will start after that Windows user signs in.

## If coaches are on different Wi-Fi

Use the Cloudflare Quick Tunnel workflow instead:

- [CLOUDFLARE-QUICK-TUNNEL.md](</C:/Users/aiden/Documents/Codex/2026-04-27/okay-i-need-to-build-a/CLOUDFLARE-QUICK-TUNNEL.md>)
