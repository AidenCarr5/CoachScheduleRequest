const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { loadData, refreshData, refreshDateData, updateLocalEvent, dataVersion } = require('./data-store');
const { applyApprovedRequest, updateGameOpponent, updateDiamondStatus, assignGameOfficial, removeGameOfficial, listTournamentScoreGames, submitTournamentScore } = require('./turtle-club-client');
const { sendTestDiamondStatusAlert, sendCoachRequestSubmittedEmail, sendCoachRequestDecisionEmail, sendOpponentChangeEmail, sendOpponentChangeFailureEmail, sendApprovedRequestSyncFailureEmail, sendAllocationApprovalRequestEmail, sendSeasonUploadInviteEmail, smtpConfigured } = require('./diamond-status-monitor');
const { buildEditableStatusRows, normalizeStatusChoice, statusTargetById } = require('./diamond-status-config');
const { createSeasonPlanner } = require('./season-planner');

const rootDir = path.join(__dirname, '..');
const storageDir = path.join(rootDir, 'storage');
const storageFile = process.env.REQUESTS_FILE
  ? path.resolve(process.env.REQUESTS_FILE)
  : path.join(storageDir, 'requests.json');
const coachAccountsFile = process.env.COACH_ACCOUNTS_FILE
  ? path.resolve(process.env.COACH_ACCOUNTS_FILE)
  : path.join(storageDir, 'coach-accounts.json');
const umpireStoreFile = process.env.UMPIRE_STORE_FILE
  ? path.resolve(process.env.UMPIRE_STORE_FILE)
  : path.join(storageDir, 'umpire-availability.json');
