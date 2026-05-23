# DigitalOcean Deploy

This app is best deployed on a small Ubuntu VM because it needs:

- an always-on Node server
- local JSON storage
- scheduled refresh jobs
- API email + Discord notifications
- Turtle Club browser automation

## Recommended Droplet

- Ubuntu 24.04 LTS
- Basic Droplet
- 2 GB RAM / 1 vCPU is a good starting point

## 1. Install system packages

```bash
sudo apt update
sudo apt install -y nginx git ufw
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

## 2. Clone the repo

```bash
git clone https://github.com/AidenCarr5/CoachScheduleRequest.git
cd CoachScheduleRequest
```

## 3. Install app dependencies

```bash
npm install
npx playwright install chromium
```

## 4. Create the production env file

```bash
cp .env.example .env
nano .env
```

Fill in the real values for:

- `SESSION_SECRET`
- `DISCORD_WEBHOOK_URL`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `EMAIL_FROM`
- `TURTLE_CLUB_USERNAME`
- `TURTLE_CLUB_PASSWORD`

For Gmail API, `EMAIL_FROM` should match the Gmail account you authenticated, for example:

```env
EMAIL_FROM=Titans Updates <titansupdate@gmail.com>
```

If you later buy a domain, you can switch to Resend by setting `RESEND_API_KEY` and a verified-domain `EMAIL_FROM`.

The old SMTP variables (`EMAIL_USER` and `EMAIL_APP_PASSWORD`) are now only an optional fallback.

## 5. Start both sites with PM2

```bash
npm run pm2:start
pm2 save
pm2 startup
```

Run the command printed by `pm2 startup`, then:

```bash
pm2 save
```

This starts two processes on the same Droplet:

- `titans-coach-scheduler` on `127.0.0.1:4173`
- `athletics-coach-scheduler` on `127.0.0.1:4184`

The Titans process uses `site/config.json`, `site/data.js`, and `storage/coach-accounts.json`.
The Athletics process uses `site/athletics.config.json`, `site/athletics-data.js`, and `storage/athletics-coach-accounts.json`.

## 6. Configure Nginx domain routing

```bash
sudo cp deploy/nginx/titans-coach-scheduler.conf /etc/nginx/sites-available/titans-coach-scheduler
sudo ln -s /etc/nginx/sites-available/titans-coach-scheduler /etc/nginx/sites-enabled/titans-coach-scheduler
sudo nginx -t
sudo systemctl reload nginx
```

Nginx routes by domain:

- `lasalletitansbaseball.com` and `www.lasalletitansbaseball.com` go to the Titans app on port `4173`.
- `lasalleathleticssoftball.com` and `www.lasalleathleticssoftball.com` go to the Athletics app on port `4184`.

## 7. Open the firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## 8. Test the live server

```bash
curl http://127.0.0.1:4173/api/health
curl http://127.0.0.1:4184/api/health
curl -H "Host: lasalletitansbaseball.com" http://127.0.0.1/api/public-config
curl -H "Host: lasalleathleticssoftball.com" http://127.0.0.1/api/public-config
curl http://YOUR_SERVER_IP/
pm2 status
pm2 logs titans-coach-scheduler
pm2 logs athletics-coach-scheduler
```

## 9. Optional domain + HTTPS

If you later add a domain, point the DNS `A` record to the Droplet IP and then run:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx
```

## Updating later

```bash
cd CoachScheduleRequest
git pull
npm install
pm2 restart ecosystem.config.js --update-env
sudo nginx -t
sudo systemctl reload nginx
```
