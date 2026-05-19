const fs = require('fs');
const os = require('os');
const path = require('path');
const { URL, URLSearchParams } = require('url');
const { statusTargetById } = require('./diamond-status-config');

const baseUrl = 'https://turtleclubbaseball.com';
const loginPath = '/Account/Login/?ReturnUrl=%2fCP%2f';
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'site', 'config.json'), 'utf8'));
const debugDir = path.join(__dirname, '..', 'storage', 'tc-debug');
fs.mkdirSync(debugDir, { recursive: true });

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' '));
}

function saveDebugHtml(name, html) {
  try {
    fs.writeFileSync(path.join(debugDir, name), String(html || ''), 'utf8');
  } catch (_) {
    // Ignore debug write failures.
  }
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^vs\.\s*/i, '')
    .replace(/[^\w]+/g, ' ')
    .trim();
}

function formatRadDate(dateIso, timeDisplay) {
  const [year, month, day] = String(dateIso || '').split('-').map(Number);
  const time = parseDisplayTime(timeDisplay);
  const date = new Date(year, (month || 1) - 1, day || 1, time.hours24, time.minutes, 0, 0);
  return {
    compact: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}-00`,
    full: date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).replace(',', '').replace(/(\d{4})\s/, '$1  '),
    timeOnly: date.toLocaleString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })
  };
}

function parseDisplayTime(value) {
  const match = String(value || '').match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) {
    return { hours24: 0, minutes: 0 };
  }
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (meridiem === 'PM' && hours !== 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  return { hours24: hours, minutes };
}

function durationMinutes(startDisplay, endDisplay) {
  const start = parseDisplayTime(startDisplay);
  const end = parseDisplayTime(endDisplay);
  const startMinutes = start.hours24 * 60 + start.minutes;
  const endMinutes = end.hours24 * 60 + end.minutes;
  return Math.max(30, endMinutes - startMinutes);
}

function todayIsoLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function cancellationReason(request) {
  const trimmed = String(request && request.reason || '').trim();
  return trimmed || 'Cancelled via Titans coach scheduler';
}

function assertNotPastCreate(request) {
  const requestedDate = String(request.date || '');
  if (!requestedDate) return;
  if (requestedDate < todayIsoLocal()) {
    throw new Error('Turtle Club does not allow creating back-dated events through the Control Panel.');
  }
}

function minutesFromDisplay(value) {
  const parsed = parseDisplayTime(value);
  return parsed.hours24 * 60 + parsed.minutes;
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  setFromResponse(response) {
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
    for (const cookie of setCookies) {
      const pair = String(cookie || '').split(';')[0];
      const index = pair.indexOf('=');
      if (index <= 0) continue;
      const key = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      this.cookies.set(key, value);
    }
  }

  header() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  }
}

async function fetchWithJar(jar, pathname, options = {}) {
  const target = pathname.startsWith('http') ? pathname : `${baseUrl}${pathname}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    ...(options.headers || {})
  };
  const cookieHeader = jar.header();
  if (cookieHeader) headers.Cookie = cookieHeader;
  const response = await fetch(target, {
    redirect: 'follow',
    ...options,
    headers
  });
  jar.setFromResponse(response);
  return response;
}

function cpScheduleUrl() {
  return `${baseUrl}/CP/Content/Scheduling/Schedule.aspx?ParentID=${config.teamCategoryId}`;
}

function scheduleShellUrl() {
  return `${baseUrl}/CP/#Module=Scheduling;SelectedValue=Content/Scheduling/Dashboard.aspx`;
}

function webmasterShellUrl() {
  return `${baseUrl}/CP/#Module=Webmaster;SelectedValue=Content/Webmaster/Suggestions.aspx`;
}

async function fetchCpScheduleHtml(jar, viewDate) {
  jar.cookies.set('Scheduling_ViewDate', `${viewDate.getDate()}/${viewDate.getMonth() + 1}/${viewDate.getFullYear()}`);
  const response = await fetchWithJar(jar, cpScheduleUrl());
  const html = await response.text();
  if (!response.ok || /Login Page|Forgot Password|Human Verification/i.test(html)) {
    throw new Error('Authenticated Turtle Club schedule request did not return the scheduling page.');
  }
  return html;
}

function hiddenValue(html, name) {
  const match = html.match(new RegExp(`name="${name.replace(/[$]/g, '\\$&')}"[^>]*value="([^"]*)"`, 'i'));
  return match ? match[1] : '';
}

async function login() {
  const username = process.env.TURTLE_CLUB_USERNAME || '';
  const password = process.env.TURTLE_CLUB_PASSWORD || '';
  if (!username || !password) {
    throw new Error('Turtle Club credentials are not configured on the server.');
  }

  const jar = new CookieJar();
  const loginPage = await fetchWithJar(jar, loginPath);
  const loginHtml = await loginPage.text();
  const form = new URLSearchParams({
    __VIEWSTATE: hiddenValue(loginHtml, '__VIEWSTATE'),
    __VIEWSTATEGENERATOR: hiddenValue(loginHtml, '__VIEWSTATEGENERATOR'),
    __EVENTVALIDATION: hiddenValue(loginHtml, '__EVENTVALIDATION'),
    'ctl00$cMain$ctl39$lMain$UserName': username,
    'ctl00$cMain$ctl39$lMain$Password': password,
    'ctl00$cMain$ctl39$lMain$LoginButton': 'Log In'
  });
  const response = await fetchWithJar(jar, loginPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    redirect: 'manual'
  });

  const location = response.headers.get('location');
  if (location) {
    await fetchWithJar(jar, new URL(location, baseUrl).toString());
  }

  const controlPanel = await fetchWithJar(jar, `${baseUrl}/cp/`);
  const html = await controlPanel.text();
  if (/Login Page|Forgot Password/i.test(html)) {
    throw new Error('Turtle Club login failed.');
  }
  return jar;
}

function loadPlaywright() {
  const candidates = [
    'playwright',
    'playwright-core',
    path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright')
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) {
      // Try the next candidate.
    }
  }
  throw new Error('Playwright is required to create Turtle Club practices and games. Install `playwright-core` on the host server.');
}

async function launchAutomationBrowser() {
  const { chromium } = loadPlaywright();
  const attempts = [
    { headless: true, channel: 'msedge' },
    { headless: true, channel: 'chrome' },
    { headless: true }
  ];
  let lastError = null;
  for (const options of attempts) {
    try {
      return await chromium.launch(options);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Could not launch a browser for Turtle Club automation.');
}

async function loginControlPanelShell(page, shellUrl) {
  const username = process.env.TURTLE_CLUB_USERNAME || '';
  const password = process.env.TURTLE_CLUB_PASSWORD || '';
  if (!username || !password) {
    throw new Error('Turtle Club credentials are not configured on the server.');
  }

  await page.goto(`${baseUrl}${loginPath}`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="ctl00$cMain$ctl39$lMain$UserName"]').fill(username);
  await page.locator('input[name="ctl00$cMain$ctl39$lMain$Password"]').fill(password);
  await page.locator('input[name="ctl00$cMain$ctl39$lMain$LoginButton"]').click();
  await page.waitForLoadState('networkidle');
  await page.goto(shellUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
}

async function loginSchedulingShell(page) {
  return loginControlPanelShell(page, scheduleShellUrl());
}

async function openSchedulingMainFrame(page) {
  let frame = page.frames().find((candidate) => candidate.name() === 'rpMain');
  if (!frame) {
    throw new Error('Could not find the Turtle Club scheduling frame.');
  }
  await frame.goto(cpScheduleUrl(), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  frame = page.frames().find((candidate) => candidate.name() === 'rpMain');
  if (!frame) {
    throw new Error('Could not reload the Turtle Club scheduling frame.');
  }
  return frame;
}

async function openShellModal(page, mainFrame, opener) {
  await opener(mainFrame);
  await page.waitForTimeout(2500);
  const frame = page.frames().find((candidate) => candidate.name() === 'rwForm');
  if (!frame) {
    throw new Error('Turtle Club did not open the scheduling modal.');
  }
  await frame.waitForSelector('#cC_lbInsertAndClose', { timeout: 15000 });
  return frame;
}

async function tryOpenModalFromDayAtGlance(page, mainFrame, request, kind) {
  const [year, month, day] = String(request.date || '').split('-').map(Number);
  await mainFrame.evaluate(({ year, month, day }) => {
    if (typeof set_calView === 'function') {
      set_calView(day, month, year, true);
    }
  }, { year, month, day });
  await page.waitForTimeout(2500);

  const addNewCandidates = [
    'text=Add New',
    'a:has-text("Add New")',
    'button:has-text("Add New")',
    'input[value="Add New"]'
  ];

  let clicked = false;
  for (const selector of addNewCandidates) {
    const locator = mainFrame.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    await locator.click({ force: true }).catch(() => {});
    clicked = true;
    break;
  }

  if (!clicked) {
    throw new Error('Day At A Glance Add New control was not found.');
  }

  await page.waitForTimeout(1500);

  if (kind === 'practice') {
    const practiceCandidates = [
      'text=Practice',
      'a:has-text("Practice")',
      'button:has-text("Practice")'
    ];
    for (const selector of practiceCandidates) {
      const locator = mainFrame.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (!count) continue;
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;
      await locator.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1500);
      break;
    }
  }

  const frame = page.frames().find((candidate) => candidate.name() === 'rwForm');
  if (!frame) {
    throw new Error('Turtle Club did not open the scheduling modal from Day At A Glance.');
  }
  await frame.waitForSelector('#cC_lbInsertAndClose', { timeout: 15000 });
  return frame;
}

async function jumpToDayAtGlance(page, mainFrame, dateIso) {
  const [year, month, day] = String(dateIso || '').split('-').map(Number);
  await mainFrame.evaluate(({ year, month, day }) => {
    if (typeof set_calView === 'function') {
      set_calView(day, month, year, true);
    }
  }, { year, month, day });
  await page.waitForTimeout(2500);
}

async function clickMatchingDayEvent(page, mainFrame, request) {
  const remoteId = request.originalId ? extractRemoteEventId(request.originalId) : '';
  const selectors = remoteId
    ? [
        `[onclick*="multischedule_edit(${remoteId}"]`,
        `[onclick*="${remoteId}"]`,
        `[id*="${remoteId}"]`
      ]
    : [];

  for (const selector of selectors) {
    const locator = mainFrame.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    await locator.click({ force: true }).catch(() => {});
    return true;
  }

  const eventCards = mainFrame.locator('div.pnl');
  const count = await eventCards.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const card = eventCards.nth(index);
    const text = await card.innerText().catch(() => '');
    if (!text) continue;
    const normalizedText = normalize(text);
    const matchesTeam = normalizedText.includes(normalize(request.team));
    const matchesDiamond = normalizedText.includes(normalize(request.originalDiamond));
    const matchesTime = normalizedText.includes(normalize(request.originalStart));
    const matchesOpponent = !request.originalOpponent
      || /practice/i.test(String(request.originalOpponent))
      || normalizedText.includes(normalize(request.originalOpponent));
    if (matchesTeam && matchesDiamond && matchesTime && matchesOpponent) {
      await card.click({ force: true }).catch(() => {});
      return true;
    }
  }

  return false;
}

async function clickFirstVisible(locatorList) {
  for (const locator of locatorList) {
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    const visible = await locator.first().isVisible().catch(() => false);
    if (!visible) continue;
    await locator.first().click({ force: true }).catch(() => {});
    return true;
  }
  return false;
}

function editorDateText(timestamp) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp || Date.now());
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function editorTimeText(timestamp) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp || Date.now());
  return date.toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).toLowerCase();
}

function editorIsoDate(timestamp) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp || Date.now());
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function editorIsoTime(timestamp) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp || Date.now());
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

