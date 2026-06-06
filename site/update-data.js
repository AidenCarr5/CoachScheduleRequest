require('../lib/load-env');

const fs = require('fs');
const path = require('path');

const siteConfigPath = process.env.SITE_CONFIG_PATH
  ? path.resolve(process.env.SITE_CONFIG_PATH)
  : path.join(__dirname, 'config.json');
const siteDataPath = process.env.SITE_DATA_PATH
  ? path.resolve(process.env.SITE_DATA_PATH)
  : path.join(__dirname, 'data.js');
const dropdownCatalogPath = path.join(__dirname, '..', 'public', 'turtle-club-dropdowns.json');
const config = JSON.parse(fs.readFileSync(siteConfigPath, 'utf8'));
const dropdownCatalog = fs.existsSync(dropdownCatalogPath)
  ? JSON.parse(fs.readFileSync(dropdownCatalogPath, 'utf8'))
  : { opponents: [], venues: [] };
const seasonYear = config.seasonYear === 'auto' ? new Date().getFullYear() : Number(config.seasonYear);
const baseUrl = 'https://turtleclubbaseball.com';
const loginUrl = `${baseUrl}/Account/Login/?ReturnUrl=%2fCP%2f`;
const turtleClubUsername = process.env.TURTLE_CLUB_USERNAME || '';
const turtleClubPassword = process.env.TURTLE_CLUB_PASSWORD || '';
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const organizationName = config.organizationName || 'Titans';
const teamNamePattern = new RegExp(config.teamNamePattern || '^(\\d+U(?:\\s*T\\d+)?|8U\\/9U)\\s*\\([^)]+\\)$', 'i');
const teamExtractPattern = new RegExp(config.teamExtractPattern || '((?:\\d+U(?:\\s*T\\d+)?|8U\\/9U)\\s*\\([^)]+\\))', 'gi');

function strip(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&bull;|&#8226;|\u2022/gi, ' - ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function monthName(month) {
  return monthNames[month - 1];
}

function monthNumber(name) {
  return monthNames.findIndex((item) => item.toLowerCase() === String(name || '').slice(0, 3).toLowerCase()) + 1;
}

function fullDate(day, month, year) {
  const dayNumber = (String(day || '').match(/\d+/) || [''])[0].padStart(2, '0');
  return `${year}-${String(month).padStart(2, '0')}-${dayNumber}`;
}

function fullDateFromParts(monthNameValue, day, year = seasonYear) {
  const month = monthNumber(monthNameValue);
  if (!month || !day) return '';
  return fullDate(day, month, year);
}

function dateFromDaySectionId(sectionId) {
  const match = String(sectionId || '').match(/^day-([A-Za-z]{3})-(\d{1,2})-(\d{4})$/);
  return match ? fullDateFromParts(match[1], match[2], Number(match[3])) : '';
}

function monthLabelFromDate(date) {
  const match = String(date || '').match(/^(\d{4})-(\d{2})-/);
  if (!match) return '';
  return `${monthName(Number(match[2]))} ${match[1]}`;
}

function eventKind(type) {
  const normalized = String(type || '').toLowerCase();
  if (normalized.includes('shared practice') || normalized.includes('practice')) return 'Practice';
  if (normalized.includes('tryout')) return 'Tryout';
  if (normalized.includes('away')) return 'Away Game';
  if (normalized.includes('home')) return 'Home Game';
  if (normalized.includes('tournament')) return 'Tournament';
  return type || 'Event';
}

function isCancelledMarker(value) {
  return /cancel/i.test(String(value || ''));
}

function normalizeEventType(value) {
  return strip(value).replace(/\bcancelled?\b/gi, '').replace(/\s+/g, ' ').trim();
}

function inferEventType(markup, label, fallback = '') {
  const source = String(markup || '');
  if (/tag\s+shared/i.test(source) && /tag\s+practice/i.test(source)) return 'Shared Practice';
  if (/tag\s+practice/i.test(source) || /pnlPrac/i.test(source)) return 'Practice';
  if (/tag\s+tryout/i.test(source)) return 'Tryout';
  if (/tag\s+home game/i.test(source) || /pnlHome/i.test(source)) return 'Home Game';
  if (/tag\s+away game/i.test(source) || /pnlAway/i.test(source)) return 'Away Game';
  if (/tag\s+tournament/i.test(source) || /pnlTour/i.test(source)) return 'Tournament';
  return normalizeEventType(label) || normalizeEventType(fallback) || 'Event';
}

function withCancellation(baseType, cancelled) {
  const resolvedType = normalizeEventType(baseType) || strip(baseType) || 'Event';
  const baseKind = eventKind(resolvedType);
  return {
    type: cancelled ? `${resolvedType} Cancelled` : resolvedType,
    eventKind: cancelled ? `${baseKind} Cancelled` : baseKind
  };
}

function sourcePriority(event) {
  const source = String(event && event.source || '').toLowerCase();
  if (source.includes('control panel')) return 3;
  if (source.includes('turtle club schedule')) return 2;
  if (source.includes('full calendar')) return 1;
  return 0;
}

function typeSpecificity(type) {
  const normalized = normalizeEventType(type).toLowerCase();
  if (normalized === 'home game' || normalized === 'away game' || normalized === 'shared practice') return 3;
  if (normalized === 'practice' || normalized === 'tournament' || normalized === 'tryout') return 2;
  if (normalized === 'game' || normalized === 'event' || normalized === 'calendar event') return 1;
  return normalized ? 2 : 0;
}

function isCancelledEvent(event) {
  return isCancelledMarker(`${event && event.type || ''} ${event && event.eventKind || ''}`);
}

