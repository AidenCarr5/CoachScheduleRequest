require('./lib/load-env');

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { URL } = require('url');
const { handleApi, useSupabaseStore, notificationsEnabled, storageFile, canAccessStatusEditorRequest, canAccessAdminPortalRequest } = require('./lib/app-handler');
const { refreshData } = require('./lib/data-store');
const { checkForDiamondStatusAlerts, smtpConfigured } = require('./lib/diamond-status-monitor');

const rootDir = __dirname;
const publicDir = path.join(rootDir, 'public');
const port = Number(process.env.PORT || 4173);

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon'
  }[ext] || 'application/octet-stream';
}

function localAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  Object.values(interfaces).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (!entry || entry.family !== 'IPv4' || entry.internal) return;
      addresses.push(entry.address);
    });
  });
  return [...new Set(addresses)];
}

function serveStatic(res, pathname) {
  const relativePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(publicDir, relativePath));
  if (!filePath.startsWith(publicDir)) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  fs.readFile(filePath, (error, file) => {
    if (error) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(filePath) });
    res.end(file);
  });
}

function nextDailyRefreshTime() {
  const next = new Date();
  next.setHours(8, 0, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  return next;
}

async function runScheduledRefresh(reason) {
  const startedAt = new Date();
  console.log(`[schedule] ${reason} refresh started at ${startedAt.toLocaleString()}`);
  try {
    const data = await refreshData();
    console.log(`[schedule] refresh complete (${data.schedule.length} events) at ${new Date().toLocaleString()}`);
  } catch (error) {
    console.error(`[schedule] refresh failed: ${error.message}`);
  }
}

function scheduleDailyRefresh() {
  const nextRun = nextDailyRefreshTime();
  const delay = Math.max(1000, nextRun.getTime() - Date.now());
  console.log(`[schedule] next automatic refresh at ${nextRun.toLocaleString()}`);
  setTimeout(async () => {
    await runScheduledRefresh('8:00 AM automatic');
    scheduleDailyRefresh();
  }, delay);
}

async function runDiamondStatusMonitor(reason) {
  if (!smtpConfigured()) {
    console.log(`[diamond-status] ${reason}: email sender not configured`);
    return;
  }
  try {
    const result = await checkForDiamondStatusAlerts();
    if (result.delivered.length) {
      console.log(`[diamond-status] ${reason}: sent ${result.delivered.length} alert batch(es)`);
    } else {
      console.log(`[diamond-status] ${reason}: no new status alerts`);
    }
  } catch (error) {
    console.error(`[diamond-status] ${reason} failed: ${error.message}`);
  }
}

function scheduleDiamondStatusMonitor() {
  console.log('[diamond-status] monitoring every 20 minutes');
  setTimeout(() => {
    runDiamondStatusMonitor('startup baseline');
  }, 3000);
  setInterval(() => {
    runDiamondStatusMonitor('20-minute check');
  }, 20 * 60 * 1000);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url.pathname);
      return;
    }
    if (url.pathname === '/admin.html' && !canAccessAdminPortalRequest(req)) {
      res.writeHead(302, { Location: '/' });
      res.end();
      return;
    }
    if (url.pathname === '/diamond-status-admin.html' && !canAccessStatusEditorRequest(req)) {
      res.writeHead(302, { Location: '/' });
      res.end();
      return;
    }
    serveStatic(res, url.pathname);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error.message || 'Server error' }));
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Titans scheduler listening on http://127.0.0.1:${port}`);
  const addresses = localAddresses();
  if (addresses.length) {
    console.log('Share this link with coaches on the same network:');
    addresses.forEach((address) => {
      console.log(`  http://${address}:${port}`);
    });
  } else {
    console.log('No local network IPv4 address was detected.');
  }
  if (useSupabaseStore()) {
    console.log('Request storage: Supabase');
  } else {
    console.log(`Request storage: local file (${storageFile})`);
  }
  if (notificationsEnabled()) {
    console.log('Discord notifications: enabled');
  } else {
    console.log('Discord notifications: disabled (set DISCORD_WEBHOOK_URL to enable)');
  }
  if (smtpConfigured()) {
    console.log('Email alerts: enabled');
  } else {
    console.log('Email alerts: disabled (set EMAIL_USER and EMAIL_APP_PASSWORD to enable)');
  }
  scheduleDailyRefresh();
  scheduleDiamondStatusMonitor();
});
