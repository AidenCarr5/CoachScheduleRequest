const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadData, refreshData, dataVersion } = require('./data-store');
const { applyApprovedRequest, updateDiamondStatus } = require('./turtle-club-client');
const { sendTestDiamondStatusAlert, sendCoachRequestSubmittedEmail, sendCoachRequestDecisionEmail, smtpConfigured } = require('./diamond-status-monitor');
const { buildEditableStatusRows, normalizeStatusChoice, statusTargetById } = require('./diamond-status-config');

const rootDir = path.join(__dirname, '..');
const storageDir = path.join(rootDir, 'storage');
const storageFile = path.join(storageDir, 'requests.json');
const coachAccountsFile = path.join(storageDir, 'coach-accounts.json');
const configPath = path.join(rootDir, 'site', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const adminPassword = process.env.ADMIN_PASSWORD || '55aiden55';
const readOnlyAdminUsername = String(process.env.READ_ONLY_ADMIN_USERNAME || 'DonHunt').trim();
const readOnlyAdminPassword = String(process.env.READ_ONLY_ADMIN_PASSWORD || 'awRtum').trim();
const coachPassword = process.env.COACH_PASSWORD || 'password';
const statusEditorUsername = String(process.env.STATUS_EDITOR_USERNAME || 'ecarr').trim();
const statusEditorPassword = String(process.env.STATUS_EDITOR_PASSWORD || 'Nikicarr1');
const cookieName = 'titans_admin_session';
const coachCookieName = 'titans_coach_session';
const sessionSecret = process.env.SESSION_SECRET || 'titans-local-secret';
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL || '';
const diamondStatusUrl = 'https://turtleclubbaseball.com/Pages/1487/Status/';

fs.mkdirSync(storageDir, { recursive: true });
if (!fs.existsSync(storageFile)) {
  fs.writeFileSync(storageFile, JSON.stringify({ requests: [] }, null, 2));
}
if (!fs.existsSync(coachAccountsFile)) {
  fs.writeFileSync(coachAccountsFile, JSON.stringify({ accounts: [] }, null, 2));
}

function readStore() {
  return JSON.parse(fs.readFileSync(storageFile, 'utf8'));
}

function writeStore(store) {
  fs.writeFileSync(storageFile, JSON.stringify(store, null, 2));
}

function readCoachAccountStore() {
  return JSON.parse(fs.readFileSync(coachAccountsFile, 'utf8'));
}

function writeCoachAccountStore(store) {
  fs.writeFileSync(coachAccountsFile, JSON.stringify(store, null, 2));
}

function useSupabaseStore() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

function notificationsEnabled() {
  return Boolean(discordWebhookUrl);
}

function nextDailyRefreshAt() {
  const next = new Date();
  next.setHours(8, 0, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  return next.toISOString();
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

function statusEditorPath() {
  return '/diamond-status-admin.html';
}

function sessionInitials(session) {
  if (!session) return '';
  if (session.initials) return String(session.initials);
  if (session.role === 'admin') return 'AC';
  if (session.role === 'admin_viewer') return 'DH';
  if (session.role === 'status_editor') return 'EC';
  return '';
}

function canAccessStatusEditorSession(session) {
  return Boolean(session && (session.role === 'admin' || session.role === 'admin_viewer' || session.role === 'status_editor'));
}

function canAccessStatusEditorRequest(req) {
  return canAccessStatusEditorSession(readCoachSession(req));
}

function canAccessAdminPortalSession(session) {
  return Boolean(session && (session.role === 'admin' || session.role === 'admin_viewer'));
}

function canAccessAdminPortalRequest(req) {
  return canAccessAdminPortalSession(readCoachSession(req));
}

function canMutateAdminPortalSession(session) {
  return Boolean(session && session.role === 'admin');
}

function canMutateStatusEditorSession(session) {
  return Boolean(session && (session.role === 'admin' || session.role === 'status_editor'));
}

function canAccessCoachProfileSession(session) {
  return Boolean(session && session.role === 'coach');
}

function canAccessCoachProfileRequest(req) {
  return canAccessCoachProfileSession(readCoachSession(req));
}

function adminPathForSession(session) {
  if (session && session.role === 'status_editor') return '/';
  return canAccessAdminPortalSession(session) ? '/admin.html' : '/admin.html';
}

function fieldStatusPathForSession(session) {
  return canAccessStatusEditorSession(session) ? statusEditorPath() : '';
}

function profilePathForSession(session) {
  return canAccessCoachProfileSession(session) ? '/profile.html' : '';
}

function coachUsernameForTeam(team) {
  const ageMatch = String(team).match(/^(\d+U(?:\/\d+U)?)/i);
  const nameMatch = String(team).match(/\(([^)]+)\)/);
  const age = (ageMatch ? ageMatch[1] : '').replace(/[^a-z0-9]/gi, '');
  const name = (nameMatch ? nameMatch[1] : team).replace(/[^a-z0-9]/gi, '');
  return `${name}${age}`;
}

function randomCoachPassword(length = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes = crypto.randomBytes(length);
  let password = '';
  for (let index = 0; index < length; index += 1) {
    password += alphabet[bytes[index] % alphabet.length];
  }
  return password;
}

function coachAccounts(data) {
  return (data.teams || []).map((team) => ({
    username: coachUsernameForTeam(team),
    password: coachPassword,
    email: '',
    team
  }));
}

function syncCoachAccounts(data) {
  const generated = coachAccounts(data);
  const store = readCoachAccountStore();
  const existingByUsername = new Map((store.accounts || []).map((account) => [String(account.username || '').toLowerCase(), account]));
  const synced = generated.map((account) => {
    const existing = existingByUsername.get(account.username.toLowerCase());
    const existingPassword = existing && existing.password ? String(existing.password) : '';
    return {
      username: account.username,
      password: existingPassword && existingPassword !== coachPassword ? existingPassword : randomCoachPassword(),
      email: existing && existing.email ? String(existing.email) : '',
      team: account.team
    };
  });
  writeCoachAccountStore({ accounts: synced });
  return synced;
}

function currentCoachAccounts(data) {
  return syncCoachAccounts(data);
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&rsquo;/gi, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();
}

function collectSectionLines(lines, title, nextTitles) {
  const start = lines.indexOf(title);
  if (start < 0) return [];
  let end = lines.length;
  for (const nextTitle of nextTitles) {
    const nextIndex = lines.indexOf(nextTitle, start + 1);
    if (nextIndex >= 0 && nextIndex < end) end = nextIndex;
  }
  return lines.slice(start + 1, end);
}

function parseDiamondStatusRows(sectionLines, title, labels) {
  const lines = sectionLines.filter((line) => !['Diamond', 'Status', 'Date', 'Time', 'Updated By', 'Comments'].includes(line));
  const rows = [];

  for (const label of labels) {
    const start = lines.indexOf(label);
    if (start < 0) {
      rows.push({
        group: title,
        diamond: label,
        status: 'Unavailable',
        updatedAt: '',
        updatedBy: '',
        comments: ''
      });
      continue;
    }

    let end = lines.length;
    for (const nextLabel of labels) {
      if (nextLabel === label) continue;
      const nextIndex = lines.indexOf(nextLabel, start + 1);
      if (nextIndex >= 0 && nextIndex < end) end = nextIndex;
    }

    const rowLines = lines.slice(start + 1, end);
    const status = rowLines[0] || 'Unavailable';
    const updatedAtParts = [];
    if (rowLines[1]) updatedAtParts.push(rowLines[1]);
    if (rowLines[2] && /\d{1,2}:\d{2}\s*(?:am|pm)/i.test(rowLines[2])) updatedAtParts.push(rowLines[2]);

    let cursor = updatedAtParts.length + 1;
    const remaining = rowLines.slice(cursor).filter(Boolean);
    let updatedBy = '';
    let comments = '';

    if (remaining.length) {
      if (/^[A-Z]{1,4}$/.test(remaining[0])) {
        updatedBy = remaining[0];
        comments = remaining.slice(1).join(' ');
      } else if (remaining.length > 1) {
        updatedBy = remaining[0];
        comments = remaining.slice(1).join(' ');
      } else if (title === 'Vollmer and River Canard Diamonds') {
        comments = remaining[0];
      } else {
        updatedBy = remaining[0];
      }
    }

    rows.push({
      group: title,
      diamond: label,
      status,
      updatedAt: updatedAtParts.join(' ').trim(),
      updatedBy,
      comments
    });
  }

  return rows;
}

function parseDiamondStatus(html) {
  const text = stripHtml(html);
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const start = lines.indexOf('Diamond Status');
  const end = lines.indexOf('Get Mobile!');
  const contentLines = lines.slice(start >= 0 ? start : 0, end > (start >= 0 ? start : -1) ? end : lines.length);

  const turtleTitle = 'Turtle Club Diamonds';
  const villanovaTitle = 'Villanova Diamonds';
  const vollmerTitle = 'Vollmer and River Canard Diamonds';

  const turtleLines = collectSectionLines(contentLines, turtleTitle, [villanovaTitle, vollmerTitle]);
  const villanovaLines = collectSectionLines(contentLines, villanovaTitle, [vollmerTitle]);
  const vollmerLines = collectSectionLines(contentLines, vollmerTitle, []);

  return {
    source: diamondStatusUrl,
    fetchedAt: new Date().toISOString(),
    rows: [
      ...parseDiamondStatusRows(turtleLines, turtleTitle, ['1', '2', '3', '4', '5', '6', '7']),
      ...parseDiamondStatusRows(villanovaLines, villanovaTitle, ['1', '2']),
      ...parseDiamondStatusRows(vollmerLines, vollmerTitle, ['All Diamonds'])
    ]
  };
}

async function loadDiamondStatus() {
  const response = await fetch(diamondStatusUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    }
  });
  if (!response.ok) {
    throw new Error(`Diamond status could not be loaded (${response.status}).`);
  }
  return parseDiamondStatus(await response.text());
}