const configPath = process.env.SITE_CONFIG_PATH
  ? path.resolve(process.env.SITE_CONFIG_PATH)
  : path.join(rootDir, 'site', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const allotmentPath = path.join(rootDir, 'site', 'titans-diamond-allotments.json');
const titansDiamondAllotments = fs.existsSync(allotmentPath)
  ? JSON.parse(fs.readFileSync(allotmentPath, 'utf8'))
  : { phases: [] };

const adminUsername = process.env.ADMIN_USERNAME || config.adminUsername || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || '55aiden55';
const configuredAdminUsers = Array.isArray(config.adminUsers)
  ? config.adminUsers
      .map((user) => ({
        username: String(user && user.username || '').trim(),
        password: String(user && user.password || ''),
        initials: String(user && user.initials || '').trim(),
        email: String(user && user.email || '').trim(),
        accessLabel: String(user && user.accessLabel || '').trim(),
        canSwitchSites: user && user.canSwitchSites !== false,
        canAccessTitans: user && user.canAccessTitans !== undefined ? user.canAccessTitans !== false : undefined,
        canAccessAthletics: user && user.canAccessAthletics !== undefined ? user.canAccessAthletics !== false : undefined,
        canEditCoachEmails: Boolean(user && user.canEditCoachEmails),
        canManualApprove: user && user.canManualApprove === true,
        notifyOnCoachRequests: user && user.notifyOnCoachRequests !== false,
        hideSyncFailures: Boolean(user && user.hideSyncFailures)
      }))
      .filter((user) => user.username && user.password)
  : [];
const readOnlyAdminUsername = String(process.env.READ_ONLY_ADMIN_USERNAME || 'DonHunt').trim();
const readOnlyAdminPassword = String(process.env.READ_ONLY_ADMIN_PASSWORD || 'awRtum').trim();
const coachPassword = process.env.COACH_PASSWORD || 'password';
const statusEditorUsername = String(process.env.STATUS_EDITOR_USERNAME || 'ecarr').trim();
const statusEditorPassword = String(process.env.STATUS_EDITOR_PASSWORD || 'Nikicarr1');
const defaultUmpireUsername = String(process.env.UMPIRE_USERNAME || 'umpire').trim();
const defaultUmpirePassword = String(process.env.UMPIRE_PASSWORD || 'umpire').trim();
const cookieName = 'titans_admin_session';
const coachCookieName = 'titans_coach_session';
const sessionSecret = process.env.SESSION_SECRET || 'titans-local-secret';
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL || '';
const diamondStatusUrl = 'https://turtleclubbaseball.com/Pages/1487/Status/';
const brandName = config.brandName || 'LaSalle Titans';
const teamLabel = config.teamLabel || 'Titans';
const sportName = config.sportName || 'Baseball';
const alternateAdminSite = config.alternateAdminSite || null;
const umpireProgramCategories = ['Titans', 'Athletics', 'House League Baseball', 'House League Softball'];
const contacts = Array.isArray(config.contacts) && config.contacts.length
  ? config.contacts
  : [
      { name: 'Aiden Carr / Ashton Carr', email: 'titansupdate@gmail.com' },
      { name: 'Elliot Carr', email: 'ECarr@flexngate.com' },
      { name: 'Bill Sivell', email: 'Bill.Sivell@hotmail.com' }
    ];
const seasonPlanner = createSeasonPlanner({ rootDir, storageDir, teamLabel });
const turtleClubBaseUrl = 'https://turtleclubbaseball.com';
const publicScheduleUrl = `${turtleClubBaseUrl}/Categories/${config.teamCategoryId || 1017}/Schedule/`;
const tournamentScoresTournamentId = Number(config.tournamentScoresTournamentId || 3331);

fs.mkdirSync(storageDir, { recursive: true });
if (!fs.existsSync(storageFile)) {
  fs.writeFileSync(storageFile, JSON.stringify({ requests: [] }, null, 2));
}
if (!fs.existsSync(coachAccountsFile)) {
  fs.writeFileSync(coachAccountsFile, JSON.stringify({ accounts: [] }, null, 2));
}
if (!fs.existsSync(umpireStoreFile)) {
  fs.writeFileSync(umpireStoreFile, JSON.stringify({
    accounts: [
      {
        username: defaultUmpireUsername,
        password: defaultUmpirePassword,
        name: 'Umpire'
      }
    ],
    claims: []
  }, null, 2));
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

function readUmpireStore() {
  return JSON.parse(fs.readFileSync(umpireStoreFile, 'utf8'));
}

function writeUmpireStore(store) {
  fs.writeFileSync(umpireStoreFile, JSON.stringify(store, null, 2));
}

function sanitizeUmpirePrograms(programs) {
  if (!Array.isArray(programs)) return [...umpireProgramCategories];
  const allowed = new Set(umpireProgramCategories);
  return [...new Set(programs.map((program) => String(program || '').trim()).filter((program) => allowed.has(program)))];
}

function umpireAccountPrograms(account) {
  return sanitizeUmpirePrograms(account && account.programs);
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

function requestOrigin(req) {
  const host = String(req.headers.host || '').trim() || `127.0.0.1:${process.env.PORT || 4173}`;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  return `${proto}://${host}`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
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

function createAdminSwitchToken(session) {
  return createSessionToken({
    role: session.role,
    username: session.username || '',
    initials: sessionInitials(session),
    canSwitchSites: session.canSwitchSites !== false,
    canAccessTitans: session.canAccessTitans !== false,
    canAccessAthletics: session.canAccessAthletics !== false,
    hideSyncFailures: Boolean(session.hideSyncFailures),
    purpose: 'admin-site-switch'
  });
}

function parseSignedToken(token) {
  const [encoded, signature] = String(token || '').split('.');
  if (!encoded || !signature) return false;
  if (sign(encoded) !== signature) return false;
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch (_) {
    return false;
  }
}

function readSignedSession(req, name) {
  const cookies = parseCookies(req);
  const token = cookies[name];
  if (!token) return false;
  return parseSignedToken(token);
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
  const configuredAdmin = findConfiguredAdminUser(session.username);
  if (configuredAdmin && configuredAdmin.initials) return configuredAdmin.initials;
  if (session.role === 'admin') return 'AC';
  if (session.role === 'admin_viewer') return 'DH';
  if (session.role === 'status_editor') return 'EC';
  return '';
}

function configurableAdminUsers() {
  const byUsername = new Map();
  const currentSiteKey = String(teamLabel || '').toLowerCase().includes('athletic') ? 'athletics' : 'titans';
  const users = [
    ...configuredAdminUsers.map((user) => ({ ...user, removable: false })),
    ...(seasonPlanner.adminAccounts() || []).map((user) => ({ ...user, removable: true }))
  ];
  users.forEach((user) => {
    const username = String(user && user.username || '').trim();
    const password = String(user && user.password || '').trim();
    if (!username || !password) return;
    const key = username.toLowerCase();
    if (key === String(adminUsername || '').toLowerCase()) return;
    const canSwitchSites = user.canSwitchSites !== false;
    const defaultTitansAccess = canSwitchSites || currentSiteKey === 'titans';
    const defaultAthleticsAccess = canSwitchSites || currentSiteKey === 'athletics';
    byUsername.set(key, {
      username,
      password,
      initials: String(user.initials || '').trim(),
      email: String(user.email || '').trim(),
      accessLabel: adminAccessLabel(user, canSwitchSites),
      canSwitchSites,
      canAccessTitans: user.canAccessTitans !== undefined ? user.canAccessTitans !== false : defaultTitansAccess,
      canAccessAthletics: user.canAccessAthletics !== undefined ? user.canAccessAthletics !== false : defaultAthleticsAccess,
      canEditCoachEmails: Boolean(user.canEditCoachEmails),
      canManualApprove: user.canManualApprove === true,
      notifyOnCoachRequests: user.notifyOnCoachRequests !== false,
      hideSyncFailures: Boolean(user.hideSyncFailures),
      removable: user.removable === true
    });
  });
  return [...byUsername.values()];
}

function adminAccessLabel(user, canSwitchSites) {
  const base = String(user && user.accessLabel || `Can approve and reject ${teamLabel} coach schedule requests.`)
    .replace(/\s*Cannot switch to [^.]+\.?\s*$/i, '')
    .trim();
  if (canSwitchSites) return base;
  const blockedSite = alternateAdminSite && alternateAdminSite.label ? alternateAdminSite.label : 'the other site';
  return `${base || `Can approve and reject ${teamLabel} coach schedule requests.`} Cannot switch to ${blockedSite}.`;
}

function findConfiguredAdminUser(username) {
  const clean = String(username || '').trim().toLowerCase();
  if (!clean) return null;
  const user = configurableAdminUsers().find((item) => item.username.toLowerCase() === clean);
  if (!user) return null;
  return applyAdminPrivilegeOverride(user);
}

function applyAdminPrivilegeOverride(user) {
  const clean = String(user && user.username || '').trim().toLowerCase();
  const override = (seasonPlanner.adminPrivilegeOverrides() || [])
    .find((item) => String(item.username || '').toLowerCase() === clean);
  return override ? { ...user, ...override } : user;
}

function adminLoginForCredentials(username, password, options = {}) {
  const cleanUsername = String(username || '').trim();
  const cleanPassword = String(password || '');
  const primary = {
    username: adminUsername,
    password: adminPassword,
    initials: 'AC',
    canSwitchSites: true,
    canAccessTitans: true,
    canAccessAthletics: true,
    canEditCoachEmails: true,
    canManualApprove: true,
    hideSyncFailures: false,
    accessLabel: 'Can approve requests, refresh Turtle Club data, edit coach logins, and send updates.',
    primary: true
  };
  const candidates = [primary, ...configurableAdminUsers().map((user) => {
    const withOverride = applyAdminPrivilegeOverride(user);
    return {
      ...withOverride,
      accessLabel: withOverride.accessLabel || 'Can approve and reject coach schedule requests for this site.'
    };
  })];
  if (!cleanUsername && options.allowPasswordOnly) {
    return primary.password === cleanPassword ? primary : null;
  }
  return candidates.find((user) => user.username.toLowerCase() === cleanUsername.toLowerCase() && user.password === cleanPassword) || null;
}

function adminSessionFromLogin(login) {
  return {
    role: 'admin',
    username: login.username,
    initials: login.initials || String(login.username || 'A').slice(0, 2).toUpperCase(),
    canSwitchSites: login.canSwitchSites !== false,
    canAccessTitans: login.canAccessTitans !== false,
    canAccessAthletics: login.canAccessAthletics !== false,
    hideSyncFailures: Boolean(login.hideSyncFailures)
  };
}

function canSwitchAdminSitesSession(session) {
  if (!canAccessAdminPortalSession(session) || session.canSwitchSites === false) return false;
  const currentIsAthletics = String(teamLabel || '').toLowerCase().includes('athletic');
  return currentIsAthletics ? session.canAccessTitans !== false : session.canAccessAthletics !== false;
}

function canRevealAdminPasswords(session) {
  return Boolean(session && session.role === 'admin' && String(session.username || '').toLowerCase() === String(adminUsername || '').toLowerCase());
}

function canEditCoachEmailsSession(session) {
  if (!session || session.role !== 'admin') return false;
  if (canRevealAdminPasswords(session)) return true;
  const configuredAdmin = findConfiguredAdminUser(session.username);
  return Boolean(configuredAdmin && configuredAdmin.canEditCoachEmails);
}

function canManualApproveSession(session) {
  if (!session || session.role !== 'admin') return false;
  if (canRevealAdminPasswords(session)) return true;
  const configuredAdmin = findConfiguredAdminUser(session.username);
  return Boolean(configuredAdmin && configuredAdmin.canManualApprove);
}

function publicAdminUser(session) {
  if (!canAccessAdminPortalSession(session)) return null;
  return {
    role: session.role,
    username: session.username || '',
    initials: sessionInitials(session),
    readOnly: !canMutateAdminPortalSession(session),
    canSwitchSites: canSwitchAdminSitesSession(session),
    canAccessTitans: session.canAccessTitans !== false,
    canAccessAthletics: session.canAccessAthletics !== false,
    hideSyncFailures: Boolean(session.hideSyncFailures),
    canRevealPasswords: canRevealAdminPasswords(session),
    canEditCoachEmails: canEditCoachEmailsSession(session),
    canManualApprove: canManualApproveSession(session)
  };
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

function canUseAdminSwitchTokenRequest(req) {
  try {
    const requestUrl = new URL(req.url || '', 'http://local');
    const switchSession = parseSignedToken(requestUrl.searchParams.get('switchToken') || '');
    return isFreshAdminSwitchSession(switchSession);
  } catch (_) {
    return false;
  }
}

function canMutateAdminPortalSession(session) {
  return Boolean(session && session.role === 'admin');
}

function isFreshAdminSwitchSession(session) {
  if (!session || session.purpose !== 'admin-site-switch') return false;
  if (!canAccessAdminPortalSession(session)) return false;
  const createdAt = Number(session.ts || 0);
  return Boolean(createdAt && Date.now() - createdAt <= 2 * 60 * 1000);
}

function safeSwitchTargetPath(req) {
  try {
    const requestUrl = new URL(req.url || '', 'http://local');
    const rawTarget = String(requestUrl.searchParams.get('targetPath') || '').trim();
    if (!rawTarget || !rawTarget.startsWith('/') || rawTarget.startsWith('//')) return '';
    const targetUrl = new URL(rawTarget, 'http://local');
    if (targetUrl.pathname.startsWith('/api/')) return '';
    return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
  } catch (_) {
    return '';
  }
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

function canAccessUmpirePortalSession(session) {
  return Boolean(session && (session.role === 'admin' || session.role === 'admin_viewer' || session.role === 'umpire'));
}

function isVanWezelCoachSession(session) {
  if (!session || session.role !== 'coach') return false;
  return /van\s*wezel/i.test(`${session.username || ''} ${session.team || ''}`);
}

function canAccessTournamentScoresSession(session) {
  return Boolean(session && (canAccessAdminPortalSession(session) || isVanWezelCoachSession(session)));
}

function canMutateTournamentScoresSession(session) {
  return Boolean(session && (canMutateAdminPortalSession(session) || isVanWezelCoachSession(session)));
}

function canAccessTournamentScoresRequest(req) {
  return canAccessTournamentScoresSession(readCoachSession(req));
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

function umpirePathForSession(session) {
  return '/umpire-availability.html';
}

function tournamentScoresPathForSession(session) {
  return canAccessTournamentScoresSession(session) ? '/tournament-scores.html' : '';
}

function parseDataFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').trim();
  const prefix = 'window.TITANS_DATA = ';
  if (!text.startsWith(prefix)) {
    throw new Error(`Schedule data file has an unexpected format: ${filePath}`);
  }
  return JSON.parse(text.slice(prefix.length).replace(/;\s*$/, ''));
}

function loadBundledSiteData(fileName) {
  try {
    return parseDataFile(path.join(rootDir, 'site', fileName));
  } catch (_) {
    return { teams: [], schedule: [], conflictEvents: [] };
  }
}

function runScheduleRefresh(envOverrides) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [path.join(rootDir, 'site', 'update-data.js')],
      {
        cwd: rootDir,
        env: { ...process.env, ...envOverrides },
        maxBuffer: 1024 * 1024 * 10
      },
      (error, stdout, stderr) => {
        if (error) {
          error.message = `${error.message}${stderr ? `\n${stderr}` : ''}`;
          reject(error);
          return;
        }
        resolve(stdout);
      }
    );
  });
}

async function refreshUmpirePortalData() {
  const refreshed = await refreshData();
  const alternate = brandName === 'LaSalle Athletics'
    ? {
        SITE_CONFIG_PATH: 'site/config.json',
        SITE_DATA_PATH: 'site/data.js',
        COACH_ACCOUNTS_FILE: 'storage/coach-accounts.json'
      }
    : {
        SITE_CONFIG_PATH: 'site/athletics.config.json',
        SITE_DATA_PATH: 'site/athletics-data.js',
        COACH_ACCOUNTS_FILE: 'storage/athletics-coach-accounts.json'
      };
  await runScheduleRefresh(alternate);
  return refreshed;
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeOfficialName(value) {
  return normalizeText(value);
}

function isPlaceholderOfficialName(value) {
  return normalizeOfficialName(value) === 'real name';
}

function collectOfficialRoster(...dataSets) {
  const byUsername = new Map();
  dataSets.forEach((data) => {
    (data && data.officials || []).forEach((official) => {
      const username = String(official && official.username || '').trim();
      const name = String(official && official.name || '').trim();
      if (!username || !name) return;
      if (isPlaceholderOfficialName(name)) return;
      const key = username.toLowerCase();
      if (!byUsername.has(key)) {
        byUsername.set(key, {
          username,
          name,
          email: official.email || '',
          qualification: official.qualification || '',
          age: official.age || '',
          positions: Array.isArray(official.positions) ? official.positions : []
        });
      } else {
        const existing = byUsername.get(key);
        if (!existing.email && official.email) existing.email = official.email;
        if (!existing.qualification && official.qualification) existing.qualification = official.qualification;
        if (!existing.age && official.age) existing.age = official.age;
        const positions = Array.isArray(official.positions) ? official.positions : [];
        positions.forEach((position) => {
          if (!existing.positions.includes(position)) existing.positions.push(position);
        });
      }
    });
  });
  return [...byUsername.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function syncUmpireAccountsFromOfficials(officials) {
  if (!Array.isArray(officials) || !officials.length) return readUmpireStore();
  const store = readUmpireStore();
  const deletedUsernames = new Set((Array.isArray(store.deletedAccountUsernames) ? store.deletedAccountUsernames : [])
    .map((username) => String(username || '').toLowerCase())
    .filter(Boolean));
  let accounts = Array.isArray(store.accounts) ? store.accounts : [];
  const filteredAccounts = accounts.filter((account) => {
    const username = String(account.username || '').toLowerCase();
    return !deletedUsernames.has(username) && !isPlaceholderOfficialName(account.name || account.username || '');
  });
  let changed = filteredAccounts.length !== accounts.length;
  accounts = filteredAccounts;
  const byUsername = new Map(accounts.map((account) => [String(account.username || '').toLowerCase(), account]));

  officials.forEach((official) => {
    const username = String(official.username || '').trim();
    const name = String(official.name || '').trim();
    if (!username || !name) return;
    if (isPlaceholderOfficialName(name)) return;
    const key = username.toLowerCase();
    if (deletedUsernames.has(key)) return;
    const existing = byUsername.get(key);
    if (existing) {
      const programs = umpireAccountPrograms(existing);
      const email = String(official.email || '').trim();
      const age = String(official.age || '').trim();
      if (existing.name !== name || existing.source !== 'official-roster' || (email && existing.email !== email) || (age && existing.age !== age)) {
        existing.name = name;
        if (email) existing.email = email;
        if (age) existing.age = age;
        existing.source = 'official-roster';
        existing.qualification = official.qualification || existing.qualification || '';
        existing.positions = Array.isArray(official.positions) ? official.positions : (existing.positions || []);
        changed = true;
      }
      if (JSON.stringify(existing.programs || []) !== JSON.stringify(programs)) {
        existing.programs = programs;
        changed = true;
      }
      return;
    }
    const account = {
      username,
      password: randomCoachPassword(),
      name,
      email: official.email || '',
      age: official.age || '',
      source: 'official-roster',
      qualification: official.qualification || '',
      positions: Array.isArray(official.positions) ? official.positions : [],
      programs: [...umpireProgramCategories],
      createdAt: new Date().toISOString()
    };
    accounts.push(account);
    byUsername.set(key, account);
    changed = true;
  });

  if (changed) {
    store.accounts = accounts.sort((a, b) => String(a.name || a.username || '').localeCompare(String(b.name || b.username || '')));
    writeUmpireStore(store);
  }
  return store;
}

function publicUmpireAccount(account) {
  return {
    name: account.name || account.username || '',
    username: account.username || '',
    password: account.password || '',
    email: account.email || '',
    age: account.age || '',
    qualification: account.qualification || '',
    programs: umpireAccountPrograms(account)
  };
}

function officialAccountMaps(store) {
  const accounts = Array.isArray(store && store.accounts) ? store.accounts : [];
  const byName = new Map();
  const byUsername = new Map();
  accounts.forEach((account) => {
    const username = String(account.username || '').trim();
    const name = String(account.name || username).trim();
    if (username) byUsername.set(username.toLowerCase(), account);
    if (name) byName.set(normalizeOfficialName(name), account);
  });
  return { byName, byUsername };
}

function ensureUmpireAccountsFromBundledData() {
  const titansData = loadBundledSiteData('data.js');
  const athleticsData = loadBundledSiteData('athletics-data.js');
  return syncUmpireAccountsFromOfficials(collectOfficialRoster(titansData, athleticsData));
}

function gameAge(team) {
  const ages = [...String(team || '').matchAll(/(?:U\s*(\d{1,2})|(?:^|[^\d])(\d{1,2})\s*U\b)/gi)]
    .map((match) => Number(match[1] || match[2]))
    .filter(Boolean);
  return ages.length ? Math.max(...ages) : 0;
}

function isCancelledEvent(event) {
  return /cancelled|canceled/i.test(`${event && event.type || ''} ${event && event.eventKind || ''} ${event && event.status || ''}`);
}

function isGameEvent(event) {
  const label = `${event && event.type || ''} ${event && event.eventKind || ''}`;
  if (isCancelledEvent(event)) return false;
  if (/practice|tournament|tryout|clinic|camp/i.test(label)) return false;
  return /game|regular season|playoff|exhibition/i.test(label);
}

function isHomeGameEvent(event) {
  return /home/i.test(`${event && event.eventKind || ''} ${event && event.type || ''}`);
}

function isAwayGameEvent(event) {
  return /away/i.test(`${event && event.eventKind || ''} ${event && event.type || ''}`);
}

function isLocalUmpireGame(event) {
  if (isAwayGameEvent(event)) return false;
  if (/windsor\s+selects/i.test(`${event && event.team || ''} ${event && event.opponent || ''}`)) return false;
  return isHomeGameEvent(event) || isHouseLeagueTeam(event.team);
}

function isHouseLeagueTeam(team) {
  return /^HL\s*-/i.test(String(team || '')) || /\bhouse\s*league\b/i.test(String(team || ''));
}

function houseLeagueCategory(event) {
  return /softball/i.test(`${event && event.team || ''} ${event && event.opponent || ''}`)
    ? 'House League Softball'
    : 'House League Baseball';
}

function compactGameKey(event, category) {
  return [
    category,
    event.date || '',
    event.time || '',
    event.endTime || '',
    event.team || '',
    event.opponent || '',
    event.diamond || ''
  ].map((part) => normalizeText(part)).join('|');
}

function visibleGameNumber(event) {
  const direct = event && (event.gameNumber || event.gameNo);
  if (direct) return direct;
  const diamondGame = String(event && event.diamond || '').match(/\[(G\d{1,3}-\d{1,3})\]/i);
  if (diamondGame) return diamondGame[1].toUpperCase();
  return event && event.cpGameId ? event.cpGameId : '';
}

function umpireDataScore(event) {
  const status = event && event.umpireStatus || {};
  const officials = Array.isArray(status.officials) ? status.officials : [];
  const statusSource = String(status.source || '').toLowerCase();
  const eventSource = String(event && event.source || '').toLowerCase();
  let score = 0;
  if (event && event.cpGameId) score += 30;
  if (statusSource && !/missing|unavailable/.test(statusSource)) score += 50;
  if (status.umpire1Confirmed) score += 8;
  if (status.umpire2Confirmed) score += 8;
  score += officials.filter((official) => official && official.confirmed).length * 10;
  score += officials.length;
  if (eventSource.includes('control panel')) score += 3;
  return score;
}

function displayGameType(event) {
  if (isHomeGameEvent(event)) return 'Home Game';
  if (isAwayGameEvent(event)) return 'Away Game';
  return event.eventKind || event.type || 'Game';
}

function umpireRequiredSlots(event, category) {
  return 2;
}

function isExternalAgeFilledEvent(event) {
  return isHomeGameEvent(event) && gameAge(event.team) >= 14;
}

function filledOverrideByGameId(overrides) {
  const byGameId = new Map();
  (Array.isArray(overrides) ? overrides : []).forEach((override) => {
    const gameId = String(override && override.gameId || '').trim();
    if (!gameId || typeof override.filled !== 'boolean') return;
    byGameId.set(gameId, {
      gameId,
      filled: override.filled,
      reason: override.reason || '',
      updatedAt: override.updatedAt || '',
      updatedBy: override.updatedBy || ''
    });
  });
  return byGameId;
}

function baseUmpireStatus(event, category, filledOverride = null) {
  const required = umpireRequiredSlots(event, category);
  const status = event.umpireStatus || {};
  const overrideFilled = filledOverride && filledOverride.filled === true;
  const overrideOpen = filledOverride && filledOverride.filled === false;
  const autoConfirmed = !overrideOpen && isExternalAgeFilledEvent(event);
  const externallyFilled = overrideFilled || autoConfirmed;
  const confirmedCount = overrideOpen
    ? 0
    : externallyFilled
    ? required
    : [status.umpire1Confirmed, status.umpire2Confirmed].filter(Boolean).length;
  return {
    required,
    confirmedCount: Math.min(required, confirmedCount),
    filled: confirmedCount >= required,
    source: overrideFilled ? 'manual-filled' : (overrideOpen ? 'manual-open' : (autoConfirmed ? 'age-rule' : (status.source || ''))),
    umpire1Confirmed: !overrideOpen && (externallyFilled || Boolean(status.umpire1Confirmed)),
    umpire2Confirmed: required < 2 ? true : (!overrideOpen && (externallyFilled || Boolean(status.umpire2Confirmed)))
  };
}

function sanitizeClaim(claim) {
  return {
    id: claim.id || '',
    gameId: claim.gameId || '',
    username: claim.username || '',
    name: claim.name || claim.username || '',
    submittedAt: claim.submittedAt || ''
  };
}

function normalizeUmpirePosition(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('home')) return 'Home Plate';
  if (normalized.includes('plate')) return 'Home Plate';
  return 'Bases';
}

function sanitizeUmpireAssignment(assignment, accountByUsername = new Map()) {
  const username = String(assignment && assignment.username || '').trim();
  const account = accountByUsername.get(username.toLowerCase());
  const name = String(assignment && assignment.name || (account && account.name) || username).trim();
  if (!username || !name) return null;
  return {
    id: assignment.id || '',
    gameId: assignment.gameId || '',
    username,
    name,
    position: assignment.position || '',
    confirmed: true,
    status: assignment.status || 'confirmed',
    source: assignment.source || 'local-admin',
    pay: assignment.pay || '',
    payAmount: Number(assignment.payAmount || 0),
    turtleClubSync: assignment.turtleClubSync || '',
    assignedAt: assignment.assignedAt || '',
    assignedBy: assignment.assignedBy || ''
  };
}

function localAssignmentsForGame(assignments, gameId, accountByUsername = new Map()) {
  return (Array.isArray(assignments) ? assignments : [])
    .filter((assignment) => assignment && assignment.gameId === gameId && assignment.status !== 'removed')
    .map((assignment) => sanitizeUmpireAssignment(assignment, accountByUsername))
    .filter(Boolean);
}

function officialEntryForEvent(official, accountMaps = { byName: new Map(), byUsername: new Map() }) {
  if (!official) return null;
  const officialUsername = String(official.username || '').trim();
  const account = (officialUsername && accountMaps.byUsername.get(officialUsername.toLowerCase()))
    || accountMaps.byName.get(normalizeOfficialName(official.name));
  const name = official.name || (account && account.name) || '';
  if (!name) return null;
  const status = String(official.status || (official.confirmed ? 'confirmed' : 'pending')).toLowerCase();
  return {
    username: officialUsername || (account ? account.username : ''),
    name,
    position: official.position || '',
    pay: official.pay || '',
    payAmount: Number(official.payAmount || 0),
    confirmed: Boolean(official.confirmed),
    status
  };
}

function officialsForEventByConfirmation(event, accountMaps, confirmed) {
  const officials = Array.isArray(event && event.umpireStatus && event.umpireStatus.officials)
    ? event.umpireStatus.officials
    : [];
  return officials
    .filter((official) => official && Boolean(official.confirmed) === confirmed)
    .map((official) => officialEntryForEvent(official, accountMaps))
    .filter(Boolean);
}

function assignedOfficialsForEvent(event, accountMaps) {
  return officialsForEventByConfirmation(event, accountMaps, true);
}

function pendingOfficialsForEvent(event, accountMaps) {
  return officialsForEventByConfirmation(event, accountMaps, false)
    .filter((official) => !['denied', 'rejected', 'declined'].includes(official.status));
}

function rejectedOfficialsForEvent(event, accountMaps) {
  return officialsForEventByConfirmation(event, accountMaps, false)
    .filter((official) => ['denied', 'rejected', 'declined'].includes(official.status));
}

function buildUmpireGame(event, category, claims, assignments = [], accountMaps = { byName: new Map(), byUsername: new Map() }, filledOverrides = new Map()) {
  const filledOverride = filledOverrides.get(event.__umpireId) || null;
  const status = baseUmpireStatus(event, category, filledOverride);
  const gameClaims = claims.filter((claim) => claim.gameId === event.__umpireId).map(sanitizeClaim);
  const remoteAssignedOfficials = assignedOfficialsForEvent(event, accountMaps);
  const localAssignedOfficials = localAssignmentsForGame(assignments, event.__umpireId, accountMaps.byUsername);
  const assignedKeys = new Set(remoteAssignedOfficials.map((official) => `${normalizeOfficialName(official.name)}|${normalizeOfficialName(official.position)}`));
  const assignedOfficials = [
    ...remoteAssignedOfficials,
    ...localAssignedOfficials.filter((official) => !assignedKeys.has(`${normalizeOfficialName(official.name)}|${normalizeOfficialName(official.position)}`))
  ];
  const pendingOfficials = pendingOfficialsForEvent(event, accountMaps);
  const rejectedOfficials = rejectedOfficialsForEvent(event, accountMaps);
  const confirmedCount = Math.min(status.required, Math.max(status.confirmedCount, assignedOfficials.length));
  const filled = confirmedCount >= status.required;
  const filledExternally = filled && !assignedOfficials.length && ['age-rule', 'manual-filled'].includes(status.source);
  return {
    id: event.__umpireId,
    remoteId: event.cpGameId || '',
    gameNumber: visibleGameNumber(event),
    category,
    date: event.date || '',
    month: event.month || '',
    time: event.time || '',
    endTime: event.endTime || '',
    type: displayGameType(event),
    team: event.team || '',
    opponent: event.opponent || '',
    diamond: event.diamond || '',
    source: event.source || '',
    requiredUmpires: status.required,
    confirmedUmpires: confirmedCount,
    filled,
    filledSource: status.source,
    filledExternally,
    fillOverride: filledOverride
      ? {
          filled: filledOverride.filled,
          reason: filledOverride.reason || '',
          updatedAt: filledOverride.updatedAt || '',
          updatedBy: filledOverride.updatedBy || ''
        }
      : null,
    umpire1Confirmed: status.umpire1Confirmed || assignedOfficials.some((official) => /home plate/i.test(official.position || '')),
    umpire2Confirmed: status.umpire2Confirmed || assignedOfficials.some((official) => /bases/i.test(official.position || '')),
    assignedOfficials,
    pendingOfficials,
    rejectedOfficials,
    claimCount: gameClaims.length,
    claims: gameClaims
  };
}

async function umpirePortalGames() {
  const currentData = await loadData();
  const titansData = brandName === 'LaSalle Titans' ? currentData : loadBundledSiteData('data.js');
  const athleticsData = brandName === 'LaSalle Athletics' ? currentData : loadBundledSiteData('athletics-data.js');
  const officials = collectOfficialRoster(titansData, athleticsData);
  const store = syncUmpireAccountsFromOfficials(officials);
  const accountMaps = officialAccountMaps(store);
  const claims = Array.isArray(store.claims) ? store.claims : [];
  const assignments = Array.isArray(store.assignments) ? store.assignments : [];
  const filledOverrides = filledOverrideByGameId(store.filledOverrides);
  const gamesByKey = new Map();

  function addEvents(events, categoryOrResolver) {
    (events || []).forEach((event) => {
      if (!event || !event.date || !event.time || !isGameEvent(event)) return;
      if (!isLocalUmpireGame(event)) return;
      const category = typeof categoryOrResolver === 'function' ? categoryOrResolver(event) : categoryOrResolver;
      const key = compactGameKey(event, category);
      const existing = gamesByKey.get(key);
      if (!existing || umpireDataScore(event) > umpireDataScore(existing.event)) {
        gamesByKey.set(key, { event, category });
      }
    });
  }

  addEvents((titansData.schedule || []).filter((event) => !isHouseLeagueTeam(event.team)), 'Titans');
  addEvents((athleticsData.schedule || []).filter((event) => !isHouseLeagueTeam(event.team)), 'Athletics');
  addEvents([
    ...(titansData.conflictEvents || []),
    ...(athleticsData.conflictEvents || []),
    ...(titansData.schedule || []),
    ...(athleticsData.schedule || [])
  ].filter((event) => isHouseLeagueTeam(event.team)), houseLeagueCategory);

  const rawGames = [...gamesByKey.entries()].map(([key, item]) => {
    const copy = { ...item.event, __umpireId: `ump-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}` };
    return buildUmpireGame(copy, item.category, claims, assignments, accountMaps, filledOverrides);
  });

  return rawGames.sort((a, b) => `${a.date} ${minutesFromDisplay(a.time)} ${a.category} ${a.team}`
    .localeCompare(`${b.date} ${minutesFromDisplay(b.time)} ${b.category} ${b.team}`));
}

function findUmpireAccount(username) {
  const normalized = String(username || '').toLowerCase();
  const store = ensureUmpireAccountsFromBundledData();
  return (store.accounts || []).find((account) => String(account.username || '').toLowerCase() === normalized);
}

function umpireProgramsForSession(session) {
  if (!session) return [];
  if (session.role === 'admin' || session.role === 'admin_viewer') return [...umpireProgramCategories];
  if (session.role !== 'umpire') return [];
  const account = findUmpireAccount(session.username || '');
  return account ? umpireAccountPrograms(account) : [];
}

function filterUmpireGamesForSession(games, session) {
  if (session && (session.role === 'admin' || session.role === 'admin_viewer')) return games;
  const allowed = new Set(umpireProgramsForSession(session));
  return (games || []).filter((game) => allowed.has(game.category));
}

function publicUmpireUser(session) {
  const programs = umpireProgramsForSession(session);
  const account = session.role === 'umpire' ? findUmpireAccount(session.username || '') : null;
  return {
    role: session.role,
    username: session.username || '',
    name: session.name || session.username || '',
    email: account ? account.email || '' : '',
    initials: sessionInitials(session),
    programs
  };
}

function coachUsernameForTeam(team) {
  const ageMatch = String(team).match(/^((?:U?\d+U?)(?:\/U?\d+U?)?|Intermediate)/i);
  const nameMatch = String(team).match(/\(([^)]+)\)/);
  const age = ageMatch && /^intermediate$/i.test(ageMatch[1])
    ? 'Intermediate'
    : [...String(ageMatch && ageMatch[1] || '').matchAll(/\d+/g)].map((match) => `${match[0]}U`).join('');
  const name = (nameMatch ? nameMatch[1] : team).replace(/[^a-z0-9]/gi, '');
  return `${name}${age.replace(/[^a-z0-9]/gi, '')}`;
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

function teamExtractRegex() {
  return new RegExp(config.teamExtractPattern || '((?:\\d+U(?:\\s*T\\d+)?|8U\\/9U)\\s*\\([^)]+\\))', 'gi');
}

function publishedCoachProgram() {
  return teamLabel || config.organizationName || 'Team';
}

function normalizePublishedTeam(team) {
  let normalized = String(team || '').replace(/\s+/g, ' ').trim();
  if (/athletics/i.test(teamLabel)) {
    normalized = normalized
      .replace(/^(?:lasalle\s+)?athletics\s*[-–—:]\s*/i, '')
      .replace(/^(?:lasalle\s+)?athletics\s+/i, '')
      .trim();
  }
  return normalized;
}

function uniquePublishedTeams(values) {
  const byKey = new Map();
  (values || []).forEach((value) => {
    const team = normalizePublishedTeam(value);
    if (!team) return;
    const key = team.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, team);
  });
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function extractPublishedTeamsFromText(text) {
  const regex = teamExtractRegex();
  return uniquePublishedTeams([...String(text || '').matchAll(regex)].map((match) => match[1]));
}

function publishedTeamsFromData(data, year) {
  const wantedYear = Number(year);
  if (Number(data && data.seasonYear) === wantedYear && Array.isArray(data && data.teams) && data.teams.length) {
    return uniquePublishedTeams(data.teams);
  }
  return [];
}

async function fetchPublicScheduleText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    },
    redirect: 'follow'
  });
  if (!response.ok) {
    throw new Error(`Turtle Club returned ${response.status}`);
  }
  const html = await response.text();
  if (/\/Human\/\?ReturnUrl=|Object moved to/i.test(html)) {
    throw new Error('Turtle Club asked for human verification on the historical season page.');
  }
  return html;
}

