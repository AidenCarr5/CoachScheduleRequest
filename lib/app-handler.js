const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadData, refreshData, dataVersion } = require('./data-store');

const rootDir = path.join(__dirname, '..');
const storageDir = path.join(rootDir, 'storage');
const storageFile = path.join(storageDir, 'requests.json');
const configPath = path.join(rootDir, 'site', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const adminPassword = process.env.ADMIN_PASSWORD || '55aiden55';
const coachPassword = process.env.COACH_PASSWORD || 'password';
const cookieName = 'titans_admin_session';
const coachCookieName = 'titans_coach_session';
const sessionSecret = process.env.SESSION_SECRET || 'titans-local-secret';
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL || '';
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

function notificationsEnabled() {
  return Boolean(discordWebhookUrl);
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

function createSessionToken(session = {}) {
  const payload = JSON.stringify({ ...session, ts: Date.now() });
  const encoded = Buffer.from(payload, 'utf8').toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

function readSignedSession(req, name) {
  const cookies = parseCookies(req);
  const token = cookies[name];
  if (!token) return false;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return false;
  if (sign(encoded) !== signature) return false;
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch (_) {
    return false;
  }
}

function isAuthenticated(req) {
  return Boolean(readSignedSession(req, cookieName));
}

function readCoachSession(req) {
  return readSignedSession(req, coachCookieName);
}

function coachUsernameForTeam(team) {
  const ageMatch = String(team).match(/^(\d+U(?:\/\d+U)?)/i);
  const nameMatch = String(team).match(/\(([^)]+)\)/);
  const age = (ageMatch ? ageMatch[1] : '').replace(/[^a-z0-9]/gi, '');
  const name = (nameMatch ? nameMatch[1] : team).replace(/[^a-z0-9]/gi, '');
  return `${name}${age}`;
}

function coachAccounts(data) {
  return (data.teams || []).map((team) => ({
    username: coachUsernameForTeam(team),
    password: coachPassword,
    team
  }));
}

function findCoachAccount(data, username) {
  const normalized = String(username || '').toLowerCase();
  return coachAccounts(data).find((account) => account.username.toLowerCase() === normalized);
}

function filterDataForSession(data, session) {
  if (!session || session.role === 'admin') return data;
  return {
    ...data,
    teams: [session.team],
    schedule: data.schedule.filter((event) => event.team === session.team)
  };
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

function minutesFromDisplay(value) {
  const match = String(value || '').match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return 0;
  let hours = Number(match[1]);
  const mins = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (meridiem === 'PM' && hours !== 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  return hours * 60 + mins;
}

function displayFromMinutes(total) {
  const normalized = ((total % 1440) + 1440) % 1440;
  const rawHour = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const meridiem = rawHour >= 12 ? 'PM' : 'AM';
  const hour = rawHour % 12 || 12;
  return `${hour}:${String(mins).padStart(2, '0')} ${meridiem}`;
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function clippedRange(start, end, min, max) {
  return {
    start: Math.max(start, min),
    end: Math.min(end, max)
  };
}

function buildAvailabilityBlocks(data) {
  const diamonds = [...new Set((data.availability || []).map((slot) => slot.diamond).filter(Boolean))].sort();
  const diamondSet = new Set(diamonds);
  const calendarDates = (data.conflictEvents || data.schedule || [])
    .filter((event) => diamondSet.has(event.diamond))
    .map((event) => event.date);
  const dates = [...new Set([
    ...(data.availability || []).map((slot) => slot.date),
    ...calendarDates
  ].filter(Boolean))].sort();
  let availableCount = 0;
  let bookedCount = 0;

  const days = dates.map((date) => {
    const dateObject = new Date(`${date}T12:00:00`);
    const isWeekend = dateObject.getDay() === 0 || dateObject.getDay() === 6;
    const defaultStart = isWeekend ? 480 : 1080;
    const defaultEnd = 1200;
    const dayAvailability = (data.availability || []).filter((slot) => slot.date === date);
    const availabilityStarts = dayAvailability.map((slot) => minutesFromDisplay(slot.start)).filter(Boolean);
    const availabilityEnds = dayAvailability.map((slot) => minutesFromDisplay(slot.end)).filter(Boolean);
    const windowStart = availabilityStarts.length ? Math.min(defaultStart, ...availabilityStarts) : defaultStart;
    const windowEnd = availabilityEnds.length ? Math.max(defaultEnd, ...availabilityEnds) : defaultEnd;
    const diamondRows = diamonds.map((diamond) => {
      const openRanges = [{ start: windowStart, end: windowEnd }];
      const conflicts = (data.conflictEvents || data.schedule || [])
        .filter((event) => event.date === date && event.diamond === diamond)
        .map((event) => {
          const eventStart = minutesFromDisplay(event.time);
          const eventEnd = event.endTime ? minutesFromDisplay(event.endTime) : eventStart + (event.durationMinutes || 120);
          return {
            ...clippedRange(eventStart, eventEnd, windowStart, windowEnd),
            label: `${event.team} ${event.opponent}`.trim()
          };
        })
        .filter((range) => range.end > range.start);
      const boundaries = [windowStart, windowEnd];
      openRanges.forEach((range) => boundaries.push(range.start, range.end));
      conflicts.forEach((range) => boundaries.push(range.start, range.end));
      const sortedBoundaries = [...new Set(boundaries)].sort((a, b) => a - b);
      const segments = [];
      for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
        const start = sortedBoundaries[index];
        const end = sortedBoundaries[index + 1];
        if (end <= start) continue;
        const open = openRanges.some((range) => range.start <= start && range.end >= end);
        const conflict = conflicts.find((range) => rangesOverlap(start, end, range.start, range.end));
        const available = open && !conflict;
        const last = segments[segments.length - 1];
        if (last && last.status === (available ? 'available' : 'booked') && last.conflict === (conflict ? conflict.label : '')) {
          last.endMinutes = end;
          last.end = displayFromMinutes(end);
          continue;
        }
        segments.push({
          start: displayFromMinutes(start),
          end: displayFromMinutes(end),
          startMinutes: start,
          endMinutes: end,
          width: ((end - start) / (windowEnd - windowStart)) * 100,
          status: available ? 'available' : 'booked',
          label: available ? 'Available' : 'Booked / unavailable',
          conflict: conflict ? conflict.label : ''
        });
      }
      availableCount += segments.filter((segment) => segment.status === 'available').length;
      bookedCount += segments.filter((segment) => segment.status !== 'available').length;
      return {
        diamond,
        segments
      };
    });
    return {
      date,
      day: dateObject.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }),
      month: dateObject.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      isWeekend,
      windowStart: displayFromMinutes(windowStart),
      windowEnd: displayFromMinutes(windowEnd),
      diamonds: diamondRows
    };
  });

  return {
    days,
    diamonds,
    availableCount,
    bookedCount,
    slotCount: availableCount + bookedCount
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

async function sendRequestNotification(request) {
  if (!notificationsEnabled()) return;
  const summary = requestSummary(request);
  const response = await fetch(discordWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'Titans Scheduler',
      content: `**New coach schedule request**\n\`\`\`\n${summary.slice(0, 1800)}\n\`\`\``
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Discord notification failed: ${response.status}`);
  }
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/coach/login') {
    const payload = await readBody(req);
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    if (username.toLowerCase() === 'admin' && password === adminPassword) {
      const adminToken = createSessionToken({ role: 'admin', username: 'admin' });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Set-Cookie', [
        `${coachCookieName}=${adminToken}; HttpOnly; SameSite=Strict; Path=/`,
        `${cookieName}=${adminToken}; HttpOnly; SameSite=Strict; Path=/`
      ]);
      res.end(JSON.stringify({ ok: true, user: { role: 'admin', username: 'admin', team: '' } }));
      return;
    }

    const fullData = await loadData();
    const account = findCoachAccount(fullData, username);
    if (!account || password !== account.password) {
      sendJson(res, 401, { error: 'Invalid username or password' });
      return;
    }
    const token = createSessionToken({ role: 'coach', username: account.username, team: account.team });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Set-Cookie', `${coachCookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`);
    res.end(JSON.stringify({ ok: true, user: { role: 'coach', username: account.username, team: account.team } }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/coach/logout') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Set-Cookie', `${coachCookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/coach/session') {
    const session = readCoachSession(req);
    if (!session) {
      sendJson(res, 200, { authenticated: false });
      return;
    }
    sendJson(res, 200, {
      authenticated: true,
      user: {
        role: session.role,
        username: session.username || '',
        team: session.team || ''
      }
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/bootstrap') {
    const session = readCoachSession(req);
    if (!session) {
      sendJson(res, 401, { error: 'Login required' });
      return;
    }
    const data = filterDataForSession(await loadData(), session);
    sendJson(res, 200, {
      data,
      publicConfig: {
        brandName: config.brandName || 'LaSalle Titans',
        adminPath: '/admin.html',
        user: {
          role: session.role,
          username: session.username || '',
          team: session.team || ''
        },
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

  if (req.method === 'GET' && pathname === '/api/availability') {
    const data = await loadData();
    const grid = buildAvailabilityBlocks(data);
    sendJson(res, 200, {
      ...grid,
      teams: data.teams || [],
      dataVersion: await dataVersion()
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/requests') {
    const session = readCoachSession(req);
    if (!session) {
      sendJson(res, 401, { error: 'Login required' });
      return;
    }
    const requests = (await listRequestsStore())
      .filter((request) => request.status !== 'rejected')
      .filter((request) => session.role === 'admin' || request.team === session.team)
      .map(sanitizeRequestForPublic);
    sendJson(res, 200, { requests });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/requests') {
    const session = readCoachSession(req);
    if (!session) {
      sendJson(res, 401, { error: 'Login required' });
      return;
    }
    const payload = await readBody(req);
    const fullData = await loadData();
    const original = payload.originalId ? fullData.schedule.find((event) => event.id === payload.originalId) : null;
    if ((payload.action || '').match(/^(Cancel|Replace) /) && !original) {
      sendJson(res, 400, { error: 'Original event was not found' });
      return;
    }
    if (session.role !== 'admin') {
      if (original && original.team !== session.team) {
        sendJson(res, 403, { error: 'This coach cannot change another team schedule' });
        return;
      }
      payload.team = session.team;
      payload.submittedBy = session.username || session.team;
      if (original) {
        payload.originalType = original.eventKind || original.type;
        payload.originalDate = original.date;
        payload.originalStart = original.time;
        payload.originalOpponent = original.opponent;
        payload.originalDiamond = original.diamond;
      }
    }
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
      console.error('Request notification failed:', error.message);
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
  notificationsEnabled,
  storageFile,
  discordWebhookUrl
};