function editableDiamondStatusPayload(statusPayload) {
  return {
    source: statusPayload.source,
    fetchedAt: statusPayload.fetchedAt,
    rows: buildEditableStatusRows(statusPayload.rows || [])
  };
}

async function waitForDiamondStatusUpdate(targetId, desiredStatus, options = {}) {
  const timeoutMs = options.timeoutMs || 25000;
  const intervalMs = options.intervalMs || 2500;
  const deadline = Date.now() + timeoutMs;
  let latestPayload = null;
  const expected = normalizeStatusChoice(desiredStatus);

  while (Date.now() <= deadline) {
    latestPayload = editableDiamondStatusPayload(await loadDiamondStatus());
    const row = latestPayload.rows.find((item) => item.targetId === targetId);
    if (row && normalizeStatusChoice(row.status) === expected) {
      return {
        ok: true,
        payload: latestPayload,
        row,
        details: `${row.label} now shows ${row.status}.`
      };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const latestRow = latestPayload && latestPayload.rows
    ? latestPayload.rows.find((item) => item.targetId === targetId)
    : null;

  return {
    ok: false,
    payload: latestPayload,
    row: latestRow,
    details: latestRow
      ? `${latestRow.label} still shows ${latestRow.status || 'Unavailable'} on the public Turtle Club status page.`
      : 'The updated diamond row could not be found on the public Turtle Club status page.'
  };
}

function findCoachAccount(data, username) {
  const normalized = String(username || '').toLowerCase();
  return currentCoachAccounts(data).find((account) => account.username.toLowerCase() === normalized);
}

function updateCoachAccount(username, updates = {}) {
  const normalized = String(username || '').toLowerCase();
  const store = readCoachAccountStore();
  const accounts = Array.isArray(store.accounts) ? store.accounts : [];
  let found = false;
  const nextAccounts = accounts.map((account) => {
    if (String(account.username || '').toLowerCase() !== normalized) return account;
    found = true;
    const nextAccount = { ...account };
    if (Object.prototype.hasOwnProperty.call(updates, 'password')) {
      nextAccount.password = String(updates.password);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'email')) {
      nextAccount.email = String(updates.email || '').trim();
    }
    return nextAccount;
  });
  if (!found) return null;
  writeCoachAccountStore({ accounts: nextAccounts });
  return nextAccounts.find((account) => String(account.username || '').toLowerCase() === normalized) || null;
}

function filterDataForSession(data, session) {
  if (!session || session.role === 'admin' || session.role === 'admin_viewer' || session.role === 'status_editor') return data;
  return {
    ...data,
    teams: [session.team],
    schedule: data.schedule.filter((event) => event.team === session.team)
  };
}

function requestVisibleToSession(request, session) {
  if (!session) return false;
  if (session.role === 'admin' || session.role === 'admin_viewer' || session.role === 'status_editor') return true;
  const submittedBy = String(request.submittedBy || '').toLowerCase();
  const username = String(session.username || '').toLowerCase();
  return Boolean(username && submittedBy && submittedBy === username);
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
    reviewedAt: request.reviewedAt || '',
    reviewedBy: request.reviewedBy || '',
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

function todayIsoLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function eventEndMinutes(event) {
  const start = minutesFromDisplay(event.time);
  if (event.endTime) return minutesFromDisplay(event.endTime);
  return start + (event.durationMinutes || 120);
}

function requestEndMinutes(request) {
  const start = minutesFromDisplay(request.start);
  if (request.end) return minutesFromDisplay(request.end);
  return start + 120;
}

function normalizeCompare(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^vs\.?\s*/i, '')
    .replace(/[^\w]+/g, ' ')
    .trim();
}

function normalizeAvailabilityDiamond(value) {
  return String(value || '')
    .replace(/\s*\[[A-Z0-9-]+\]\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function labelsLikelyMatch(left, right) {
  const a = normalizeCompare(left);
  const b = normalizeCompare(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function eventIsMarkedCancelled(event) {
  return normalizeCompare(`${event && event.eventKind || ''} ${event && event.type || ''} ${event && event.subject || ''} ${event && event.opponent || ''}`)
    .includes('cancelled');
}

function eventMatchesRequestShape(event, request) {
  if (!event || !request) return false;
  if (String(event.date || '') !== String(request.date || '')) return false;
  if (normalizeCompare(event.team) !== normalizeCompare(request.team)) return false;
  const requestType = String(request.newType || request.action || '').toLowerCase();
  const isAwayRequest = requestType.includes('away');
  if (isAwayRequest) {
    if (!labelsLikelyMatch(event.diamond, request.diamond)) return false;
  } else if (normalizeCompare(event.diamond) !== normalizeCompare(request.diamond)) {
    return false;
  }
  if (minutesFromDisplay(event.time) !== minutesFromDisplay(request.start)) return false;

  const eventKind = String(event.eventKind || event.type || '').toLowerCase();
  if (requestType.includes('practice') && !eventKind.includes('practice')) return false;
  if (requestType.includes('away') && !eventKind.includes('game')) return false;
  if (requestType.includes('home') && !eventKind.includes('home')) return false;
  if (requestType.includes('game') && !requestType.includes('away') && !requestType.includes('home') && !eventKind.includes('game')) return false;

  const opponent = normalizeCompare(request.opponent || '');
  if (opponent && opponent !== 'practice') {
    const eventOpponent = normalizeCompare(event.opponent || '');
    if (isAwayRequest ? !labelsLikelyMatch(eventOpponent, opponent) : (eventOpponent !== opponent && !eventOpponent.includes(opponent) && !opponent.includes(eventOpponent))) {
      return false;
    }
  }

  return true;
}

function originalEventStillPresent(data, request) {
  const items = [...(data.conflictEvents || []), ...(data.schedule || [])];
  return items.some((event) => {
    if (eventIsMarkedCancelled(event)) return false;
    if (request.originalId && event.id === request.originalId) return true;
    return String(event.date || '') === String(request.originalDate || '')
      && normalizeCompare(event.team) === normalizeCompare(request.team)
      && normalizeCompare(event.diamond) === normalizeCompare(request.originalDiamond)
      && minutesFromDisplay(event.time) === minutesFromDisplay(request.originalStart)
      && normalizeCompare(event.opponent || '') === normalizeCompare(request.originalOpponent || '');
  });
}

function findVerifiedCreatedEvent(data, request, applyResult) {
  const items = [...(data.conflictEvents || []), ...(data.schedule || [])];
  const createdRemoteId = String(applyResult && applyResult.createdEvent && applyResult.createdEvent.remoteId || '').trim();
  if (createdRemoteId) {
    const idMatch = items.find((event) => String(event.id || '').trim() === `tc-cp-${createdRemoteId}`);
    if (idMatch) return idMatch;
  }
  return items.find((event) => eventMatchesRequestShape(event, request)) || null;
}

function verifyApprovedRequestApplied(request, data, applyResult) {
  const action = String(request.action || '');
  const createdEvent = findVerifiedCreatedEvent(data, request, applyResult);
  const originalPresent = originalEventStillPresent(data, request);

  if (action.startsWith('Cancel ')) {
    return originalPresent
      ? { ok: false, details: 'The original event still appears in the refreshed Turtle Club schedule.' }
      : { ok: true, details: 'Verified: the original event no longer appears in the refreshed Turtle Club schedule.' };
  }

  if (action.startsWith('Replace ')) {
    if (originalPresent) {
      return { ok: false, details: 'The original event still appears in the refreshed Turtle Club schedule.' };
    }
    if (!createdEvent) {
      return { ok: false, details: 'The replacement event was not found in the refreshed Turtle Club schedule.' };
    }
    return {
      ok: true,
      details: `Verified: replacement event is visible on ${createdEvent.date} at ${createdEvent.time} on ${createdEvent.diamond}.`
    };
  }

  if (!createdEvent) {
    return { ok: false, details: 'The newly created event was not found in the refreshed Turtle Club schedule.' };
  }
  return {
    ok: true,
    details: `Verified: new event is visible on ${createdEvent.date} at ${createdEvent.time} on ${createdEvent.diamond}.`
  };
}

function isCreateLikeRequest(request) {
  const action = String(request.action || '');
  return action.startsWith('Create ') || action.startsWith('Replace ');
}

function validateRequestAgainstLiveData(request, data, queuedRequests, original) {
  if ((String(request.action || '').startsWith('Cancel ') || String(request.action || '').startsWith('Replace '))
    && original
    && `${original.eventKind || ''} ${original.type || ''}`.toLowerCase().includes('cancelled')) {
    return {
      ok: false,
      message: 'This Turtle Club event is already marked cancelled. Create a new event instead of cancelling or replacing it.'
    };
  }

  if (!isCreateLikeRequest(request)) {
    return { ok: true, message: request.availabilityStatus || 'Original event cancellation' };
  }

  const date = String(request.date || '');
  const diamond = String(request.diamond || '');
  const normalizedDiamond = normalizeAvailabilityDiamond(diamond);
  const isAwayGame = String(request.newType || request.action || '').toLowerCase().includes('away');
  const start = minutesFromDisplay(request.start);
  const end = requestEndMinutes(request);
  if (!date || !diamond || !start || end <= start) {
    return { ok: false, message: 'Enter a valid date, start, and end time.' };
  }
  if (date < todayIsoLocal()) {
    return { ok: false, message: 'Turtle Club does not allow creating back-dated events. Choose today or a future date.' };
  }

  const ignoredId = String(request.action || '').startsWith('Replace ') ? String(request.originalId || '') : '';
  const freedSlots = [];

  if (original && original.date === date && normalizeAvailabilityDiamond(original.diamond) === normalizedDiamond) {
    freedSlots.push({
      id: original.id,
      start: minutesFromDisplay(original.time),
      end: eventEndMinutes(original),
      source: original.eventKind || original.type || 'event'
    });
  }

  (queuedRequests || [])
    .filter((item) => (item.status || 'pending') !== 'rejected')
    .filter((item) => String(item.action || '').startsWith('Cancel ') || String(item.action || '').startsWith('Replace '))
    .forEach((item) => {
      if (item.originalDate !== date || normalizeAvailabilityDiamond(item.originalDiamond) !== normalizedDiamond || !item.originalId) return;
      if (ignoredId && item.originalId === ignoredId) return;
      freedSlots.push({
        id: item.originalId,
        start: minutesFromDisplay(item.originalStart),
        end: item.end ? minutesFromDisplay(item.end) : minutesFromDisplay(item.originalStart) + 120,
        source: item.originalType || 'event'
      });
    });

  const conflict = (data.conflictEvents || data.schedule || []).find((item) => {
    if (item.id === ignoredId) return false;
    if (freedSlots.some((slot) => slot.id === item.id)) return false;
    if (item.date !== date || normalizeAvailabilityDiamond(item.diamond) !== normalizedDiamond) return false;
    const eventStart = minutesFromDisplay(item.time);
    const eventEnd = eventEndMinutes(item);
    return rangesOverlap(start, end, eventStart, eventEnd);
  });
  if (conflict) {
    return {
      ok: false,
      message: `Diamond conflict with ${conflict.team} ${conflict.opponent} (${conflict.eventKind || conflict.type}) at ${conflict.time}.`
    };
  }

  if (isAwayGame) {
    return {
      ok: true,
      message: `Available: no Turtle Club away-game conflict overlaps at ${diamond}.`
    };
  }

  const openSlot = (data.availability || []).find((slot) => {
    return slot.date === date
      && normalizeAvailabilityDiamond(slot.diamond) === normalizedDiamond
      && minutesFromDisplay(slot.start) <= start
      && minutesFromDisplay(slot.end) >= end;
  });
  const fitsFreedSlot = freedSlots.find((slot) => slot.start <= start && slot.end >= end);
  if (!openSlot && !fitsFreedSlot) {
    return {
      ok: false,
      message: 'This request does not fit a published open diamond block or a time slot already being freed by a queued change.'
    };
  }

  if (fitsFreedSlot && !openSlot) {
    return {
      ok: true,
      message: `Available: this request uses the ${fitsFreedSlot.source} time being freed, and no other Turtle Club ${(request.newType || 'event').toLowerCase()} conflict overlaps.`
    };
  }

  return {
    ok: true,
    message: `Available: ${diamond} is open ${openSlot.start}-${openSlot.end}, and no Turtle Club ${(request.newType || 'event').toLowerCase()} conflict overlaps.`
  };
}

function buildAvailabilityBlocks(data) {
  const homeVenuePrefixes = ['turtle club', 'vollmer', 'villanova', 'river canard'];
  const isHomeVenue = (value) => {
    const normalized = normalizeCompare(normalizeAvailabilityDiamond(value));
    return homeVenuePrefixes.some((prefix) => normalized.startsWith(prefix));
  };
  const diamonds = [...new Set([
    ...(data.availability || []).map((slot) => normalizeAvailabilityDiamond(slot.diamond)).filter(Boolean),
    ...((data.conflictEvents || data.schedule || []).map((event) => normalizeAvailabilityDiamond(event.diamond)).filter((diamond) => diamond && isHomeVenue(diamond)))
  ])].sort();
  const diamondSet = new Set(diamonds);
  const calendarDates = (data.conflictEvents || data.schedule || [])
    .filter((event) => diamondSet.has(normalizeAvailabilityDiamond(event.diamond)))
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
    const dayConflicts = (data.conflictEvents || data.schedule || [])
      .filter((event) => event.date === date && diamondSet.has(normalizeAvailabilityDiamond(event.diamond)));
    const availabilityStarts = dayAvailability.map((slot) => minutesFromDisplay(slot.start)).filter(Boolean);
    const availabilityEnds = dayAvailability.map((slot) => minutesFromDisplay(slot.end)).filter(Boolean);
    const conflictStarts = dayConflicts.map((event) => minutesFromDisplay(event.time)).filter(Boolean);
    const conflictEnds = dayConflicts.map((event) => event.endTime ? minutesFromDisplay(event.endTime) : minutesFromDisplay(event.time) + (event.durationMinutes || 120)).filter(Boolean);
    const windowStart = (availabilityStarts.length || conflictStarts.length)
      ? Math.min(defaultStart, ...availabilityStarts, ...conflictStarts)
      : defaultStart;
    const windowEnd = (availabilityEnds.length || conflictEnds.length)
      ? Math.max(defaultEnd, ...availabilityEnds, ...conflictEnds)
      : defaultEnd;
    const diamondRows = diamonds.map((diamond) => {
      const availabilityRanges = dayAvailability
        .filter((slot) => normalizeAvailabilityDiamond(slot.diamond) === diamond)
        .map((slot) => clippedRange(minutesFromDisplay(slot.start), minutesFromDisplay(slot.end), windowStart, windowEnd))
        .filter((range) => range.end > range.start);
      const openRanges = availabilityRanges.length ? availabilityRanges : [{ start: windowStart, end: windowEnd }];
      const conflicts = (data.conflictEvents || data.schedule || [])
        .filter((event) => event.date === date && normalizeAvailabilityDiamond(event.diamond) === diamond)
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
      const adminToken = createSessionToken({ role: 'admin', username: 'admin', initials: 'AC' });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Set-Cookie', [
        `${coachCookieName}=${adminToken}; HttpOnly; SameSite=Strict; Path=/`,
        `${cookieName}=${adminToken}; HttpOnly; SameSite=Strict; Path=/`
      ]);
      res.end(JSON.stringify({
        ok: true,
        user: { role: 'admin', username: 'admin', team: '' },
        redirectTo: '/admin.html'
      }));
      return;
    }

    if (username.toLowerCase() === readOnlyAdminUsername.toLowerCase() && password === readOnlyAdminPassword) {
      const viewerToken = createSessionToken({ role: 'admin_viewer', username: readOnlyAdminUsername, initials: 'DH' });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Set-Cookie', [
        `${coachCookieName}=${viewerToken}; HttpOnly; SameSite=Strict; Path=/`,
        `${cookieName}=${viewerToken}; HttpOnly; SameSite=Strict; Path=/`
      ]);
      res.end(JSON.stringify({
        ok: true,
        user: { role: 'admin_viewer', username: readOnlyAdminUsername, team: '', initials: 'DH' },
        redirectTo: '/admin.html'
      }));
      return;
    }

    if (username.toLowerCase() === statusEditorUsername.toLowerCase() && password === statusEditorPassword) {
      const editorToken = createSessionToken({
        role: 'status_editor',
        username: statusEditorUsername,
        team: '',
        initials: 'EC'
      });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Set-Cookie', `${coachCookieName}=${editorToken}; HttpOnly; SameSite=Strict; Path=/`);
      res.end(JSON.stringify({
        ok: true,
        user: { role: 'status_editor', username: statusEditorUsername, team: '', initials: 'EC' },
        redirectTo: statusEditorPath()
      }));
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
    res.setHeader('Set-Cookie', [
      `${coachCookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
      `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
    ]);
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
        team: session.team || '',
        initials: sessionInitials(session)
      }
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/coach/profile') {
    const session = readCoachSession(req);
    if (!canAccessCoachProfileSession(session)) {
      sendJson(res, 403, { error: 'Coach profile access is required.' });
      return;
    }
    const fullData = await loadData();
    const account = findCoachAccount(fullData, session.username || '');
    if (!account) {
      sendJson(res, 404, { error: 'Coach account not found.' });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      profile: {
        username: account.username,
        team: account.team,
        email: account.email || ''
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/coach/profile/change-password') {
    const session = readCoachSession(req);
    if (!canAccessCoachProfileSession(session)) {
      sendJson(res, 403, { error: 'Coach profile access is required.' });
      return;
    }
    const payload = await readBody(req);
    const currentPassword = String(payload.currentPassword || '');
    const newPassword = String(payload.newPassword || '');
    const confirmPassword = String(payload.confirmPassword || '');
    if (!currentPassword || !newPassword || !confirmPassword) {
      sendJson(res, 400, { error: 'Current password and new password are required.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      sendJson(res, 400, { error: 'New password confirmation did not match.' });
      return;
    }
    if (newPassword.length < 6) {
      sendJson(res, 400, { error: 'New password must be at least 6 characters.' });
      return;
    }

    const fullData = await loadData();
    const account = findCoachAccount(fullData, session.username || '');
    if (!account) {
      sendJson(res, 404, { error: 'Coach account not found.' });
      return;
    }
    if (currentPassword !== account.password) {
      sendJson(res, 401, { error: 'Current password did not match.' });
      return;
    }

    const updatedAccount = updateCoachAccount(account.username, { password: newPassword });
    if (!updatedAccount) {
      sendJson(res, 500, { error: 'Coach password could not be saved.' });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      profile: {
        username: updatedAccount.username,
        team: updatedAccount.team,
        email: updatedAccount.email || ''
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/coach/profile/update-email') {
    const session = readCoachSession(req);
    if (!canAccessCoachProfileSession(session)) {
      sendJson(res, 403, { error: 'Coach profile access is required.' });
      return;
    }
    const payload = await readBody(req);
    const email = String(payload.email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      sendJson(res, 400, { error: 'Enter a valid email address.' });
      return;
    }

    const fullData = await loadData();
    const account = findCoachAccount(fullData, session.username || '');
    if (!account) {
      sendJson(res, 404, { error: 'Coach account not found.' });
      return;
    }

    const updatedAccount = updateCoachAccount(account.username, { email });
    if (!updatedAccount) {
      sendJson(res, 500, { error: 'Coach email could not be saved.' });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      profile: {
        username: updatedAccount.username,
        team: updatedAccount.team,
        email: updatedAccount.email || ''
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
        adminPath: adminPathForSession(session),
        fieldStatusPath: fieldStatusPathForSession(session),
        profilePath: profilePathForSession(session),
        user: {
          role: session.role,
          username: session.username || '',
          team: session.team || '',
          initials: sessionInitials(session)
        },
        dataVersion: await dataVersion(),
        nextRefreshAt: nextDailyRefreshAt(),
        storageMode: useSupabaseStore() ? 'supabase' : 'local'
      }
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/preload-schedule') {
    const data = await loadData();
    sendJson(res, 200, {
      ok: true,
      dataVersion: await dataVersion(),
      nextRefreshAt: nextDailyRefreshAt(),
      events: (data.schedule || []).length
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/public-config') {
    const session = readCoachSession(req);
    sendJson(res, 200, {
      brandName: config.brandName || 'LaSalle Titans',
      adminPath: adminPathForSession(session),
      fieldStatusPath: fieldStatusPathForSession(session),
      profilePath: profilePathForSession(session),
      dataVersion: await dataVersion(),
      nextRefreshAt: nextDailyRefreshAt(),
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

  if (req.method === 'GET' && pathname === '/api/diamond-status') {
    try {
      sendJson(res, 200, await loadDiamondStatus());
    } catch (error) {
      sendJson(res, 502, { error: 'Diamond status unavailable', details: error.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/status-editor/bootstrap') {
    const session = readCoachSession(req);
    if (!canAccessStatusEditorSession(session)) {
      sendJson(res, 403, { error: 'Status editor access is required.' });
      return;
    }
    try {
      const statusPayload = editableDiamondStatusPayload(await loadDiamondStatus());
      sendJson(res, 200, {
        ...statusPayload,
        user: {
          role: session.role,
          username: session.username || '',
          initials: sessionInitials(session),
          readOnly: !canMutateStatusEditorSession(session)
        }
      });
    } catch (error) {
      sendJson(res, 502, { error: 'Diamond status unavailable', details: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/status-editor/update') {
    const session = readCoachSession(req);
    if (!canAccessStatusEditorSession(session)) {
      sendJson(res, 403, { error: 'Status editor access is required.' });
      return;
    }
    if (!canMutateStatusEditorSession(session)) {
      sendJson(res, 403, { error: 'This account can view Turtle Club field statuses but cannot change them.' });
      return;
    }

    const payload = await readBody(req);
    const target = statusTargetById(payload.targetId);
    const desiredStatus = normalizeStatusChoice(payload.status);
    if (!target) {
      sendJson(res, 400, { error: 'Unknown diamond status target.' });
      return;
    }
    if (!['Open', 'Closed'].includes(desiredStatus)) {
      sendJson(res, 400, { error: 'Status must be Open or Closed.' });
      return;
    }

    try {
      await updateDiamondStatus({
        targetId: target.id,
        status: desiredStatus,
        notes: String(payload.notes || ''),
        initials: sessionInitials(session),
        updatedBy: session.username || '',
        requestedAt: new Date().toISOString()
      });
    } catch (error) {
      sendJson(res, 502, {
        error: 'Turtle Club status update failed',
        details: error.message
      });
      return;
    }

    try {
      const verification = await waitForDiamondStatusUpdate(target.id, desiredStatus);
      if (!verification.ok) {
        sendJson(res, 409, {
          error: 'Turtle Club verification failed',
          details: verification.details,
          row: verification.row || null
        });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        row: verification.row,
        rows: verification.payload.rows,
        fetchedAt: verification.payload.fetchedAt,
        message: verification.details
      });
    } catch (error) {
      sendJson(res, 502, {
        error: 'Updated diamond status could not be reloaded',
        details: error.message
      });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/requests') {
    const session = readCoachSession(req);
    if (!session) {
      sendJson(res, 401, { error: 'Login required' });
      return;
    }
    const requests = (await listRequestsStore())
      .filter((request) => requestVisibleToSession(request, session))
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
    if (session.role === 'status_editor' || session.role === 'admin_viewer') {
      sendJson(res, 403, { error: 'Status editor accounts can review coach requests but cannot queue schedule changes from the coach page.' });
      return;
    }
    const payload = await readBody(req);
    const fullData = await refreshData();
    const queuedRequests = await listRequestsStore();
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
    const liveValidation = validateRequestAgainstLiveData(payload, fullData, queuedRequests, original);
    if (!liveValidation.ok) {
      sendJson(res, 409, {
        error: 'Live Turtle Club conflict detected',
        details: liveValidation.message
      });
      return;
    }
    payload.availabilityStatus = liveValidation.message;
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
    sendCoachRequestSubmittedEmail(stored).catch((error) => {
      console.error(`Request submission email failed for ${stored.team} (${stored.id}):`, error.message);
    });
    sendJson(res, 201, { request: sanitizeRequestForPublic(stored) });
    return;
  }

  const coachDeleteMatch = pathname.match(/^\/api\/requests\/([^/]+)$/);
  if (req.method === 'DELETE' && coachDeleteMatch) {
    const session = readCoachSession(req);
    if (!session) {
      sendJson(res, 401, { error: 'Login required' });
      return;
    }
    if (session.role === 'status_editor' || session.role === 'admin_viewer') {
      sendJson(res, 403, { error: 'Status editor accounts can review coach requests but cannot delete them from the coach page.' });
      return;
    }
    const [, requestId] = coachDeleteMatch;
    const request = (await listRequestsStore()).find((item) => item.id === requestId);
    if (!request) {
      sendJson(res, 404, { error: 'Request not found' });
      return;
    }
    if (!requestVisibleToSession(request, session)) {
      sendJson(res, 403, { error: 'This coach cannot delete another coach request' });
      return;
    }
    const deleted = await deleteRequestStore(requestId);
    if (!deleted) {
      sendJson(res, 404, { error: 'Request not found' });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/login') {
    const payload = await readBody(req);
    if ((payload.password || '') !== adminPassword) {
      sendJson(res, 401, { error: 'Invalid password' });
      return;
    }
    const token = createSessionToken({ role: 'admin', username: 'admin', initials: 'AC' });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Set-Cookie', [
      `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`,
      `${coachCookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`
    ]);
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/logout') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Set-Cookie', [
      `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
      `${coachCookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
    ]);
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/session') {
    const session = readCoachSession(req);
    sendJson(res, 200, {
      authenticated: canAccessAdminPortalSession(session),
      user: canAccessAdminPortalSession(session) ? {
        role: session.role,
        username: session.username || '',
        initials: sessionInitials(session),
        readOnly: !canMutateAdminPortalSession(session)
      } : null
    });
    return;
  }

  if (pathname.startsWith('/api/admin/') && !canAccessAdminPortalSession(readCoachSession(req))) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/requests') {
    sendJson(res, 200, { requests: await listRequestsStore() });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/coach-accounts') {
    const data = await loadData();
    sendJson(res, 200, {
      accounts: currentCoachAccounts(data),
      generatedAt: await dataVersion()
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/logins') {
    sendJson(res, 200, {
      logins: [
        {
          label: 'Full Admin',
          username: 'admin',
          password: adminPassword,
          access: 'Can approve requests, refresh Turtle Club data, edit coach logins, and send updates.'
        },
        {
          label: 'Read-Only Admin',
          username: readOnlyAdminUsername,
          password: readOnlyAdminPassword,
          access: 'Can view all admin and field status pages, but cannot apply changes.'
        },
        {
          label: 'Field Status Editor',
          username: statusEditorUsername,
          password: statusEditorPassword,
          access: 'Can view all teams and update Turtle Club field statuses, but cannot approve schedule changes.'
        }
      ]
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/coach-accounts/update-passwords') {
    const session = readCoachSession(req);
    if (!canMutateAdminPortalSession(session)) {
      sendJson(res, 403, { error: 'This account can view coach login details but cannot change them.' });
      return;
    }
    const data = await loadData();
    const payload = await readBody(req);
    const updates = Array.isArray(payload.accounts) ? payload.accounts : [];
    const accounts = currentCoachAccounts(data);
    const updateMap = new Map(
      updates
        .filter((item) => item && item.username)
        .map((item) => [String(item.username).toLowerCase(), {
          password: String(item.password || '').trim(),
          email: String(item.email || '').trim()
        }])
    );
    const nextAccounts = accounts.map((account) => {
      const nextValues = updateMap.get(account.username.toLowerCase());
      if (!nextValues) return account;
      return {
        ...account,
        password: nextValues.password || account.password,
        email: nextValues.email
      };
    });
    writeCoachAccountStore({ accounts: nextAccounts });
    sendJson(res, 200, {
      ok: true,
      accounts: nextAccounts
    });
    return;
  }

  const approvalMatch = pathname.match(/^\/api\/admin\/requests\/([^/]+)\/(approve|reject)$/);
  if (req.method === 'POST' && approvalMatch) {
    const session = readCoachSession(req);
    if (!canMutateAdminPortalSession(session)) {
      sendJson(res, 403, { error: 'This account can review coach requests but cannot approve or reject them.' });
      return;
    }
    const [, requestId, action] = approvalMatch;
    const payload = await readBody(req);
    const existing = (await listRequestsStore()).find((item) => item.id === requestId);
    if (!existing) {
      sendJson(res, 404, { error: 'Request not found' });
      return;
    }
    if (action === 'approve') {
      let refreshedData;
      let verification;
      let applyResult;
      try {
        applyResult = await applyApprovedRequest(existing);
        refreshedData = await refreshData();
        verification = verifyApprovedRequestApplied(existing, refreshedData, applyResult);
        existing.__verification = verification;
      } catch (error) {
        sendJson(res, 502, {
          error: 'Turtle Club update failed',
          details: error.message
        });
        return;
      }
      if (!verification || !verification.ok) {
        sendJson(res, 409, {
          error: 'Turtle Club verification failed',
          details: verification ? verification.details : 'The approved request could not be verified on Turtle Club.',
          verified: false
        });
        return;
      }
    }
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
    let emailSent = false;
    let emailError = '';
    if (smtpConfigured()) {
      try {
        emailSent = await sendCoachRequestDecisionEmail(request);
      } catch (error) {
        emailSent = false;
        emailError = error.message || 'Unknown email error';
        console.error(`Decision email failed for ${request.team} (${request.id}):`, emailError);
      }
    } else {
      emailError = 'Email sender is not configured on the server.';
    }
    sendJson(res, 200, {
      request,
      emailSent,
      emailError,
      verified: existing.__verification ? existing.__verification.ok : true,
      verificationDetails: existing.__verification ? existing.__verification.details : 'No verification was required.'
    });
    return;
  }

  const deleteMatch = pathname.match(/^\/api\/admin\/requests\/([^/]+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    const session = readCoachSession(req);
    if (!canMutateAdminPortalSession(session)) {
      sendJson(res, 403, { error: 'This account can review coach requests but cannot clear them.' });
      return;
    }
    const [, requestId] = deleteMatch;
    const deleted = await deleteRequestStore(requestId);
    if (!deleted) {
      sendJson(res, 404, { error: 'Request not found' });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/refresh-schedule') {
    const session = readCoachSession(req);
    if (!canMutateAdminPortalSession(session)) {
      sendJson(res, 403, { error: 'This account can view the admin dashboard but cannot refresh Turtle Club data.' });
      return;
    }
    try {
      const refreshed = await refreshData();
      sendJson(res, 200, {
        ok: true,
        version: String(refreshed.scrapedAt || Date.now())
      });
    } catch (error) {
      sendJson(res, 500, { error: 'Refresh failed', details: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/rescan-teams') {
    const session = readCoachSession(req);
    if (!canMutateAdminPortalSession(session)) {
      sendJson(res, 403, { error: 'This account can view coach login details but cannot rescan teams.' });
      return;
    }
    try {
      const refreshed = await refreshData();
      sendJson(res, 200, {
        ok: true,
        version: String(refreshed.scrapedAt || Date.now()),
        accounts: syncCoachAccounts(refreshed)
      });
    } catch (error) {
      sendJson(res, 500, { error: 'Team rescan failed', details: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/test-diamond-status-email') {
    const session = readCoachSession(req);
    if (!canMutateAdminPortalSession(session)) {
      sendJson(res, 403, { error: 'This account can view the admin dashboard but cannot send test emails.' });
      return;
    }
    if (!smtpConfigured()) {
      sendJson(res, 400, { error: 'Email sender is not configured.' });
      return;
    }
    try {
      const result = await sendTestDiamondStatusAlert();
      sendJson(res, 200, { ok: true, result });
    } catch (error) {
      sendJson(res, 500, { error: 'Diamond status test email failed', details: error.message });
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
  discordWebhookUrl,
  canAccessStatusEditorRequest,
  canAccessAdminPortalRequest,
  canAccessCoachProfileRequest
};