function scheduleContentText(html) {
  const text = stripHtml(html);
  const marker = text.indexOf('Category Schedule');
  return marker >= 0 ? text.slice(marker) : text;
}

function publicScheduleSeasonLink(html, year) {
  const wantedYear = String(year);
  const linkPattern = /<a\b[^>]*href="([^"]*\?Season=\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || '').matchAll(linkPattern)) {
    const href = match[1].replace(/&amp;/g, '&');
    const label = stripHtml(match[2]);
    if (new RegExp(`\\b${wantedYear}\\b`).test(label)) {
      return new URL(href, turtleClubBaseUrl).toString();
    }
  }
  return '';
}

function seasonSearchInfo(value) {
  const text = String(value || '').trim();
  const range = text.match(/\b(20\d{2})\D+(20\d{2})\b/);
  if (range) {
    const startYear = Number(range[1]);
    const endYear = Number(range[2]);
    return {
      season: `${startYear}-${endYear}`,
      wantedYear: endYear,
      startYear,
      endYear,
      isRange: true
    };
  }
  const single = text.match(/\b(20\d{2})\b/);
  const wantedYear = single ? Number(single[1]) : new Date().getFullYear();
  return {
    season: String(wantedYear),
    wantedYear,
    startYear: 0,
    endYear: wantedYear,
    isRange: false
  };
}

function publicScheduleMonthUrl(year, month) {
  const url = new URL(publicScheduleUrl);
  url.searchParams.set('Month', String(month));
  url.searchParams.set('Year', String(year));
  return url.toString();
}

function withoutPublishedTeams(teams, excludedTeams) {
  const excluded = new Set((excludedTeams || []).map((team) => normalizePublishedTeam(team).toLowerCase()));
  return uniquePublishedTeams((teams || []).filter((team) => !excluded.has(normalizePublishedTeam(team).toLowerCase())));
}

async function fallbackHistoricalCalendarTeams(effectiveYear, excludedTeams, searchedUrls) {
  const months = [4, 5, 6, 7, 8, 9];
  const teamNames = [];
  let warning = '';
  for (const month of months) {
    const url = publicScheduleMonthUrl(effectiveYear, month);
    searchedUrls.push(url);
    try {
      const html = await fetchPublicScheduleText(url);
      teamNames.push(...extractPublishedTeamsFromText(scheduleContentText(html)));
    } catch (error) {
      warning = warning || error.message;
    }
  }
  const filtered = withoutPublishedTeams(teamNames, excludedTeams);
  return {
    teams: filtered.length ? filtered : uniquePublishedTeams(teamNames),
    warning
  };
}

