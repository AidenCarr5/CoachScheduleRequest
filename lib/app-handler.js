const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tls = require('tls');
const { loadData, refreshData, dataVersion } = require('./data-store');

const rootDir = path.join(__dirname, '..');
const storageDir = path.join(rootDir, 'storage');
const storageFile = path.join(storageDir, 'requests.json');
const configPath = path.join(rootDir, 'site', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const adminPassword = process.env.ADMIN_PASSWORD || '55aiden55';
const cookieName = 'titans_admin_session';
const sessionSecret = process.env.SESSION_SECRET || 'titans-local-secret';
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const emailUser = process.env.EMAIL_USER || 'titansupdate@gmail.com';
const emailTo = process.env.EMAIL_TO || emailUser;
const emailAppPassword = process.env.EMAIL_APP_PASSWORD || '';
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

function useSupabaseStore() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

function emailEnabled() {
  return Boolean(emailAppPassword);
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: supabaseServiceRoleKey,
    Authorization: `Bearer ${supabaseServiceRoleKey}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function supabaseFetch(pathname, options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
    ...options,
    headers: supabaseHeaders(options.headers || {})
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Supabase request failed: ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function rowToRequest(row) {
  return {
    ...(row.payload || {}),
    id: row.id,
    status: row.status,
    submittedAt: row.submitted_at || (row.payload || {}).submittedAt || '',
    reviewedAt: row.reviewed_at || (row.payload || {}).reviewedAt || '',
    reviewedBy: row.reviewed_by || (row.payload || {}).reviewedBy || '',
    adminNote: row.admin_note || (row.payload || {}).adminNote || ''
  };
}

function requestToRow(request) {
  return {
    id: request.id,
    status: request.status || 'pending',
    submitted_at: request.submittedAt || new Date().toISOString(),
    reviewed_at: request.reviewedAt || null,
    reviewed_by: request.reviewedBy || null,
    admin_note: request.adminNote || '',
    payload: request
  };
}

async function listRequestsStore() {
  if (!useSupabaseStore()) {
    return readStore().requests;
  }
  const rows = await supabaseFetch('coach_requests?select=id,status,submitted_at,reviewed_at,reviewed_by,admin_note,payload&order=submitted_at.desc');
  return rows.map(rowToRequest);
}

async function insertRequestStore(request) {
  if (!useSupabaseStore()) {
    const store = readStore();
    store.requests.unshift(request);
    writeStore(store);
    return request;
  }
  const rows = await supabaseFetch('coach_requests', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(requestToRow(request))
  });
  return rowToRequest(rows[0]);
}

async function updateRequestStore(requestId, updater) {
  if (!useSupabaseStore()) {
    const store = readStore();
    const request = store.requests.find((item) => item.id === requestId);
    if (!request) return null;
    updater(request);
    writeStore(store);
    return request;
  }
  const rows = await supabaseFetch(`coach_requests?id=eq.${encodeURIComponent(requestId)}&select=id,status,submitted_at,reviewed_at,reviewed_by,admin_note,payload`);
  if (!rows.length) return null;
  const request = rowToRequest(rows[0]);
  updater(request);
  const updatedRows = await supabaseFetch(`coach_requests?id=eq.${encodeURIComponent(requestId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(requestToRow(request))
  });
  return rowToRequest(updatedRows[0]);
}

async function deleteRequestStore(requestId) {
  if (!useSupabaseStore()) {
    const store = readStore();
    const nextRequests = store.requests.filter((item) => item.id !== requestId);
    if (nextRequests.length === store.requests.length) return false;
    store.requests = nextRequests;
    writeStore(store);
    return true;
  }
  const deletedRows = await supabaseFetch(`coach_requests?id=eq.${encodeURIComponent(requestId)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' }
  });
  return Array.isArray(deletedRows) && deletedRows.length > 0;
}

async function clearAllRequestsStore() {
  if (!useSupabaseStore()) {
    writeStore({ requests: [] });
    return;
  }
  await supabaseFetch('coach_requests?id=not.is.null', {
    method: 'DELETE'
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
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
    if (req.body && typeof req.body === 'object') {
      resolve(req.body);
      return;
    }
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

function requestSummary(request) {
  const lines = [
    'A coach submitted a new Titans schedule request.',
    '',
    `Action: ${request.action || ''}`,
    `Team: ${request.team || ''}`,
    `Submitted by: ${request.submittedBy || 'Coach'}`,
    `Submitted at: ${request.submittedAt || ''}`,
    '',
    'New / requested event',
    `Type: ${request.newType || request.action || ''}`,
    `Date: ${request.date || ''}`,
    `Start: ${request.start || ''}`,
    `End: ${request.end || ''}`,
    `Opponent / title: ${request.opponent || ''}`,
    `Diamond: ${request.diamond || ''}`,
    `Availability check: ${request.availabilityStatus || ''}`,
    `Reason / notes: ${request.reason || ''}`
  ];
  if (request.originalId || request.originalType || request.originalDate) {
    lines.push(
      '',
      'Original event being changed',
      `Original ID: ${request.originalId || ''}`,
      `Original type: ${request.originalType || ''}`,
      `Original date: ${request.originalDate || ''}`,
      `Original start: ${request.originalStart || ''}`,
      `Original opponent / title: ${request.originalOpponent || ''}`,
      `Original diamond: ${request.originalDiamond || ''}`
    );
  }
  return lines.join('\n');
}

function smtpConversation(socket) {
  let buffer = '';
  const queue = [];
  const pending = [];

  function flushQueue() {
    while (queue.length && pending.length) {
      pending.shift().resolve(queue.shift());
    }
  }

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      const rawLine = buffer.slice(0, index + 1);
      buffer = buffer.slice(index + 1);
      const line = rawLine.trim();
      if (!line) continue;
      queue.push(line);
      flushQueue();
    }
  });

  socket.on('error', (error) => {
    while (pending.length) pending.shift().reject(error);
  });

  return function nextLine() {
    return new Promise((resolve, reject) => {
      pending.push({ resolve, reject });
      flushQueue();
    });
  };
}

async function smtpExpect(nextLine, expectedCode) {
  const lines = [];
  while (true) {
    const line = await nextLine();
    lines.push(line);
    const code = Number(line.slice(0, 3));
    if (code !== expectedCode) {
      throw new Error(`SMTP expected ${expectedCode} but received: ${lines.join(' | ')}`);
    }
    if (line[3] !== '-') return lines;
  }
}

function smtpCommand(socket, command) {
  socket.write(`${command}\r\n`);
}

function toBase64(value) {
  return Buffer.from(value, 'utf8').toString('base64');
}

function buildEmailMessage(request) {
  const subject = `New Titans coach request: ${request.team || 'Unknown team'} - ${request.action || 'update'}`;
  const body = requestSummary(request).replace(/\r?\n/g, '\r\n').replace(/\r\n\./g, '\r\n..');
  return [
    `From: ${emailUser}`,
    `To: ${emailTo}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    body,
    '.'
  ].join('\r\n');
}

async function sendRequestNotification(request) {
  if (!emailEnabled()) return;
  await new Promise((resolve, reject) => {
    const socket = tls.connect(465, 'smtp.gmail.com');
    const nextLine = smtpConversation(socket);
    socket.once('secureConnect', async () => {
      try {
        await smtpExpect(nextLine, 220);
        smtpCommand(socket, 'EHLO titans-scheduler');
        await smtpExpect(nextLine, 250);
        smtpCommand(socket, 'AUTH LOGIN');
        await smtpExpect(nextLine, 334);
        smtpCommand(socket, toBase64(emailUser));
        await smtpExpect(nextLine, 334);
        smtpCommand(socket, toBase64(emailAppPassword));
        await smtpExpect(nextLine, 235);
        smtpCommand(socket, `MAIL FROM:<${emailUser}>`);
        await smtpExpect(nextLine, 250);
        smtpCommand(socket, `RCPT TO:<${emailTo}>`);
        await smtpExpect(nextLine, 250);
        smtpCommand(socket, 'DATA');
        await smtpExpect(nextLine, 354);
        socket.write(`${buildEmailMessage(request)}\r\n`);
        await smtpExpect(nextLine, 250);
        smtpCommand(socket, 'QUIT');
        await smtpExpect(nextLine, 221);
        socket.end();
        resolve();
      } catch (error) {
        socket.destroy();
        reject(error);
      }
    });
    socket.once('error', reject);
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/bootstrap') {
    const data = await loadData();
    sendJson(res, 200, {
      data,
      publicConfig: {
        brandName: config.brandName || 'LaSalle Titans',
        adminPath: '/admin.html',
        dataVersion: await dataVersion(),
        storageMode: useSupabaseStore() ? 'supabase' : 'local'
      }
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/public-config') {
    sendJson(res, 200, {
      brandName: config.brandName || 'LaSalle Titans',
      adminPath: '/admin.html',
      dataVersion: await dataVersion(),
      storageMode: useSupabaseStore() ? 'supabase' : 'local'
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/data-version') {
    sendJson(res, 200, { version: await dataVersion() });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/requests') {
    const requests = (await listRequestsStore())
      .filter((request) => request.status !== 'rejected')
      .map(sanitizeRequestForPublic);
    sendJson(res, 200, { requests });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/requests') {
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
    const stored = await insertRequestStore(request);
    sendRequestNotification(stored).catch((error) => {
      console.error('Request email notification failed:', error.message);
    });
    sendJson(res, 201, { request: sanitizeRequestForPublic(stored) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/login') {
    const payload = await readBody(req);
    if ((payload.password || '') !== adminPassword) {
      sendJson(res, 401, { error: 'Invalid password' });
      return;
    }
    const token = createSessionToken();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`);
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/logout') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/session') {
    sendJson(res, 200, { authenticated: isAuthenticated(req) });
    return;
  }

  if (pathname.startsWith('/api/admin/') && !isAuthenticated(req)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/requests') {
    sendJson(res, 200, { requests: await listRequestsStore() });
    return;
  }

  const approvalMatch = pathname.match(/^\/api\/admin\/requests\/([^/]+)\/(approve|reject)$/);
  if (req.method === 'POST' && approvalMatch) {
    const [, requestId, action] = approvalMatch;
    const payload = await readBody(req);
    const request = await updateRequestStore(requestId, (item) => {
      item.status = action === 'approve' ? 'approved' : 'rejected';
      item.adminNote = payload.adminNote || '';
      item.reviewedAt = new Date().toISOString();
      item.reviewedBy = 'Admin';
    });
    if (!request) {
      sendJson(res, 404, { error: 'Request not found' });
      return;
    }
    sendJson(res, 200, { request });
    return;
  }

  const deleteMatch = pathname.match(/^\/api\/admin\/requests\/([^/]+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    const [, requestId] = deleteMatch;
    const deleted = await deleteRequestStore(requestId);
    if (!deleted) {
      sendJson(res, 404, { error: 'Request not found' });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/reset-schedule') {
    if (resetInProgress) {
      sendJson(res, 409, { error: 'Reset already in progress' });
      return;
    }
    resetInProgress = true;
    try {
      const refreshed = await refreshData();
      await clearAllRequestsStore();
      sendJson(res, 200, {
        ok: true,
        version: String(refreshed.scrapedAt || Date.now())
      });
    } catch (error) {
      sendJson(res, 500, { error: 'Reset failed', details: error.message });
    } finally {
      resetInProgress = false;
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

module.exports = {
  handleApi,
  useSupabaseStore,
  emailEnabled,
  storageFile,
  emailTo
};
