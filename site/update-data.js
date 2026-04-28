const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const seasonYear = config.seasonYear === 'auto' ? new Date().getFullYear() : Number(config.seasonYear);
const baseUrl = 'https://turtleclubbaseball.com';

function strip(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&bull;/g, '•')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function monthName(month) {
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1];
}

function fullDate(day, month, year) {
  const dayNumber = (day.match(/\d+/) || [''])[0].padStart(2, '0');
  return `${year}-${String(month).padStart(2, '0')}-${dayNumber}`;
}

function eventKind(type) {
  const normalized = type.toLowerCase();
  if (normalized.includes('practice')) return 'Practice';
  if (normalized.includes('away')) return 'Away Game';
  if (normalized.includes('home')) return 'Home Game';
  return type || 'Event';
}

function isTitansTeam(team) {
  return /^(\d+U|8U\/9U|9U|Titans)/.test(team);
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.text();
}

async function loadGames(schedule, conflictEvents) {
  for (const month of config.scheduleMonths) {
    const url = `${baseUrl}/Categories/${config.teamCategoryId}/Schedule/?Month=${month}&Year=${seasonYear}`;
    const html = await fetchText(url);
    const items = html.split('<div class="event-list-item').slice(1).map((chunk) => `<div class="event-list-item${chunk.split('<div class="event-list-item')[0]}`);
    let index = 0;
    for (const body of items) {
      const day = (body.match(/<div class="day_of_month">([^<]+)/) || [])[1] || '';
      const time = (body.match(/<div class="time-primary">[\s\S]*?<\/div>([^<]+)/) || [])[1] || '';
      const type = strip((body.match(/<div class="tag [^"]+">([\s\S]*?)<\/div>/) || [])[1] || '');
      const team = strip((body.match(/<div class="subject-owner[^>]*">([\s\S]*?)<\/div>/) || [])[1] || '');
      const opponent = strip((body.match(/<div class="subject-text">([\s\S]*?)<\/div>/) || [])[1] || '');
      const diamond = strip((body.match(/<div class="location local">([\s\S]*?)<\/div>/) || [])[1] || '');
      if (team && diamond && isTitansTeam(team)) {
        const event = {
          id: `tc-game-${month}-${++index}`,
          date: fullDate(day, month, seasonYear),
          month: `${monthName(month)} ${seasonYear}`,
          time: time.trim(),
          endTime: '',
          durationMinutes: 120,
          type,
          eventKind: eventKind(type),
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

async function loadPractices(schedule, conflictEvents, teams) {
  for (const month of config.practiceMonths) {
    const url = `${baseUrl}/Calendar/?Month=${month}&Year=${seasonYear}`;
    const html = await fetchText(url);
    if (/Human Verification/i.test(html)) {
      console.warn(`Skipped practices for ${monthName(month)} ${seasonYear}: human verification page returned.`);
      continue;
    }
    const items = html.split('<div class="event-list-item').slice(1).map((chunk) => `<div class="event-list-item${chunk.split('<div class="event-list-item')[0]}`);
    let index = 0;
    for (const body of items) {
      if (!body.includes('tag practice')) continue;
      const owner = strip((body.match(/<div class="subject-owner[^>]*">([\s\S]*?)<\/div>/) || [])[1] || '');
      if (!owner.startsWith('Titans • ')) continue;
      const team = owner.replace('Titans • ', '').trim();
      if (!teams.includes(team)) continue;
      const href = body.match(/href="[^"]*\?Day=(\d+)&(?:amp;)?Month=(\d+)&(?:amp;)?Year=(\d+)/);
      if (!href) continue;
      const monthNumber = Number(href[2]);
      if (!config.practiceMonths.includes(monthNumber)) continue;
      const date = `${href[3]}-${href[2].padStart(2, '0')}-${href[1].padStart(2, '0')}`;
      const time = strip((body.match(/<div class="time-primary">([\s\S]*?)<\/div>/) || [])[1] || '');
      const endTime = strip((body.match(/<div class="time-secondary">([\s\S]*?)<\/div>/) || [])[1] || '').replace(/^-/, '');
      const diamond = strip((body.match(/<div class="location local">([\s\S]*?)<\/div>/) || [])[1] || '');
      const event = {
        id: `tc-practice-${month}-${++index}`,
        date,
        month: `${monthName(monthNumber)} ${href[3]}`,
        time,
        endTime,
        durationMinutes: time && endTime ? null : 90,
        type: 'Practice',
        eventKind: 'Practice',
        team,
        opponent: 'Practice',
        diamond,
        status: 'Scheduled',
        source: 'Turtle Club calendar'
      };
      schedule.push(event);
      conflictEvents.push(event);
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
      const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(match[1]) + 1;
      availability.push({
        diamond,
        date: `${seasonYear}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`,
        start,
        end,
        mins: Number(mins)
      });
    }
  }
  return availability;
}

function dedupe(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = `${event.date}|${event.time}|${event.endTime}|${event.team}|${event.eventKind}|${event.diamond}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  const schedule = [];
  const conflictEvents = [];
  await loadGames(schedule, conflictEvents);
  const teams = [...new Set(schedule.map((event) => event.team))].sort();
  await loadPractices(schedule, conflictEvents, teams);
  const availability = await loadAvailability();

  schedule.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const deduped = dedupe(schedule);
  const data = {
    seasonYear,
    brandName: config.brandName,
    scrapedAt: new Date().toISOString(),
    sourceSchedule: `${baseUrl}/Categories/${config.teamCategoryId}/Schedule/`,
    sourceCalendar: `${baseUrl}/Calendar/`,
    sourceAvailability: `${baseUrl}/Availabilities/${config.availabilityId}/`,
    teams,
    schedule: deduped,
    conflictEvents: deduped,
    availability
  };

  fs.writeFileSync(path.join(__dirname, 'data.js'), `window.TITANS_DATA = ${JSON.stringify(data, null, 2)};\n`);
  const practices = deduped.filter((event) => event.eventKind === 'Practice').length;
  console.log(JSON.stringify({
    seasonYear,
    teams: teams.length,
    events: deduped.length,
    games: deduped.length - practices,
    practices,
    availability: availability.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