function dedupeBaseType(event) {
  return normalizeEventType(event && (event.type || event.eventKind) || '');
}

function normalizeDedupeValue(value) {
  return strip(value).toLowerCase();
}

function tournamentGroupId(team, subject) {
  const key = `${team || ''}|${subject || 'Tournament'}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `tournament-${key || 'event'}`;
}

function mergeDuplicateEvents(existing, candidate) {
  const existingCancelled = isCancelledEvent(existing);
  const candidateCancelled = isCancelledEvent(candidate);
  const existingBaseType = dedupeBaseType(existing);
  const candidateBaseType = dedupeBaseType(candidate);

  const mergedType = typeSpecificity(candidateBaseType) > typeSpecificity(existingBaseType)
    ? candidateBaseType
    : existingBaseType;
  const cancelled = existingCancelled || candidateCancelled;
  const finalEvent = withCancellation(mergedType || candidateBaseType || existingBaseType || candidate.type || existing.type || 'Event', cancelled);

  const preferred = (() => {
    if (candidateCancelled !== existingCancelled) return candidateCancelled ? candidate : existing;
    if (typeSpecificity(candidateBaseType) !== typeSpecificity(existingBaseType)) {
      return typeSpecificity(candidateBaseType) > typeSpecificity(existingBaseType) ? candidate : existing;
    }
    return sourcePriority(candidate) > sourcePriority(existing) ? candidate : existing;
  })();

  return {
    ...preferred,
    type: finalEvent.type,
    eventKind: finalEvent.eventKind
  };
}

function isTargetTeam(team) {
  return teamNamePattern.test(strip(team));
}

function teamAge(team) {
  const match = String(team || '').match(/(\d+)U/i);
  return match ? Number(match[1]) : NaN;
}

function teamAges(team) {
  const ages = new Set();
  const value = strip(team);
  for (const match of value.matchAll(/\b(\d{1,2})U\b/gi)) {
    ages.add(Number(match[1]));
  }
  for (const match of value.matchAll(/\bU(\d{1,2})\b/gi)) {
    ages.add(Number(match[1]));
  }
  return [...ages].filter((age) => Number.isFinite(age));
}

function hostedTournamentAges(subject) {
  return teamAges(subject);
}

function isHostedTournament(body, tagList) {
  return /hosted\s*tournament|hostedtournament/i.test(`${body || ''} ${tagList || ''}`);
}

function hostedTournamentTeams(subject, teams) {
  const ages = new Set(hostedTournamentAges(subject));
  if (!ages.size) return [];
  return (teams || []).filter((team) => teamAges(team).some((age) => ages.has(age)));
}

function hasTeamTournamentOnDate(events, team, date) {
  return (events || []).some((event) => {
    return event.date === date
      && strip(event.team).toLowerCase() === strip(team).toLowerCase()
      && /tournament/i.test(`${event.type || ''} ${event.eventKind || ''}`);
  });
}

function hasHostedTeamTournamentOnDate(events, team, date) {
  return (events || []).some((event) => {
    return event.date === date
      && strip(event.team).toLowerCase() === strip(team).toLowerCase()
      && /hosted tournament/i.test(String(event.source || ''));
  });
}

function tournamentScheduleUrlFromHref(href) {
  const match = String(href || '').match(/\/Tournaments\/(\d+)\//i);
  return match ? `${baseUrl}/Tournaments/${match[1]}/Schedule/` : '';
}

async function hostedTournamentAvailabilityConflicts(events, session) {
  const byScheduleUrl = new Map();
  (events || [])
    .filter((event) => /hosted tournament/i.test(String(event.source || '')))
    .filter((event) => event.tournamentScheduleUrl)
    .forEach((event) => {
      if (!byScheduleUrl.has(event.tournamentScheduleUrl)) {
        byScheduleUrl.set(event.tournamentScheduleUrl, event);
      }
    });

  const conflicts = [];
  for (const [scheduleUrl, tournamentEvent] of byScheduleUrl.entries()) {
    try {
      const html = session
        ? await (await fetchWithSession(scheduleUrl, session)).text()
        : await fetchText(scheduleUrl);
      conflicts.push(...parseHostedTournamentScheduleConflicts(html, tournamentEvent));
      for (const dayUrl of hostedTournamentSchedulePageUrls(html)) {
        if (dayUrl === scheduleUrl) continue;
        const dayHtml = session
          ? await (await fetchWithSession(dayUrl, session)).text()
          : await fetchText(dayUrl);
        conflicts.push(...parseHostedTournamentScheduleConflicts(dayHtml, tournamentEvent));
      }
    } catch (error) {
      console.warn(`Skipped hosted tournament availability for ${tournamentEvent.opponent}: ${error.message}`);
    }
  }
  return conflicts;
}

function hostedTournamentSchedulePageUrls(html) {
  return [...new Set([...String(html || '').matchAll(/href="([^"]*\/Tournaments\/\d+\/Schedule\/\?[^"]+)"/gi)]
    .map((match) => match[1].replace(/&amp;/g, '&'))
    .map((href) => {
      try {
        return new URL(href, baseUrl).toString();
      } catch (_) {
        return '';
      }
    })
    .filter(Boolean))];
}

function parseHostedTournamentScheduleConflicts(html, tournamentEvent) {
  return eventListItemsFromHtml(html).map((body, index) => {
    const dateMatch = body.match(/[?&](?:amp;)?Day=(\d+)&(?:amp;)?Month=(\d+)&(?:amp;)?Year=(\d+)/i);
    const time = strip((body.match(/<div class="time-primary">([\s\S]*?)<\/div>/) || [])[1] || '');
    const diamond = strip((body.match(/<div class="location local">([\s\S]*?)<\/div>/) || [])[1] || '');
    if (!dateMatch || !time || !diamond) return null;

    const gameId = (body.match(/\/Games\/(\d+)\//i) || [])[1] || `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}-${index}`;
    const division = strip((body.match(/<div class="subject-group[^"]*">([\s\S]*?)<\/div>/) || [])[1] || '');
    const gameNo = strip((body.match(/<span class="game_no">([\s\S]*?)<\/span>/) || [])[1] || '');
    const date = `${dateMatch[3]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[1]).padStart(2, '0')}`;
    const opponent = [tournamentEvent.opponent || 'Hosted Tournament', division, gameNo].filter(Boolean).join(' - ');

    return {
      id: `tc-hosted-tournament-availability-${gameId}`,
      tournamentGroupId: tournamentEvent.tournamentGroupId || tournamentGroupId('Hosted Tournament', tournamentEvent.opponent),
      date,
      month: monthLabelFromDate(date),
      time,
      endTime: '',
      durationMinutes: 120,
      type: tournamentEvent.type || 'Hosted Tournament',
      eventKind: tournamentEvent.eventKind || 'Tournament',
      team: 'Turtle Club',
      opponent,
      diamond,
      status: tournamentEvent.status || 'Scheduled',
      source: 'Turtle Club hosted tournament availability'
    };
  }).filter(Boolean);
}

function isHomeGame(event) {
  return String(event && event.eventKind || '').toLowerCase() === 'home game'
    && !/cancelled/i.test(String(event && event.type || ''));
}

function autoConfirmUmpires(event) {
  const age = teamAge(event && event.team);
  return Number.isFinite(age) && age >= 14;
}

function extractTargetTeams(text) {
  const matches = [...strip(text).matchAll(teamExtractPattern)].map((match) => match[1].trim());
  return [...new Set(matches.filter(Boolean))];
}

function targetTeamFromOwner(owner) {
  const normalized = strip(owner);
  const escapedOrganization = organizationName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = normalized.match(new RegExp(`^${escapedOrganization}\\s*(?:-|\\u2022|\\.)\\s*(.+)$`, 'i'));
  return match ? match[1].trim() : '';
}

function eventListItemsFromHtml(html) {
  return String(html || '')
    .split('<div class="event-list-item')
    .slice(1)
    .map((chunk) => `<div class="event-list-item${chunk.split('<div class="event-list-item')[0]}`);
}