async function frameContainsStatusEditor(frame) {
  const text = await frame.locator('body').innerText().catch(() => '');
  const normalized = normalize(text);
  return normalized.includes('turtle club diamonds')
    && normalized.includes('villanova diamonds')
    && normalized.includes('status')
    && (normalized.includes('updated by') || normalized.includes('edit content') || normalized.includes('comments'));
}

async function frameContainsStatusPagePreview(frame) {
  const text = await frame.locator('body').innerText().catch(() => '');
  const normalized = normalize(text);
  return normalized.includes('diamond status')
    && normalized.includes('turtle club diamonds')
    && normalized.includes('villanova diamonds');
}

function statusPreviewFrameCandidates() {
  return [
    '/CP/Live/Pages/1487/STATUS/',
    '/CP/Live/Pages/1487/Status/',
    '/Pages/1487/STATUS/',
    '/Pages/1487/Status/'
  ];
}

async function probeStatusPageCandidates(page, mainFrame) {
  const candidates = [
    ...statusPreviewFrameCandidates(),
    '/CP/Modals/Webmaster/Content_Main/Content.aspx?ID=1487',
    '/CP/Modals/Webmaster/Content_Main/Content.aspx?id=1487',
    '/CP/Content/Webmaster/PageContent.aspx?ID=1487',
    '/CP/Content/Webmaster/PageContent.aspx?id=1487',
    '/CP/Content/Webmaster/PageContent.aspx?pageid=1487',
    '/CP/Content/Webmaster/Page_Content.aspx?ID=1487',
    '/CP/Content/Webmaster/Page_Content.aspx?id=1487',
    '/CP/Content/Webmaster/Page.aspx?ID=1487',
    '/CP/Content/Webmaster/Page.aspx?id=1487',
    '/CP/Content/Webmaster/PageEdit.aspx?ID=1487',
    '/CP/Content/Webmaster/PageEdit.aspx?id=1487',
    '/CP/Content/Webmaster/Pages.aspx?ID=1487',
    '/CP/Content/Webmaster/Pages.aspx?id=1487'
  ];

  for (const candidate of candidates) {
    try {
      await mainFrame.goto(`${baseUrl}${candidate}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1800);
      const refreshedFrame = page.frames().find((frame) => frame.name() === 'rpMain') || mainFrame;
      if (await frameContainsStatusEditor(refreshedFrame) || await frameContainsStatusPagePreview(refreshedFrame)) {
        return refreshedFrame;
      }
    } catch (_) {
      // Keep probing the next likely page-content route.
    }
  }

  return null;
}

async function clickVisibleTextInFrames(page, labels) {
  const selectors = labels.flatMap((label) => [
    `text=${label}`,
    `a:has-text("${label}")`,
    `button:has-text("${label}")`,
    `input[value="${label}"]`
  ]);

  for (const frame of page.frames()) {
    for (const selector of selectors) {
      const locator = frame.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (!count) continue;
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;
      await locator.click({ force: true }).catch(() => {});
      return true;
    }
  }
  return false;
}

function resolveEditorHref(value) {
  const href = String(value || '').trim();
  if (!href) return '';
  if (href.startsWith('http')) return href;
  if (href.startsWith('/')) return `${baseUrl}${href}`;
  if (href.startsWith('Content/') || href.startsWith('CP/')) return `${baseUrl}/CP/${href.replace(/^CP\//, '')}`;
  return '';
}

async function openStatusEditorFrame(page) {
  await loginControlPanelShell(page, webmasterShellUrl());
  await page.waitForTimeout(2500);

  let mainFrame = page.frames().find((candidate) => candidate.name() === 'rpMain');
  if (!mainFrame) {
    throw new Error('Could not find the Turtle Club webmaster frame.');
  }

  for (const candidate of statusPreviewFrameCandidates()) {
    try {
      await mainFrame.goto(`${baseUrl}${candidate}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1800);
      const refreshedFrame = page.frames().find((frame) => frame.name() === 'rpMain') || mainFrame;
      if (await frameContainsStatusEditor(refreshedFrame) || await frameContainsStatusPagePreview(refreshedFrame)) {
        return refreshedFrame;
      }
    } catch (_) {
      // Keep probing likely preview routes inside the content frame.
    }
  }

  if (await frameContainsStatusEditor(mainFrame) || await frameContainsStatusPagePreview(mainFrame)) {
    return mainFrame;
  }

  const navigationAttempts = [
    [['Manage Page Content'], ['Status']],
    [['Page Content'], ['Status']],
    [['Status']]
  ];

  for (const steps of navigationAttempts) {
    for (const labels of steps) {
      const clicked = await clickVisibleTextInFrames(page, labels);
      if (!clicked) continue;
      await page.waitForTimeout(2500);
    }
    mainFrame = page.frames().find((candidate) => candidate.name() === 'rpMain') || mainFrame;
    if (await frameContainsStatusEditor(mainFrame) || await frameContainsStatusPagePreview(mainFrame)) {
      return mainFrame;
    }
  }

  const probedFrame = await probeStatusPageCandidates(page, mainFrame);
  if (probedFrame) {
    return probedFrame;
  }

  saveDebugHtml('status-editor-frame.html', await mainFrame.content().catch(() => ''));
  throw new Error('The Turtle Club status editor page could not be opened.');
}

function publicStatusDateText(timestamp) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp || Date.now());
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric'
  });
}

function publicStatusTimeText(timestamp) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp || Date.now());
  return date.toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).replace(/\s+/g, '').toLowerCase();
}

function escapeHtmlText(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

function replaceCellInnerHtml(cellHtml, innerHtml) {
  const openTagMatch = String(cellHtml || '').match(/^<td\b[^>]*>/i);
  if (!openTagMatch) return String(cellHtml || '');
  return `${openTagMatch[0]}${innerHtml}</td>`;
}

function cellFontSize(cellHtml) {
  const match = String(cellHtml || '').match(/font-size:\s*(\d+)px/i);
  return match ? Number(match[1]) : 22;
}

function rewriteStatusRowHtml(rowHtml, update) {
  const cells = String(rowHtml || '').match(/<td\b[\s\S]*?<\/td>/gi) || [];
  if (cells.length < 6) {
    throw new Error('The Turtle Club status table row did not contain enough cells to update.');
  }

  const fontSize = Math.max(...cells.map(cellFontSize), 16);
  const isOpen = /^open/i.test(update.status || '');
  const statusColor = isOpen ? 'rgb(0, 176, 80)' : 'rgb(255, 0, 0)';
  const statusText = isOpen ? 'OPEN' : 'CLOSED';
  const dateText = escapeHtmlText(publicStatusDateText(update.requestedAt));
  const timeText = escapeHtmlText(publicStatusTimeText(update.requestedAt));
  const updatedBy = escapeHtmlText(update.initials || update.updatedBy || '');
  const comments = String(update.notes || '').trim()
    ? `<span style="font-size: ${fontSize}px;">${escapeHtmlText(String(update.notes || '').trim())}</span>`
    : '&nbsp;';

  cells[1] = replaceCellInnerHtml(
    cells[1],
    `<span style="font-size: ${fontSize}px; color: ${statusColor};"><strong>${statusText}</strong></span>`
  );
  cells[2] = replaceCellInnerHtml(cells[2], `<span style="font-size: ${fontSize}px;">${dateText}</span>`);
  cells[3] = replaceCellInnerHtml(cells[3], `<span style="font-size: ${fontSize}px;">${timeText}</span>`);
  cells[4] = replaceCellInnerHtml(cells[4], `<span style="font-size: ${fontSize}px;">${updatedBy}</span>`);
  cells[5] = replaceCellInnerHtml(cells[5], comments);

  return `<tr>${cells.join('')}</tr>`;
}

function updateStatusTableHtml(html, update) {
  const target = statusTargetById(update.targetId);
  if (!target) {
    throw new Error('Unknown diamond status target.');
  }

  const tableMatch = String(html || '').match(/<table\b[\s\S]*?<\/table>/i);
  if (!tableMatch) {
    throw new Error('The Turtle Club status page HTML did not include the diamond status table.');
  }

  const tableHtml = tableMatch[0];
  const rows = tableHtml.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  let currentGroup = '';
  let replaced = false;

  const nextRows = rows.map((rowHtml) => {
    const normalizedText = normalize(stripTags(rowHtml));
    if (normalizedText.includes(normalize(target.group))) {
      currentGroup = target.group;
      return rowHtml;
    }
    if (currentGroup !== target.group) {
      return rowHtml;
    }

    const cellMatches = [...String(rowHtml).matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cellMatches.length < 6) {
      return rowHtml;
    }

    const diamondText = normalize(stripTags(cellMatches[0][1]));
    if (diamondText !== normalize(target.diamond)) {
      return rowHtml;
    }

    replaced = true;
    return rewriteStatusRowHtml(rowHtml, update);
  });

  if (!replaced) {
    throw new Error(`Could not find the ${target.label} row inside the Turtle Club status table.`);
  }

  return String(html).replace(tableHtml, nextRows.join('\n'));
}

function directStatusEditorCandidates() {
  return [
    '/CP/Modals/Webmaster/Content_Main/Content.aspx?ID=1487',
    '/CP/Modals/Webmaster/Content_Main/Content.aspx?id=1487',
    '/CP/Modals/Webmaster/Page.aspx?ID=1487',
    '/CP/Modals/Webmaster/Page.aspx?id=1487',
    '/CP/Live/Pages/1487/STATUS/',
    '/CP/Live/Pages/1487/Status/',
    '/CP/Content/Webmaster/PageContent.aspx?ID=1487',
    '/CP/Content/Webmaster/PageContent.aspx?id=1487',
    '/CP/Content/Webmaster/PageContent.aspx?pageid=1487',
    '/CP/Content/Webmaster/Page_Content.aspx?ID=1487',
    '/CP/Content/Webmaster/Page_Content.aspx?id=1487',
    '/CP/Content/Webmaster/Page.aspx?ID=1487',
    '/CP/Content/Webmaster/Page.aspx?id=1487',
    '/CP/Content/Webmaster/PageEdit.aspx?ID=1487',
    '/CP/Content/Webmaster/PageEdit.aspx?id=1487',
    '/CP/Content/Webmaster/Pages.aspx?ID=1487',
    '/CP/Content/Webmaster/Pages.aspx?id=1487'
  ];
}

async function tryClickEditContent(page, previewFrame) {
  const clicked = await clickFirstVisible([
    previewFrame.locator('button:has-text("Edit Content")'),
    previewFrame.locator('a:has-text("Edit Content")'),
    previewFrame.locator('input[value*="Edit Content"]'),
    previewFrame.locator('button:has-text("Edit")'),
    previewFrame.locator('a:has-text("Edit")')
  ]) || await clickVisibleTextInFrames(page, ['Edit Content', 'Edit']);

  if (!clicked) return false;

  await page.waitForTimeout(2500);
  return true;
}

async function markStatusHtmlEditor(frame) {
  return frame.evaluate(() => {
    document.querySelectorAll('[data-codex-status-html-editor]').forEach((node) => node.removeAttribute('data-codex-status-html-editor'));
    const matchesStatusHtml = (value) => /turtle club diamonds|villanova diamonds|vollmer and river canard diamonds|<table/i.test(String(value || ''));

    const textareas = [...document.querySelectorAll('textarea')];
    textareas.sort((left, right) => String(right.value || '').length - String(left.value || '').length);
    for (const textarea of textareas) {
      if (matchesStatusHtml(textarea.value)) {
        textarea.setAttribute('data-codex-status-html-editor', 'textarea');
        return 'textarea';
      }
    }

    const editables = [...document.querySelectorAll('[contenteditable="true"], body[contenteditable="true"]')];
    for (const editable of editables) {
      const html = editable === document.body ? document.body.innerHTML : editable.innerHTML;
      if (matchesStatusHtml(html)) {
        editable.setAttribute('data-codex-status-html-editor', 'rich');
        return 'rich';
      }
    }

    if (document.designMode === 'on' && matchesStatusHtml(document.body && document.body.innerHTML)) {
      document.body.setAttribute('data-codex-status-html-editor', 'design');
      return 'design';
    }

    return '';
  }).catch(() => '');
}

async function findStatusHtmlEditor(page) {
  for (const frame of page.frames()) {
    const editorType = await markStatusHtmlEditor(frame);
    if (editorType) {
      return { frame, editorType };
    }
  }
  return null;
}

async function waitForNamedFrame(page, frameName, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = page.frames().find((candidate) => candidate.name() === frameName);
    if (frame) return frame;
    await page.waitForTimeout(250);
  }
  return null;
}

async function waitForStatusHtmlEditor(page, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const editor = await findStatusHtmlEditor(page);
    if (editor) return editor;
    await page.waitForTimeout(300);
  }
  return null;
}

async function tryOpenStatusEditorDirectly(page, previewFrame) {
  for (const candidate of directStatusEditorCandidates()) {
    try {
      const targetUrl = `${baseUrl}${candidate}`;
      if (previewFrame && typeof previewFrame.goto === 'function') {
        await previewFrame.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      } else {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      }
      await page.waitForTimeout(1800);
      const editor = await findStatusHtmlEditor(page);
      if (editor) return editor;
    } catch (_) {
      // Keep trying the next likely page-content route.
    }
  }
  return null;
}

async function findEditorRouteInFrame(frame) {
  return frame.evaluate(() => {
    const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const anchors = [...document.querySelectorAll('a[href], a[onclick], button[onclick], input[onclick]')];
    const interesting = anchors.find((node) => {
      const text = normalizeText(node.textContent || node.getAttribute('value') || node.getAttribute('title') || '');
      const href = String(node.getAttribute('href') || '');
      const onclick = String(node.getAttribute('onclick') || '');
      return text.includes('edit content')
        || text.includes('edit page')
        || text.includes('page content')
        || /pagecontent\.aspx|pageedit\.aspx|dataType=Page|navigate\('/i.test(`${href} ${onclick}`);
    });
    if (!interesting) return '';

    const href = interesting.getAttribute('href') || '';
    if (href && href !== '#') return href;

    const onclick = interesting.getAttribute('onclick') || '';
    const navigateMatch = onclick.match(/navigate\('([^']+)'/i);
    if (navigateMatch) return navigateMatch[1];

    return '';
  }).catch(() => '');
}

async function tryOpenStatusEditorFromPageModal(page, existingModalFrame = null) {
  const modalFrame = existingModalFrame || await waitForNamedFrame(page, 'rwForm', 1000);
  if (!modalFrame) return null;

  let editor = await waitForStatusHtmlEditor(page, 2500);
  if (editor) return editor;

  const clicked = await clickFirstVisible([
    modalFrame.locator('button:has-text("Edit Content")'),
    modalFrame.locator('a:has-text("Edit Content")'),
    modalFrame.locator('input[value*="Edit Content"]'),
    modalFrame.locator('button:has-text("Page Content")'),
    modalFrame.locator('a:has-text("Page Content")'),
    modalFrame.locator('button:has-text("Content")'),
    modalFrame.locator('a:has-text("Content")'),
    modalFrame.locator('text=Edit Content'),
    modalFrame.locator('text=Page Content')
  ]);

  if (clicked) {
    await page.waitForTimeout(1500);
    editor = await waitForStatusHtmlEditor(page, 7000);
    if (editor) return editor;
  }

  const route = await findEditorRouteInFrame(modalFrame);
  const targetUrl = resolveEditorHref(route);
  if (targetUrl) {
    try {
      await modalFrame.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      editor = await waitForStatusHtmlEditor(page, 7000);
      if (editor) return editor;
    } catch (_) {
      // Fall through to explicit route candidates.
    }
  }

  for (const candidate of directStatusEditorCandidates()) {
    try {
      await modalFrame.goto(`${baseUrl}${candidate}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      editor = await waitForStatusHtmlEditor(page, 5000);
      if (editor) return editor;
    } catch (_) {
      // Keep probing the next likely modal/editor route.
    }
  }

  saveDebugHtml('status-editor-rwform.html', await modalFrame.content().catch(() => ''));
  return null;
}

async function tryOpenStatusEditorFromManagePage(page) {
  const seen = new Set();
  const targets = [page.mainFrame(), ...page.frames()].filter((frame) => {
    if (!frame) return false;
    if (seen.has(frame)) return false;
    seen.add(frame);
    return true;
  });

  for (const frame of targets) {
    let triggered = false;
    try {
      const directRow = frame.locator('tr[ondblclick*="multidata_edit(1487"]').first();
      const directRowCount = await directRow.count().catch(() => 0);
      if (directRowCount) {
        await directRow.dblclick({ force: true, timeout: 2000 }).catch(() => {});
        triggered = true;
      }

      if (!triggered) {
        const statusRow = frame.locator('tr').filter({ hasText: 'STATUS' }).filter({ hasText: '/Pages/1487/STATUS/' }).first();
        const statusRowCount = await statusRow.count().catch(() => 0);
        if (statusRowCount) {
          await statusRow.dblclick({ force: true, timeout: 2000 }).catch(() => {});
          triggered = true;
        }
      }

      if (!triggered) {
        triggered = await frame.evaluate(() => {
        const targetRow = document.querySelector('tr[ondblclick*="multidata_edit(1487,\\\'Page\\\')"], tr[ondblclick*="multidata_edit(1487,&quot;Page&quot;)"], tr[ondblclick*="multidata_edit(1487,\'Page\')"]');
        if (targetRow) {
          if (typeof window.multidata_edit === 'function') {
            window.multidata_edit(1487, 'Page');
            return true;
          }
          targetRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
          return true;
        }

        const pageCells = [...document.querySelectorAll('tr')].find((row) => {
          const text = String(row.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
          return text.includes('status') && text.includes('/pages/1487/status/');
        });
        if (!pageCells) return false;

        if (typeof window.multidata_edit === 'function') {
          window.multidata_edit(1487, 'Page');
          return true;
        }
        pageCells.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
        return true;
        }).catch(() => false);
      }

      if (!triggered) continue;

      await page.waitForTimeout(1000);
      const modalFrame = await waitForNamedFrame(page, 'rwForm', 7000);
      const editor = modalFrame
        ? await tryOpenStatusEditorFromPageModal(page, modalFrame)
        : await waitForStatusHtmlEditor(page, 9000);
      if (editor) return editor;

      if (modalFrame) {
        saveDebugHtml('status-editor-rwform.html', await modalFrame.content().catch(() => ''));
      }
      saveDebugHtml('status-editor-manage-page.html', await frame.content().catch(() => ''));
    } catch (_) {
      // Keep trying other frames.
    }
  }
  return null;
}

async function tryOpenStatusEditorFromShell(page) {
  const targets = [page.mainFrame(), ...page.frames()];
  for (const frame of targets) {
    const route = await findEditorRouteInFrame(frame);
    const targetUrl = resolveEditorHref(route);
    if (!targetUrl) continue;
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1800);
      const editor = await findStatusHtmlEditor(page);
      if (editor) return editor;
    } catch (_) {
      // Keep probing other possible editor routes.
    }
  }
  return null;
}

async function readStatusHtmlEditorHtml(editor) {
  const telerikHtml = await editor.frame.evaluate(() => {
    if (typeof window.$find !== 'function') return '';
    const candidateIds = ['ctl00_cM_reContent', 'cM_reContent'];
    for (const id of candidateIds) {
      const control = window.$find(id);
      if (control && typeof control.get_html === 'function') {
        return String(control.get_html() || '');
      }
    }
    return '';
  }).catch(() => '');
  if (telerikHtml) {
    return telerikHtml;
  }

  const locator = editor.frame.locator('[data-codex-status-html-editor]').first();
  if (editor.editorType === 'textarea') {
    return locator.inputValue();
  }
  return locator.evaluate((node) => node.innerHTML || '');
}

async function writeStatusHtmlEditorHtml(editor, html) {
  const wroteWithTelerik = await editor.frame.evaluate((value) => {
    if (typeof window.$find !== 'function') return false;
    const candidateIds = ['ctl00_cM_reContent', 'cM_reContent'];
    for (const id of candidateIds) {
      const control = window.$find(id);
      if (!control || typeof control.set_html !== 'function') continue;
      control.set_html(value);
      if (typeof control.set_contentHiddenTextareaValue === 'function') {
        control.set_contentHiddenTextareaValue(value);
      }
      if (typeof control.updateClientState === 'function') {
        control.updateClientState();
      }
      if (typeof control.saveContent === 'function') {
        control.saveContent();
      }
      return true;
    }
    return false;
  }, html).catch(() => false);
  if (wroteWithTelerik) {
    return;
  }

  const locator = editor.frame.locator('[data-codex-status-html-editor]').first();
  if (editor.editorType === 'textarea') {
    await locator.evaluate((node, value) => {
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
      node.dispatchEvent(new Event('blur', { bubbles: true }));
    }, html);
    return;
  }

  await locator.evaluate((node, value) => {
    node.innerHTML = value;
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
    node.dispatchEvent(new Event('blur', { bubbles: true }));
  }, html);

  if (editor.editorType === 'design') {
    await editor.frame.evaluate(() => {
      if (document.body) {
        document.body.dispatchEvent(new Event('input', { bubbles: true }));
        document.body.dispatchEvent(new Event('change', { bubbles: true }));
        document.body.dispatchEvent(new Event('blur', { bubbles: true }));
      }
    }).catch(() => {});
  }
}

async function applyStatusPageUpdate(page, previewFrame, update) {
  let editor = await findStatusHtmlEditor(page);
  if (!editor) {
    const clicked = await tryClickEditContent(page, previewFrame);
    if (clicked) {
      editor = await findStatusHtmlEditor(page);
    }
  }
  if (!editor) {
    editor = await tryOpenStatusEditorDirectly(page, previewFrame);
  }
  if (!editor) {
    editor = await tryOpenStatusEditorFromManagePage(page);
  }
  if (!editor) {
    editor = await tryOpenStatusEditorFromPageModal(page);
  }
  if (!editor) {
    editor = await tryOpenStatusEditorFromShell(page);
  }
  if (!editor) {
    saveDebugHtml('status-editor-page.html', await page.content().catch(() => ''));
    saveDebugHtml('status-editor-preview.html', await previewFrame.content().catch(() => ''));
    saveDebugHtml('status-editor-edit-surface.html', await previewFrame.content().catch(() => ''));
    throw new Error('The Turtle Club status page preview did not show an Edit Content action.');
  }

  const currentHtml = await readStatusHtmlEditorHtml(editor);
  const nextHtml = updateStatusTableHtml(currentHtml, update);
  await writeStatusHtmlEditorHtml(editor, nextHtml);
  return editor;
}

async function saveStatusEditorPage(page, editor, targetId) {
  const pageSaveClicked = await clickFirstVisible([
    editor.frame.locator('button:has-text("Save")'),
    editor.frame.locator('button:has-text("Update")'),
    editor.frame.locator('button:has-text("Publish")'),
    editor.frame.locator('a:has-text("Save")'),
    editor.frame.locator('a:has-text("Update")'),
    editor.frame.locator('input[value*="Save"]'),
    editor.frame.locator('input[value*="Update"]'),
    editor.frame.locator('input[value*="Publish"]')
  ]) || await clickVisibleTextInFrames(page, ['Save', 'Update', 'Publish']);

  if (!pageSaveClicked) {
    saveDebugHtml(`status-editor-save-${targetId}.html`, await editor.frame.content().catch(() => ''));
    throw new Error('The Turtle Club status editor did not show a save button.');
  }

  await page.waitForTimeout(3000);
}

async function confirmCancellationFromModal(page, request, replacementType = '') {
  const frame = page.frames().find((candidate) => candidate.name() === 'rwForm');
  if (!frame) {
    throw new Error('Turtle Club did not open the event modal from Day At A Glance.');
  }

  const cancelClicked = await clickFirstVisible([
    frame.locator('text=Cancel'),
    frame.locator('a:has-text("Cancel")'),
    frame.locator('button:has-text("Cancel")'),
    frame.locator('input[value*="Cancel"]'),
    frame.locator('#ctl00_cC_btnCancel'),
    frame.locator('#cC_btnCancel')
  ]);

  if (!cancelClicked) {
    saveDebugHtml('cancel-modal-no-cancel-button.html', await frame.content().catch(() => ''));
    throw new Error('The Turtle Club event modal did not show a cancel action.');
  }

  await page.waitForTimeout(2500);

  const deleteFrame = page.frames().find((candidate) => candidate.name() === 'rwForm') || frame;
  const replacementKind = replacementType;
  const cancellationMode = await deleteFrame.evaluate(({ replacementType }) => {
    const radioName = 'ctl00$cM$rblMulti';
    const radios = [...document.querySelectorAll(`input[name="${radioName}"]`)];
    const available = radios.map((radio) => String(radio.value || '').trim()).filter(Boolean);
    const preferred = replacementType ? ['Cancel', 'Single'] : ['Single', 'Cancel'];
    for (const option of preferred) {
      const match = available.find((value) => value.toLowerCase() === option.toLowerCase());
      if (match) return match;
    }
    return available[0] || (replacementType ? 'Cancel' : 'Single');
  }, {
    replacementType: replacementKind
  }).catch(() => (replacementKind ? 'Cancel' : 'Single'));

  await deleteFrame.evaluate(({ reason, cancellationMode, replacementKind }) => {
    const radioName = 'ctl00$cM$rblMulti';
    const radios = [...document.querySelectorAll(`input[name="${radioName}"]`)];
    radios.forEach((radio) => {
      radio.checked = radio.value === cancellationMode;
    });

    const reasonInput = document.querySelector('[name="ctl00$cM$txtReason"]');
    if (reasonInput) {
      reasonInput.value = String(reason || '');
    }

    const replaceWithPractice = document.querySelector('[name="ctl00$cM$chk_replace_with_practice"]');
    if (replaceWithPractice) {
      replaceWithPractice.checked = String(replacementKind || '') === 'Practice';
    }
  }, {
    reason: cancellationReason(request),
    cancellationMode,
    replacementKind
  }).catch(() => {});

  const deleted = await clickFirstVisible([
    deleteFrame.locator('#ctl00_cC_btnDelete'),
    deleteFrame.locator('#cC_btnDelete'),
    deleteFrame.locator('text=Delete'),
    deleteFrame.locator('text=Confirm'),
    deleteFrame.locator('button:has-text("Delete")'),
    deleteFrame.locator('input[value*="Delete"]')
  ]);

  if (!deleted) {
    saveDebugHtml('cancel-modal-no-delete-button.html', await deleteFrame.content().catch(() => ''));
    throw new Error('The Turtle Club cancellation confirmation did not show a delete button.');
  }

  await page.waitForTimeout(2500);
}

async function tryCancelFromDayAtGlance(request, replacementType = '') {
  const browser = await launchAutomationBrowser();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  try {
    await loginSchedulingShell(page);
    const mainFrame = await openSchedulingMainFrame(page);
    await jumpToDayAtGlance(page, mainFrame, request.originalDate);
    const clicked = await clickMatchingDayEvent(page, mainFrame, request);
    if (!clicked) {
      const html = await mainFrame.content().catch(() => '');
      saveDebugHtml('cancel-day-at-a-glance-not-found.html', html);
      throw new Error('The original event could not be found in Turtle Club Day At A Glance.');
    }
    await page.waitForTimeout(1500);
    await confirmCancellationFromModal(page, request, replacementType);
  } finally {
    await browser.close();
  }
}

async function setRadDateTime(frame, controlId, dateIso, timeDisplay) {
  const [year, month, day] = String(dateIso || '').split('-').map(Number);
  const time = parseDisplayTime(timeDisplay);
  await frame.evaluate(({ controlId, year, month, day, hours24, minutes }) => {
    const picker = $find(controlId);
    if (!picker) {
      throw new Error(`Could not find date/time control ${controlId}.`);
    }
    picker.set_selectedDate(new Date(year, month - 1, day, hours24, minutes, 0, 0));
  }, {
    controlId,
    year,
    month,
    day,
    hours24: time.hours24,
    minutes: time.minutes
  });
}

async function chooseComboItem(frame, domId, label) {
  const trimmed = String(label || '').trim();
  if (!trimmed) {
    return;
  }
  const dropdown = frame.locator(`#${domId}_DropDown`);
  await frame.click(`#${domId}_Arrow`);
  await dropdown.waitFor({ state: 'visible', timeout: 10000 });
  const items = dropdown.locator('li.rcbItem');
  const count = await items.count();
  let matchIndex = -1;
  const normalizedTarget = normalize(trimmed);
  for (let index = 0; index < count; index += 1) {
    const text = (await items.nth(index).innerText()).trim();
    const normalizedText = normalize(text);
    if (
      text === trimmed
      || normalizedText === normalizedTarget
      || normalizedText.includes(normalizedTarget)
      || normalizedTarget.includes(normalizedText)
    ) {
      matchIndex = index;
      break;
    }
  }
  if (matchIndex < 0) {
    throw new Error(`Could not find "${trimmed}" in Turtle Club.`);
  }
  await items.nth(matchIndex).click();
  await frame.page().waitForTimeout(800);
}

async function chooseComboItemViaTelerik(frame, domId, label, options = {}) {
  const trimmed = String(label || '').trim();
  if (!trimmed) {
    return;
  }
  const handlerName = options.handlerName || '';
  const postDelayMs = options.postDelayMs || 1200;
  const selected = await frame.evaluate(({ domId, trimmed, handlerName }) => {
    function normalizeClient(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/^vs\.\s*/i, '')
        .replace(/[^\w]+/g, ' ')
        .trim();
    }

    const combo = $find(domId);
    if (!combo) {
      throw new Error(`Could not find combo ${domId}.`);
    }

    let item = combo.findItemByText(trimmed);
    if (!item) {
      const target = normalizeClient(trimmed);
      const items = combo.get_items();
      for (let index = 0; index < items.get_count(); index += 1) {
        const candidate = items.getItem(index);
        const text = candidate.get_text();
        const normalized = normalizeClient(text);
        if (
          text === trimmed
          || normalized === target
          || normalized.includes(target)
          || target.includes(normalized)
        ) {
          item = candidate;
          break;
        }
      }
    }

    if (!item) {
      throw new Error(`Could not find "${trimmed}" in Turtle Club.`);
    }

    item.select();
    if (typeof combo.hideDropDown === 'function') {
      combo.hideDropDown();
    }
    if (handlerName && typeof window[handlerName] === 'function') {
      window[handlerName](combo, { get_item: () => item });
    }
    return {
      text: item.get_text(),
      value: typeof item.get_value === 'function' ? item.get_value() : ''
    };
  }, { domId, trimmed, handlerName });

  await frame.page().waitForTimeout(postDelayMs);
  return selected;
}

async function waitForComboSelection(frame, domId, label, timeoutMs = 10000) {
  const trimmed = String(label || '').trim();
  if (!trimmed) {
    return;
  }
  await frame.waitForFunction(({ domId, trimmed }) => {
    function normalizeClient(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/^vs\.\s*/i, '')
        .replace(/[^\w]+/g, ' ')
        .trim();
    }
    const input = document.getElementById(`${domId}_Input`);
    if (!input) return false;
    const actual = normalizeClient(input.value);
    const target = normalizeClient(trimmed);
    return actual === target || actual.includes(target) || target.includes(actual);
  }, { domId, trimmed }, { timeout: timeoutMs }).catch(() => {});
}

async function chooseComboItemReliable(frame, domId, label, options = {}) {
  try {
    await chooseComboItemViaTelerik(frame, domId, label, options);
    await waitForComboSelection(frame, domId, label);
    return;
  } catch (_) {
    await chooseComboItem(frame, domId, label);
    await waitForComboSelection(frame, domId, label);
  }
}

async function waitForComboItems(frame, domId, predicate, timeoutMs = 15000) {
  await frame.waitForFunction(({ domId, predicateSource }) => {
    const combo = $find(domId);
    if (!combo) return false;
    const items = combo.get_items();
    const values = [];
    for (let index = 0; index < items.get_count(); index += 1) {
      const candidate = items.getItem(index);
      values.push(candidate.get_text());
    }
    const predicate = eval(`(${predicateSource})`);
    return Boolean(predicate(values));
  }, {
    domId,
    predicateSource: predicate.toString()
  }, {
    timeout: timeoutMs
  });
}

async function comboInputText(frame, domId) {
  return frame.locator(`#${domId}_Input`).inputValue().catch(() => '');
}

async function setComboInputText(frame, domId, label) {
  await frame.locator(`#${domId}_Input`).fill(String(label || ''));
  await frame.page().waitForTimeout(300);
}

async function setHomeAway(frame, isAway) {
  const targetValue = isAway ? 'False' : 'True';
  await frame.evaluate((targetValue) => {
    const radios = [...document.querySelectorAll('input[name="ctl00$cM$rblIsHome"]')];
    radios.forEach((radio) => {
      radio.checked = radio.value === targetValue;
    });
  }, targetValue);
}

async function submitInsertAndClose(frame) {
  const submitted = await frame.evaluate(() => {
    const link = document.getElementById('cC_lbInsertAndClose')
      || document.getElementById('ctl00_cC_lbInsertAndClose');
    if (link && typeof link.click === 'function') {
      link.click();
      return true;
    }
    if (typeof __doPostBack === 'function') {
      __doPostBack('ctl00$cC$lbInsertAndClose', '');
      return true;
    }
    return false;
  });
  if (!submitted) {
    throw new Error('Could not trigger Turtle Club Insert & Close.');
  }
}

async function modalHasInsert(frame) {
  return frame.locator('#cC_lbInsertAndClose').count().then((count) => count > 0).catch(() => false);
}

async function waitForCreatedEvent(jar, request, beforeEvents, options = {}) {
  const timeoutMs = options.timeoutMs || 30000;
  const intervalMs = options.intervalMs || 2500;
  const deadline = Date.now() + timeoutMs;
  let latest = { created: null, beforeEvents, afterEvents: [] };
  while (Date.now() <= deadline) {
    latest = await findCreatedEvent(jar, request, beforeEvents);
    if (latest.created) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return latest;
}

async function waitForCreatedEventOnPage(page, request, beforeEvents, options = {}) {
  const timeoutMs = options.timeoutMs || 30000;
  const intervalMs = options.intervalMs || 2500;
  const deadline = Date.now() + timeoutMs;
  const targetDate = new Date(`${request.date}T12:00:00`);
  let latest = { created: null, beforeEvents, afterEvents: [] };

  while (Date.now() <= deadline) {
    let mainFrame = page.frames().find((candidate) => candidate.name() === 'rpMain');
    if (!mainFrame) {
      await page.waitForTimeout(intervalMs);
      continue;
    }
    try {
      await mainFrame.evaluate(({ year, month, day }) => {
        if (typeof set_calView === 'function') {
          set_calView(day, month, year, true);
        }
      }, {
        year: targetDate.getFullYear(),
        month: targetDate.getMonth() + 1,
        day: targetDate.getDate()
      });
      await page.waitForTimeout(2000);
    } catch (_) {
      await mainFrame.goto(cpScheduleUrl(), { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(2000);
      mainFrame = page.frames().find((candidate) => candidate.name() === 'rpMain') || mainFrame;
    }

    const html = await mainFrame.content().catch(() => '');
    if (html) {
      const afterEvents = parseCpScheduleEvents(html, targetDate).filter((event) => eventMatchesNewRequest(request, event));
      latest = {
        created: findCreatedDelta(beforeEvents, afterEvents),
        beforeEvents,
        afterEvents
      };
      if (latest.created) {
        return latest;
      }
    }
    await page.waitForTimeout(intervalMs);
  }

  return latest;
}

async function createViaShell(request, kind) {
  const browser = await launchAutomationBrowser();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  try {
    await loginSchedulingShell(page);
    const mainFrame = await openSchedulingMainFrame(page);
    let modalFrame;
    try {
      modalFrame = await tryOpenModalFromDayAtGlance(page, mainFrame, request, kind);
    } catch (_) {
      modalFrame = await openShellModal(page, mainFrame, async (frame) => {
        if (kind === 'practice') {
          const venueId = venueIdForDiamond(request.diamond);
          const [year, month, day] = String(request.date || '').split('-').map(Number);
          const start = parseDisplayTime(request.start);
          const end = parseDisplayTime(request.end);
          await frame.evaluate(({ venueId, year, month, day, startHour, startMinute, endHour, endMinute }) => {
            ShowInsertPracticeFormWithStartAndEnd(venueId, year, month, day, startHour, startMinute, endHour, endMinute);
          }, {
            venueId: Number(venueId),
            year,
            month,
            day,
            startHour: start.hours24,
            startMinute: start.minutes,
            endHour: end.hours24,
            endMinute: end.minutes
          });
          return;
        }
        await frame.evaluate(() => ShowInsertGameForm(0));
      });
    }

    if (kind === 'practice') {
      await chooseComboItemReliable(modalFrame, 'ctl00_cM_rcbVenues', cpVenueOptionLabel(request.diamond), {
        handlerName: 'rcbV_OnIndexChanged'
      });
      await chooseComboItemReliable(modalFrame, 'ctl00_cM_rcbTeams', request.team, {
        handlerName: 'rcbT_OnIndexChanged',
        postDelayMs: 1800
      });
      await page.waitForTimeout(1200);
    } else {
      await setRadDateTime(modalFrame, 'ctl00_cM_rtbStarts', request.date, request.start);
      await modalFrame.locator('#ctl00_cM_rtbDuration').fill(String(durationMinutes(request.start, request.end || request.start)));
      const currentGameType = await comboInputText(modalFrame, 'ctl00_cM_rcbGameType');
      if (currentGameType.trim() !== 'Regular Season') {
        await chooseComboItemReliable(modalFrame, 'ctl00_cM_rcbGameType', 'Regular Season', {
          handlerName: 'OnTypeChanged'
        });
      }
      await chooseComboItemReliable(modalFrame, 'ctl00_cM_rcbVenues', cpVenueOptionLabel(request.diamond), {
        handlerName: 'rcbV_OnIndexChanged',
        postDelayMs: 1800
      });
      await chooseComboItemReliable(modalFrame, 'ctl00_cM_rcbTeams', request.team, {
        handlerName: 'rcbT_OnIndexChanged',
        postDelayMs: 2200
      });
      await waitForComboItems(modalFrame, 'ctl00_cM_rcbTeams2', (items) => {
        return items.some((item) => /select an opponent/i.test(item) || /\w/.test(item));
      }, 15000).catch(() => {});
      await page.waitForTimeout(1500);
      if (request.opponent) {
        const currentOpponent = await comboInputText(modalFrame, 'ctl00_cM_rcbTeams2');
        if (currentOpponent.trim() !== String(request.opponent).trim()) {
          await chooseComboItemReliable(modalFrame, 'ctl00_cM_rcbTeams2', request.opponent, {
            handlerName: 'rcbO_OnIndexChanged',
            postDelayMs: 1800
          });
        }
      }
      await setHomeAway(modalFrame, /away/i.test(request.newType || request.action));
    }

    const preparedHtml = await modalFrame.content().catch(() => '');
    await submitInsertAndClose(modalFrame);
    await page.waitForTimeout(2500);
    return { page, browser, preparedHtml };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

function parseDefaultForm(html) {
  const actionMatch = html.match(/<form[^>]*action="([^"]+)"/i);
  const form = {
    action: actionMatch ? decodeHtml(actionMatch[1]) : '',
    values: {}
  };

  for (const match of html.matchAll(/<input\b([^>]*)>/gi)) {
    const attrs = match[1];
    const nameMatch = attrs.match(/\bname="([^"]+)"/i);
    if (!nameMatch) continue;
    const typeMatch = attrs.match(/\btype="([^"]+)"/i);
    const type = (typeMatch ? typeMatch[1] : 'text').toLowerCase();
    const valueMatch = attrs.match(/\bvalue="([^"]*)"/i);
    const checked = /\bchecked="checked"/i.test(attrs);
    if (type === 'radio' || type === 'checkbox') {
      if (checked) {
        form.values[nameMatch[1]] = valueMatch ? valueMatch[1] : 'on';
      }
      continue;
    }
    form.values[nameMatch[1]] = valueMatch ? valueMatch[1] : '';
  }

  for (const match of html.matchAll(/<textarea\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/gi)) {
    form.values[match[1]] = decodeHtml(match[2]);
  }

  return form;
}

function extractRadComboConfig(html, domId) {
  const anchor = html.indexOf(`$get("${domId}")`);
  if (anchor < 0) {
    throw new Error(`Could not find combo ${domId}`);
  }
  const start = html.lastIndexOf('$create(Telerik.Web.UI.RadComboBox,', anchor);
  const objectStart = html.indexOf('{', start);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = objectStart; index < html.length; index += 1) {
    const char = html[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(html.slice(objectStart, index + 1));
      }
    }
  }
  throw new Error(`Could not parse combo config for ${domId}`);
}

function extractComboVisibleItems(html, domId) {
  const start = html.indexOf(`<div id="${domId}"`);
  if (start < 0) return [];
  const endMarker = `<input id="${domId}_ClientState"`;
  const end = html.indexOf(endMarker, start);
  const section = end > start ? html.slice(start, end) : html.slice(start);
  return [...section.matchAll(/<li class="[^"]*rcb(?:Item|Disabled)[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => stripTags(match[1]));
}

function extractRadInputConfig(html, clientId) {
  const pattern = new RegExp(`\\$create\\(Telerik\\.Web\\.UI\\.RadDateInput, \\{([\\s\\S]*?)\\}, [\\s\\S]*?\\$get\\("${clientId}"\\)\\);`, 'i');
  const match = html.match(pattern);
  if (!match) return null;
  const body = match[1];
  const displayText = (body.match(/"_displayText":"([^"]*)"/) || [])[1] || '';
  const initialValue = (body.match(/"_initialValueAsText":"([^"]*)"/) || [])[1] || '';
  const validationText = (body.match(/"_validationText":"([^"]*)"/) || [])[1] || '';
  return {
    displayText: decodeHtml(displayText),
    initialValue: decodeHtml(initialValue),
    validationText: decodeHtml(validationText)
  };
}

function rehydrateRadDateTimeFields(formValues, html) {
  const mappings = [
    {
      inputClientId: 'ctl00_cM_rtbStarts_dateInput',
      valueName: 'ctl00$cM$rtbStarts',
      displayName: 'ctl00$cM$rtbStarts$dateInput'
    },
    {
      inputClientId: 'ctl00_cM_rtbEnds_dateInput',
      valueName: 'ctl00$cM$rtbEnds',
      displayName: 'ctl00$cM$rtbEnds$dateInput'
    }
  ];

  for (const mapping of mappings) {
    const config = extractRadInputConfig(html, mapping.inputClientId);
    if (!config) continue;
    if (!formValues[mapping.valueName]) {
      formValues[mapping.valueName] = config.initialValue || config.validationText || formValues[mapping.valueName] || '';
    }
    if (!formValues[mapping.displayName]) {
      formValues[mapping.displayName] = config.displayText || formValues[mapping.displayName] || '';
    }
  }
}

function rehydrateComboFields(formValues, html) {
  const comboMappings = [
    {
      inputName: 'ctl00$cM$rcbVenues',
      clientStateName: 'ctl00_cM_rcbVenues_ClientState',
      domId: 'ctl00_cM_rcbVenues',
      allowPrefix: true
    },
    {
      inputName: 'ctl00$cM$rcbTeams',
      clientStateName: 'ctl00_cM_rcbTeams_ClientState',
      domId: 'ctl00_cM_rcbTeams',
      allowPrefix: false
    },
    {
      inputName: 'ctl00$cM$rcbTeams2',
      clientStateName: 'ctl00_cM_rcbTeams2_ClientState',
      domId: 'ctl00_cM_rcbTeams2',
      allowPrefix: false
    },
    {
      inputName: 'ctl00$cM$rcb_repeat',
      clientStateName: 'ctl00_cM_rcb_repeat_ClientState',
      domId: 'ctl00_cM_rcb_repeat',
      allowPrefix: false
    }
  ];

  for (const mapping of comboMappings) {
    if (formValues[mapping.clientStateName]) continue;
    const label = decodeHtml(formValues[mapping.inputName] || '');
    if (!label) continue;
    try {
      const items = comboItems(html, mapping.domId);
      const item = findComboItem(items, label, { allowPrefix: mapping.allowPrefix });
      if (!item) continue;
      formValues[mapping.clientStateName] = comboState(item);
      if (mapping.domId === 'ctl00_cM_rcbVenues') {
        formValues['ctl00$cM$hfVen'] = item.value;
      }
    } catch (_) {
      continue;
    }
  }

  if (!formValues.ctl00_cM_rcbItemtext_ClientState && formValues['ctl00$cM$rcbItemtext']) {
    formValues.ctl00_cM_rcbItemtext_ClientState = comboState({
      value: formValues['ctl00$cM$rcbItemtext'],
      text: formValues['ctl00$cM$rcbItemtext']
    });
  }
}

function comboItems(html, domId) {
  const config = extractRadComboConfig(html, domId);
  const visibleTexts = extractComboVisibleItems(html, domId);
  const paired = [];
  let visibleIndex = 0;
  for (const [index, item] of (config.itemData || []).entries()) {
    const text = Object.prototype.hasOwnProperty.call(item, 'text')
      ? decodeHtml(item.text)
      : (visibleTexts[visibleIndex] || '');
    if (!item.hidden) visibleIndex += 1;
    paired.push({
      ...item,
      index,
      text
    });
  }
  return paired;
}

function findComboItem(items, label, options = {}) {
  const wanted = normalize(label);
  const allowPrefix = options.allowPrefix !== false;
  let best = items.find((item) => item.value && normalize(item.text) === wanted);
  if (best) return best;
  if (allowPrefix) {
    best = items.find((item) => item.value && normalize(item.text).startsWith(wanted));
    if (best) return best;
  }
  best = items.find((item) => item.value && normalize(item.text).includes(wanted));
  if (best) return best;
  best = items.find((item) => item.value && wanted.includes(normalize(item.text)));
  return best || null;
}

function comboState(item, options = {}) {
  const mode = options.mode || 'light';
  const state = {
    logEntries: [],
    value: mode === 'selected' ? (item?.value || '') : '',
    text: item?.text || '',
    enabled: item?.enabled !== 0,
    checkedIndices: [],
    checkedItemsTextOverflows: false
  };
  if (mode === 'selected') {
    state.selectedIndex = typeof item?.index === 'number' ? item.index : -1;
  }
  return JSON.stringify(state);
}

function buildActionUrl(action) {
  return action.startsWith('http') ? action : `${baseUrl}/CP/Modals/Common/MultiSchedule/${action.replace(/^\.\//, '')}`;
}

async function postForm(jar, actionUrl, values, extraHeaders = {}) {
  const response = await fetchWithJar(jar, actionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...extraHeaders
    },
    body: new URLSearchParams(values).toString()
  });
  return response.text();
}

function extractRemoteEventId(localId) {
  const match = String(localId || '').match(/tc-cp-(\d+)$/);
  return match ? match[1] : '';
}

function extractBalancedDiv(html, startIndex) {
  let depth = 0;
  let cursor = startIndex;
  while (cursor < html.length) {
    const nextOpen = html.indexOf('<div', cursor);
    const nextClose = html.indexOf('</div>', cursor);
    if (nextClose === -1) return '';
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      cursor = nextOpen + 4;
      continue;
    }
    depth -= 1;
    cursor = nextClose + 6;
    if (depth === 0) return html.slice(startIndex, cursor);
  }
  return '';
}