async function discoverPublishedSeasonCoaches(year, data) {
  const search = seasonSearchInfo(year);
  const wantedYear = search.wantedYear;
  const currentDataYear = Number(data && data.seasonYear);
  const effectiveYear = currentDataYear && wantedYear > currentDataYear ? currentDataYear : wantedYear;
  let fromData = publishedTeamsFromData(data, effectiveYear);
  let currentDataTeams = currentDataYear ? publishedTeamsFromData(data, currentDataYear) : [];
  if (!fromData.length && /athletics/i.test(teamLabel)) {
    const bundledAthletics = loadBundledSiteData('athletics-data.js');
    if (Number(bundledAthletics && bundledAthletics.seasonYear) === effectiveYear) {
      fromData = publishedTeamsFromData(bundledAthletics, effectiveYear);
      currentDataTeams = currentDataTeams.length ? currentDataTeams : publishedTeamsFromData(bundledAthletics, effectiveYear);
    }
  }
  const searchedUrls = [];
  let source = fromData.length ? 'current bundled data' : '';
  let warning = '';

  if (fromData.length && currentDataYear === effectiveYear) {
    return {
      year: wantedYear,
      season: search.season,
      discoveredSeasonYear: effectiveYear,
      source: wantedYear > effectiveYear ? `latest published data (${effectiveYear} season)` : source,
      searchedUrls,
      teams: fromData,
      coaches: fromData.map((team) => ({ team, email: '', program: publishedCoachProgram() })),
      warning: wantedYear > effectiveYear
        ? `Using the latest published ${effectiveYear} team list for ${search.season} setup.`
        : warning
    };
  }

  try {
    const indexHtml = await fetchPublicScheduleText(publicScheduleUrl);
    const seasonLink = publicScheduleSeasonLink(indexHtml, effectiveYear);
    const teamNames = [];

    if (!seasonLink && currentDataYear === effectiveYear) {
      teamNames.push(...extractPublishedTeamsFromText(scheduleContentText(indexHtml)));
      searchedUrls.push(publicScheduleUrl);
    }

    if (seasonLink) {
      searchedUrls.push(seasonLink);
      try {
        const html = await fetchPublicScheduleText(seasonLink);
        teamNames.push(...extractPublishedTeamsFromText(scheduleContentText(html)));
      } catch (error) {
        warning = error.message;
      }
    }

    if (!teamNames.length && effectiveYear < currentDataYear) {
      const fallback = await fallbackHistoricalCalendarTeams(effectiveYear, currentDataTeams, searchedUrls);
      teamNames.push(...fallback.teams);
      if (fallback.warning && !warning) warning = fallback.warning;
      if (teamNames.length) {
        warning = warning
          ? `${warning} Used public monthly schedule pages as a fallback and filtered out the latest published ${currentDataYear} teams.`
          : `Used public monthly schedule pages as a fallback and filtered out the latest published ${currentDataYear} teams.`;
      }
    }

    const teams = uniquePublishedTeams([...fromData, ...teamNames]);
    source = searchedUrls.length ? 'Turtle Club public schedule' : source || 'current bundled data';
    if (!teams.length && seasonLink && warning) {
      source = `Turtle Club ${effectiveYear} season`;
    }
    return {
      year: wantedYear,
      season: search.season,
      discoveredSeasonYear: effectiveYear,
      source,
      searchedUrls,
      teams,
      coaches: teams.map((team) => ({ team, email: '', program: publishedCoachProgram() })),
      warning
    };
  } catch (error) {
    return {
      year: wantedYear,
      season: search.season,
      discoveredSeasonYear: effectiveYear,
      source: source || 'current bundled data',
      searchedUrls,
      teams: fromData,
      coaches: fromData.map((team) => ({ team, email: '', program: publishedCoachProgram() })),
      warning: fromData.length ? error.message : `Could not search Turtle Club for ${effectiveYear}: ${error.message}`
    };
  }
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

function readTextBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sanitizeRequestForPublic(request) {
  return {
    id: request.id,
    action: request.action,
    team: request.team,
    originalId: request.originalId || '',
    originalGroupId: request.originalGroupId || '',
    originalType: request.originalType || '',
    originalDate: request.originalDate || '',
    originalStart: request.originalStart || '',
    originalEnd: request.originalEnd || '',
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
    adminNote: request.adminNote || '',
    allocationApproval: request.allocationApproval || null
  };
}

function isTournamentType(value) {
  return String(value || '').toLowerCase().includes('tournament');
}

function isTournamentCancellationRequest(request) {
  return String(request && request.action || '').startsWith('Cancel ')
    && isTournamentType(`${request.originalType || ''} ${request.action || ''}`)
    && Boolean(request.originalGroupId || String(request.originalId || '').startsWith('tc-calendar-tournament-'));
}

function tournamentGroupKey(event) {
  if (!event || !isTournamentType(`${event.eventKind || ''} ${event.type || ''}`)) return '';
  if (event.tournamentGroupId) return event.tournamentGroupId;
  const key = `${event.team || ''}|${event.opponent || 'Tournament'}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `tournament-${key || 'event'}`;
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
    .replace(/^@\s*/i, '')
    .replace(/[^\w]+/g, ' ')
    .trim();
}

function normalizeAvailabilityDiamond(value) {
  return String(value || '')
    .replace(/\s*\[[A-Z0-9-]+\]\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isHomeVenueDiamond(value) {
  const normalized = normalizeCompare(normalizeAvailabilityDiamond(value));
  return ['turtle club', 'vollmer', 'villanova', 'river canard'].some((prefix) => normalized.startsWith(prefix));
}

function isAllHomeDiamondsEvent(event) {
  return normalizeCompare(normalizeAvailabilityDiamond(event && event.diamond)) === 'home diamonds';
}

function eventMatchesDiamond(event, normalizedDiamond) {
  const eventDiamond = normalizeAvailabilityDiamond(event && event.diamond);
  return eventDiamond === normalizedDiamond || (isAllHomeDiamondsEvent(event) && isHomeVenueDiamond(normalizedDiamond));
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

function verifiedAppliedCreatedEvent(request, applyResult) {
  const createdEvent = applyResult && applyResult.createdEvent;
  if (!createdEvent) return null;
  return eventMatchesRequestShape(createdEvent, request) ? createdEvent : null;
}

function verifyApprovedRequestApplied(request, data, applyResult) {
  const action = String(request.action || '');
  if (isTournamentCancellationRequest(request)) {
    return {
      ok: true,
      details: 'Verified: tournament cancellation is recorded in the scheduler for every matching tournament day.'
    };
  }
  const createdEvent = findVerifiedCreatedEvent(data, request, applyResult);
  const appliedCreatedEvent = verifiedAppliedCreatedEvent(request, applyResult);
  const originalPresent = originalEventStillPresent(data, request);

  if (action.startsWith('Cancel ')) {
    return originalPresent
      ? { ok: false, details: 'The original event still appears in the refreshed Turtle Club schedule.' }
      : { ok: true, details: 'Verified: the original event no longer appears in the refreshed Turtle Club schedule.' };
  }

  if (action.startsWith('Replace ')) {
    if (appliedCreatedEvent) {
      return {
        ok: true,
        details: `Verified: Turtle Club created replacement event ${appliedCreatedEvent.remoteId || ''} on ${appliedCreatedEvent.date} at ${appliedCreatedEvent.time} on ${appliedCreatedEvent.diamond}.`
      };
    }
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

  if (!createdEvent && !appliedCreatedEvent) {
    return { ok: false, details: 'The newly created event was not found in the refreshed Turtle Club schedule.' };
  }
  const verifiedEvent = createdEvent || appliedCreatedEvent;
  return {
    ok: true,
    details: `Verified: new event is visible on ${verifiedEvent.date} at ${verifiedEvent.time} on ${verifiedEvent.diamond}.`
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshAndVerifyApprovedRequest(request, applyResult) {
  const refreshedData = await refreshData();
  return verifyApprovedRequestApplied(request, refreshedData, applyResult);
}

async function verifyApprovedRequestWithRetries(request, applyResult, firstError = null) {
  const attempts = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt > 1) await delay(10000);
    try {
      const verification = await refreshAndVerifyApprovedRequest(request, applyResult);
      attempts.push(verification ? verification.details : 'No verification result was returned.');
      if (verification && verification.ok) return verification;
    } catch (error) {
      attempts.push(error.message || 'Refresh verification failed.');
    }
  }
  return {
    ok: false,
    details: [
      firstError ? `Initial Turtle Club update error: ${firstError.message || firstError}` : '',
      ...attempts
    ].filter(Boolean).join(' | ') || 'The approved request could not be verified on Turtle Club.'
  };
}

function queueApprovedRequestSync(requestId) {
  setImmediate(() => {
    syncApprovedRequestToTurtleClub(requestId).catch((error) => {
      console.error(`Approved request background sync crashed for ${requestId}:`, error.message || error);
    });
  });
}

async function syncApprovedRequestToTurtleClub(requestId) {
  const request = (await listRequestsStore()).find((item) => item.id === requestId);
  if (!request || request.status !== 'approved' || request.manualApproved) return;
  if (isTournamentCancellationRequest(request)) {
    await updateRequestStore(requestId, (item) => {
      item.turtleClubSyncStatus = 'not-required';
      item.turtleClubSyncDetails = 'Tournament cancellation is recorded in the scheduler only.';
      item.turtleClubSyncedAt = new Date().toISOString();
    });
    return;
  }

  await updateRequestStore(requestId, (item) => {
    item.turtleClubSyncStatus = 'running';
    item.turtleClubSyncStartedAt = new Date().toISOString();
    item.turtleClubSyncError = '';
    item.turtleClubSyncDetails = 'Turtle Club sync is running in the background.';
  });

  let applyResult = null;
  let applyError = null;
  try {
    applyResult = await applyApprovedRequest(request);
  } catch (error) {
    applyError = error;
  }

  const verification = await verifyApprovedRequestWithRetries(request, applyResult, applyError);
  if (verification && verification.ok) {
    await updateRequestStore(requestId, (item) => {
      item.turtleClubSyncStatus = 'synced';
      item.turtleClubSyncDetails = verification.details;
      item.turtleClubSyncError = '';
      item.turtleClubSyncedAt = new Date().toISOString();
      item.turtleClubSyncAttemptedAt = item.turtleClubSyncedAt;
    });
    return;
  }

  const failedRequest = await updateRequestStore(requestId, (item) => {
    item.turtleClubSyncStatus = 'failed';
    item.turtleClubSyncDetails = verification ? verification.details : 'The approved request could not be verified on Turtle Club.';
    item.turtleClubSyncError = applyError ? (applyError.message || String(applyError)) : '';
    item.turtleClubSyncAttemptedAt = new Date().toISOString();
  });
  if (failedRequest && smtpConfigured()) {
    try {
      await sendApprovedRequestSyncFailureEmail(failedRequest);
    } catch (error) {
      console.error(`Approved request sync failure email failed for ${failedRequest.team} (${failedRequest.id}):`, error.message || error);
    }
  }
}

function isCreateLikeRequest(request) {
  const action = String(request.action || '');
  return action.startsWith('Create ') || action.startsWith('Replace ');
}

function isGameOpponentEditable(event) {
  const kind = `${event && event.eventKind || ''} ${event && event.type || ''}`.toLowerCase();
  return kind.includes('game') && !kind.includes('cancelled');
}

function isValidOpponentChange(value) {
  const clean = normalizeCompare(value);
  return Boolean(clean)
    && !['practice', 'home game', 'away game', 'event', 'tournament', 'select an opponent'].includes(clean);
}

function isTitansAllocationSite() {
  return String(teamLabel || '').toLowerCase() === 'titans';
}

function dateDayName(dateIso) {
  const date = new Date(`${String(dateIso || '')}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
}

function timeKeyToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function allocationDiamondKey(value) {
  const normalized = normalizeAvailabilityDiamond(value)
    .toLowerCase()
    .replace(/\bdiamonds?\b/g, 'diamond')
    .replace(/\bfield\b/g, '')
    .replace(/\s*#\s*/g, '')
    .replace(/[^a-z0-9]+/g, '');
  return normalized;
}

function normalizeTeamKey(value) {
  return normalizeCompare(value).replace(/\s+/g, '');
}

function normalizeCoachName(value) {
  const clean = String(value || '')
    .toLowerCase()
    .replace(/nickelson/g, 'nickleson')
    .replace(/[^a-z]+/g, '');
  return clean;
}

function teamAllocationIdentity(value) {
  const text = String(value || '');
  const ageMatch = text.match(/(8U\/9U|\d+\s*U)/i);
  const coachMatch = text.match(/\(([^)]+)\)/);
  if (!ageMatch || !coachMatch) return null;
  return {
    age: ageMatch[1].replace(/\s+/g, '').toUpperCase(),
    coach: normalizeCoachName(coachMatch[1])
  };
}

function teamsShareAllocationIdentity(left, right) {
  const leftKey = normalizeTeamKey(left);
  const rightKey = normalizeTeamKey(right);
  if (leftKey && rightKey && leftKey === rightKey) return true;
  const leftIdentity = teamAllocationIdentity(left);
  const rightIdentity = teamAllocationIdentity(right);
  return Boolean(leftIdentity && rightIdentity
    && leftIdentity.age === rightIdentity.age
    && leftIdentity.coach
    && leftIdentity.coach === rightIdentity.coach);
}

function activeAllotmentPhase(dateIso) {
  const phases = Array.isArray(titansDiamondAllotments.phases) ? titansDiamondAllotments.phases : [];
  return phases.find((phase) => {
    const from = String(phase.from || '');
    const through = String(phase.through || '');
    return (!from || dateIso >= from) && (!through || dateIso <= through);
  }) || phases[0] || { slots: [] };
}

function requestIsAwayGame(request) {
  return String(`${request.newType || ''} ${request.action || ''}`).toLowerCase().includes('away');
}

function requestIsAllocationChecked(request) {
  const action = String(request.action || '');
  if (!isTitansAllocationSite()) return false;
  if (!isCreateLikeRequest(request)) return false;
  if (requestIsAwayGame(request)) return false;
  if (isTournamentType(`${request.newType || ''} ${request.action || ''}`)) return false;
  return Boolean(request.date && request.diamond);
}

function requestMatchesAllocationSlot(request, slot, dayName, requestStart, requestEnd) {
  if (!slot || slot.day !== dayName) return false;
  if (allocationDiamondKey(slot.diamond || '') !== allocationDiamondKey(request.diamond || '')) return false;
  if (dayName !== 'Saturday' && dayName !== 'Sunday') return true;
  const slotStart = timeKeyToMinutes(slot.start);
  const slotEnd = timeKeyToMinutes(slot.end) || slotStart;
  if (!slotStart || !slotEnd || !requestStart || !requestEnd) return false;
  return requestStart >= slotStart && requestEnd <= slotEnd;
}

function allocationReviewForRequest(request) {
  if (!requestIsAllocationChecked(request)) {
    return { required: false, reason: 'Allocation approval not required.' };
  }
  const dayName = dateDayName(request.date);
  const phase = activeAllotmentPhase(request.date);
  const slots = Array.isArray(phase.slots) ? phase.slots : [];
  const requestStart = minutesFromDisplay(request.start);
  const requestEnd = requestEndMinutes(request);
  const matchingSlots = slots.filter((slot) => requestMatchesAllocationSlot(request, slot, dayName, requestStart, requestEnd));
  const ownSlot = matchingSlots.find((slot) => teamsShareAllocationIdentity(slot.team, request.team));
  if (ownSlot) {
    return {
      required: false,
      phase: phase.name || '',
      matchedOwnSlot: ownSlot,
      reason: `Within ${ownSlot.team}'s allotted diamond time.`
    };
  }
  const assignedSlot = matchingSlots[0] || null;
  return {
    required: true,
    phase: phase.name || '',
    status: 'pending',
    assignedSlot,
    assignedOwnerLabel: assignedSlot && assignedSlot.team ? assignedSlot.team : 'No listed allotment for this diamond/time.',
    reason: assignedSlot
      ? `Outside ${request.team}'s allotted time. This slot is allotted to ${assignedSlot.team}.`
      : `Outside ${request.team}'s allotted time. No allotment was found for this diamond/time.`
  };
}

function originFromRequest(req) {
  const host = String(req.headers.host || '').trim() || `127.0.0.1:${process.env.PORT || 4173}`;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (host.includes('127.0.0.1') || host.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function createAllocationApprovalToken(requestId, decision) {
  return createSessionToken({
    purpose: 'allocation-approval',
    requestId,
    decision
  });
}

function allocationApprovalLinks(req, requestId) {
  const origin = originFromRequest(req);
  return {
    approveUrl: `${origin}/api/allocation-approval/${encodeURIComponent(createAllocationApprovalToken(requestId, 'approve'))}`,
    rejectUrl: `${origin}/api/allocation-approval/${encodeURIComponent(createAllocationApprovalToken(requestId, 'reject'))}`
  };
}

function isFreshAllocationApprovalToken(tokenPayload) {
  if (!tokenPayload || tokenPayload.purpose !== 'allocation-approval') return false;
  const createdAt = Number(tokenPayload.ts || 0);
  return Boolean(tokenPayload.requestId && tokenPayload.decision && createdAt && Date.now() - createdAt <= 14 * 24 * 60 * 60 * 1000);
}

function sendHtml(res, statusCode, title, message) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; background: #f4f5ef; color: #153d1b; }
    main { max-width: 680px; margin: 10vh auto; background: #fff; border-left: 6px solid #d6aa2c; padding: 28px; box-shadow: 0 10px 28px rgba(0,0,0,.12); }
    h1 { margin-top: 0; font-size: 28px; }
    p { font-size: 18px; line-height: 1.45; }
    a { color: #153d1b; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <p><a href="/admin.html">Open admin portal</a></p>
  </main>
</body>
</html>`);
}

function sendAllocationDecisionForm(res, token, decision, request) {
  const approving = decision === 'approve';
  const title = approving ? 'Accept Diamond Use' : 'Reject Diamond Use';
  const buttonLabel = approving ? 'Accept request' : 'Reject request';
  const buttonColor = approving ? '#123f16' : '#9d352b';
  const approval = request.allocationApproval || {};
  const assigned = approval.assignedSlot || {};
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; background: #f4f5ef; color: #153d1b; }
    main { max-width: 760px; margin: 7vh auto; background: #fff; border-left: 6px solid #d6aa2c; padding: 28px; box-shadow: 0 10px 28px rgba(0,0,0,.12); }
    h1 { margin-top: 0; font-size: 30px; }
    dl { display: grid; grid-template-columns: minmax(140px, 190px) 1fr; gap: 10px 18px; font-size: 16px; }
    dt { color: #5f695d; font-weight: 700; }
    dd { margin: 0; }
    textarea { box-sizing: border-box; width: 100%; min-height: 130px; margin-top: 8px; padding: 12px; border: 1px solid #cdd6c7; font: inherit; }
    label { display: block; margin-top: 22px; font-weight: 700; }
    button { margin-top: 18px; padding: 13px 20px; border: 0; background: ${buttonColor}; color: #fff; font-weight: 800; cursor: pointer; }
    .note { color: #5f695d; line-height: 1.45; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p class="note">Review the request below. Add an optional note, then confirm your decision.</p>
    <dl>
      <dt>Team requesting</dt><dd>${escapeHtml(request.team || '')}</dd>
      <dt>Action</dt><dd>${escapeHtml(request.action || '')}</dd>
      <dt>Date / time</dt><dd>${escapeHtml(`${request.date || ''} ${request.start || ''}${request.end ? `-${request.end}` : ''}`)}</dd>
      <dt>Diamond</dt><dd>${escapeHtml(request.diamond || '')}</dd>
      <dt>Opponent / title</dt><dd>${escapeHtml(request.opponent || '')}</dd>
      <dt>Allotted to</dt><dd>${escapeHtml(assigned.team ? `${assigned.team} (${assigned.timeLabel || ''})` : (approval.assignedOwnerLabel || 'No listed allotment'))}</dd>
      <dt>Reason</dt><dd>${escapeHtml(approval.reason || '')}</dd>
    </dl>
    <form method="post" action="/api/allocation-approval/${encodeURIComponent(token)}">
      <label for="note">Optional note</label>
      <textarea id="note" name="note" placeholder="Add context for the admin approval record..."></textarea>
      <button type="submit">${escapeHtml(buttonLabel)}</button>
    </form>
  </main>
</body>
</html>`);
}

function opponentLabelForEvent(event, opponent) {
  const clean = String(opponent || '').trim();
  if (!clean || /^(vs\.?|@)\s+/i.test(clean)) return clean;
  const kind = `${event && event.eventKind || ''} ${event && event.type || ''}`.toLowerCase();
  if (kind.includes('away')) return `@ ${clean}`;
  if (kind.includes('home')) return `vs. ${clean}`;
  return clean;
}

async function markOpponentSyncFailure(change, error, localOpponent) {
  const message = error && error.message ? error.message : String(error || 'Unknown error');
  await updateLocalEvent(change.originalId, (current) => ({
    ...current,
    opponentSyncStatus: 'failed',
    opponentSyncError: message,
    opponentSyncFailedAt: new Date().toISOString()
  }));

  if (!smtpConfigured()) {
    console.error(`Opponent change failed for ${change.team} (${change.originalId}) and email is not configured:`, message);
    return;
  }

  try {
    await sendOpponentChangeFailureEmail({
      ...change,
      localOpponent,
      error: message
    });
  } catch (emailError) {
    console.error(`Opponent change failure email failed for ${change.team} (${change.originalId}):`, emailError.message || emailError);
  }
}

async function syncOpponentChangeInBackground(change, localOpponent) {
  try {
    const updateResult = await updateGameOpponent(change);
    const verifiedOpponent = updateResult.event && updateResult.event.opponent
      ? updateResult.event.opponent
      : opponentLabelForEvent({ eventKind: change.type, type: change.type }, change.opponent);

    await updateLocalEvent(change.originalId, (current) => ({
      ...current,
      ...(updateResult.event || {}),
      id: current.id,
      remoteId: updateResult.remoteId || current.remoteId,
      opponent: verifiedOpponent,
      opponentSyncStatus: 'synced',
      opponentSyncError: '',
      opponentSyncedAt: new Date().toISOString()
    }));
  } catch (error) {
    await markOpponentSyncFailure(change, error, localOpponent);
  }
}

async function sendOpponentChangeNotificationInBackground(change, localOpponent) {
  if (!smtpConfigured()) return;
  try {
    await sendOpponentChangeEmail({
      ...change,
      opponent: localOpponent,
      syncStatus: 'Updated on local scheduler immediately; Turtle Club sync is running in the background.'
    });
  } catch (error) {
    console.error(`Opponent change notification email failed for ${change.team} (${change.originalId}):`, error.message || error);
  }
}

async function dataForRequestValidation(payload) {
  const targetDate = String(payload.date || payload.originalDate || '');
  if (!targetDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return loadData();
  }
  try {
    return await refreshDateData(targetDate);
  } catch (error) {
    console.warn(`[schedule] one-day live validation refresh failed for ${targetDate}: ${error.message}`);
    return loadData();
  }
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
  const { freedSlots, queuedConflicts } = queuedScheduleAdjustments(data, queuedRequests, request, date, normalizedDiamond, ignoredId, original);

  const conflict = (data.conflictEvents || data.schedule || []).find((item) => {
    if (item.id === ignoredId) return false;
    if (freedSlots.some((slot) => slot.id === item.id)) return false;
    if (item.date !== date || !eventMatchesDiamond(item, normalizedDiamond)) return false;
    const eventStart = minutesFromDisplay(item.time);
    const eventEnd = eventEndMinutes(item);
    return rangesOverlap(start, end, eventStart, eventEnd);
  });
  if (conflict) {
    if (normalizeCompare(conflict.team) === normalizeCompare(request.team)) {
      return {
        ok: false,
        message: `This overlaps your own ${conflict.eventKind || conflict.type || 'event'} vs ${conflict.opponent || 'Practice'} at ${conflict.time}. To change that event, click the existing event on your schedule and choose Replace instead of creating a new request.`
      };
    }
    return {
      ok: false,
      message: `Diamond conflict with ${conflict.team} ${conflict.opponent} (${conflict.eventKind || conflict.type}) at ${conflict.time}.`
    };
  }

  const queuedConflict = queuedConflicts.find((item) => rangesOverlap(start, end, item.start, item.end));
  if (queuedConflict) {
    return {
      ok: false,
      message: `Queued ${request.team} conflict with ${queuedConflict.opponent} (${queuedConflict.source}) at ${queuedConflict.time}.`
    };
  }

  if (isAwayGame) {
    return {
      ok: true,
      message: `Available: no Turtle Club away-game conflict overlaps at ${diamond}.`
    };
  }

  const masterUnavailableConflict = masterScheduleUnavailableBlocksForDates([date], data).find((item) => {
    if (!eventMatchesDiamond(item, normalizedDiamond)) return false;
    const unavailableStart = minutesFromDisplay(item.time);
    const unavailableEnd = item.endTime ? minutesFromDisplay(item.endTime) : unavailableStart + (item.durationMinutes || 120);
    return rangesOverlap(start, end, unavailableStart, unavailableEnd);
  });
  if (masterUnavailableConflict) {
    return {
      ok: false,
      message: `Not available - no reservation: ${diamond} is unavailable ${masterUnavailableConflict.time}-${masterUnavailableConflict.endTime}.`
    };
  }

  const openSlot = (data.availability || []).find((slot) => {
    return slot.date === date
      && normalizeAvailabilityDiamond(slot.diamond) === normalizedDiamond
      && minutesFromDisplay(slot.start) <= start
      && minutesFromDisplay(slot.end) >= end;
  });
  const fitsWeekdayWindow = isWithinWeekdayOpenWindow(date, start, end);
  const fitsFreedSlot = freedSlots.find((slot) => slot.start <= start && slot.end >= end);
  if (!openSlot && !fitsWeekdayWindow && !fitsFreedSlot) {
    return {
      ok: false,
      message: 'This request does not fit the weekday 5:00 PM-9:00 PM window, a published open diamond block, or a time slot already being freed by a queued change.'
    };
  }

  if (fitsFreedSlot && !openSlot && !fitsWeekdayWindow) {
    return {
      ok: true,
      message: `Available: this request uses the ${fitsFreedSlot.source} time being freed, and no other Turtle Club ${(request.newType || 'event').toLowerCase()} conflict overlaps.`
    };
  }

  if (fitsWeekdayWindow && !openSlot) {
    return {
      ok: true,
      message: `Available: ${diamond} fits the weekday 5:00 PM-9:00 PM window, and no Turtle Club ${(request.newType || 'event').toLowerCase()} conflict overlaps.`
    };
  }

  return {
    ok: true,
    message: `Available: ${diamond} is open ${openSlot.start}-${openSlot.end}, and no Turtle Club ${(request.newType || 'event').toLowerCase()} conflict overlaps.`
  };
}

function queuedScheduleAdjustments(data, queuedRequests, request, date, normalizedDiamond, ignoredId, original) {
  const freedSlots = [];
  const queuedConflicts = [];
  if (original && original.date === date && normalizeAvailabilityDiamond(original.diamond) === normalizedDiamond) {
    freedSlots.push(eventToFreedSlot(original));
  }

  (queuedRequests || [])
    .filter((item) => (item.status || 'pending') !== 'rejected')
    .filter((item) => normalizeCompare(item.team) === normalizeCompare(request.team))
    .forEach((item) => {
      const action = String(item.action || '');
      if ((action.startsWith('Cancel ') || action.startsWith('Replace ')) && item.originalId) {
        if (!(ignoredId && item.originalId === ignoredId)) {
          const originalEvent = findEventById(data, item.originalId);
          const slot = originalEvent ? eventToFreedSlot(originalEvent) : originalRequestToFreedSlot(item);
          if (slot && slot.date === date && normalizeAvailabilityDiamond(slot.diamond) === normalizedDiamond) {
            freedSlots.push(slot);
          }
        }
      }

      if ((action.startsWith('Create ') || action.startsWith('Replace '))
        && item.date === date
        && normalizeAvailabilityDiamond(item.diamond) === normalizedDiamond) {
        const queuedStart = minutesFromDisplay(item.start);
        const queuedEnd = item.end ? minutesFromDisplay(item.end) : queuedStart + 120;
        if (queuedStart && queuedEnd > queuedStart) {
          queuedConflicts.push({
            start: queuedStart,
            end: queuedEnd,
            time: item.start,
            opponent: item.opponent || 'event',
            source: item.newType || item.action || 'event'
          });
        }
      }
    });

  return { freedSlots, queuedConflicts };
}

function findEventById(data, id) {
  return [...(data.schedule || []), ...(data.conflictEvents || [])].find((event) => event.id === id) || null;
}

function eventToFreedSlot(event) {
  return {
    id: event.id,
    date: event.date,
    diamond: event.diamond,
    start: minutesFromDisplay(event.time),
    end: eventEndMinutes(event),
    source: event.eventKind || event.type || 'event'
  };
}

function originalRequestToFreedSlot(request) {
  const start = minutesFromDisplay(request.originalStart);
  if (!start) return null;
  const end = request.originalEnd ? minutesFromDisplay(request.originalEnd) : start + 120;
  return {
    id: request.originalId,
    date: request.originalDate,
    diamond: request.originalDiamond,
    start,
    end,
    source: request.originalType || 'event'
  };
}

const MASTER_SCHEDULE_UNAVAILABLE_RULES = {
  weekly: [
    { day: 'Monday', start: '5:00 PM', end: '9:00 PM', diamonds: ['Vollmer #2', 'Vollmer #5', 'Vollmer #6', 'Vollmer #7', 'Vollmer #8'] },
    { day: 'Monday', start: '5:00 PM', end: '9:00 PM', diamonds: ['River Canard #1', 'River Canard #3', 'River Canard #4'] },
    { day: 'Tuesday', start: '5:00 PM', end: '9:00 PM', diamonds: ['River Canard #1', 'River Canard #2'] },
    { day: 'Wednesday', start: '5:00 PM', end: '9:00 PM', diamonds: ['River Canard #1', 'River Canard #3', 'River Canard #4'] },
    { day: 'Thursday', start: '5:00 PM', end: '9:00 PM', diamonds: ['Vollmer #1', 'River Canard #1', 'River Canard #3', 'River Canard #4'] },
    { day: 'Friday', start: '5:00 PM', end: '9:00 PM', diamonds: ['Vollmer #1', 'River Canard #1', 'River Canard #2', 'River Canard #3', 'River Canard #4'] },
    { day: 'Saturday', start: '9:00 AM', end: '8:00 PM', diamonds: ['Vollmer #8'] },
    { day: 'Sunday', start: '9:00 AM', end: '2:00 PM', diamonds: ['Vollmer #4', 'Vollmer #5', 'Vollmer #6', 'Vollmer #7', 'Vollmer #8'] }
  ],
  postHouseLeague: [
    { day: 'Monday', start: '5:00 PM', end: '9:00 PM', diamonds: ['Vollmer #2', 'Vollmer #5', 'Vollmer #6', 'Vollmer #7', 'Vollmer #8', 'River Canard #1'] },
    { day: 'Tuesday', start: '5:00 PM', end: '9:00 PM', diamonds: ['River Canard #1', 'River Canard #2'] },
    { day: 'Wednesday', start: '5:00 PM', end: '9:00 PM', diamonds: ['River Canard #1'] },
    { day: 'Thursday', start: '5:00 PM', end: '9:00 PM', diamonds: ['Vollmer #1', 'Vollmer #2', 'Vollmer #5', 'Vollmer #6', 'Vollmer #7', 'Vollmer #8', 'River Canard #1'] },
    { day: 'Friday', start: '5:00 PM', end: '9:00 PM', diamonds: ['Vollmer #1'] },
    { day: 'Saturday', start: '9:00 AM', end: '3:00 PM', diamonds: ['Vollmer #1'] },
    { day: 'Saturday', start: '9:00 AM', end: '8:00 PM', diamonds: ['Vollmer #2', 'Vollmer #3', 'Vollmer #5', 'Vollmer #6', 'Vollmer #7', 'Vollmer #8', 'River Canard #1', 'River Canard #2', 'River Canard #3', 'River Canard #4'] },
    { day: 'Saturday', start: '9:00 AM', end: '1:00 PM', diamonds: ['Vollmer #4'] },
    { day: 'Saturday', start: '5:00 PM', end: '8:00 PM', diamonds: ['Vollmer #4'] },
    { day: 'Sunday', start: '9:00 AM', end: '8:00 PM', diamonds: ['Vollmer #2', 'Vollmer #3', 'Vollmer #5', 'Vollmer #6', 'Vollmer #7', 'Vollmer #8', 'River Canard #1', 'River Canard #2', 'River Canard #3', 'River Canard #4'] },
    { day: 'Sunday', start: '2:00 PM', end: '8:00 PM', diamonds: ['Vollmer #1', 'Vollmer #4'] }
  ]
};

function seasonYearForData(data, dates = []) {
  if (Number(data && data.seasonYear)) return Number(data.seasonYear);
  const dated = dates.find(Boolean);
  if (dated && /^\d{4}-/.test(dated)) return Number(dated.slice(0, 4));
  return new Date().getFullYear();
}

function masterUnavailablePhase(date, seasonYear) {
  if (date < `${seasonYear}-04-01` || date > `${seasonYear}-12-31`) return '';
  return date <= `${seasonYear}-06-29` ? 'weekly' : 'postHouseLeague';
}

function masterScheduleUnavailableBlocksForDates(dates, data) {
  const seasonYear = seasonYearForData(data, dates);
  return [...new Set(dates.filter(Boolean))].flatMap((date) => {
    const phase = masterUnavailablePhase(date, seasonYear);
    if (!phase) return [];
    const dayName = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
    return (MASTER_SCHEDULE_UNAVAILABLE_RULES[phase] || [])
      .filter((rule) => rule.day === dayName)
      .flatMap((rule) => rule.diamonds.map((diamond) => ({
        date,
        diamond,
        time: rule.start,
        endTime: rule.end,
        durationMinutes: minutesFromDisplay(rule.end) - minutesFromDisplay(rule.start),
        team: 'Not available - no reservation',
        opponent: '',
        eventKind: 'Not available - no reservation',
        type: 'Not available - no reservation',
        source: 'Master diamond schedule unavailable'
      })));
  });
}

function isWithinWeekdayOpenWindow(date, start, end) {
  const day = new Date(`${date}T12:00:00`).getDay();
  return day !== 0 && day !== 6 && start >= 1020 && end <= 1260;
}

function buildAvailabilityBlocks(data) {
  const homeVenuePrefixes = ['turtle club', 'vollmer', 'villanova', 'river canard'];
  const isHomeVenue = (value) => {
    const normalized = normalizeCompare(normalizeAvailabilityDiamond(value));
    return homeVenuePrefixes.some((prefix) => normalized.startsWith(prefix));
  };
  const isAllHomeDiamondsEvent = (event) => {
    return normalizeCompare(normalizeAvailabilityDiamond(event && event.diamond)) === 'home diamonds';
  };
  const eventAppliesToDiamond = (event, diamond) => {
    const normalizedDiamond = normalizeAvailabilityDiamond(event && event.diamond);
    return normalizedDiamond === diamond || (isAllHomeDiamondsEvent(event) && isHomeVenue(diamond));
  };
  const eventAppliesToDiamondSet = (event, diamondSet) => {
    const normalizedDiamond = normalizeAvailabilityDiamond(event && event.diamond);
    return diamondSet.has(normalizedDiamond) || (isAllHomeDiamondsEvent(event) && [...diamondSet].some(isHomeVenue));
  };
  const baseDates = [...new Set([
    ...(data.availability || []).map((slot) => slot.date),
    ...(data.conflictEvents || data.schedule || []).map((event) => event.date)
  ].filter(Boolean))].sort();
  const masterUnavailableEvents = masterScheduleUnavailableBlocksForDates(baseDates, data);
  const diamonds = [...new Set([
    ...(data.availability || []).map((slot) => normalizeAvailabilityDiamond(slot.diamond)).filter(Boolean),
    ...((data.conflictEvents || data.schedule || []).map((event) => normalizeAvailabilityDiamond(event.diamond)).filter((diamond) => diamond && isHomeVenue(diamond))),
    ...masterUnavailableEvents.map((event) => normalizeAvailabilityDiamond(event.diamond)).filter(Boolean)
  ])].sort();
  const diamondSet = new Set(diamonds);
  const calendarDates = (data.conflictEvents || data.schedule || [])
    .filter((event) => eventAppliesToDiamondSet(event, diamondSet))
    .map((event) => event.date);
  const dates = [...new Set([
    ...(data.availability || []).map((slot) => slot.date),
    ...calendarDates,
    ...masterUnavailableEvents.map((event) => event.date)
  ].filter(Boolean))].sort();
  let availableCount = 0;
  let bookedCount = 0;

  const days = dates.map((date) => {
    const dateObject = new Date(`${date}T12:00:00`);
    const isWeekend = dateObject.getDay() === 0 || dateObject.getDay() === 6;
    const defaultStart = isWeekend ? 480 : 1020;
    const defaultEnd = isWeekend ? 1200 : 1260;
    const dayAvailability = (data.availability || []).filter((slot) => slot.date === date);
    const dayConflicts = (data.conflictEvents || data.schedule || [])
      .filter((event) => event.date === date && eventAppliesToDiamondSet(event, diamondSet));
    const dayMasterUnavailable = masterUnavailableEvents
      .filter((event) => event.date === date && eventAppliesToDiamondSet(event, diamondSet));
    const availabilityStarts = dayAvailability.map((slot) => minutesFromDisplay(slot.start)).filter(Boolean);
    const availabilityEnds = dayAvailability.map((slot) => minutesFromDisplay(slot.end)).filter(Boolean);
    const conflictStarts = dayConflicts.map((event) => minutesFromDisplay(event.time)).filter(Boolean);
    const conflictEnds = dayConflicts.map((event) => event.endTime ? minutesFromDisplay(event.endTime) : minutesFromDisplay(event.time) + (event.durationMinutes || 120)).filter(Boolean);
    const unavailableStarts = dayMasterUnavailable.map((event) => minutesFromDisplay(event.time)).filter(Boolean);
    const unavailableEnds = dayMasterUnavailable.map((event) => event.endTime ? minutesFromDisplay(event.endTime) : minutesFromDisplay(event.time) + (event.durationMinutes || 120)).filter(Boolean);
    const windowStart = (availabilityStarts.length || conflictStarts.length || unavailableStarts.length)
      ? Math.min(defaultStart, ...availabilityStarts, ...conflictStarts, ...unavailableStarts)
      : defaultStart;
    const windowEnd = (availabilityEnds.length || conflictEnds.length || unavailableEnds.length)
      ? Math.max(defaultEnd, ...availabilityEnds, ...conflictEnds, ...unavailableEnds)
      : defaultEnd;
    const diamondRows = diamonds.map((diamond) => {
      const availabilityRanges = dayAvailability
        .filter((slot) => normalizeAvailabilityDiamond(slot.diamond) === diamond)
        .map((slot) => clippedRange(minutesFromDisplay(slot.start), minutesFromDisplay(slot.end), windowStart, windowEnd))
        .filter((range) => range.end > range.start);
      const defaultOpenRanges = isWeekend ? [] : [{ start: defaultStart, end: defaultEnd }];
      const openRanges = [...defaultOpenRanges, ...availabilityRanges];
      if (!openRanges.length) openRanges.push({ start: windowStart, end: windowEnd });
      const realConflicts = (data.conflictEvents || data.schedule || [])
        .filter((event) => event.date === date && eventAppliesToDiamond(event, diamond))
        .map((event) => {
          const eventStart = minutesFromDisplay(event.time);
          const eventEnd = event.endTime ? minutesFromDisplay(event.endTime) : eventStart + (event.durationMinutes || 120);
          return {
            ...clippedRange(eventStart, eventEnd, windowStart, windowEnd),
            label: `${event.team} ${event.opponent}`.trim()
          };
        })
        .filter((range) => range.end > range.start);
      const unavailableConflicts = masterUnavailableEvents
        .filter((event) => event.date === date && eventAppliesToDiamond(event, diamond))
        .map((event) => {
          const eventStart = minutesFromDisplay(event.time);
          const eventEnd = event.endTime ? minutesFromDisplay(event.endTime) : eventStart + (event.durationMinutes || 120);
          return {
            ...clippedRange(eventStart, eventEnd, windowStart, windowEnd),
            label: 'Not available - no reservation'
          };
        })
        .filter((range) => range.end > range.start);
      const conflicts = [...realConflicts, ...unavailableConflicts];
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
    `A coach submitted a new ${teamLabel} schedule request.`,
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
      username: `${teamLabel} Scheduler`,
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
    const adminLogin = adminLoginForCredentials(username, password);
    if (adminLogin) {
      const adminSession = adminSessionFromLogin(adminLogin);
      const adminToken = createSessionToken(adminSession);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Set-Cookie', [
        `${coachCookieName}=${adminToken}; HttpOnly; SameSite=Strict; Path=/`,
        `${cookieName}=${adminToken}; HttpOnly; SameSite=Strict; Path=/`
      ]);
      res.end(JSON.stringify({
        ok: true,
        user: { role: 'admin', username: adminSession.username, team: '', initials: adminSession.initials },
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
        initials: sessionInitials(session),
        canSwitchSites: canSwitchAdminSitesSession(session),
        hideSyncFailures: Boolean(session.hideSyncFailures),
        canRevealPasswords: canRevealAdminPasswords(session),
        canEditCoachEmails: canEditCoachEmailsSession(session),
        canManualApprove: canManualApproveSession(session)
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/umpire/login') {
    const payload = await readBody(req);
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '').trim();
    const adminLogin = adminLoginForCredentials(username, password);
    if (adminLogin) {
      const adminSession = adminSessionFromLogin(adminLogin);
      const token = createSessionToken(adminSession);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Set-Cookie', [
        `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`,
        `${coachCookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`
      ]);
      res.end(JSON.stringify({
        ok: true,
        user: {
          role: 'admin',
          username: adminSession.username,
          name: adminSession.username,
          programs: [...umpireProgramCategories]
        }
      }));
      return;
    }
    const account = findUmpireAccount(username);
    if (!account || password !== String(account.password || '')) {
      sendJson(res, 401, { error: 'Invalid username or password' });
      return;
    }
    const token = createSessionToken({
      role: 'umpire',
      username: account.username,
      name: account.name || account.username,
      initials: String(account.name || account.username || 'U').trim().slice(0, 2).toUpperCase()
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Set-Cookie', `${coachCookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`);
    res.end(JSON.stringify({
      ok: true,
      user: {
        role: 'umpire',
        username: account.username,
        name: account.name || account.username,
        programs: umpireAccountPrograms(account)
      }
    }));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/umpire/session') {
    const session = readCoachSession(req);
    sendJson(res, 200, {
      authenticated: canAccessUmpirePortalSession(session),
      user: canAccessUmpirePortalSession(session) ? publicUmpireUser(session) : null
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/umpire/games') {
    const session = readCoachSession(req);
    if (!canAccessUmpirePortalSession(session)) {
      sendJson(res, 401, { error: 'Umpire login required.' });
      return;
    }
    const allGames = await umpirePortalGames();
    const games = filterUmpireGamesForSession(allGames, session);
    const categories = session.role === 'umpire'
      ? umpireProgramsForSession(session)
      : [...umpireProgramCategories];
    sendJson(res, 200, {
      games,
      categories,
      user: publicUmpireUser(session),
      dataVersion: await dataVersion()
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/umpire/accounts') {
    const session = readCoachSession(req);
    if (!canMutateAdminPortalSession(session)) {
      sendJson(res, 403, { error: 'Only an admin can view umpire login accounts.' });
      return;
    }
    const store = ensureUmpireAccountsFromBundledData();
    sendJson(res, 200, {
      accounts: (store.accounts || [])
        .filter((account) => account.source === 'official-roster' && !isPlaceholderOfficialName(account.name || account.username || ''))
        .map(publicUmpireAccount)
        .sort((a, b) => a.name.localeCompare(b.name))
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/umpire/accounts') {
    const session = readCoachSession(req);
    if (!canMutateAdminPortalSession(session)) {
      sendJson(res, 403, { error: 'Only an admin can update umpire login accounts.' });
      return;
    }
    const payload = await readBody(req);
    const updates = Array.isArray(payload.accounts) ? payload.accounts : [];
    const store = ensureUmpireAccountsFromBundledData();
    const byUsername = new Map(updates.map((account) => [
      String(account.username || '').toLowerCase(),
      sanitizeUmpirePrograms(account.programs)
    ]));
    const accounts = (store.accounts || []).map((account) => {
      const key = String(account.username || '').toLowerCase();
      if (!byUsername.has(key)) return account;
      return { ...account, programs: byUsername.get(key) };
    });
    writeUmpireStore({ ...store, accounts });
    sendJson(res, 200, {
      ok: true,
      accounts: accounts
        .filter((account) => account.source === 'official-roster' && !isPlaceholderOfficialName(account.name || account.username || ''))
        .map(publicUmpireAccount)
        .sort((a, b) => a.name.localeCompare(b.name))
    });
    return;
  }

  const umpireAccountDeleteMatch = pathname.match(/^\/api\/umpire\/accounts\/([^/]+)$/);
  if (req.method === 'DELETE' && umpireAccountDeleteMatch) {
    const session = readCoachSession(req);
    if (!canMutateAdminPortalSession(session)) {
      sendJson(res, 403, { error: 'Only an admin can delete umpire login accounts.' });
      return;
    }
    const username = decodeURIComponent(umpireAccountDeleteMatch[1] || '').trim();
    if (!username) {
      sendJson(res, 400, { error: 'Choose an umpire account to delete.' });
      return;
    }
    const store = ensureUmpireAccountsFromBundledData();
    const normalizedUsername = username.toLowerCase();
    const accounts = Array.isArray(store.accounts) ? store.accounts : [];
    const target = accounts.find((account) => String(account.username || '').toLowerCase() === normalizedUsername);
    if (!target || target.source !== 'official-roster') {
      sendJson(res, 404, { error: 'Umpire account not found.' });
      return;
    }
    const deletedAccountUsernames = new Set((Array.isArray(store.deletedAccountUsernames) ? store.deletedAccountUsernames : [])
      .map((item) => String(item || '').toLowerCase())
      .filter(Boolean));
    deletedAccountUsernames.add(normalizedUsername);
    const claims = (Array.isArray(store.claims) ? store.claims : [])
      .filter((claim) => String(claim.username || '').toLowerCase() !== normalizedUsername);
    const assignments = (Array.isArray(store.assignments) ? store.assignments : [])
      .map((assignment) => String(assignment.username || '').toLowerCase() === normalizedUsername && assignment.status !== 'removed'
        ? {
            ...assignment,
            status: 'removed',
            removedAt: new Date().toISOString(),
            removedBy: session.username || adminUsername,
            removeTurtleClubSync: assignment.turtleClubSync === 'synced' ? 'not-run-account-deleted' : assignment.removeTurtleClubSync || ''
          }
        : assignment);
    const nextAccounts = accounts.filter((account) => String(account.username || '').toLowerCase() !== normalizedUsername);
    writeUmpireStore({
      ...store,
      accounts: nextAccounts,
      claims,
      assignments,
      deletedAccountUsernames: [...deletedAccountUsernames].sort()
    });
    sendJson(res, 200, {
      ok: true,
      deleted: publicUmpireAccount(target),
      accounts: nextAccounts
        .filter((account) => account.source === 'official-roster' && !isPlaceholderOfficialName(account.name || account.username || ''))
        .map(publicUmpireAccount)
        .sort((a, b) => a.name.localeCompare(b.name))
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/umpire/refresh-data') {
    const session = readCoachSession(req);
    if (!canMutateAdminPortalSession(session)) {
      sendJson(res, 403, { error: 'Only an admin can refresh umpire schedule data.' });
      return;
    }
    try {
      const refreshed = await refreshUmpirePortalData();
      const allGames = await umpirePortalGames();
      const games = filterUmpireGamesForSession(allGames, session);
      sendJson(res, 200, {
        ok: true,
        version: String(refreshed.scrapedAt || Date.now()),
        games
      });
    } catch (error) {
      sendJson(res, 500, { error: 'Umpire data refresh failed', details: error.message });
    }
    return;
  }

  const umpireFilledMatch = pathname.match(/^\/api\/umpire\/games\/([^/]+)\/filled$/);
  if (req.method === 'POST' && umpireFilledMatch) {
    const session = readCoachSession(req);
    if (!canMutateAdminPortalSession(session)) {
      sendJson(res, 403, { error: 'Only an admin can mark umpire games filled.' });
      return;
    }
    const [, gameId] = umpireFilledMatch;
    const payload = await readBody(req);
    if (typeof payload.filled !== 'boolean') {
      sendJson(res, 400, { error: 'Choose whether this game should be marked filled.' });
      return;
    }
    const games = await umpirePortalGames();
    const game = games.find((item) => item.id === gameId);
    if (!game) {
      sendJson(res, 404, { error: 'Game not found.' });
      return;
    }
    if (payload.filled === false && game.assignedOfficials && game.assignedOfficials.length && !game.fillOverride) {
      sendJson(res, 409, { error: 'This game has assigned officials. Remove the assignments instead of reopening it manually.' });
      return;
    }

    const store = readUmpireStore();
    const overrides = Array.isArray(store.filledOverrides) ? store.filledOverrides : [];
    const nextOverrides = overrides.filter((override) => override && override.gameId !== gameId);
    nextOverrides.push({
      gameId,
      filled: payload.filled,
      reason: payload.filled ? 'admin-marked-filled' : 'admin-reopened',
      updatedAt: new Date().toISOString(),
      updatedBy: session.username || adminUsername
    });
    writeUmpireStore({ ...store, filledOverrides: nextOverrides });
    const updatedGames = await umpirePortalGames();
    sendJson(res, 200, {
      ok: true,
      game: updatedGames.find((item) => item.id === gameId) || game
    });
    return;
  }

  const umpireAssignMatch = pathname.match(/^\/api\/umpire\/games\/([^/]+)\/assign$/);
  if (req.method === 'POST' && umpireAssignMatch) {
    const session = readCoachSession(req);
    if (!canMutateAdminPortalSession(session)) {
      sendJson(res, 403, { error: 'Only an admin can assign umpires.' });
      return;
    }
    const [, gameId] = umpireAssignMatch;
    const payload = await readBody(req);
    const username = String(payload.username || '').trim();
    const position = normalizeUmpirePosition(payload.position || 'Bases');
    if (!username) {
      sendJson(res, 400, { error: 'Choose an umpire to assign.' });
      return;
    }
    const games = await umpirePortalGames();
    const game = games.find((item) => item.id === gameId);
    if (!game) {
      sendJson(res, 404, { error: 'Game not found.' });
      return;
    }
    const account = findUmpireAccount(username);
    if (!account) {
      sendJson(res, 404, { error: 'Official account not found.' });
      return;
    }
    const store = readUmpireStore();
    const assignments = Array.isArray(store.assignments) ? store.assignments : [];
    const alreadyAssigned = [
      ...(game.assignedOfficials || []),
      ...assignments.filter((assignment) => assignment.gameId === gameId && assignment.status !== 'removed')
    ].some((official) => String(official.username || '').toLowerCase() === username.toLowerCase()
      || normalizeOfficialName(official.name) === normalizeOfficialName(account.name || username));
    if (alreadyAssigned) {
      sendJson(res, 409, { error: `${account.name || username} is already assigned to this game.` });
      return;
    }

    let turtleClubSync = 'synced';
    let turtleClubError = '';
    try {
      await assignGameOfficial({
        game,
        official: account,
        position,
        assignedBy: session.username || adminUsername
      });
    } catch (error) {
      turtleClubSync = 'failed';
      turtleClubError = error.message || String(error);
    }

    const assignment = {
      id: createRequestId(),
      gameId,
      username: account.username,
      name: account.name || account.username,
      position,
      source: 'local-admin',
      status: 'confirmed',
      turtleClubSync,
      turtleClubError,
      assignedAt: new Date().toISOString(),
      assignedBy: session.username || adminUsername
    };
    const claims = Array.isArray(store.claims) ? store.claims : [];
    writeUmpireStore({
      ...store,
      assignments: [...assignments, assignment],
      claims: claims.filter((claim) => !(claim.gameId === gameId && String(claim.username || '').toLowerCase() === username.toLowerCase()))
    });
    const updatedGames = await umpirePortalGames();
    sendJson(res, 200, {
      ok: turtleClubSync === 'synced',
      turtleClubSync,
      turtleClubError,
      assignment,
      game: updatedGames.find((item) => item.id === gameId) || game
    });
    return;
  }

  const umpireRemoveAssignmentMatch = pathname.match(/^\/api\/umpire\/games\/([^/]+)\/assignments\/([^/]+)$/);
  if (req.method === 'DELETE' && umpireRemoveAssignmentMatch) {
    const session = readCoachSession(req);
    if (!canMutateAdminPortalSession(session)) {
      sendJson(res, 403, { error: 'Only an admin can remove umpire assignments.' });
      return;
    }
    const [, gameId, assignmentId] = umpireRemoveAssignmentMatch;
    const store = readUmpireStore();
    const assignments = Array.isArray(store.assignments) ? store.assignments : [];
    const assignment = assignments.find((item) => item.id === assignmentId && item.gameId === gameId && item.status !== 'removed');
    if (!assignment) {
      sendJson(res, 404, { error: 'Assignment not found.' });
      return;
    }
    let turtleClubSync = 'synced';
    let turtleClubError = '';
    const game = (await umpirePortalGames()).find((item) => item.id === gameId);
    try {
      await removeGameOfficial({
        game,
        assignment,
        removedBy: session.username || adminUsername
      });
    } catch (error) {
      turtleClubSync = 'failed';
      turtleClubError = error.message || String(error);
    }
    const nextAssignments = assignments.map((item) => item.id === assignmentId
      ? {
          ...item,
          status: 'removed',
          removedAt: new Date().toISOString(),
          removedBy: session.username || adminUsername,
          removeTurtleClubSync: turtleClubSync,
          removeTurtleClubError: turtleClubError
        }
      : item);
    writeUmpireStore({ ...store, assignments: nextAssignments });
    const updatedGames = await umpirePortalGames();
    sendJson(res, 200, {
      ok: turtleClubSync === 'synced',
      turtleClubSync,
      turtleClubError,
      game: updatedGames.find((item) => item.id === gameId) || game
    });
    return;
  }

  const umpireMoveClaimMatch = pathname.match(/^\/api\/umpire\/games\/([^/]+)\/claims\/([^/]+)\/move$/);
  if (req.method === 'POST' && umpireMoveClaimMatch) {
    const session = readCoachSession(req);
    if (!canMutateAdminPortalSession(session)) {
      sendJson(res, 403, { error: 'Only an admin can move umpire availability.' });
      return;
    }
    const [, sourceGameId, claimId] = umpireMoveClaimMatch;
    const payload = await readBody(req);
    const targetGameId = String(payload.targetGameId || '').trim();
    if (!targetGameId) {
      sendJson(res, 400, { error: 'Choose a game to move this umpire to.' });
      return;
    }
    if (targetGameId === sourceGameId) {
      sendJson(res, 409, { error: 'This umpire is already available for that game.' });
      return;
    }
    const games = await umpirePortalGames();
    const sourceGame = games.find((game) => game.id === sourceGameId);
    const targetGame = games.find((game) => game.id === targetGameId);
    if (!sourceGame || !targetGame) {
      sendJson(res, 404, { error: 'Game not found.' });
      return;
    }
    if (sourceGame.date !== targetGame.date || minutesFromDisplay(sourceGame.time) !== minutesFromDisplay(targetGame.time)) {
      sendJson(res, 409, { error: 'Move availability only between games at the same date and time.' });
      return;
    }
    const store = readUmpireStore();
    const claims = Array.isArray(store.claims) ? store.claims : [];
    const claimIndex = claims.findIndex((claim) => claim.gameId === sourceGameId && claim.id === claimId);
    if (claimIndex < 0) {
      sendJson(res, 404, { error: 'Availability request not found.' });
      return;
    }
    const claim = claims[claimIndex];
    const username = String(claim.username || '').toLowerCase();
    const alreadyAvailable = claims.some((item, index) => index !== claimIndex
      && item.gameId === targetGameId
      && String(item.username || '').toLowerCase() === username);
    if (alreadyAvailable) {
      sendJson(res, 409, { error: `${claim.name || claim.username || 'This umpire'} is already available for that game.` });
      return;
    }
    const alreadyAssigned = [
      ...(targetGame.assignedOfficials || []),
      ...(targetGame.pendingOfficials || [])
    ].some((official) => String(official.username || '').toLowerCase() === username
      || normalizeOfficialName(official.name) === normalizeOfficialName(claim.name || claim.username));
    if (alreadyAssigned) {
      sendJson(res, 409, { error: `${claim.name || claim.username || 'This umpire'} is already listed on that game.` });
      return;
    }
    const nextClaims = claims.map((item, index) => index === claimIndex
      ? {
          ...item,
          gameId: targetGameId,
          movedFromGameId: sourceGameId,
          movedAt: new Date().toISOString(),
          movedBy: session.username || adminUsername
        }
      : item);
    writeUmpireStore({ ...store, claims: nextClaims });
    const updatedGames = await umpirePortalGames();
    sendJson(res, 200, {
      ok: true,
      games: updatedGames.filter((game) => game.id === sourceGameId || game.id === targetGameId)
    });
    return;
  }

  const umpireClaimMatch = pathname.match(/^\/api\/umpire\/games\/([^/]+)\/claim$/);
  if (req.method === 'POST' && umpireClaimMatch) {
    const session = readCoachSession(req);
    if (!canAccessUmpirePortalSession(session)) {
      sendJson(res, 401, { error: 'Umpire login required.' });
      return;
    }
    if (session.role === 'admin_viewer') {
      sendJson(res, 403, { error: 'View-only admins cannot mark umpire availability.' });
      return;
    }
    const [, gameId] = umpireClaimMatch;
    const payload = await readBody(req);
    const action = String(payload.action || 'claim');
    const games = filterUmpireGamesForSession(await umpirePortalGames(), session);
    const game = games.find((item) => item.id === gameId);
    if (!game) {
      sendJson(res, 404, { error: 'Game not found.' });
      return;
    }
    const store = readUmpireStore();
    const username = String(session.username || '').trim();
    const claims = Array.isArray(store.claims) ? store.claims : [];
    const existingIndex = claims.findIndex((claim) => claim.gameId === gameId && String(claim.username || '').toLowerCase() === username.toLowerCase());
    if (action === 'cancel') {
      if (existingIndex >= 0) claims.splice(existingIndex, 1);
    } else if (existingIndex < 0) {
      claims.push({
        id: createRequestId(),
        gameId,
        username,
        name: session.name || username,
        submittedAt: new Date().toISOString()
      });
    }
    writeUmpireStore({ ...store, claims });
    const updatedGames = filterUmpireGamesForSession(await umpirePortalGames(), session);
    sendJson(res, 200, {
      ok: true,
      game: updatedGames.find((item) => item.id === gameId) || game
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
        brandName,
        teamLabel,
        sportName,
        contacts,
        alternateAdminSite,
        adminPath: adminPathForSession(session),
        fieldStatusPath: fieldStatusPathForSession(session),
        profilePath: profilePathForSession(session),
        umpirePath: umpirePathForSession(session),
        tournamentScoresPath: tournamentScoresPathForSession(session),
        user: {
          role: session.role,
          username: session.username || '',
          team: session.team || '',
          initials: sessionInitials(session),
          canSwitchSites: canSwitchAdminSitesSession(session),
          hideSyncFailures: Boolean(session.hideSyncFailures),
          canRevealPasswords: canRevealAdminPasswords(session),
          canEditCoachEmails: canEditCoachEmailsSession(session),
          canManualApprove: canManualApproveSession(session)
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
      brandName,
      teamLabel,
      sportName,
      contacts,
      alternateAdminSite,
      adminPath: adminPathForSession(session),
      fieldStatusPath: fieldStatusPathForSession(session),
      profilePath: profilePathForSession(session),
      umpirePath: umpirePathForSession(session),
      tournamentScoresPath: tournamentScoresPathForSession(session),
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

  if (req.method === 'GET' && pathname === '/api/tournament-scores/bootstrap') {
    const session = readCoachSession(req);
    if (!canAccessTournamentScoresSession(session)) {
      sendJson(res, 403, { error: 'Tournament score access is limited to vanWezel and admin accounts.' });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      tournamentId: tournamentScoresTournamentId,
      canSubmit: canMutateTournamentScoresSession(session),
      user: {
        role: session.role,
        username: session.username || '',
        team: session.team || '',
        initials: sessionInitials(session)
      }
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/tournament-scores/games') {
    const session = readCoachSession(req);
    if (!canAccessTournamentScoresSession(session)) {
      sendJson(res, 403, { error: 'Tournament score access is limited to vanWezel and admin accounts.' });
      return;
    }
    try {
      const games = await listTournamentScoreGames({ tournamentId: tournamentScoresTournamentId });
      sendJson(res, 200, {
        ok: true,
        tournamentId: tournamentScoresTournamentId,
        games,
        refreshedAt: new Date().toISOString()
      });
    } catch (error) {
      sendJson(res, 502, {
        error: 'Tournament scores could not be loaded from Turtle Club.',
        details: error.message || String(error)
      });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/tournament-scores/report') {
    const session = readCoachSession(req);
    if (!canMutateTournamentScoresSession(session)) {
      sendJson(res, 403, { error: 'This account cannot submit tournament scores.' });
      return;
    }
    const payload = await readBody(req);
    try {
      const result = await submitTournamentScore({
        tournamentId: tournamentScoresTournamentId,
        game: payload.game,
        homeScore: payload.homeScore,
        awayScore: payload.awayScore
      });
      sendJson(res, 200, {
        ok: true,
        result,
        submittedAt: new Date().toISOString()
      });
    } catch (error) {
      sendJson(res, 502, {
        error: 'Tournament score could not be submitted to Turtle Club.',
        details: error.message || String(error)
      });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/season-upload/verify') {
    const payload = await readBody(req);
    const found = seasonPlanner.findCoachByToken(payload.token);
    if (!found) {
      sendJson(res, 404, { error: 'Upload link was not found or has expired.' });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      season: {
        id: found.season.id,
        year: found.season.year,
        label: found.season.label,
        status: found.season.status
      },
      coach: {
        id: found.coach.id,
        team: found.coach.team,
        email: found.coach.email,
        program: found.coach.program,
        uploadedAt: found.coach.uploadedAt || '',
        eventCount: (found.coach.events || []).length
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/season-upload/events') {
    const payload = await readBody(req);
    const saved = seasonPlanner.saveUpload(payload.token, payload.events);
    if (!saved) {
      sendJson(res, 404, { error: 'Upload link was not found or has expired.' });
      return;
    }
    const publicSeason = seasonPlanner.publicSeason(saved.season, await loadData());
    sendJson(res, 200, {
      ok: true,
      eventCount: saved.events.length,
      invalidCount: saved.events.filter((event) => !event.valid).length,
      conflictCount: publicSeason.conflictCount,
      coach: {
        team: saved.coach.team,
        uploadedAt: saved.coach.uploadedAt
      }
    });
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

  if (req.method === 'POST' && pathname === '/api/coach/events/opponent') {
    const session = readCoachSession(req);
    if (!session) {
      sendJson(res, 401, { error: 'Login required' });
      return;
    }
    if (session.role !== 'coach' && session.role !== 'admin') {
      sendJson(res, 403, { error: 'Only coach and admin accounts can directly change game opponents.' });
      return;
    }
    const payload = await readBody(req);
    const eventId = String(payload.eventId || '').trim();
    const opponent = String(payload.opponent || '').trim();
    if (!eventId || !isValidOpponentChange(opponent)) {
      sendJson(res, 400, { error: 'Choose a valid opponent.' });
      return;
    }
    const fullData = await loadData();
    const event = (fullData.schedule || []).find((item) => item.id === eventId);
    if (!event) {
      sendJson(res, 404, { error: 'Game was not found in the latest schedule.' });
      return;
    }
    if (session.role !== 'admin' && event.team !== session.team) {
      sendJson(res, 403, { error: 'This coach cannot change another team schedule.' });
      return;
    }
    if (!isGameOpponentEditable(event)) {
      sendJson(res, 400, { error: 'Only active home or away games can have the opponent changed directly.' });
      return;
    }
    if (normalizeCompare(event.opponent) === normalizeCompare(opponent)) {
      sendJson(res, 400, { error: 'The selected opponent is already on this game.' });
      return;
    }

    const change = {
      team: event.team,
      originalId: event.id,
      originalType: event.eventKind || event.type || 'Game',
      originalDate: event.date,
      originalStart: event.time,
      originalEnd: event.endTime || '',
      originalOpponent: event.opponent || '',
      originalDiamond: event.diamond || '',
      date: event.date,
      start: event.time,
      end: event.endTime || '',
      type: event.eventKind || event.type || 'Game',
      newType: event.eventKind || event.type || 'Game',
      previousOpponent: event.opponent || '',
      opponent,
      diamond: event.diamond || '',
      changedBy: session.username || session.team
    };

    const localOpponent = opponentLabelForEvent(event, opponent);
    const localEvent = await updateLocalEvent(event.id, (current) => ({
      ...current,
      opponent: localOpponent,
      opponentSyncStatus: 'pending',
      opponentSyncRequestedAt: new Date().toISOString(),
      opponentSyncRequestedBy: session.username || session.team,
      opponentSyncPreviousOpponent: event.opponent || ''
    }));
    const responseEvent = localEvent || {
      ...event,
      opponent: localOpponent,
      opponentSyncStatus: 'pending'
    };

    sendJson(res, 200, {
      ok: true,
      event: responseEvent,
      syncPending: true,
      emailSent: false,
      emailError: smtpConfigured() ? '' : 'Email sender is not configured on the server.'
    });

    syncOpponentChangeInBackground(change, localOpponent).catch((error) => {
      console.error(`Opponent change background sync failed for ${change.team} (${event.id}):`, error.message || error);
    });
    sendOpponentChangeNotificationInBackground(change, localOpponent).catch((error) => {
      console.error(`Opponent change notification failed for ${change.team} (${event.id}):`, error.message || error);
    });
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
    const fullData = await dataForRequestValidation(payload);
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
        payload.originalEnd = original.endTime || '';
        payload.originalOpponent = original.opponent;
        payload.originalDiamond = original.diamond;
        payload.originalGroupId = tournamentGroupKey(original) || payload.originalGroupId || '';
      }
    } else if (original) {
      payload.originalType = original.eventKind || original.type || payload.originalType || '';
      payload.originalDate = original.date || payload.originalDate || '';
      payload.originalStart = original.time || payload.originalStart || '';
      payload.originalEnd = original.endTime || payload.originalEnd || '';
      payload.originalOpponent = original.opponent || payload.originalOpponent || '';
      payload.originalDiamond = original.diamond || payload.originalDiamond || '';
      payload.originalGroupId = tournamentGroupKey(original) || payload.originalGroupId || '';
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
    const allocationReview = allocationReviewForRequest(payload);
    const request = {
      ...payload,
      id: createRequestId(),
      status: 'pending',
      submittedAt: new Date().toISOString(),
      reviewedAt: '',
      reviewedBy: '',
      adminNote: ''
    };
    if (allocationReview.required) {
      request.allocationApproval = {
        status: 'pending',
        requestedAt: request.submittedAt,
        phase: allocationReview.phase || '',
        reason: allocationReview.reason || '',
        assignedOwnerLabel: allocationReview.assignedOwnerLabel || '',
        assignedSlot: allocationReview.assignedSlot || null,
        approvedAt: '',
        approvedBy: '',
        rejectedAt: '',
        rejectedBy: '',
        decisionTokenUsedAt: ''
      };
      Object.assign(request.allocationApproval, allocationApprovalLinks(req, request.id));
    } else {
      request.allocationApproval = {
        status: 'not_required',
        reason: allocationReview.reason || '',
        matchedOwnSlot: allocationReview.matchedOwnSlot || null
      };
    }
    const stored = await insertRequestStore(request);
    sendRequestNotification(stored).catch((error) => {
      console.error('Request notification failed:', error.message);
    });
    sendCoachRequestSubmittedEmail(stored).catch((error) => {
      console.error(`Request submission email failed for ${stored.team} (${stored.id}):`, error.message);
    });
    if (stored.allocationApproval && stored.allocationApproval.status === 'pending') {
      sendAllocationApprovalRequestEmail(stored).catch((error) => {
        console.error(`Allocation approval email failed for ${stored.team} (${stored.id}):`, error.message);
      });
    }
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
    const adminLogin = adminLoginForCredentials(payload.username, payload.password, { allowPasswordOnly: true });
    if (!adminLogin) {
      sendJson(res, 401, { error: 'Invalid password' });
      return;
    }
    const adminSession = adminSessionFromLogin(adminLogin);
    const token = createSessionToken(adminSession);
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
      user: publicAdminUser(session)
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/switch-link') {
    const session = readCoachSession(req);
    if (!canAccessAdminPortalSession(session)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }
    if (!canSwitchAdminSitesSession(session)) {
      sendJson(res, 403, { error: 'This admin account is limited to this site.' });
      return;
    }
    if (!alternateAdminSite || !alternateAdminSite.url) {
      sendJson(res, 404, { error: 'No alternate admin site is configured.' });
      return;
    }
    try {
      const targetUrl = new URL(alternateAdminSite.url);
      const targetPath = safeSwitchTargetPath(req);
      if (targetPath) {
        const targetPathUrl = new URL(targetPath, 'http://local');
        targetUrl.pathname = targetPathUrl.pathname;
        targetUrl.search = targetPathUrl.search;
        targetUrl.hash = targetPathUrl.hash;
      }
      targetUrl.searchParams.set('switchToken', createAdminSwitchToken(session));
      sendJson(res, 200, {
        ok: true,
        url: targetUrl.toString(),
        label: alternateAdminSite.label || 'Other Admin'
      });
    } catch (_) {
      sendJson(res, 500, { error: 'Alternate admin site URL is invalid.' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/switch-login') {
    const payload = await readBody(req);
    const switchSession = parseSignedToken(payload.switchToken || '');
    if (!isFreshAdminSwitchSession(switchSession)) {
      sendJson(res, 401, { error: 'Switch login expired. Please switch again from the original admin page.' });
      return;
    }
    const token = createSessionToken({
      role: switchSession.role,
      username: switchSession.username || (switchSession.role === 'admin' ? adminUsername : readOnlyAdminUsername),
      initials: switchSession.initials || sessionInitials(switchSession),
      canSwitchSites: switchSession.canSwitchSites !== false,
      canAccessTitans: switchSession.canAccessTitans !== false,
      canAccessAthletics: switchSession.canAccessAthletics !== false,
      hideSyncFailures: Boolean(switchSession.hideSyncFailures)
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Set-Cookie', [
      `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`,
      `${coachCookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`
    ]);
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const allocationApprovalMatch = pathname.match(/^\/api\/allocation-approval\/([^/]+)$/);
  if ((req.method === 'GET' || req.method === 'POST') && allocationApprovalMatch) {
    const rawToken = decodeURIComponent(allocationApprovalMatch[1] || '');
    const tokenPayload = parseSignedToken(rawToken);
    if (!isFreshAllocationApprovalToken(tokenPayload)) {
      sendHtml(res, 400, 'Approval Link Expired', 'This allocation approval link is invalid or expired.');
      return;
    }
    const decision = String(tokenPayload.decision || '').toLowerCase();
    if (decision !== 'approve' && decision !== 'reject') {
      sendHtml(res, 400, 'Invalid Decision', 'This allocation approval link is not valid.');
      return;
    }
    const requestId = String(tokenPayload.requestId || '');
    const existing = (await listRequestsStore()).find((item) => item.id === requestId);
    if (!existing) {
      sendHtml(res, 404, 'Request Not Found', 'The schedule request connected to this link could not be found.');
      return;
    }
    const allocation = existing.allocationApproval || {};
    if (allocation.status !== 'pending') {
      sendHtml(res, 200, 'Already Reviewed', `This allocation request has already been ${allocation.status || 'reviewed'}.`);
      return;
    }
    if (req.method === 'GET') {
      sendAllocationDecisionForm(res, rawToken, decision, existing);
      return;
    }
    const formText = await readTextBody(req);
    const formValues = new URLSearchParams(formText);
    const decisionNote = String(formValues.get('note') || '').trim();
    const reviewedAt = new Date().toISOString();
    const request = await updateRequestStore(requestId, (item) => {
      item.allocationApproval = {
        ...(item.allocationApproval || {}),
        status: decision === 'approve' ? 'approved' : 'rejected',
        approvedAt: decision === 'approve' ? reviewedAt : '',
        approvedBy: decision === 'approve' ? 'Allocation approval link' : '',
        approvedNote: decision === 'approve' ? decisionNote : '',
        rejectedAt: decision === 'reject' ? reviewedAt : '',
        rejectedBy: decision === 'reject' ? 'Allocation approval link' : '',
        rejectedNote: decision === 'reject' ? decisionNote : '',
        decisionTokenUsedAt: reviewedAt
      };
      if (decision === 'reject') {
        item.status = 'rejected';
        item.adminNote = decisionNote
          ? `Rejected during additional diamond allotment approval. Note: ${decisionNote}`
          : 'Rejected during additional diamond allotment approval.';
        item.reviewedAt = reviewedAt;
        item.reviewedBy = 'Allocation approval link';
      }
    });
    if (decision === 'reject' && smtpConfigured()) {
      sendCoachRequestDecisionEmail(request).catch((error) => {
        console.error(`Allocation rejection email failed for ${request.team} (${request.id}):`, error.message);
      });
    }
    sendHtml(
      res,
      200,
      decision === 'approve' ? 'Allocation Approved' : 'Allocation Rejected',
      decision === 'approve'
        ? 'This request can now continue through the normal admin approval process.'
        : 'This request has been rejected and will not be applied to Turtle Club.'
    );
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

  if (req.method === 'GET' && pathname === '/api/admin/season-planner') {
    const session = readCoachSession(req);
    if (!canRevealAdminPasswords(session)) {
      sendJson(res, 403, { error: 'Only the primary admin account can manage new season setup.' });
      return;
    }
    const data = await loadData();
    sendJson(res, 200, {
      seasons: seasonPlanner.listSeasons().map((season) => seasonPlanner.publicSeason(season, data)),
      storeFile: seasonPlanner.storeFile,
      smtpConfigured: smtpConfigured()
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/privileges') {
    const session = readCoachSession(req);
    if (!canRevealAdminPasswords(session)) {
      sendJson(res, 403, { error: 'Only the primary admin account can manage admin privileges.' });
      return;
    }
    const configurable = configurableAdminUsers().map((user) => findConfiguredAdminUser(user.username) || user);
    sendJson(res, 200, {
      admins: [
        {
          username: adminUsername,
          password: canRevealAdminPasswords(session) ? adminPassword : '********',
          label: 'Primary Admin',
          email: '',
          locked: true,
          canSwitchSites: true,
          canAccessTitans: true,
          canAccessAthletics: true,
          canEditCoachEmails: true,
          canManualApprove: true,
          notifyOnCoachRequests: true,
          hideSyncFailures: false
        },
        {
          username: readOnlyAdminUsername,
          password: canRevealAdminPasswords(session) ? readOnlyAdminPassword : '********',
          label: 'Read-Only Admin',
          email: '',
          locked: true,
          canSwitchSites: true,
          canAccessTitans: true,
          canAccessAthletics: true,
          canEditCoachEmails: false,
          canManualApprove: false,
          notifyOnCoachRequests: false,
          hideSyncFailures: false
        },
        {
          username: statusEditorUsername,
          password: canRevealAdminPasswords(session) ? statusEditorPassword : '********',
          label: 'Field Status Editor',
          email: '',
          locked: true,
          canSwitchSites: false,
          canAccessTitans: String(teamLabel || '').toLowerCase().includes('titan'),
          canAccessAthletics: String(teamLabel || '').toLowerCase().includes('athletic'),
          canEditCoachEmails: false,
          canManualApprove: false,
          notifyOnCoachRequests: false,
          hideSyncFailures: false
        },
        ...configurable.map((user) => ({
          username: user.username,
          password: canRevealAdminPasswords(session) ? user.password : '********',
          label: user.accessLabel || 'Site Admin',
          email: user.email || '',
          locked: false,
          removable: user.removable === true,
          canSwitchSites: user.canSwitchSites !== false,
          canAccessTitans: user.canAccessTitans !== false,
          canAccessAthletics: user.canAccessAthletics !== false,
          canEditCoachEmails: Boolean(user.canEditCoachEmails),
          canManualApprove: Boolean(user.canManualApprove),
          notifyOnCoachRequests: user.notifyOnCoachRequests !== false,
          hideSyncFailures: Boolean(user.hideSyncFailures)
        }))
      ]
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/privileges') {
    const session = readCoachSession(req);
    if (!canRevealAdminPasswords(session)) {
      sendJson(res, 403, { error: 'Only the primary admin account can manage admin privileges.' });
      return;
    }
    const payload = await readBody(req);
    const configurable = new Set(configurableAdminUsers().map((user) => user.username.toLowerCase()));
    const overrides = (Array.isArray(payload.admins) ? payload.admins : [])
      .filter((item) => configurable.has(String(item.username || '').toLowerCase()));
    seasonPlanner.saveAdminPrivilegeOverrides(overrides);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/accounts') {
    const session = readCoachSession(req);
    if (!canRevealAdminPasswords(session)) {
      sendJson(res, 403, { error: 'Only the primary admin account can add admin accounts.' });
      return;
    }
    const payload = await readBody(req);
    const account = seasonPlanner.addAdminAccount({
      username: payload.username,
      password: payload.password,
      initials: payload.initials,
      email: payload.email,
      accessLabel: payload.accessLabel || 'Site Admin',
      canSwitchSites: payload.canSwitchSites !== false,
      canAccessTitans: payload.canAccessTitans !== false,
      canAccessAthletics: payload.canAccessAthletics !== false,
      canEditCoachEmails: payload.canEditCoachEmails === true,
      canManualApprove: payload.canManualApprove === true,
      notifyOnCoachRequests: payload.notifyOnCoachRequests !== false,
      hideSyncFailures: payload.hideSyncFailures === true
    });
    if (!account) {
      sendJson(res, 400, { error: 'Username and password are required.' });
      return;
    }
    sendJson(res, 200, { ok: true, account });
    return;
  }

  const adminAccountDeleteMatch = pathname.match(/^\/api\/admin\/accounts\/([^/]+)$/);
  if (req.method === 'DELETE' && adminAccountDeleteMatch) {
    const session = readCoachSession(req);
    if (!canRevealAdminPasswords(session)) {
      sendJson(res, 403, { error: 'Only the primary admin account can remove admin accounts.' });
      return;
    }
    const username = decodeURIComponent(adminAccountDeleteMatch[1] || '');
    const removed = seasonPlanner.removeAdminAccount(username);
    if (!removed) {
      sendJson(res, 404, { error: 'Admin account not found or cannot be removed.' });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/season-planner/create') {
    const session = readCoachSession(req);
    if (!canRevealAdminPasswords(session)) {
      sendJson(res, 403, { error: 'Only the primary admin account can create a season workspace.' });
      return;
    }
    const payload = await readBody(req);
    const season = seasonPlanner.ensureSeason(payload.season || payload.year, payload.label);
    sendJson(res, 200, {
      ok: true,
      season: seasonPlanner.publicSeason(season, await loadData())
    });
    return;
  }

  const seasonPlannerDeleteMatch = pathname.match(/^\/api\/admin\/season-planner\/([^/]+)$/);
  if (req.method === 'DELETE' && seasonPlannerDeleteMatch) {
    const session = readCoachSession(req);
    if (!canRevealAdminPasswords(session)) {
      sendJson(res, 403, { error: 'Only the primary admin account can delete a season workspace.' });
      return;
    }
    const removed = seasonPlanner.removeSeason(decodeURIComponent(seasonPlannerDeleteMatch[1]));
    if (!removed) {
      sendJson(res, 404, { error: 'Season workspace not found.' });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/season-planner/coaches') {
    const session = readCoachSession(req);
    if (!canRevealAdminPasswords(session)) {
      sendJson(res, 403, { error: 'Only the primary admin account can update season coaches.' });
      return;
    }
    const payload = await readBody(req);
    const season = seasonPlanner.upsertCoaches(payload.seasonId, payload.coaches);
    if (!season) {
      sendJson(res, 404, { error: 'Season workspace not found.' });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      season: seasonPlanner.publicSeason(season, await loadData())
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/season-planner/discover-coaches') {
    const session = readCoachSession(req);
    if (!canRevealAdminPasswords(session)) {
      sendJson(res, 403, { error: 'Only the primary admin account can search published season coaches.' });
      return;
    }
    const payload = await readBody(req);
    const data = await loadData();
    const discovered = await discoverPublishedSeasonCoaches(payload.season || payload.year, data);
    sendJson(res, 200, {
      ok: true,
      ...discovered
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/season-planner/send-links') {
    const session = readCoachSession(req);
    if (!canRevealAdminPasswords(session)) {
      sendJson(res, 403, { error: 'Only the primary admin account can send season upload links.' });
      return;
    }
    const payload = await readBody(req);
    const season = seasonPlanner.findSeason(payload.seasonId);
    if (!season) {
      sendJson(res, 404, { error: 'Season workspace not found.' });
      return;
    }
    if (!smtpConfigured()) {
      sendJson(res, 400, { error: 'Email sender is not configured on the server.' });
      return;
    }
    const wanted = new Set((payload.coachIds || []).map(String));
    const deliveries = [];
    const failures = [];
    for (const coach of season.coaches || []) {
      if (wanted.size && !wanted.has(coach.id)) continue;
      if (!coach.email) {
        failures.push({ team: coach.team, error: 'No email address' });
        continue;
      }
      const uploadUrl = `${requestOrigin(req)}/season-upload.html?token=${encodeURIComponent(coach.uploadToken)}`;
      try {
        await sendSeasonUploadInviteEmail({
          to: coach.email,
          coachTeam: coach.team,
          seasonLabel: season.label,
          uploadUrl
        });
        deliveries.push({ team: coach.team, email: coach.email });
      } catch (error) {
        failures.push({ team: coach.team, email: coach.email, error: error.message || 'Email failed' });
      }
    }
    const updatedSeason = seasonPlanner.markLinksSent(payload.seasonId, deliveries.map((delivery) => {
      const coach = (season.coaches || []).find((item) => item.team === delivery.team && item.email === delivery.email);
      return coach && coach.id;
    }).filter(Boolean));
    sendJson(res, 200, {
      ok: true,
      sent: deliveries.length,
      deliveries,
      failures,
      season: updatedSeason ? seasonPlanner.publicSeason(updatedSeason, await loadData()) : null
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/season-planner/admin-upload') {
    const session = readCoachSession(req);
    if (!canRevealAdminPasswords(session)) {
      sendJson(res, 403, { error: 'Only the primary admin account can upload a season schedule sheet.' });
      return;
    }
    const payload = await readBody(req);
    const saved = seasonPlanner.saveAdminUpload(payload.seasonId, payload.rows);
    if (!saved) {
      sendJson(res, 404, { error: 'Season workspace not found.' });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      coachCount: saved.coachCount,
      eventCount: saved.eventCount,
      season: seasonPlanner.publicSeason(saved.season, await loadData())
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/season-planner/approve') {
    const session = readCoachSession(req);
    if (!canRevealAdminPasswords(session)) {
      sendJson(res, 403, { error: 'Only the primary admin account can approve a staged season.' });
      return;
    }
    const payload = await readBody(req);
    const season = seasonPlanner.findSeason(payload.seasonId);
    if (!season) {
      sendJson(res, 404, { error: 'Season workspace not found.' });
      return;
    }
    const coachCount = Array.isArray(season.coaches) ? season.coaches.length : 0;
    const uploadedCount = Array.isArray(season.coaches)
      ? season.coaches.filter((coach) => String(coach.uploadStatus || '').startsWith('uploaded')).length
      : 0;
    if (!coachCount || uploadedCount !== coachCount) {
      sendJson(res, 400, { error: 'Every coach must upload their season schedule before one-time approval.' });
      return;
    }
    const data = await loadData();
    const conflicts = seasonPlanner.buildConflicts(season, data);
    if (conflicts.length) {
      sendJson(res, 400, { error: 'Clear the season conflicts before approving this season.', conflicts });
      return;
    }
    const approved = seasonPlanner.approveSeason(payload.seasonId, session.username || 'admin');
    sendJson(res, 200, {
      ok: true,
      season: seasonPlanner.publicSeason(approved, data)
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/coach-accounts') {
    const session = readCoachSession(req);
    const canRevealPasswords = canRevealAdminPasswords(session);
    const canEditCoachEmails = canEditCoachEmailsSession(session);
    const data = await loadData();
    const accounts = currentCoachAccounts(data).map((account) => ({
      ...account,
      password: canRevealPasswords ? account.password : '********'
    }));
    sendJson(res, 200, {
      accounts,
      canRevealPasswords,
      canEditCoachEmails,
      generatedAt: await dataVersion()
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/logins') {
    const session = readCoachSession(req);
    const canRevealPasswords = canRevealAdminPasswords(session);
    const reveal = (value) => canRevealPasswords ? value : '********';
    const configuredLogins = configurableAdminUsers().map((user) => ({
      label: user.accessLabel ? 'Site Admin' : 'Additional Admin',
      username: user.username,
      password: reveal(user.password),
      email: user.email || '',
      access: user.accessLabel || 'Can approve and reject coach schedule requests for this site.'
    }));
    sendJson(res, 200, {
      canRevealPasswords,
      logins: [
        {
          label: 'Full Admin',
          username: adminUsername,
          password: reveal(adminPassword),
          access: 'Can approve requests, refresh Turtle Club data, edit coach logins, and send updates.'
        },
        {
          label: 'Read-Only Admin',
          username: readOnlyAdminUsername,
          password: reveal(readOnlyAdminPassword),
          access: 'Can view all admin and field status pages, but cannot apply changes.'
        },
        {
          label: 'Field Status Editor',
          username: statusEditorUsername,
          password: reveal(statusEditorPassword),
          access: 'Can view all teams and update Turtle Club field statuses, but cannot approve schedule changes.'
        },
        ...configuredLogins
      ]
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/coach-accounts/update-passwords') {
    const session = readCoachSession(req);
    const canRevealPasswords = canRevealAdminPasswords(session);
    const canEditCoachEmails = canEditCoachEmailsSession(session);
    if (!canRevealPasswords && !canEditCoachEmails) {
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
        password: canRevealPasswords ? (nextValues.password || account.password) : account.password,
        email: canEditCoachEmails ? nextValues.email : account.email
      };
    });
    writeCoachAccountStore({ accounts: nextAccounts });
    sendJson(res, 200, {
      ok: true,
      accounts: nextAccounts.map((account) => ({
        ...account,
        password: canRevealPasswords ? account.password : '********'
      })),
      canRevealPasswords,
      canEditCoachEmails
    });
    return;
  }

  const approvalMatch = pathname.match(/^\/api\/admin\/requests\/([^/]+)\/(approve|manual-approve|reject)$/);
  if (req.method === 'POST' && approvalMatch) {
    const session = readCoachSession(req);
    if (!canMutateAdminPortalSession(session)) {
      sendJson(res, 403, { error: 'This account can review coach requests but cannot approve or reject them.' });
      return;
    }
    const [, requestId, action] = approvalMatch;
    const isApproveAction = action === 'approve' || action === 'manual-approve';
    const isManualApprove = action === 'manual-approve';
    if (isManualApprove && !canManualApproveSession(session)) {
      sendJson(res, 403, { error: 'This account cannot manually approve requests.' });
      return;
    }
    const payload = await readBody(req);
    const existing = (await listRequestsStore()).find((item) => item.id === requestId);
    if (!existing) {
      sendJson(res, 404, { error: 'Request not found' });
      return;
    }
    const allocationStatus = existing.allocationApproval && existing.allocationApproval.status;
    if (isApproveAction && allocationStatus === 'pending') {
      sendJson(res, 409, {
        error: 'Additional diamond approval required',
        details: 'This request is outside the coach allotment and must be accepted from the allocation approval email before admin approval can apply it to Turtle Club.'
      });
      return;
    }
    if (isApproveAction && allocationStatus === 'rejected') {
      sendJson(res, 409, {
        error: 'Additional diamond approval rejected',
        details: 'This request was rejected by the allocation approver and cannot be approved.'
      });
      return;
    }
    const request = await updateRequestStore(requestId, (item) => {
      item.status = isApproveAction ? 'approved' : 'rejected';
      item.adminNote = payload.adminNote || '';
      item.reviewedAt = new Date().toISOString();
      item.reviewedBy = isManualApprove ? 'Admin (manual approve)' : 'Admin';
      if (isManualApprove) {
        item.manualApproved = true;
        item.manualApprovedAt = item.reviewedAt;
      }
      if (action === 'approve') {
        item.turtleClubSyncStatus = isTournamentCancellationRequest(item) ? 'not-required' : 'pending';
        item.turtleClubSyncDetails = isTournamentCancellationRequest(item)
          ? 'Tournament cancellation is recorded in the scheduler only.'
          : 'Approved locally. Turtle Club sync is queued in the background.';
        item.turtleClubSyncError = '';
        item.turtleClubSyncQueuedAt = item.reviewedAt;
        item.turtleClubSyncedAt = '';
      }
    });
    if (!request) {
      sendJson(res, 404, { error: 'Request not found' });
      return;
    }
    let emailSent = false;
    let emailError = '';
    const backgroundSync = action === 'approve';
    if (backgroundSync) {
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
      queueApprovedRequestSync(request.id);
    } else if (smtpConfigured()) {
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
      backgroundSync,
      appliedToTurtleClub: false,
      verified: !backgroundSync,
      verificationDetails: backgroundSync
        ? request.turtleClubSyncDetails || 'Approved locally. Turtle Club sync is running in the background.'
        : isManualApprove
        ? 'Manual approval only: Turtle Club was not updated by the scheduler.'
        : 'No verification was required.'
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
    if (!canRevealAdminPasswords(session)) {
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
  canUseAdminSwitchTokenRequest,
  canAccessCoachProfileRequest,
  canAccessTournamentScoresRequest
};
