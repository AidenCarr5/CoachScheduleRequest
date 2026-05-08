const fs = require('fs');
const path = require('path');
const { generateData, writeDataFile } = require('../site/update-data');

const rootDir = path.join(__dirname, '..');
const dataFile = path.join(rootDir, 'site', 'data.js');

let cachedData = null;
let refreshPromise = null;

function parseBundledData() {
  const text = fs.readFileSync(dataFile, 'utf8').trim();
  const prefix = 'window.TITANS_DATA = ';
  if (!text.startsWith(prefix)) {
    throw new Error('Bundled schedule data is in an unexpected format.');
  }
  const json = text.slice(prefix.length).replace(/;\s*$/, '');
  return JSON.parse(json);
}

async function loadData() {
  if (cachedData) return cachedData;
  cachedData = parseBundledData();
  return cachedData;
}

async function refreshData() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const fresh = await generateData();
    cachedData = fresh;
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