function extractPnlBlocks(cellHtml) {
  const blocks = [];
  let cursor = 0;
  while (cursor < cellHtml.length) {
    const marker = cellHtml.indexOf('<div class="pnl', cursor);
    if (marker === -1) break;
    const block = extractBalancedDiv(cellHtml, marker);
    if (!block) break;
    blocks.push(block);
    cursor = marker + block.length;
  }
  return blocks;
}

function parseCpDateLabel(label, fallbackYear) {
  const match = stripTags(label).match(/([A-Za-z]{3})\s+(\d{1,2})/);
  if (!match) return '';
  const month = new Date(`${match[1]} 1, ${fallbackYear}`).getMonth() + 1;
  return `${fallbackYear}-${String(month).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
}

function extractTableCells(rowHtml) {
  return [...rowHtml.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)].map((match) => {
    const colspan = Number((match[1].match(/colspan="(\d+)"/i) || [])[1] || 1);
    return {
      colspan,
      content: match[2]
    };
  });
}

function splitTimeRange(text) {
  const clean = stripTags(text);
  if (!clean.includes('-')) return { start: clean, end: '' };
  const [start, end] = clean.split('-').map((piece) => piece.trim());
  return { start, end };
}

function parseCpEventBlock(block, date) {
  const className = (block.match(/<div class="(pnl[^"\s]+)/i) || [])[1] || '';
  const eventId = (block.match(/multischedule_edit\((\d+),'[^']+'\)/) || block.match(/(?:del|cmd)_[A-Za-z]+_(\d+)/) || [])[1] || '';
  const teams = [...block.matchAll(/<div class="team">([\s\S]*?)<\/div>/gi)].map((match) => stripTags(match[1])).filter(Boolean);
  const organization = teams[0] || '';
  const rawTeam = teams[teams.length - 1] || organization || 'Turtle Club';
  const timeText = stripTags((block.match(/<div class="time">([\s\S]*?)<\/div>/i) || [])[1] || '');
  const venue = stripTags((block.match(/<div class="venue[^"]*">([\s\S]*?)<\/div>/i) || [])[1] || '');
  const subject = stripTags((block.match(/<div class="subject">([\s\S]*?)<\/div>/i) || [])[1] || '');
  const opponent = stripTags((block.match(/<div class="opponent">([\s\S]*?)<\/div>/i) || [])[1] || '');
  if (!eventId || !timeText || !venue) return null;
  const timeRange = splitTimeRange(timeText);
  let eventKind = 'Practice';
  if (/pnlAway/i.test(className)) eventKind = 'Away Game';
  if (/pnlHome/i.test(className)) eventKind = 'Home Game';
  const cancelled = /cancel/i.test(className) || /cancelled/i.test(subject) || /cancelled/i.test(opponent);
  if (cancelled) eventKind = `${eventKind} Cancelled`;
  return {
    remoteId: eventId,
    date,
    time: timeRange.start,
    endTime: timeRange.end,
    team: organization === 'Titans' ? rawTeam : `${organization} - ${rawTeam}`,
    diamond: venue,
    opponent: opponent || subject || eventKind,
    subject: subject || eventKind,
    eventKind
  };
}

function parseCpScheduleEvents(html, fallbackDate) {
  const tableMatch = html.match(/<table class="standard calendar">([\s\S]*?)<\/table>/i);
  if (!tableMatch) return [];
  const rows = [...tableMatch[1].matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)];
  const events = [];
  let currentDates = [];
  for (const row of rows) {
    const rowClass = (row[1].match(/class="([^"]+)"/i) || [])[1] || '';
    const cells = extractTableCells(row[2]);
    if (rowClass.includes('dates')) {
      currentDates = [];
      let dateIndex = 0;
      for (const cell of cells) {
        const date = parseCpDateLabel(cell.content, fallbackDate.getFullYear());
        for (let offset = 0; offset < cell.colspan; offset += 1) {
          currentDates[dateIndex + offset] = date;
        }
        dateIndex += cell.colspan;
      }
      continue;
    }
    if (!currentDates.length || rowClass.includes('head') || rowClass.includes('dayofweek')) continue;
    let dateIndex = 0;
    for (const cell of cells) {
      const date = currentDates[dateIndex];
      if (date) {
        for (const block of extractPnlBlocks(cell.content)) {
          const event = parseCpEventBlock(block, date);
          if (event) events.push(event);
        }
      }
      dateIndex += cell.colspan;
    }
  }
  return events;
}

function eventKindMatches(request, event) {
  const originalType = String(request.originalType || '').toLowerCase();
  const eventKind = String(event.eventKind || '').toLowerCase();
  if (originalType.includes('practice')) return eventKind.includes('practice');
  if (originalType.includes('away')) return eventKind.includes('away');
  if (originalType.includes('home')) return eventKind.includes('home');
  if (originalType.includes('game')) return eventKind.includes('game');
  return true;
}

function eventMatchesRequest(request, event) {
  const directRemoteId = extractRemoteEventId(request.originalId);
  if (directRemoteId) {
    return String(event.remoteId || '') === String(directRemoteId);
  }
  if (event.date !== request.originalDate) return false;
  if (normalize(event.team) !== normalize(request.team)) return false;
  if (normalize(event.diamond) !== normalize(request.originalDiamond)) return false;
  if (!eventKindMatches(request, event)) return false;

  const requestedStart = minutesFromDisplay(request.originalStart);
  const eventStart = minutesFromDisplay(event.time);
  if (requestedStart !== eventStart) return false;

  const requestOpponent = normalize(request.originalOpponent || '');
  if (requestOpponent && requestOpponent !== 'practice') {
    const eventOpponent = normalize(event.opponent || event.subject || '');
    if (requestOpponent !== eventOpponent && !eventOpponent.includes(requestOpponent) && !requestOpponent.includes(eventOpponent)) {
      return false;
    }
  }

  return true;
}

async function resolveRemoteEventId(jar, request) {
  const direct = extractRemoteEventId(request.originalId);
  if (direct) return direct;

  const targetDate = new Date(`${request.originalDate}T12:00:00`);
  const offsets = [0, -7, 7];
  for (const offset of offsets) {
    const viewDate = new Date(targetDate);
    viewDate.setDate(viewDate.getDate() + offset);
    const html = await fetchCpScheduleHtml(jar, viewDate);
    const match = parseCpScheduleEvents(html, viewDate).find((event) => eventMatchesRequest(request, event));
    if (match) return match.remoteId;
  }

  throw new Error('The original event could not be matched to a writable Turtle Club schedule record.');
}

async function currentMatchingOriginalEvents(jar, request) {
  const targetDate = new Date(`${request.originalDate}T12:00:00`);
  const offsets = [0, -7, 7];
  const matches = [];
  for (const offset of offsets) {
    const viewDate = new Date(targetDate);
    viewDate.setDate(viewDate.getDate() + offset);
    const html = await fetchCpScheduleHtml(jar, viewDate);
    matches.push(...parseCpScheduleEvents(html, viewDate).filter((event) => eventMatchesRequest(request, event)));
  }
  return matches;
}

async function originalEventStillActive(jar, request) {
  const matches = await currentMatchingOriginalEvents(jar, request);
  saveDebugHtml('cancel-current-matches.json', JSON.stringify(matches, null, 2));
  return matches.some((event) => !/cancelled/i.test(String(event.eventKind || '')));
}

async function waitForOriginalEventToClear(jar, request, options = {}) {
  const timeoutMs = options.timeoutMs || 15000;
  const intervalMs = options.intervalMs || 3000;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    if (!await originalEventStillActive(jar, request)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return !(await originalEventStillActive(jar, request));
}

async function submitGameCancellationForm(jar, request, html, replacementType = '', explicitMode = '') {
  const form = parseDefaultForm(html);
  const availableModes = radioGroupValuesFromHtml(html, 'ctl00$cM$rblMulti');
  const chosenMode = explicitMode || chooseCancellationMode(availableModes, request, replacementType);
  form.values.__EVENTTARGET = 'ctl00$cC$btnDelete';
  form.values.__EVENTARGUMENT = '';
  form.values['ctl00$cM$rblMulti'] = chosenMode;
  form.values['ctl00$cM$txtReason'] = cancellationReason(request);
  if (replacementType === 'Practice') {
    form.values['ctl00$cM$chk_replace_with_practice'] = 'on';
  }
  saveDebugHtml('cancel-game-delete-request.json', JSON.stringify({ chosenMode, availableModes, values: form.values }, null, 2));
  const result = await postForm(jar, buildActionUrl(form.action), form.values);
  saveDebugHtml('cancel-game-delete-result.html', result);
  if (/Problem|Error|Exception/i.test(result)) {
    throw new Error('Turtle Club rejected the game cancellation.');
  }
  return { chosenMode, availableModes, result };
}

function venueLabelForRequest(diamond) {
  return diamond;
}

function cpVenueOptionLabel(diamond) {
  const map = {
    'Turtle Club - Diamond #1': 'Turtle Club - Diamond #1 (LaSalle)',
    'Turtle Club - Diamond #2': 'Turtle Club - Diamond #2 (LaSalle)',
    'Turtle Club - Diamond #3': 'Turtle Club - Diamond #3 (LaSalle)',
    'Turtle Club - Diamond #4': 'Turtle Club - Diamond #4 (LaSalle)',
    'Turtle Club - Diamond #5': 'Turtle Club - Diamond #5 (LaSalle)',
    'Turtle Club - Diamond #6': 'Turtle Club - Diamond #6 (LaSalle)',
    'Turtle Club - Diamond #7': 'Turtle Club - Diamond #7 (LaSalle)',
    'Villanova - Diamond #1': 'Villanova - Diamond #1 (LaSalle)',
    'Villanova - Diamond #2': 'Villanova - Diamond #2 (LaSalle)',
    'Vollmer #1': 'Vollmer #1 (LaSalle)',
    'Vollmer #2': 'Vollmer #2 (LaSalle)',
    'Vollmer #3': 'Vollmer #3 (LaSalle)',
    'Vollmer #4': 'Vollmer #4 (LaSalle)',
    'Vollmer #5': 'Vollmer #5 (Lasalle)',
    'Vollmer #6': 'Vollmer #6 (Lasalle)',
    'Vollmer #7': 'Vollmer #7 (LaSalle)',
    'Vollmer #8': 'Vollmer #8 (Lasalle)',
    'River Canard #1': 'River Canard #1 (River Canard)',
    'River Canard #2': 'River Canard #2 (River Canard)',
    'River Canard #3': 'River Canard #3 (River Canard)',
    'River Canard #4': 'River Canard #4 (Amherstburg)'
  };
  return map[diamond] || diamond;
}

function extractAjaxHiddenFields(payload) {
  const fields = {};
  const pattern = /\|\d+\|hiddenField\|([^|]+)\|([\s\S]*?)(?=\|\d+\|(?:hiddenField|asyncPostBackControlIDs|postBackControlIDs|updatePanelIDs|childUpdatePanelIDs|panelsToRefreshIDs|asyncPostBackTimeout|formAction|pageTitle|scriptStartupBlock|scriptBlock|onSubmit|dataItem|fallbackScript|expando|pageRedirect|error|pageLoading|pageLoaded)\|)/g;
  for (const match of payload.matchAll(pattern)) {
    fields[match[1]] = match[2];
  }
  return fields;
}

function extractAjaxFormAction(payload) {
  const match = String(payload || '').match(/\|\d+\|formAction\|([^|]*)\|/);
  return match ? decodeHtml(match[1]) : '';
}

function radioGroupValuesFromHtml(html, name) {
  const escapedName = String(name || '').replace(/[$]/g, '\\$&');
  const pattern = new RegExp(`<input\\b[^>]*name="${escapedName}"[^>]*value="([^"]*)"[^>]*>`, 'gi');
  return [...String(html || '').matchAll(pattern)].map((match) => decodeHtml(match[1])).filter(Boolean);
}

