const fs = require('fs');
const path = require('path');
const { generateData, generateDateData, writeDataFile } = require('../site/update-data');

const rootDir = path.join(__dirname, '..');
const dataFile = process.env.SITE_DATA_PATH
  ? path.resolve(process.env.SITE_DATA_PATH)
  : path.join(rootDir, 'site', 'data.js');
const turtleClubUsername = String(process.env.TURTLE_CLUB_USERNAME || '').trim();
const turtleClubPassword = String(process.env.TURTLE_CLUB_PASSWORD || '').trim();

let cachedData = null;
let refreshPromise = null;
let dateRefreshPromises = new Map();
let freshnessCheckCompleted = false;

function eventIsTournament(event) {
  return String(`${event && event.type || ''} ${event && event.eventKind || ''}`).toLowerCase().includes('tournament');
}

function eventIsHostedTournamentAvailability(event) {
  return String(event && event.source || '').toLowerCase().includes('hosted tournament availability');
}

function eventHasSpecificDiamond(event) {
  const diamond = String(event && event.diamond || '').trim().toLowerCase();
  if (!diamond) return false;
  return !['tournament', 'home diamonds', 'all diamonds', 'all home diamonds'].includes(diamond);
}

function withoutTournamentConflicts(data) {
  if (!data || !Array.isArray(data.conflictEvents)) return data;
  return {
    ...data,
    conflictEvents: data.conflictEvents.filter((event) => {
      if (!eventIsTournament(event)) return true;
      return eventIsHostedTournamentAvailability(event) || eventHasSpecificDiamond(event);
    })
  };
}

function parseBundledData() {
  const text = fs.readFileSync(dataFile, 'utf8').trim();
  const prefix = 'window.TITANS_DATA = ';
  if (!text.startsWith(prefix)) {
    throw new Error('Bundled schedule data is in an unexpected format.');
  }
  const json = text.slice(prefix.length).replace(/;\s*$/, '');
  return withoutTournamentConflicts(JSON.parse(json));
}

function canRefreshFromTurtleClub() {
  return Boolean(turtleClubUsername && turtleClubPassword);
}

function bundledHomeGameMissingUmpireStatus(event) {
  return String(event && event.eventKind || '').toLowerCase() === 'home game'
    && !/cancelled/i.test(String(event && event.type || ''))
    && !(event && event.umpireStatus);
}

function bundledDataNeedsRefresh(data) {
  return Array.isArray(data && data.schedule)
    && data.schedule.some(bundledHomeGameMissingUmpireStatus);
}

async function ensureFreshBundledData() {
  if (freshnessCheckCompleted) return cachedData;
  freshnessCheckCompleted = true;
  if (!cachedData || !canRefreshFromTurtleClub() || !bundledDataNeedsRefresh(cachedData)) {
    return cachedData;
  }

  console.log('[schedule] bundled schedule is missing umpire status data; refreshing now');
  try {
    return await refreshData();
  } catch (error) {
    console.warn(`[schedule] startup umpire refresh failed: ${error.message}`);
    return cachedData;
  }
}

async function loadData() {
  if (!cachedData) {
    cachedData = parseBundledData();
  }
  return ensureFreshBundledData();
}

async function refreshData() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const fresh = await generateData();
    cachedData = withoutTournamentConflicts(fresh);
    freshnessCheckCompleted = true;
    try {
      writeDataFile(cachedData, dataFile);
    } catch (_) {
      // Ignore non-persistent or read-only deployments such as Vercel.
    }
    return fresh;
  })();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

function mergeDateData(baseData, date, dateData) {
  const current = baseData || {};
  return {
    ...current,
    scrapedAt: dateData.scrapedAt || current.scrapedAt,
    sourceSchedule: dateData.sourceSchedule || current.sourceSchedule,
    sourceAvailability: dateData.sourceAvailability || current.sourceAvailability,
    schedule: [
      ...(current.schedule || []).filter((event) => event.date !== date),
      ...(dateData.schedule || [])
    ].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
    conflictEvents: [
      ...(current.conflictEvents || []).filter((event) => event.date !== date),
      ...(dateData.conflictEvents || [])
    ],
    availability: [
      ...(current.availability || []).filter((slot) => slot.date !== date),
      ...(dateData.availability || [])
    ].sort((a, b) => `${a.date} ${a.start} ${a.diamond}`.localeCompare(`${b.date} ${b.start} ${b.diamond}`))
  };
}

async function refreshDateData(date) {
  const dateIso = String(date || '');
  if (!dateIso.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return loadData();
  }
  if (dateRefreshPromises.has(dateIso)) {
    return dateRefreshPromises.get(dateIso);
  }
  const promise = (async () => {
    const baseData = await loadData();
    if (!canRefreshFromTurtleClub() || typeof generateDateData !== 'function') {
      return baseData;
    }
    const partial = await generateDateData(dateIso, baseData.teams || []);
    cachedData = withoutTournamentConflicts(mergeDateData(baseData, dateIso, partial));
    return cachedData;
  })();
  dateRefreshPromises.set(dateIso, promise);
  try {
    return await promise;
  } finally {
    dateRefreshPromises.delete(dateIso);
  }
}

async function dataVersion() {
  const data = await loadData();
  return String(data.scrapedAt || fs.statSync(dataFile).mtimeMs);
}

module.exports = {
  loadData,
  refreshData,
  refreshDateData,
  dataVersion
};