function configuredMonths() {
  return [...new Set([
    ...(config.scheduleMonths || []),
    ...(config.practiceMonths || [])
  ].map(Number).filter(Boolean))].sort((a, b) => a - b);
}

function localCalendarMonths(availability = []) {
  const availabilityMonths = availability
    .map((slot) => Number(String(slot.date || '').slice(5, 7)))
    .filter(Boolean);
  return [...new Set([...(configuredMonths() || []), ...availabilityMonths])].sort((a, b) => a - b);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    }
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.text();
}

function parseHiddenInput(html, name) {
  const match = html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`, 'i'));
  return match ? match[1] : '';
}

function storeCookies(session, response) {
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
  for (const cookie of setCookies) {
    const pair = String(cookie).split(';')[0];
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    session.cookies.set(name, value);
  }
}

function sessionCookieHeader(session) {
  return [...session.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function fetchWithSession(url, session, options = {}) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    ...(options.headers || {})
  };
  const cookieHeader = sessionCookieHeader(session);
  if (cookieHeader) headers.Cookie = cookieHeader;

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body,
    redirect: options.redirect || 'follow'
  });
  storeCookies(session, response);
  return response;
}

async function createAuthenticatedSession() {
  if (!turtleClubUsername || !turtleClubPassword) return null;

  const session = { cookies: new Map() };
  const loginPage = await fetchWithSession(loginUrl, session);
  if (!loginPage.ok) {
    console.warn(`Unable to open Turtle Club login page: ${loginPage.status}`);
    return null;
  }

  const html = await loginPage.text();
  const body = new URLSearchParams({
    __VIEWSTATE: parseHiddenInput(html, '__VIEWSTATE'),
    __VIEWSTATEGENERATOR: parseHiddenInput(html, '__VIEWSTATEGENERATOR'),
    __EVENTVALIDATION: parseHiddenInput(html, '__EVENTVALIDATION'),
    'ctl00$cMain$ctl39$lMain$UserName': turtleClubUsername,
    'ctl00$cMain$ctl39$lMain$Password': turtleClubPassword,
    'ctl00$cMain$ctl39$lMain$LoginButton': 'Log In'
  });

  const loginResponse = await fetchWithSession(loginUrl, session, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'manual'
  });

  const location = loginResponse.headers.get('location');
  if (location) {
    await fetchWithSession(new URL(location, baseUrl).toString(), session);
  }

  const controlPanel = await fetchWithSession(`${baseUrl}/cp/`, session);
  const controlPanelHtml = await controlPanel.text();
  if (/Login Page|Forgot Password/i.test(controlPanelHtml)) {
    console.warn('Turtle Club credentials were provided, but the authenticated schedule session could not be established.');
    return null;
  }

  return session;
}

function splitTimeRange(value) {
  const clean = strip(value);
  const match = clean.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM))(?:\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM)))?$/i);
  if (!match) return { start: clean, end: '' };
  return { start: match[1], end: match[2] || '' };
}

function minutesFromDisplay(value) {
  const match = String(value || '').trim().match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return NaN;
  let hours = Number(match[1]) % 12;
  const mins = Number(match[2]);
  if (match[3].toUpperCase() === 'PM') hours += 12;
  return hours * 60 + mins;
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

function parseCpDateLabel(label) {
  const match = strip(label).match(/([A-Za-z]{3})\s+(\d{1,2})/);
  if (!match) return '';
  return `${seasonYear}-${String(monthNumber(match[1])).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
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

function parseCpEventBlock(block, date) {
  const className = (block.match(/<div class="([^"]*\bpnl[^"]*)"/i) || [])[1] || '';
  const eventId = (block.match(/multischedule_edit\((\d+),'[^']+'\)/) || block.match(/(?:del|cmd)_[A-Za-z]+_(\d+)/) || [])[1] || '';
  const teams = [...block.matchAll(/<div class="team">([\s\S]*?)<\/div>/gi)].map((match) => strip(match[1])).filter(Boolean);
  const organization = teams[0] || '';
  const rawTeam = teams[teams.length - 1] || organization || 'Turtle Club';
  const timeText = strip((block.match(/<div class="time">([\s\S]*?)<\/div>/i) || [])[1] || '');
  const venue = strip((block.match(/<div class="venue[^"]*">([\s\S]*?)<\/div>/i) || [])[1] || '');
  const subject = strip((block.match(/<div class="subject">([\s\S]*?)<\/div>/i) || [])[1] || '');
  const opponent = strip((block.match(/<div class="opponent">([\s\S]*?)<\/div>/i) || [])[1] || '');
  if (!timeText || !venue) return null;

  const teamLabel = organization && organization !== organizationName ? `${organization} - ${rawTeam}` : rawTeam;
  const timeRange = splitTimeRange(timeText);
  const type = inferEventType(block, subject, 'Practice');
  const cancelled = isCancelledMarker(className) || isCancelledMarker(subject) || isCancelledMarker(opponent);
  const finalEvent = withCancellation(type, cancelled);
  const titansTeams = organization === organizationName
    ? (extractTargetTeams(rawTeam).length ? extractTargetTeams(rawTeam) : (isTargetTeam(rawTeam) ? [rawTeam] : []))
    : [];

  return {
    id: eventId ? `tc-cp-${eventId}` : `tc-cp-${date}-${teamLabel}-${venue}-${timeText}`,
    cpGameId: eventId || '',
    date,
    month: monthLabelFromDate(date),
    time: timeRange.start,
    endTime: timeRange.end,
    durationMinutes: timeRange.end ? null : 120,
    type: finalEvent.type,
    eventKind: finalEvent.eventKind,
    team: teamLabel,
    opponent: opponent || subject || type,
    diamond: venue,
    status: 'Scheduled',
    source: 'Turtle Club Control Panel',
    titansTeams
  };
}

function cpGameIdFromEvent(event) {
  if (event && event.cpGameId) return String(event.cpGameId);
  const match = String(event && event.id || '').match(/^tc-cp-(\d+)$/);
  return match ? match[1] : '';
}

function parseCpCalendar(html, allowedMonths) {
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
        const date = parseCpDateLabel(cell.content);
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
      if (date && allowedMonths.has(Number(date.slice(5, 7)))) {
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

function parseCpAvailability(html, allowedMonths) {
  const sectionMatch = html.match(/<h4>Open Field Bookings<\/h4><div class="list"><ul class="availabilities">([\s\S]*?)<\/ul><\/div>/i);
  if (!sectionMatch) return [];

  const availability = [];
  const items = [...sectionMatch[1].matchAll(/<li class="boxed">([\s\S]*?)<\/li>/gi)];
  for (const item of items) {
    const venue = strip((item[1].match(/<div class="venue">([\s\S]*?)<\/div>/i) || [])[1] || '');
    if (!venue) continue;
    const openings = [...item[1].matchAll(/<div class="opening[^"]*">([\s\S]*?)<\/div>/gi)];
    for (const opening of openings) {
      const text = strip((opening[1].match(/<\/span>([\s\S]*)$/i) || [])[1] || '');
      const match = text.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))-(\d{1,2}:\d{2}\s*(?:AM|PM))$/i);
      if (!match) continue;
      const month = monthNumber(match[1]);
      if (!allowedMonths.has(month)) continue;
      availability.push({
        diamond: venue,
        date: `${seasonYear}-${String(month).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`,
        start: match[3],
        end: match[4],
        mins: minutesFromDisplay(match[4]) - minutesFromDisplay(match[3]),
        source: 'Turtle Club Control Panel'
      });
    }
  }

  return availability;
}

function dedupe(events) {
  const byKey = new Map();
  for (const event of events) {
    const key = [
      event.date,
      event.time,
      event.endTime,
      normalizeDedupeValue(event.team),
      dedupeBaseType(event),
      normalizeDedupeValue(event.diamond),
      normalizeDedupeValue(event.opponent)
    ].join('|');
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeDuplicateEvents(existing, event) : event);
  }
  return [...byKey.values()];
}

function dedupeAvailability(availability) {
  const seen = new Set();
  return availability.filter((slot) => {
    const key = `${slot.date}|${slot.diamond}|${slot.start}|${slot.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeOpponentOption(value) {
  return String(value || '')
    .replace(/^@+\s*/, '')
    .replace(/^vs\.?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const turtleClubOpponentCatalog = Array.isArray(dropdownCatalog.opponents) ? dropdownCatalog.opponents : [];

function normalizedSearchKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isOpponentOption(value) {
  const clean = normalizeOpponentOption(value);
  if (!clean) return false;
  return !/^(select an opponent|practice|tryout|field booking|event|home game|away game|tournament|regular season|local game|playoff round|intrasquad|global note)$/i.test(clean);
}

function buildOpponentOptions(schedule, conflictEvents, teams) {
  const titansTeams = new Set((teams || []).map((team) => normalizedSearchKey(normalizeOpponentOption(team))).filter(Boolean));
  const choiceMap = new Map();

  function maybeAddOpponent(value) {
    const clean = normalizeOpponentOption(value);
    const key = normalizedSearchKey(clean);
    if (!key || titansTeams.has(key) || !isOpponentOption(clean)) return;
    if (!choiceMap.has(key)) {
      choiceMap.set(key, clean);
    }
  }

  turtleClubOpponentCatalog.forEach(maybeAddOpponent);
  if (!choiceMap.size) {
    [...(schedule || []), ...(conflictEvents || [])].forEach((event) => {
      const isGame = /game/i.test(String(event.eventKind || event.type || ''));
      if (!isGame) return;
      maybeAddOpponent(event.opponent);
      maybeAddOpponent(event.team);
    });
  }

  return [...choiceMap.values()].sort((a, b) => a.localeCompare(b));
}

function cpScheduleUrl() {
  return `${baseUrl}/CP/Content/Scheduling/Schedule.aspx?ParentID=${config.teamCategoryId}`;
}

async function fetchCpScheduleHtml(session, viewDate) {
  session.cookies.set('Scheduling_ViewDate', `${viewDate.getDate()}/${viewDate.getMonth() + 1}/${viewDate.getFullYear()}`);
  const response = await fetchWithSession(cpScheduleUrl(), session);
  if (!response.ok) throw new Error(`Failed to fetch authenticated schedule page: ${response.status}`);
  const html = await response.text();
  if (/Login Page|Forgot Password|Human Verification/i.test(html)) {
    throw new Error('Authenticated Turtle Club schedule request did not return the scheduling page.');
  }
  return html;
}

async function fetchOfficialsDailyHtml(session, date) {
  const [year, month, day] = String(date || '').split('-').map(Number);
  const queryDate = `${month}/${day}/${year}`;
  session.cookies.set('GameOfficials_ViewDate', `${day}/${month}/${year}`);
  const url = `${baseUrl}/CP/Content/Officials/Daily.aspx?gt=Assignable%20Games&d=${encodeURIComponent(queryDate)}&t=&p=&v=`;
  const response = await fetchWithSession(url, session);
  if (!response.ok) throw new Error(`Failed to fetch officials daily page: ${response.status}`);
  const html = await response.text();
  if (/Login Page|Forgot Password|Human Verification/i.test(html)) {
    throw new Error('Authenticated Turtle Club officials request did not return the daily page.');
  }
  return html;
}

function parseOfficialsAssignments(html) {
  const assignmentsByGameId = new Map();
  const rowPattern = /<tr id="multischedule_(\d+)"[\s\S]*?<\/tr>\s*<tr class="assignments">([\s\S]*?)<\/tr>/gi;
  let match = rowPattern.exec(html);

  while (match) {
    const gameId = match[1];
    const assignmentHtml = match[2];
    const assignmentInfo = {
      umpire1Confirmed: false,
      umpire2Confirmed: false,
      umpire1Name: '',
      umpire2Name: ''
    };

    const officialPattern = /<span class="gameOfficial\s+([^"]+)"[\s\S]*?<span[^>]*>([^<]+)<\/span>\s*\(([^)]+)\)/gi;
    let officialMatch = officialPattern.exec(assignmentHtml);
    while (officialMatch) {
      const classTokens = String(officialMatch[1] || '')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      const name = strip(officialMatch[2]);
      const position = strip(officialMatch[3]).toLowerCase();
      if (classTokens.includes('confirmed')) {
        if (position.includes('home plate') && !assignmentInfo.umpire1Confirmed) {
          assignmentInfo.umpire1Confirmed = true;
          assignmentInfo.umpire1Name = name;
        }
        if (position.includes('bases') && !assignmentInfo.umpire2Confirmed) {
          assignmentInfo.umpire2Confirmed = true;
          assignmentInfo.umpire2Name = name;
        }
      }
      officialMatch = officialPattern.exec(assignmentHtml);
    }

    assignmentsByGameId.set(gameId, assignmentInfo);
    match = rowPattern.exec(html);
  }

  return assignmentsByGameId;
}

function attachUmpireStatus(event, status) {
  return {
    ...event,
    umpireStatus: {
      source: status.source,
      autoConfirmed: Boolean(status.autoConfirmed),
      umpire1Confirmed: Boolean(status.umpire1Confirmed),
      umpire2Confirmed: Boolean(status.umpire2Confirmed),
      umpire1Name: status.umpire1Name || '',
      umpire2Name: status.umpire2Name || ''
    }
  };
}

async function enrichScheduleWithUmpires(schedule, session, assignmentsByDate = new Map()) {
  if (!Array.isArray(schedule) || !schedule.length) return schedule;

  const enriched = schedule.map((event) => {
    if (!isHomeGame(event)) return event;
    if (autoConfirmUmpires(event)) {
      return attachUmpireStatus(event, {
        source: 'auto-age',
        autoConfirmed: true,
        umpire1Confirmed: true,
        umpire2Confirmed: true
      });
    }
    return event;
  });

  if (!session) {
    return enriched.map((event) => {
      if (!isHomeGame(event) || event.umpireStatus) return event;
      return attachUmpireStatus(event, {
        source: 'unavailable',
        umpire1Confirmed: false,
        umpire2Confirmed: false
      });
    });
  }

  const targetDates = [...new Set(
    enriched
      .filter((event) => isHomeGame(event) && !event.umpireStatus && cpGameIdFromEvent(event))
      .map((event) => event.date)
  )].sort();

  for (const date of targetDates) {
    if (assignmentsByDate.has(date)) continue;
    try {
      const html = await fetchOfficialsDailyHtml(session, date);
      assignmentsByDate.set(date, parseOfficialsAssignments(html));
    } catch (error) {
      console.warn(`Skipping officials daily sync for ${date}: ${error.message}`);
      assignmentsByDate.set(date, new Map());
    }
  }

  return enriched.map((event) => {
    if (!isHomeGame(event) || event.umpireStatus) return event;
    const gameId = cpGameIdFromEvent(event);
    const dayAssignments = assignmentsByDate.get(event.date) || new Map();
    const assignment = gameId ? dayAssignments.get(gameId) : null;
    return attachUmpireStatus(event, {
      source: assignment ? 'officials-daily' : 'officials-daily-missing',
      umpire1Confirmed: assignment ? assignment.umpire1Confirmed : false,
      umpire2Confirmed: assignment ? assignment.umpire2Confirmed : false,
      umpire1Name: assignment ? assignment.umpire1Name : '',
      umpire2Name: assignment ? assignment.umpire2Name : ''
    });
  });
}

async function loadCpSchedule(schedule, conflictEvents, availability, session) {
  const months = configuredMonths();
  if (!months.length) return false;

  const allowedMonths = new Set(months);
  const startDate = new Date(seasonYear, months[0] - 1, 1);
  const endDate = new Date(seasonYear, months[months.length - 1], 0);
  const cursor = new Date(startDate);

  while (cursor <= endDate) {
    const html = await fetchCpScheduleHtml(session, cursor);
    const cpEvents = parseCpCalendar(html, allowedMonths);
    cpEvents.forEach((event) => {
      const conflictEvent = { ...event };
      delete conflictEvent.titansTeams;
      conflictEvents.push(conflictEvent);
      if (event.titansTeams && event.titansTeams.length) {
        event.titansTeams.forEach((team, index) => {
          schedule.push({
            ...conflictEvent,
            id: index === 0 ? conflictEvent.id : `${conflictEvent.id}-${index + 1}`,
            team
          });
        });
      }
    });
    availability.push(...parseCpAvailability(html, allowedMonths));
    cursor.setDate(cursor.getDate() + 7);
  }

  return schedule.length > 0;
}

async function generateDateData(dateIso, knownTeams = []) {
  const date = String(dateIso || '');
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error('A valid date is required for the one-day schedule refresh.');
  }

  const session = await createAuthenticatedSession();
  if (!session) {
    throw new Error('Turtle Club credentials are not configured for a one-day schedule refresh.');
  }

  const targetDate = new Date(`${date}T12:00:00`);
  const month = Number(match[2]);
  const allowedMonths = new Set([month]);
  const html = await fetchCpScheduleHtml(session, targetDate);
  const cpEvents = parseCpCalendar(html, allowedMonths).filter((event) => event.date === date);
  const schedule = [];
  const conflictEvents = [];

  cpEvents.forEach((event) => {
    const conflictEvent = { ...event };
    delete conflictEvent.titansTeams;
    conflictEvents.push(conflictEvent);
    if (event.titansTeams && event.titansTeams.length) {
      event.titansTeams.forEach((team, index) => {
        schedule.push({
          ...conflictEvent,
          id: index === 0 ? conflictEvent.id : `${conflictEvent.id}-${index + 1}`,
          team
        });
      });
    }
  });

  const availability = parseCpAvailability(html, allowedMonths).filter((slot) => slot.date === date);
  const teams = Array.isArray(knownTeams) ? knownTeams.filter(Boolean) : [];
  if (teams.length) {
    try {
      const calendarUrl = `${baseUrl}/Calendar/?Month=${month}&Year=${seasonYear}`;
      const calendarHtml = await (await fetchWithSession(calendarUrl, session)).text();
      if (!/Human Verification/i.test(calendarHtml)) {
        const tournamentEvents = parsePublicCalendarTournaments(calendarHtml, month, teams)
          .filter((event) => event.date === date);
        schedule.push(...tournamentEvents);
        const tournamentConflicts = await hostedTournamentAvailabilityConflicts(tournamentEvents, session);
        conflictEvents.push(...tournamentConflicts.filter((event) => event.date === date));
      }
    } catch (error) {
      console.warn(`Skipped one-day hosted tournament sync for ${date}: ${error.message}`);
    }
  }

  return {
    schedule: await enrichScheduleWithUmpires(dedupe(schedule), session),
    conflictEvents: dedupe(conflictEvents),
    availability: dedupeAvailability(availability),
    scrapedAt: new Date().toISOString(),
    sourceSchedule: cpScheduleUrl(),
    sourceAvailability: cpScheduleUrl()
  };
}

async function loadGames(schedule, conflictEvents) {
  for (const month of config.scheduleMonths) {
    const url = `${baseUrl}/Categories/${config.teamCategoryId}/Schedule/?Month=${month}&Year=${seasonYear}`;
    const html = await fetchText(url);
    const items = eventListItemsFromHtml(html);
    let index = 0;
    for (const body of items) {
      const day = (body.match(/<div class="day_of_month">([^<]+)/) || [])[1] || '';
      const time = (body.match(/<div class="time-primary">[\s\S]*?<\/div>([^<]+)/) || [])[1] || '';
      const type = strip((body.match(/<div class="tag [^"]+">([\s\S]*?)<\/div>/) || [])[1] || '');
      const team = strip((body.match(/<div class="subject-owner[^>]*">([\s\S]*?)<\/div>/) || [])[1] || '');
      const opponent = strip((body.match(/<div class="subject-text">([\s\S]*?)<\/div>/) || [])[1] || '');
      const diamond = strip((body.match(/<div class="location local">([\s\S]*?)<\/div>/) || [])[1] || '');
      if (team && diamond && isTargetTeam(team)) {
        const cancelled = isCancelledMarker(body) || isCancelledMarker(type) || isCancelledMarker(opponent);
        const finalType = inferEventType(body, type, opponent || 'Game');
        const finalEvent = withCancellation(finalType, cancelled);
        const event = {
          id: `tc-game-${month}-${++index}`,
          date: fullDate(day, month, seasonYear),
          month: `${monthName(month)} ${seasonYear}`,
          time: strip(time),
          endTime: '',
          durationMinutes: 120,
          type: finalEvent.type,
          eventKind: finalEvent.eventKind,
          team,
          opponent,
          diamond,
          status: 'Scheduled',
          source: 'Turtle Club schedule'
        };
        schedule.push(event);
        conflictEvents.push(event);
      }
    }
  }
}

function parsePublicCalendarTournaments(html, month, teams) {
  const teamSet = new Set(teams || []);
  const daySections = String(html || '').split(/<div class="day-details[^"]*" id="([^"]+)"/i).slice(1);
  const events = [];
  for (let index = 0; index < daySections.length; index += 2) {
    const sectionId = daySections[index];
    const sectionHtml = daySections[index + 1] || '';
    const date = dateFromDaySectionId(sectionId);
    if (!date || Number(date.slice(5, 7)) !== Number(month)) continue;

    eventListItemsFromHtml(sectionHtml).forEach((body, itemIndex) => {
      const tagList = strip((body.match(/<div class="tag-list">([\s\S]*?)<\/div>\s*<\/div>/) || [])[1] || '');
      const finalType = inferEventType(body, tagList, 'Calendar Event');
      if (!/tournament/i.test(`${tagList} ${finalType}`)) return;

      const owner = strip((body.match(/<div class="subject-owner[^>]*">([\s\S]*?)<\/div>/) || [])[1] || '');
      const timeText = strip((body.match(/<div class="time-primary">([\s\S]*?)<\/div>/) || [])[1] || '');
      const subject = strip((body.match(/<div class="subject-text[^>]*">([\s\S]*?)<\/div>/) || [])[1] || '');
      const diamond = strip((body.match(/<div class="location[^"]*">([\s\S]*?)<\/div>/) || [])[1] || '');
      const tournamentHref = (body.match(/href="([^"]*\/Tournaments\/\d+\/[^"]*)"/i) || [])[1] || '';
      const cancelled = isCancelledMarker(body) || isCancelledMarker(tagList) || isCancelledMarker(subject);
      const finalEvent = withCancellation(finalType, cancelled);

      const team = targetTeamFromOwner(owner);
      const hosted = !team && isHostedTournament(body, tagList);
      const eventTeams = team && teamSet.has(team)
        ? [team]
        : (hosted ? hostedTournamentTeams(subject, teams) : []);
      if (!eventTeams.length) return;

      eventTeams.forEach((eventTeam) => {
        if (hosted && hasTeamTournamentOnDate(events, eventTeam, date)) return;
        if (!hosted && hasHostedTeamTournamentOnDate(events, eventTeam, date)) return;
        events.push({
          id: `tc-calendar-tournament-${date}-${eventTeam}-${subject || timeText || itemIndex}`,
          tournamentGroupId: tournamentGroupId(eventTeam, subject || timeText || itemIndex),
          date,
          month: monthLabelFromDate(date),
          time: timeText || 'All Day',
          endTime: '',
          durationMinutes: null,
          type: finalEvent.type,
          eventKind: finalEvent.eventKind,
          team: eventTeam,
          opponent: subject || 'Tournament',
          diamond: diamond || (hosted ? 'Home Diamonds' : 'Tournament'),
          status: 'Scheduled',
          source: hosted ? 'Turtle Club hosted tournament' : 'Turtle Club full calendar',
          tournamentScheduleUrl: hosted ? tournamentScheduleUrlFromHref(tournamentHref) : ''
        });
      });
    });
  }
  return events;
}

async function loadFullCalendar(schedule, conflictEvents, teams, availability, session, options = {}) {
  const months = localCalendarMonths(availability);
  for (const month of months) {
    const url = `${baseUrl}/Calendar/?Month=${month}&Year=${seasonYear}`;
    const html = session
      ? await (await fetchWithSession(url, session)).text()
      : await fetchText(url);
    if (/Human Verification/i.test(html)) {
      console.warn(`Skipped full calendar for ${monthName(month)} ${seasonYear}: human verification page returned.`);
      continue;
    }
    const tournamentEvents = parsePublicCalendarTournaments(html, month, teams);
    schedule.push(...tournamentEvents);
    conflictEvents.push(...await hostedTournamentAvailabilityConflicts(tournamentEvents, session));

    if (options.tournamentsOnly) continue;

    const items = eventListItemsFromHtml(html);
    let index = 0;
    for (const body of items) {
      const href = body.match(/href="[^"]*\?Day=(\d+)&(?:amp;)?Month=(\d+)&(?:amp;)?Year=(\d+)/);
      if (!href) continue;
      const monthValue = Number(href[2]);
      if (!months.includes(monthValue)) continue;

      const time = strip((body.match(/<div class="time-primary">([\s\S]*?)<\/div>/) || [])[1] || '');
      const endTime = strip((body.match(/<div class="time-secondary">([\s\S]*?)<\/div>/) || [])[1] || '').replace(/^-/, '');
      const diamond = strip((body.match(/<div class="location local">([\s\S]*?)<\/div>/) || [])[1] || '');
      if (!time.match(/\d+:\d+\s*(AM|PM)/i) || !diamond) continue;

      const owner = strip((body.match(/<div class="subject-owner[^>]*">([\s\S]*?)<\/div>/) || [])[1] || '');
      const group = strip((body.match(/<div class="subject-group[^>]*">([\s\S]*?)<\/div>/) || [])[1] || '');
      const subject = strip((body.match(/<div class="subject-text[^>]*">([\s\S]*?)<\/div>/) || [])[1] || '');
      const tagList = strip((body.match(/<div class="tag-list">([\s\S]*?)<\/div>\s*<\/div>/) || [])[1] || '');
      const team = targetTeamFromOwner(owner);
      const cancelled = isCancelledMarker(body) || isCancelledMarker(tagList) || isCancelledMarker(subject);
      const finalType = inferEventType(body, tagList, subject || 'Calendar Event');
      const finalEvent = withCancellation(finalType, cancelled);
      const event = {
        id: `tc-calendar-${month}-${++index}`,
        date: `${href[3]}-${href[2].padStart(2, '0')}-${href[1].padStart(2, '0')}`,
        month: `${monthName(monthValue)} ${href[3]}`,
        time,
        endTime,
        durationMinutes: time && endTime ? null : 120,
        type: finalEvent.type,
        eventKind: finalEvent.eventKind,
        team: team || owner || group || 'Turtle Club',
        opponent: subject || tagList || 'Field booking',
        diamond,
        status: 'Scheduled',
        source: 'Turtle Club full calendar'
      };
      conflictEvents.push(event);
      if (team && teams.includes(team)) {
        schedule.push(event);
      }
    }
  }
}

async function loadAvailability() {
  const url = `${baseUrl}/Availabilities/${config.availabilityId}/`;
  const html = await fetchText(url);
  const section = html.match(/<div class="editable-content[\s\S]*?<em>Please contact your scheduler[\s\S]*?<\/div>/)?.[0] || html;
  const blocks = section.split(/<div class="M">/).slice(1);
  const availability = [];
  for (const block of blocks) {
    const diamond = strip(block.split('</div>')[0]);
    const rows = [...block.matchAll(/<tr><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td>/g)];
    for (const row of rows) {
      const [, date, start, end, mins] = row;
      const match = date.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d+)/);
      if (!match) continue;
      const month = monthNumber(match[1]);
      availability.push({
        diamond,
        date: `${seasonYear}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`,
        start,
        end,
        mins: Number(mins),
        source: 'Turtle Club availability'
      });
    }
  }
  return availability;
}

async function generateData() {
  const schedule = [];
  const conflictEvents = [];
  const availability = [];
  const session = await createAuthenticatedSession();
  let usedControlPanel = false;

  if (session) {
    try {
      usedControlPanel = await loadCpSchedule(schedule, conflictEvents, availability, session);
      const teams = [...new Set(schedule.map((event) => event.team))].sort();
      if (teams.length) {
        await loadFullCalendar(schedule, conflictEvents, teams, availability, session, { tournamentsOnly: true });
      }
    } catch (error) {
      console.warn(`Falling back to public Turtle Club pages: ${error.message}`);
    }
  }

  if (!usedControlPanel) {
    await loadGames(schedule, conflictEvents);
    const teams = [...new Set(schedule.map((event) => event.team))].sort();
    availability.push(...await loadAvailability());
    await loadFullCalendar(schedule, conflictEvents, teams, availability, session);
  }

  schedule.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const officialsAssignmentsByDate = new Map();
  const dedupedSchedule = await enrichScheduleWithUmpires(dedupe(schedule), session, officialsAssignmentsByDate);
  const dedupedConflicts = await enrichScheduleWithUmpires(dedupe(conflictEvents), session, officialsAssignmentsByDate);
  const dedupedAvailability = dedupeAvailability(availability).sort((a, b) => `${a.date} ${a.start} ${a.diamond}`.localeCompare(`${b.date} ${b.start} ${b.diamond}`));
  const teams = [...new Set(dedupedSchedule.map((event) => event.team))].sort();

  return {
    seasonYear,
    brandName: config.brandName,
    scrapedAt: new Date().toISOString(),
    sourceSchedule: usedControlPanel ? cpScheduleUrl() : `${baseUrl}/Categories/${config.teamCategoryId}/Schedule/`,
    sourceCalendar: usedControlPanel ? cpScheduleUrl() : `${baseUrl}/Calendar/`,
    sourceAvailability: usedControlPanel ? cpScheduleUrl() : `${baseUrl}/Availabilities/${config.availabilityId}/`,
    teams,
    opponentOptions: buildOpponentOptions(dedupedSchedule, dedupedConflicts, teams),
    schedule: dedupedSchedule,
    conflictEvents: dedupedConflicts,
    availability: dedupedAvailability
  };
}

function writeDataFile(data, targetPath = siteDataPath) {
  fs.writeFileSync(targetPath, `window.TITANS_DATA = ${JSON.stringify(data, null, 2)};\n`);
}

async function main() {
  const data = await generateData();
  writeDataFile(data);
  const practices = data.schedule.filter((event) => event.eventKind === 'Practice').length;
  console.log(JSON.stringify({
    seasonYear: data.seasonYear,
    teams: data.teams.length,
    events: data.schedule.length,
    games: data.schedule.length - practices,
    practices,
    conflicts: data.conflictEvents.length,
    availability: data.availability.length
  }, null, 2));
}

module.exports = {
  generateData,
  generateDateData,
  writeDataFile,
  parseCpCalendar
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