function chooseCancellationMode(availableValues, request, replacementType = '') {
  const normalized = (availableValues || []).map((value) => String(value || '').trim()).filter(Boolean);
  const preferred = replacementType
    ? ['Cancel', 'Single']
    : ['Single', 'Cancel'];
  for (const option of preferred) {
    const match = normalized.find((value) => value.toLowerCase() === option.toLowerCase());
    if (match) return match;
  }
  return normalized[0] || (replacementType ? 'Cancel' : 'Single');
}

function applyAjaxHiddenFields(formValues, fields) {
  for (const [name, value] of Object.entries(fields || {})) {
    formValues[name] = value;
  }
}

function eventMatchesNewRequest(request, event) {
  if (event.date !== request.date) return false;
  if (normalize(event.team) !== normalize(request.team)) return false;
  if (normalize(event.diamond) !== normalize(request.diamond)) return false;
  if (minutesFromDisplay(event.time) !== minutesFromDisplay(request.start)) return false;

  const requestedType = String(request.newType || request.action || '').toLowerCase();
  const eventKind = String(event.eventKind || '').toLowerCase();
  if (requestedType.includes('practice') && !eventKind.includes('practice')) return false;
  if (requestedType.includes('away') && !eventKind.includes('away')) return false;
  if (requestedType.includes('home') && !eventKind.includes('home')) return false;
  if (requestedType.includes('game') && !eventKind.includes('game')) return false;

  const opponent = normalize(request.opponent || '');
  if (opponent && opponent !== 'practice') {
    const eventOpponent = normalize(event.opponent || event.subject || '');
    if (opponent !== eventOpponent && !eventOpponent.includes(opponent) && !opponent.includes(eventOpponent)) {
      return false;
    }
  }

  return true;
}

