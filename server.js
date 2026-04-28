const http = require('http');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const rootDir = __dirname;
const siteDir = path.join(rootDir, 'site');
const storageDir = path.join(rootDir, 'storage');
const storageFile = path.join(storageDir, 'requests.json');
const configPath = path.join(siteDir, 'config.json');
const updateDataScript = path.join(siteDir, 'update-data.js');
const dataFile = path.join(siteDir, 'data.js');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const port = Number(process.env.PORT || 4173);
const adminPassword = process.env.ADMIN_PASSWORD || '55aiden55';
const cookieName = 'titans_admin_session';
const sessionSecret = process.env.SESSION_SECRET || 'titans-local-secret';
let resetInProgress = false;

fs.mkdirSync(storageDir, { recursive: true });
if (!fs.existsSync(storageFile)) {
  fs.writeFileSync(storageFile, JSON.stringify({ requests: [] }, null, 2));
}

function readStore() {
  return JSON.parse(fs.readFileSync(storageFile, 'utf8'));
}

function writeStore(store) {
  fs.writeFileSync(storageFile, JSON.stringify(store, null, 2));
}

function dataVersion() {
  const stats = fs.statSync(dataFile);
  return String(stats.mtimeMs);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, payload, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, { 'Content-Type': contentType });
  res.end(payload);
}

function notFound(res) {
  sendText(res, 404, 'Not found');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function sign(value) {
  return crypto.createHmac('sha256', sessionSecret).update(value).digest('hex');
}

function createSessionToken() {
  const payload = JSON.stringify({ ts: Date.now() });
  const encoded = Buffer.from(payload, 'utf8').toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  const token = cookies[cookieName];
  if (!token) return false;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return false;
  return sign(encoded) === signature;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sanitizeRequestForPublic(request) {
  return {
    id: request.id,
    action: request.action,
    team: request.team,
    originalId: request.originalId || '',
    originalType: request.originalType || '',
    originalDate: request.originalDate || '',
    originalStart: request.originalStart || '',
    originalOpponent: request.originalOpponent || '',
    originalDiamond: request.originalDiamond || '',
    newType: request.newType || '',
    date: request.date,
    start: request.start,
    end: request.end,
    opponent: request.opponent,
    diamond: request.diamond,
    reason: request.reason,
    availabilityStatus: request.availabilityStatus,
    submittedAt: request.submittedAt,
    submittedBy: request.submittedBy || 'Coach',
    status: request.status || 'pending',
    adminNote: request.adminNote || ''
  };
}

function createRequestId() {
  return `req-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

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

function serveStatic(req, res, pathname) {
  const relativePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(siteDir, relativePath));
  if (!filePath.startsWith(siteDir)) {
    notFound(res);
    return;
  }
  fs.readFile(filePath, (error, file) => {
    if (error) {
      notFound(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(filePath) });
    res.end(file);
  });
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/public-config') {
    sendJson(res, 200, {
      brandName: config.brandName || 'LaSalle Titans',
      adminPath: '/admin.html',
      dataVersion: dataVersion()
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/data-version') {
    sendJson(res, 200, { version: dataVersion() });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/requests') {
    const store = readStore();
    const requests = store.requests
      .filter((request) => request.status !== 'rejected')
      .map(sanitizeRequestForPublic);
    sendJson(res, 200, { requests });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/requests') {
    const payload = await readBody(req);
    const request = {
      ...payload,
      id: createRequestId(),
      status: 'pending',
      submittedAt: new Date().toISOString(),
      reviewedAt: '',
      reviewedBy: '',
      adminNote: ''
    };
    const store = readStore();
    store.requests.unshift(request);
    writeStore(store);
    sendJson(res, 201, { request: sanitizeRequestForPublic(request) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    const payload = await readBody(req);
    if ((payload.password || '') !== adminPassword) {
      sendJson(res, 401, { error: 'Invalid password' });
      return;
    }
    const token = createSessionToken();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/session') {
    sendJson(res, 200, { authenticated: isAuthenticated(req) });
    return;
  }

  if (url.pathname.startsWith('/api/admin/')) {
    if (!isAuthenticated(req)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/requests') {
    const store = readStore();
    sendJson(res, 200, { requests: store.requests });
    return;
  }

  const approvalMatch = url.pathname.match(/^\/api\/admin\/requests\/([^/]+)\/(approve|reject)$/);
  if (req.method === 'POST' && approvalMatch) {
    const [, requestId, action] = approvalMatch;
    const payload = await readBody(req);
    const store = readStore();
    const request = store.requests.find((item) => item.id === requestId);
    if (!request) {
      sendJson(res, 404, { error: 'Request not found' });
      return;
    }
    request.status = action === 'approve' ? 'approved' : 'rejected';
    request.adminNote = payload.adminNote || '';
    request.reviewedAt = new Date().toISOString();
    request.reviewedBy = 'Admin';
    writeStore(store);
    sendJson(res, 200, { request });
    return;
  }

  const deleteMatch = url.pathname.match(/^\/api\/admin\/requests\/([^/]+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    const [, requestId] = deleteMatch;
    const store = readStore();
    const nextRequests = store.requests.filter((item) => item.id !== requestId);
    if (nextRequests.length === store.requests.length) {
      sendJson(res, 404, { error: 'Request not found' });
      return;
    }
    store.requests = nextRequests;
    writeStore(store);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/reset-schedule') {
    if (resetInProgress) {
      sendJson(res, 409, { error: 'Reset already in progress' });
      return;
    }
    resetInProgress = true;
    execFile(process.execPath, [updateDataScript], { cwd: rootDir }, (error, stdout, stderr) => {
      resetInProgress = false;
      if (error) {
        sendJson(res, 500, {
          error: 'Reset failed',
          details: stderr || error.message
        });
        return;
      }
      writeStore({ requests: [] });
      sendJson(res, 200, {
        ok: true,
        version: dataVersion(),
        output: stdout.trim()
      });
    });
    return;
  }

  notFound(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Server error' });
  }
});

server.listen(port, () => {
  console.log(`Titans scheduler listening on http://127.0.0.1:${port}`);
});
