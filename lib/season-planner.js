const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function safeSiteKey(teamLabel) {
  return String(teamLabel || 'site')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'site';
}

function createSeasonPlanner({ rootDir, storageDir, teamLabel }) {
  const storeFile = path.join(storageDir, `${safeSiteKey(teamLabel)}-season-planner.json`);

  function emptyStore() {
    return {
      seasons: [],
      adminAccounts: [],
      adminPrivileges: [],
      updatedAt: ''
    };
  }

  function readStore() {
    if (!fs.existsSync(storeFile)) {
      fs.mkdirSync(path.dirname(storeFile), { recursive: true });
      fs.writeFileSync(storeFile, JSON.stringify(emptyStore(), null, 2));
    }
    try {
      const store = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
      if (!Array.isArray(store.seasons)) store.seasons = [];
      if (!Array.isArray(store.adminAccounts)) store.adminAccounts = [];
      if (!Array.isArray(store.adminPrivileges)) store.adminPrivileges = [];
      return store;
    } catch (_) {
      return emptyStore();
    }
  }

  function writeStore(store) {
    fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    store.updatedAt = new Date().toISOString();
    fs.writeFileSync(storeFile, JSON.stringify(store, null, 2));
    return store;
  }

  function seasonInfo(value) {
    const text = String(value || '').trim();
    const range = text.match(/\b(20\d{2})\D+(20\d{2})\b/);
    if (range) {
      const startYear = Number(range[1]);
      const endYear = Number(range[2]);
      return {
        key: `${startYear}-${endYear}`,
        year: endYear,
        label: `${startYear}-${endYear} Season`
      };
    }
    const single = text.match(/\b(20\d{2})\b/);
    const year = single ? Number(single[1]) : new Date().getFullYear();
    return {
      key: String(year),
      year,
      label: `${year} Season`
    };
  }

  function seasonId(year) {
    const info = seasonInfo(year);
    return `season-${info.key.replace(/[^0-9a-z-]/gi, '-')}`;
  }

  function coachId(team, email) {
    const source = `${team || ''}-${email || ''}-${crypto.randomBytes(3).toString('hex')}`;
    return `coach-${crypto.createHash('sha1').update(source).digest('hex').slice(0, 10)}`;
  }

  function seasonCoachUsername(team) {
    const text = String(team || '').trim();
    const nameMatch = text.match(/\(([^)]+)\)/);
    const name = nameMatch ? nameMatch[1] : text.split(/\s+/).slice(-1)[0] || 'Coach';
    const ageMatch = text.match(/(\d+U(?:\/\d+U)?|U\d+(?:\/U\d+)?|Intermediate)/i);
    const age = ageMatch ? ageMatch[1].replace(/\//g, '').replace(/^U(\d+)/i, '$1U') : '';
    return `${name.replace(/[^a-z0-9]/gi, '')}${age.replace(/[^a-z0-9]/gi, '')}` || `Coach${crypto.randomBytes(2).toString('hex')}`;
  }

  function randomPassword(length = 10) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const bytes = crypto.randomBytes(length);
    return Array.from(bytes).map((byte) => alphabet[byte % alphabet.length]).join('');
  }

  function token() {
    return crypto.randomBytes(24).toString('base64url');
  }

  function ensureSeason(year, label = '') {
    const store = readStore();
    const info = seasonInfo(year);
    const id = seasonId(year);
    let season = store.seasons.find((item) => item.id === id);
    if (!season) {
      season = {
        id,
        year: info.year,
        seasonKey: info.key,
        label: label || info.label,
        status: 'setup',
        coaches: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      store.seasons.unshift(season);
    } else if (label) {
      season.label = label;
      season.updatedAt = new Date().toISOString();
    }
    writeStore(store);
    return season;
  }

  function listSeasons() {
    return readStore().seasons;
  }

  function findSeason(id) {
    return readStore().seasons.find((season) => season.id === id) || null;
  }

  function removeSeason(id) {
    const clean = String(id || '').trim();
    if (!clean) return false;
    const store = readStore();
    const before = store.seasons.length;
    store.seasons = store.seasons.filter((season) => season.id !== clean);
    if (store.seasons.length === before) return false;
    writeStore(store);
    return true;
  }

  function findCoachByToken(rawToken) {
    const clean = String(rawToken || '').trim();
    if (!clean) return null;
    const store = readStore();
    for (const season of store.seasons) {
      const coach = (season.coaches || []).find((item) => item.uploadToken === clean);
      if (coach) return { store, season, coach };
    }
    return null;
  }

  function upsertCoaches(seasonIdValue, coaches) {
    const store = readStore();
    const season = store.seasons.find((item) => item.id === seasonIdValue);
    if (!season) return null;
    const existingById = new Map((season.coaches || []).map((coach) => [coach.id, coach]));
    const next = (Array.isArray(coaches) ? coaches : [])
      .map((coach) => {
        const id = String(coach.id || '').trim();
        const existing = id ? existingById.get(id) : null;
        const team = String(coach.team || existing && existing.team || '').trim();
        const email = String(coach.email || existing && existing.email || '').trim();
        if (!team && !email) return null;
        return {
          id: existing ? existing.id : coachId(team, email),
          team,
          program: String(coach.program || existing && existing.program || teamLabel || '').trim(),
          email,
          username: String(coach.username || existing && existing.username || seasonCoachUsername(team)).trim(),
          password: String(coach.password || existing && existing.password || randomPassword()).trim(),
          uploadToken: existing && existing.uploadToken ? existing.uploadToken : token(),
          uploadSentAt: existing && existing.uploadSentAt || '',
          uploadStatus: existing && existing.uploadStatus || 'not-sent',
          uploadedAt: existing && existing.uploadedAt || '',
          events: Array.isArray(existing && existing.events) ? existing.events : []
        };
      })
      .filter(Boolean);
    season.coaches = next;
    season.updatedAt = new Date().toISOString();
    writeStore(store);
    return season;
  }

  function normalizeDate(value) {
    const text = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function parseMinutes(value) {
    const text = String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
    const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const suffix = match[3] || '';
    if (suffix === 'PM' && hour !== 12) hour += 12;
    if (suffix === 'AM' && hour === 12) hour = 0;
    if (!suffix && hour >= 1 && hour <= 7) hour += 12;
    return hour * 60 + minute;
  }

  function formatTime(value) {
    const minutes = parseMinutes(value);
    if (minutes == null) return String(value || '').trim();
    const hour24 = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const suffix = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 % 12 || 12;
    return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
  }

  function normalizeType(value) {
    const text = String(value || '').trim();
    if (/away/i.test(text)) return 'Away Game';
    if (/home|game/i.test(text)) return 'Home Game';
    if (/practice/i.test(text)) return 'Practice';
    if (/tournament/i.test(text)) return 'Tournament';
    return text || 'Event';
  }

  function normalizeUploadedEvent(raw, coach) {
    const date = normalizeDate(raw.date || raw.Date || raw.day || raw.Day || raw.gameDate || raw['Game Date']);
    const start = formatTime(raw.start || raw.Start || raw.time || raw.Time || raw.startTime || raw['Start Time']);
    const end = formatTime(raw.end || raw.End || raw.finish || raw.Finish || raw.endTime || raw['End Time']);
    const type = normalizeType(raw.type || raw.Type || raw.eventType || raw['Event Type'] || raw.gameType || raw['Game Type']);
    const diamond = String(raw.diamond || raw.Diamond || raw.venue || raw.Venue || raw.location || raw.Location || raw.diamondVenue || raw['Diamond/Venue'] || '').trim();
    const opponent = String(raw.opponent || raw.Opponent || raw.title || raw.Title || raw.description || raw.Description || raw.opponentTitle || raw['Opponent/Title'] || '').trim();
    const startMinutes = parseMinutes(start);
    const endMinutes = parseMinutes(end);
    return {
      id: `staged-${crypto.randomBytes(6).toString('hex')}`,
      source: 'season-upload',
      team: coach.team,
      program: coach.program || teamLabel,
      type,
      eventKind: type,
      date,
      start,
      end,
      time: start,
      startMinutes,
      endMinutes,
      diamond,
      opponent,
      notes: String(raw.notes || raw.Notes || '').trim(),
      valid: Boolean(date && startMinutes != null && (endMinutes == null || endMinutes > startMinutes))
    };
  }

  function teamFromUploadRow(raw) {
    return String(raw.team || raw.Team || raw.coachTeam || raw['Coach Team'] || '').trim();
  }

  function emailFromUploadRow(raw) {
    return String(raw.email || raw.Email || raw.coachEmail || raw['Coach Email'] || '').trim();
  }

  function programFromUploadRow(raw) {
    return String(raw.program || raw.Program || '').trim();
  }

  function saveUpload(rawToken, rawEvents) {
    const found = findCoachByToken(rawToken);
    if (!found) return null;
    const events = (Array.isArray(rawEvents) ? rawEvents : [])
      .map((event) => normalizeUploadedEvent(event, found.coach))
      .filter((event) => event.date && event.startMinutes != null);
    found.coach.events = events;
    found.coach.uploadStatus = 'uploaded';
    found.coach.uploadedAt = new Date().toISOString();
    found.season.updatedAt = found.coach.uploadedAt;
    writeStore(found.store);
    return {
      season: found.season,
      coach: found.coach,
      events
    };
  }

  function saveAdminUpload(seasonIdValue, rawRows) {
    const store = readStore();
    const season = store.seasons.find((item) => item.id === seasonIdValue);
    if (!season) return null;
    const groups = new Map();
    (Array.isArray(rawRows) ? rawRows : []).forEach((row) => {
      const team = teamFromUploadRow(row);
      if (!team) return;
      const key = team.toLowerCase();
      const current = groups.get(key) || {
        team,
        email: '',
        program: '',
        rows: []
      };
      current.email = current.email || emailFromUploadRow(row);
      current.program = current.program || programFromUploadRow(row);
      current.rows.push(row);
      groups.set(key, current);
    });
    const existingByTeam = new Map((season.coaches || []).map((coach) => [String(coach.team || '').toLowerCase(), coach]));
    groups.forEach((group, key) => {
      let coach = existingByTeam.get(key);
      if (!coach) {
        coach = {
          id: coachId(group.team, group.email),
          team: group.team,
          program: group.program || teamLabel,
          email: group.email,
          username: seasonCoachUsername(group.team),
          password: randomPassword(),
          uploadToken: token(),
          uploadSentAt: '',
          uploadStatus: 'not-sent',
          uploadedAt: '',
          events: []
        };
        season.coaches = season.coaches || [];
        season.coaches.push(coach);
        existingByTeam.set(key, coach);
      }
      coach.email = group.email || coach.email || '';
      coach.program = group.program || coach.program || teamLabel;
      coach.events = group.rows
        .map((row) => normalizeUploadedEvent(row, coach))
        .filter((event) => event.date && event.startMinutes != null);
      coach.uploadStatus = coach.events.length ? 'uploaded-admin' : coach.uploadStatus || 'not-sent';
      coach.uploadedAt = coach.events.length ? new Date().toISOString() : coach.uploadedAt || '';
    });
    season.updatedAt = new Date().toISOString();
    writeStore(store);
    return {
      season,
      coachCount: groups.size,
      eventCount: [...groups.values()].reduce((total, group) => {
        const coach = existingByTeam.get(String(group.team || '').toLowerCase());
        return total + (coach && Array.isArray(coach.events) ? coach.events.length : 0);
      }, 0)
    };
  }

  function eventEndMinutes(event) {
    if (Number.isFinite(event.endMinutes)) return event.endMinutes;
    const parsed = parseMinutes(event.end || event.endTime || '');
    if (parsed != null) return parsed;
    const start = eventStartMinutes(event);
    return start == null ? null : start + 120;
  }

  function eventStartMinutes(event) {
    if (Number.isFinite(event.startMinutes)) return event.startMinutes;
    return parseMinutes(event.start || event.time || '');
  }

  function isAwayEvent(event) {
    return /away/i.test(`${event.type || ''} ${event.eventKind || ''}`);
  }

  function comparableDiamond(event) {
    return String(event.diamond || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    if (aStart == null || aEnd == null || bStart == null || bEnd == null) return false;
    return aStart < bEnd && bStart < aEnd;
  }

  function eventConflicts(a, b) {
    if (!a || !b || a.id === b.id) return false;
    if (a.date !== b.date) return false;
    if (isAwayEvent(a) || isAwayEvent(b)) return false;
    const diamondA = comparableDiamond(a);
    const diamondB = comparableDiamond(b);
    if (!diamondA || !diamondB || diamondA !== diamondB) return false;
    return rangesOverlap(eventStartMinutes(a), eventEndMinutes(a), eventStartMinutes(b), eventEndMinutes(b));
  }

  function stagedEventsForSeason(season) {
    return (season.coaches || []).flatMap((coach) => (coach.events || []).map((event) => ({
      ...event,
      coachId: coach.id,
      coachEmail: coach.email
    })));
  }

  function liveEventsForComparison(data) {
    return [...(data.schedule || []), ...(data.conflictEvents || [])].map((event) => ({
      ...event,
      source: event.source || 'Turtle Club'
    }));
  }

  function conflictLabel(event) {
    return `${event.team || ''} ${event.opponent || ''} ${event.type || event.eventKind || ''}`.replace(/\s+/g, ' ').trim();
  }

  function buildConflicts(season, data) {
    const staged = stagedEventsForSeason(season);
    const live = liveEventsForComparison(data);
    const conflicts = [];
    staged.forEach((event, index) => {
      live.forEach((liveEvent) => {
        if (!eventConflicts(event, liveEvent)) return;
        conflicts.push({
          id: `live-${conflicts.length + 1}`,
          severity: 'live',
          date: event.date,
          diamond: event.diamond,
          time: `${event.start}${event.end ? `-${event.end}` : ''}`,
          event: conflictLabel(event),
          conflictsWith: conflictLabel(liveEvent),
          source: liveEvent.source || 'Turtle Club'
        });
      });
      staged.slice(index + 1).forEach((other) => {
        if (!eventConflicts(event, other)) return;
        conflicts.push({
          id: `staged-${conflicts.length + 1}`,
          severity: 'staged',
          date: event.date,
          diamond: event.diamond,
          time: `${event.start}${event.end ? `-${event.end}` : ''}`,
          event: conflictLabel(event),
          conflictsWith: conflictLabel(other),
          source: 'Coach uploads'
        });
      });
    });
    return conflicts.sort((a, b) => `${a.date} ${a.diamond} ${a.time}`.localeCompare(`${b.date} ${b.diamond} ${b.time}`));
  }

  function publicSeason(season, data) {
    const conflicts = data ? buildConflicts(season, data) : [];
    return {
      ...season,
      coaches: (season.coaches || []).map((coach) => ({
        ...coach,
        uploadToken: undefined,
        uploadLink: `/season-upload.html?token=${coach.uploadToken}`,
        eventCount: (coach.events || []).length
      })),
      stagedEventCount: stagedEventsForSeason(season).length,
      conflictCount: conflicts.length,
      conflicts
    };
  }

  function markLinksSent(seasonIdValue, coachIds) {
    const store = readStore();
    const season = store.seasons.find((item) => item.id === seasonIdValue);
    if (!season) return null;
    const wanted = new Set((coachIds || []).map(String));
    const now = new Date().toISOString();
    (season.coaches || []).forEach((coach) => {
      if (wanted.size && !wanted.has(coach.id)) return;
      coach.uploadSentAt = now;
      coach.uploadStatus = coach.uploadStatus === 'uploaded' ? 'uploaded' : 'sent';
    });
    season.updatedAt = now;
    writeStore(store);
    return season;
  }

  function approveSeason(seasonIdValue, approvedBy = '') {
    const store = readStore();
    const season = store.seasons.find((item) => item.id === seasonIdValue);
    if (!season) return null;
    season.status = 'approved';
    season.approvedAt = new Date().toISOString();
    season.approvedBy = String(approvedBy || '').trim();
    season.updatedAt = season.approvedAt;
    writeStore(store);
    return season;
  }

  function adminPrivilegeOverrides() {
    return readStore().adminPrivileges || [];
  }

  function adminAccounts() {
    return readStore().adminAccounts || [];
  }

  function addAdminAccount(account) {
    const username = String(account && account.username || '').trim();
    const password = String(account && account.password || '').trim();
    if (!username || !password) return null;
    const store = readStore();
    const clean = username.toLowerCase();
    const existing = (store.adminAccounts || []).find((item) => String(item.username || '').toLowerCase() === clean);
    const next = {
      username,
      password,
      initials: String(account.initials || username.slice(0, 2).toUpperCase()).trim(),
      email: String(account.email || '').trim(),
      accessLabel: String(account.accessLabel || 'Site Admin').trim(),
      canSwitchSites: account.canSwitchSites !== false,
      canEditCoachEmails: account.canEditCoachEmails === true,
      canManualApprove: account.canManualApprove === true,
      notifyOnCoachRequests: account.notifyOnCoachRequests !== false,
      hideSyncFailures: account.hideSyncFailures === true
    };
    if (existing) {
      Object.assign(existing, next);
    } else {
      store.adminAccounts.push(next);
    }
    writeStore(store);
    return next;
  }

  function removeAdminAccount(username) {
    const clean = String(username || '').trim().toLowerCase();
    if (!clean) return false;
    const store = readStore();
    const before = (store.adminAccounts || []).length;
    store.adminAccounts = (store.adminAccounts || [])
      .filter((item) => String(item.username || '').toLowerCase() !== clean);
    store.adminPrivileges = (store.adminPrivileges || [])
      .filter((item) => String(item.username || '').toLowerCase() !== clean);
    if (store.adminAccounts.length === before) return false;
    writeStore(store);
    return true;
  }

  function saveAdminPrivilegeOverrides(privileges) {
    const store = readStore();
    store.adminPrivileges = (Array.isArray(privileges) ? privileges : [])
      .map((item) => ({
        username: String(item.username || '').trim(),
        canSwitchSites: item.canSwitchSites === true,
        canEditCoachEmails: item.canEditCoachEmails === true,
        canManualApprove: item.canManualApprove === true,
        notifyOnCoachRequests: item.notifyOnCoachRequests === true,
        hideSyncFailures: item.hideSyncFailures === true
      }))
      .filter((item) => item.username);
    writeStore(store);
    return store.adminPrivileges;
  }

  return {
    storeFile,
    readStore,
    writeStore,
    ensureSeason,
    listSeasons,
    findSeason,
    removeSeason,
    findCoachByToken,
    upsertCoaches,
    saveUpload,
    saveAdminUpload,
    publicSeason,
    buildConflicts,
    markLinksSent,
    approveSeason,
    adminPrivilegeOverrides,
    adminAccounts,
    addAdminAccount,
    removeAdminAccount,
    saveAdminPrivilegeOverrides
  };
}

module.exports = {
  createSeasonPlanner
};