function createdEventSignature(event) {
  return [
    event.date,
    normalize(event.team),
    normalize(event.diamond),
    minutesFromDisplay(event.time),
    minutesFromDisplay(event.endTime || event.time),
    normalize(event.eventKind || ''),
    normalize(event.opponent || event.subject || '')
  ].join('|');
}

function countEventMultiset(events) {
  const counts = new Map();
  for (const event of events) {
    const key = createdEventSignature(event);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function findCreatedDelta(beforeEvents, afterEvents) {
  const beforeCounts = countEventMultiset(beforeEvents);
  for (const event of afterEvents) {
    const key = createdEventSignature(event);
    const remaining = beforeCounts.get(key) || 0;
    if (remaining > 0) {
      beforeCounts.set(key, remaining - 1);
      continue;
    }
    return event;
  }
  return null;
}

async function collectMatchingEvents(jar, request) {
  const targetDate = new Date(`${request.date}T12:00:00`);
  const offsets = [0, -7, 7];
  const matches = [];
  for (const offset of offsets) {
    const viewDate = new Date(targetDate);
    viewDate.setDate(viewDate.getDate() + offset);
    const html = await fetchCpScheduleHtml(jar, viewDate);
    matches.push(...parseCpScheduleEvents(html, viewDate).filter((event) => eventMatchesNewRequest(request, event)));
  }
  return matches;
}

async function findCreatedEvent(jar, request, beforeEvents = []) {
  const afterEvents = await collectMatchingEvents(jar, request);
  const created = findCreatedDelta(beforeEvents, afterEvents);
  return {
    created,
    beforeEvents,
    afterEvents
  };
}

function populatePracticeForm(formValues, html, request, stateMode = 'light') {
  const start = formatRadDate(request.date, request.start);
  const end = formatRadDate(request.date, request.end);
  const practiceLabel = /practice/i.test(String(request.opponent || ''))
    ? 'Practice'
    : (String(request.newType || '').trim() || 'Practice');
  formValues.__EVENTARGUMENT = '';
  formValues['ctl00$cM$rtbStarts'] = start.compact;
  formValues['ctl00$cM$rtbStarts$dateInput'] = start.full;
  formValues['ctl00$cM$rtbEnds'] = end.compact;
  formValues['ctl00$cM$rtbEnds$dateInput'] = end.timeOnly;
  formValues['ctl00$cM$rcbItemtext'] = practiceLabel.slice(0, 50);
  formValues.ctl00_cM_rcbItemtext_ClientState = comboState({
    value: practiceLabel.slice(0, 50),
    text: practiceLabel.slice(0, 50)
  }, { mode: 'selected' });
  formValues['ctl00$cM$chkTentative'] = '';
  selectCombo(formValues, html, 'ctl00_cM_rcbVenues', venueLabelForRequest(request.diamond), { stateMode });
  selectCombo(formValues, html, 'ctl00_cM_rcbTeams', request.team, { stateMode });
  selectCombo(formValues, html, 'ctl00_cM_rcb_repeat', "Don't Repeat This Practice", { allowPrefix: false, stateMode });
}

async function submitPracticeConflictIgnore(jar, baseHtml, payload, request, mode) {
  const retryForm = parseDefaultForm(baseHtml);
  applyAjaxHiddenFields(retryForm.values, extractAjaxHiddenFields(payload));
  rehydrateRadDateTimeFields(retryForm.values, baseHtml);
  rehydrateComboFields(retryForm.values, baseHtml);
  populatePracticeForm(retryForm.values, baseHtml, request, 'selected');
  retryForm.values.__EVENTARGUMENT = '';

  if (mode === 'submit') {
    retryForm.values.__EVENTTARGET = '';
    delete retryForm.values.__ASYNCPOST;
    delete retryForm.values['ctl00$sm'];
  } else if (mode === 'async-submit') {
    retryForm.values.__EVENTTARGET = '';
    retryForm.values['ctl00$sm'] = 'ctl00$cC$rwConflicts$C$upConflicts|ctl00$cC$rwConflicts$C$btn_ignore';
    retryForm.values.__ASYNCPOST = 'true';
  } else {
    retryForm.values.__EVENTTARGET = 'ctl00$cC$rwConflicts$C$btn_ignore';
    retryForm.values['ctl00$sm'] = 'ctl00$cC$rwConflicts$C$upConflicts|ctl00$cC$rwConflicts$C$btn_ignore';
    retryForm.values.__ASYNCPOST = 'true';
  }

  retryForm.values['ctl00$cC$rwConflicts$C$btn_ignore'] = 'Ignore Conflicts & Save Anyway';
  return postForm(
    jar,
    buildActionUrl(extractAjaxFormAction(payload) || retryForm.action),
    retryForm.values,
    mode === 'async-submit' || mode === 'eventtarget-async'
      ? {
          'X-MicrosoftAjax': 'Delta=true',
          'X-Requested-With': 'XMLHttpRequest'
        }
      : {}
  );
}

async function clickInsertAndCloseFromHtml(jar, html, request, kind) {
  const form = parseDefaultForm(html);
  rehydrateRadDateTimeFields(form.values, html);
  rehydrateComboFields(form.values, html);
  if (kind === 'practice') {
    populatePracticeForm(form.values, html, request, 'selected');
  } else {
    const start = formatRadDate(request.date, request.start);
    form.values['ctl00$cM$rtbStarts'] = start.compact;
    form.values['ctl00$cM$rtbStarts$dateInput'] = start.full;
    form.values['ctl00$cM$rtbDuration'] = String(durationMinutes(request.start, request.end || request.start));
    form.values['ctl00$cM$rtbDescription'] = request.reason ? request.reason.slice(0, 50) : '';
    form.values['ctl00$cM$rtbGameNumber'] = '';
    form.values['ctl00$cM$rblIsHome'] = /away/i.test(request.newType || request.action) ? 'False' : 'True';
    selectCombo(form.values, html, 'ctl00_cM_rcbVenues', venueLabelForRequest(request.diamond), { stateMode: 'selected' });
    selectCombo(form.values, html, 'ctl00_cM_rcbTeams', request.team, { stateMode: 'selected' });
    selectCombo(form.values, html, 'ctl00_cM_rcbTeams2', request.opponent, { stateMode: 'selected' });
    selectCombo(form.values, html, 'ctl00_cM_rcbGameType', 'Regular Season', { allowPrefix: false, stateMode: 'selected' });
  }
  form.values.__EVENTTARGET = 'ctl00$cC$lbInsertAndClose';
  form.values.__EVENTARGUMENT = '';
  delete form.values.__ASYNCPOST;
  delete form.values['ctl00$sm'];
  delete form.values['ctl00$cC$rwConflicts$C$btn_ignore'];
  return postForm(jar, buildActionUrl(form.action), form.values);
}

async function cancelPractice(jar, request) {
  try {
    await tryCancelFromDayAtGlance(request);
    if (await waitForOriginalEventToClear(jar, request)) {
      return;
    }
    saveDebugHtml('cancel-practice-day-at-a-glance-no-effect.txt', 'Day At A Glance path completed but the original practice still appears active.');
  } catch (error) {
    saveDebugHtml('cancel-practice-day-at-a-glance-fallback.txt', error.message || String(error));
  }

  const remoteId = await resolveRemoteEventId(jar, request);
  const response = await fetchWithJar(jar, `/CP/Modals/Common/Multischedule/Practice_Delete.aspx?ID=${remoteId}&HFID=cMain_cBot_hfContent`);
  const html = await response.text();
  saveDebugHtml('cancel-practice-delete-form.html', html);
  const form = parseDefaultForm(html);
  form.values.__EVENTTARGET = 'ctl00$cC$btnDelete';
  form.values.__EVENTARGUMENT = '';
  if ('ctl00$cM$rblMulti' in form.values) {
    form.values['ctl00$cM$rblMulti'] = chooseCancellationMode(radioGroupValuesFromHtml(html, 'ctl00$cM$rblMulti'), request);
  }
  saveDebugHtml('cancel-practice-delete-request.json', JSON.stringify(form.values, null, 2));
  const result = await postForm(jar, buildActionUrl(form.action), form.values);
  saveDebugHtml('cancel-practice-delete-result.html', result);
  if (/Problem|Error|Exception/i.test(result)) {
    throw new Error('Turtle Club rejected the practice cancellation.');
  }
  if (!await waitForOriginalEventToClear(jar, request)) {
    throw new Error('Turtle Club accepted the practice cancellation request, but the original practice still appears active afterward.');
  }
}

async function cancelGame(jar, request, replacementType = '') {
  try {
    await tryCancelFromDayAtGlance(request, replacementType);
    if (await waitForOriginalEventToClear(jar, request)) {
      return;
    }
    saveDebugHtml('cancel-game-day-at-a-glance-no-effect.txt', 'Day At A Glance path completed but the original game still appears active.');
  } catch (error) {
    saveDebugHtml('cancel-game-day-at-a-glance-fallback.txt', error.message || String(error));
  }

  const remoteId = await resolveRemoteEventId(jar, request);
  const response = await fetchWithJar(jar, `/CP/Modals/Common/Multischedule/Game_Delete.aspx?ID=${remoteId}&HFID=cMain_cBot_hfContent`);
  const html = await response.text();
  saveDebugHtml('cancel-game-delete-form.html', html);
  const { chosenMode, availableModes } = await submitGameCancellationForm(jar, request, html, replacementType);
  if (!await waitForOriginalEventToClear(jar, request)) {
    const deleteMode = availableModes.find((value) => String(value || '').toLowerCase() === 'delete');
    if (deleteMode && String(chosenMode || '').toLowerCase() !== 'delete') {
      saveDebugHtml('cancel-game-delete-retry.txt', `Retrying cancellation in Delete mode after ${chosenMode} left the event active.`);
      await submitGameCancellationForm(jar, request, html, replacementType, deleteMode);
    }
  }
  if (!await waitForOriginalEventToClear(jar, request)) {
    throw new Error('Turtle Club accepted the game cancellation request, but the original game still appears active afterward.');
  }
}

function selectCombo(formValues, html, domId, label, options = {}) {
  const items = comboItems(html, domId);
  const item = findComboItem(items, label, options);
  if (!item) {
    throw new Error(`Could not find "${label}" in Turtle Club.`);
  }
  const name = {
    ctl00_cM_rcbTeams: 'ctl00$cM$rcbTeams',
    ctl00_cM_rcbTeams2: 'ctl00$cM$rcbTeams2',
    ctl00_cM_rcbVenues: 'ctl00$cM$rcbVenues',
    ctl00_cM_rcbGameType: 'ctl00$cM$rcbGameType',
    ctl00_cM_rcb_repeat: 'ctl00$cM$rcb_repeat'
  }[domId];
  formValues[name] = item.text;
  formValues[`${domId}_ClientState`] = comboState(item, { mode: options.stateMode || 'light' });
  if (domId === 'ctl00_cM_rcbVenues') {
    formValues['ctl00$cM$hfVen'] = item.value;
  }
  return item;
}

async function createPractice(jar, request) {
  assertNotPastCreate(request);
  const beforeEvents = await collectMatchingEvents(jar, request);
  const { browser, page } = await createViaShell(request, 'practice');
  try {
    let { created } = await waitForCreatedEvent(jar, request, beforeEvents, { timeoutMs: 20000, intervalMs: 2000 });
    if (!created) {
      ({ created } = await waitForCreatedEventOnPage(page, request, beforeEvents, { timeoutMs: 12000, intervalMs: 2000 }));
    }
    if (created) {
      return created;
    }

    const modalFrame = page.frames().find((candidate) => candidate.name() === 'rwForm');
    if (modalFrame && await modalHasInsert(modalFrame)) {
      await submitInsertAndClose(modalFrame);
      await page.waitForTimeout(3000);
      ({ created } = await waitForCreatedEvent(jar, request, beforeEvents, { timeoutMs: 20000, intervalMs: 2000 }));
      if (!created) {
        ({ created } = await waitForCreatedEventOnPage(page, request, beforeEvents, { timeoutMs: 12000, intervalMs: 2000 }));
      }
      if (created) {
        return created;
      }
    }

    if (modalFrame && await modalFrame.locator('#ctl00_cC_rwConflicts_C_btn_ignore').isVisible().catch(() => false)) {
      await modalFrame.locator('#ctl00_cC_rwConflicts_C_btn_ignore').click({ force: true });
      await page.waitForTimeout(3000);
      ({ created } = await waitForCreatedEvent(jar, request, beforeEvents, { timeoutMs: 25000, intervalMs: 2500 }));
      if (!created) {
        ({ created } = await waitForCreatedEventOnPage(page, request, beforeEvents, { timeoutMs: 12000, intervalMs: 2000 }));
      }
      if (created) {
        return created;
      }
      await submitInsertAndClose(modalFrame);
      await page.waitForTimeout(3000);
      ({ created } = await waitForCreatedEvent(jar, request, beforeEvents, { timeoutMs: 25000, intervalMs: 2500 }));
      if (!created) {
        ({ created } = await waitForCreatedEventOnPage(page, request, beforeEvents, { timeoutMs: 12000, intervalMs: 2000 }));
      }
      if (created) {
        return;
      }
      saveDebugHtml('practice-conflict-after-ignore.html', await modalFrame.content().catch(() => ''));
      throw new Error('Turtle Club did not save the practice after the conflict acknowledgement step.');
    }

    if (modalFrame) {
      const bodyText = await modalFrame.locator('body').innerText().catch(() => '');
      if (/Problem|Exception|terribly wrong|Nullable object/i.test(bodyText)) {
        saveDebugHtml('practice-create-error.html', await modalFrame.content().catch(() => bodyText));
        throw new Error('Turtle Club rejected the practice creation.');
      }
      saveDebugHtml('practice-create-unsaved.html', await modalFrame.content().catch(() => bodyText));
    }

    throw new Error('Turtle Club did not persist the practice after the create submission.');
  } finally {
    await browser.close();
  }
}

async function createGame(jar, request) {
  assertNotPastCreate(request);
  const beforeEvents = await collectMatchingEvents(jar, request);
  const { browser, page, preparedHtml } = await createViaShell(request, 'game');
  try {
    let { created } = await waitForCreatedEvent(jar, request, beforeEvents, { timeoutMs: 20000, intervalMs: 2000 });
    if (!created) {
      ({ created } = await waitForCreatedEventOnPage(page, request, beforeEvents, { timeoutMs: 12000, intervalMs: 2000 }));
    }
    if (created) {
      return created;
    }

    const modalFrame = page.frames().find((candidate) => candidate.name() === 'rwForm');
    if (modalFrame && await modalHasInsert(modalFrame)) {
      await submitInsertAndClose(modalFrame);
      await page.waitForTimeout(3000);
      ({ created } = await waitForCreatedEvent(jar, request, beforeEvents, { timeoutMs: 20000, intervalMs: 2000 }));
      if (!created) {
        ({ created } = await waitForCreatedEventOnPage(page, request, beforeEvents, { timeoutMs: 12000, intervalMs: 2000 }));
      }
      if (created) {
        return created;
      }
    }

    if (modalFrame && await modalFrame.locator('#ctl00_cC_rwConflicts_C_btn_ignore').isVisible().catch(() => false)) {
      await modalFrame.locator('#ctl00_cC_rwConflicts_C_btn_ignore').click({ force: true });
      await page.waitForTimeout(3000);
      ({ created } = await waitForCreatedEvent(jar, request, beforeEvents, { timeoutMs: 25000, intervalMs: 2500 }));
      if (!created) {
        ({ created } = await waitForCreatedEventOnPage(page, request, beforeEvents, { timeoutMs: 12000, intervalMs: 2000 }));
      }
      if (created) {
        return created;
      }
      await submitInsertAndClose(modalFrame);
      await page.waitForTimeout(3000);
      ({ created } = await waitForCreatedEvent(jar, request, beforeEvents, { timeoutMs: 25000, intervalMs: 2500 }));
      if (!created) {
        ({ created } = await waitForCreatedEventOnPage(page, request, beforeEvents, { timeoutMs: 12000, intervalMs: 2000 }));
      }
      if (created) {
        return;
      }
      saveDebugHtml('game-conflict-after-ignore.html', await modalFrame.content().catch(() => ''));
      if (preparedHtml) {
        const retryResult = await clickInsertAndCloseFromHtml(jar, preparedHtml, request, 'game');
        if (/Problem|Exception|terribly wrong|Nullable object/i.test(retryResult)) {
          saveDebugHtml('game-create-error.html', retryResult);
          throw new Error('Turtle Club rejected the game creation after the conflict acknowledgement step.');
        }
        ({ created } = await waitForCreatedEvent(jar, request, beforeEvents, { timeoutMs: 25000, intervalMs: 2500 }));
        if (!created) {
          ({ created } = await waitForCreatedEventOnPage(page, request, beforeEvents, { timeoutMs: 12000, intervalMs: 2000 }));
        }
        if (created) {
          return created;
        }
      }
      throw new Error('Turtle Club did not persist the game after the conflict acknowledgement step.');
    }

    if (modalFrame) {
      const bodyText = await modalFrame.locator('body').innerText().catch(() => '');
      if (/Problem|Exception|terribly wrong|Nullable object/i.test(bodyText)) {
        saveDebugHtml('game-create-error.html', await modalFrame.content().catch(() => bodyText));
        throw new Error('Turtle Club rejected the game creation.');
      }
      saveDebugHtml('game-create-unsaved.html', await modalFrame.content().catch(() => bodyText));
    }

    if (preparedHtml) {
      const retryResult = await clickInsertAndCloseFromHtml(jar, preparedHtml, request, 'game');
      if (/Problem|Exception|terribly wrong|Nullable object/i.test(retryResult)) {
        saveDebugHtml('game-create-error.html', retryResult);
        throw new Error('Turtle Club rejected the game creation.');
      }
      ({ created } = await waitForCreatedEvent(jar, request, beforeEvents, { timeoutMs: 25000, intervalMs: 2500 }));
      if (!created) {
        ({ created } = await waitForCreatedEventOnPage(page, request, beforeEvents, { timeoutMs: 12000, intervalMs: 2000 }));
      }
      if (created) {
        return created;
      }
    }

    throw new Error('Turtle Club did not persist the game after the create submission.');
  } finally {
    await browser.close();
  }
}

function venueIdForDiamond(diamond) {
  const map = {
    'Turtle Club - Diamond #1': '3',
    'Turtle Club - Diamond #2': '2',
    'Turtle Club - Diamond #3': '5',
    'Turtle Club - Diamond #4': '6',
    'Turtle Club - Diamond #5': '7',
    'Turtle Club - Diamond #6': '8',
    'Turtle Club - Diamond #7': '9',
    'Villanova - Diamond #1': '10',
    'Villanova - Diamond #2': '11',
    'Vollmer #1': '75',
    'Vollmer #2': '76',
    'Vollmer #3': '56',
    'Vollmer #4': '57',
    'Vollmer #5': '91',
    'Vollmer #6': '92',
    'Vollmer #7': '95',
    'Vollmer #8': '94',
    'River Canard #1': '136',
    'River Canard #2': '137',
    'River Canard #3': '138',
    'River Canard #4': '139'
  };
  const value = map[diamond];
  if (!value) {
    throw new Error(`No Turtle Club venue id is mapped for ${diamond}.`);
  }
  return value;
}

async function updateDiamondStatus(update) {
  const target = statusTargetById(update.targetId);
  if (!target) {
    throw new Error('Unknown diamond status target.');
  }

  const browser = await launchAutomationBrowser();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  try {
    const frame = await openStatusEditorFrame(page);
    const editor = await applyStatusPageUpdate(page, frame, update);
    await saveStatusEditorPage(page, editor, target.id);
    saveDebugHtml(`status-editor-after-save-${target.id}.html`, await editor.frame.content().catch(() => ''));
    return {
      ok: true,
      targetId: target.id,
      label: target.label,
      status: update.status
    };
  } catch (error) {
    saveDebugHtml(`status-editor-error-${target.id}.txt`, error && error.message ? error.message : String(error));
    throw error;
  } finally {
    await browser.close();
  }
}

async function applyApprovedRequest(request) {
  const jar = await login();

  if ((request.action || '').startsWith('Cancel ')) {
    if (/practice/i.test(request.originalType)) {
      await cancelPractice(jar, request);
      return { outcome: 'cancelled' };
    }
    await cancelGame(jar, request);
    return { outcome: 'cancelled' };
  }

  if ((request.action || '').startsWith('Replace ')) {
    if (/practice/i.test(request.originalType)) {
      await cancelPractice(jar, request);
    } else {
      await cancelGame(jar, request, request.newType);
    }

    if (/practice/i.test(request.newType)) {
      const createdEvent = await createPractice(jar, request);
      return { outcome: 'replaced', createdEvent };
    }
    const createdEvent = await createGame(jar, request);
    return { outcome: 'replaced', createdEvent };
  }

  if (/practice/i.test(request.newType)) {
    const createdEvent = await createPractice(jar, request);
    return { outcome: 'created', createdEvent };
  }
  const createdEvent = await createGame(jar, request);
  return { outcome: 'created', createdEvent };
}

module.exports = {
  applyApprovedRequest,
  updateDiamondStatus
};
