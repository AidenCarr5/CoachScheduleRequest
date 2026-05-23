const fs = require('fs');
const path = require('path');
const { generateData, writeDataFile } = require('../site/update-data');

const rootDir = path.join(__dirname, '..');
const dataFile = process.env.SITE_DATA_PATH
  ? path.resolve(process.env.SITE_DATA_PATH)
  : path.join(rootDir, 'site', 'data.js');
const turtleClubUsername = String(process.env.TURTLE_CLUB_USERNAME || '').trim();
const turtleClubPassword = String(process.env.TURTLE_CLUB_PASSWORD || '').trim();

let cachedData = null;
let refreshPromise = null;
let freshnessCheckCompleted = false;

function parseBundledData() {
  const text = fs.readFileSync(dataFile, 'utf8').trim();
  const prefix = 'window.TITANS_DATA = ';
  if (!text.startsWith(prefix)) {
    throw new Error('Bundled schedule data is in an unexpected format.');
  }
  const json = text.slice(prefix.length).replace(/;\s*$/, '');
  return JSON.parse(json);
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
    cachedData = fresh;
    freshnessCheckCompleted = true;
    try {
      writeDataFile(fresh, dataFile);
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

async function dataVersion() {
  const data = await loadData();
  return String(data.scrapedAt || fs.statSync(dataFile).mtimeMs);
}

module.exports = {
  loadData,
  refreshData,
  dataVersion
};
