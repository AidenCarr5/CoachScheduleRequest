const fs = require('fs');
const path = require('path');
const tls = require('tls');
const { loadData } = require('./data-store');

const rootDir = path.join(__dirname, '..');
const configPath = process.env.SITE_CONFIG_PATH
  ? path.resolve(process.env.SITE_CONFIG_PATH)
  : path.join(rootDir, 'site', 'config.json');
const config = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
  : {};
const teamLabel = config.teamLabel || 'Titans';
const schedulerLabel = config.serviceName || `${teamLabel} scheduler`;
const statusStoreFile = process.env.STATUS_MONITOR_FILE
  ? path.resolve(process.env.STATUS_MONITOR_FILE)
  : path.join(rootDir, 'storage', 'diamond-status-monitor.json');
const coachAccountsFile = process.env.COACH_ACCOUNTS_FILE
  ? path.resolve(process.env.COACH_ACCOUNTS_FILE)
  : path.join(rootDir, 'storage', 'coach-accounts.json');
const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
const resendApiBase = String(process.env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/+$/, '');
const gmailClientId = String(process.env.GMAIL_CLIENT_ID || '').trim();
const gmailClientSecret = String(process.env.GMAIL_CLIENT_SECRET || '').trim();
const gmailRefreshToken = String(process.env.GMAIL_REFRESH_TOKEN || '').trim();

const smtpHost = process.env.EMAIL_SMTP_HOST || 'smtp.gmail.com';
const smtpPort = Number(process.env.EMAIL_SMTP_PORT || 465);
const smtpUser = process.env.EMAIL_USER || 'titansupdate@gmail.com';
const smtpPassword = String(process.env.EMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const emailFrom = process.env.EMAIL_FROM || smtpUser || 'titansupdate@gmail.com';
const requiredCcRecipients = [
  'titansupdate@gmail.com',
  'donhunttc@gmail.com',
  'ecarr@flexngate-mi.com',
  'ECarr@flexngate.com'
];
const alertCc = String(process.env.EMAIL_ALERT_CC || '').trim();
const localApiBase = `http://127.0.0.1:${Number(process.env.PORT || 4173)}`;

fs.mkdirSync(path.dirname(statusStoreFile), { recursive: true });
if (!fs.existsSync(statusStoreFile)) {
  fs.writeFileSync(statusStoreFile, JSON.stringify({ statuses: {}, lastCheckedAt: '' }, null, 2));
}

function readStatusStore() {
  return JSON.parse(fs.readFileSync(statusStoreFile, 'utf8'));
}

function writeStatusStore(store) {
  fs.writeFileSync(statusStoreFile, JSON.stringify(store, null, 2));
}

function readCoachAccounts() {
  return JSON.parse(fs.readFileSync(coachAccountsFile, 'utf8')).accounts || [];
}

function todayIsoLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function rowKey(row) {
  return `${row.group}::${row.diamond}`;
}

function statusLabel(row) {
  if (row.group === 'Turtle Club Diamonds') return `Turtle Club Diamond #${row.diamond}`;
  if (row.group === 'Villanova Diamonds') return `Villanova Diamond #${row.diamond}`;
  if (row.group === 'Vollmer and River Canard Diamonds') return 'Vollmer and River Canard Diamonds';
  return `${row.group} ${row.diamond}`.trim();
}

function eventMatchesRow(event, row) {
  const diamond = String(event.diamond || '').toLowerCase();
  if (row.group === 'Turtle Club Diamonds') {
    return diamond.includes('turtle club') && diamond.includes(`#${String(row.diamond).toLowerCase()}`);
  }
  if (row.group === 'Villanova Diamonds') {
    return diamond.includes('villanova') && diamond.includes(`#${String(row.diamond).toLowerCase()}`);
  }
  if (row.group === 'Vollmer and River Canard Diamonds') {
    return diamond.includes('vollmer') || diamond.includes('river canard');
  }
  return false;
}

function formatEventLine(event) {
  return `${event.team}: ${event.date} at ${event.time} on ${event.diamond} (${event.type})`;
}

function groupEventsByEmail(events, coachAccounts) {
  const accountByTeam = new Map(coachAccounts.map((account) => [account.team, account]));
  const grouped = new Map();
  for (const event of events) {
    const account = accountByTeam.get(event.team);
    const email = String(account && account.email || '').trim();
    if (!email) continue;
    if (!grouped.has(email)) grouped.set(email, []);
    grouped.get(email).push(event);
  }
  return grouped;
}

async function fetchDiamondStatus() {
  const response = await fetch(`${localApiBase}/api/diamond-status`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Diamond status endpoint returned ${response.status}.`);
  }
  return response.json();
}

async function getStatusChanges() {
  const [statusPayload, data] = await Promise.all([fetchDiamondStatus(), loadData()]);
  const store = readStatusStore();
  const changes = [];

  for (const row of statusPayload.rows || []) {
    const key = rowKey(row);
    const previous = store.statuses[key];
    if (previous && previous.status !== row.status) {
      changes.push({ row, previousStatus: previous.status, currentStatus: row.status });
    }
    store.statuses[key] = {
      status: row.status,
      updatedAt: row.updatedAt || '',
      updatedBy: row.updatedBy || '',
      checkedAt: statusPayload.fetchedAt
    };
  }

  store.lastCheckedAt = statusPayload.fetchedAt;
  writeStatusStore(store);

  return { statusPayload, data, changes };
}

function buildAffectedRecipients(row, data) {
  const date = todayIsoLocal();
  const events = (data.schedule || []).filter((event) => event.date === date && eventMatchesRow(event, row));
  const recipients = groupEventsByEmail(events, readCoachAccounts());
  return { date, events, recipients };
}

function buildEmailContent(row, date, events, previousStatus, currentStatus) {
  const venueLabel = statusLabel(row);
  const eventLines = events.map((event) => `- ${formatEventLine(event)}`).join('\n');
  const commentsLine = row.comments ? `\nNotes from Turtle Club: ${row.comments}\n` : '\n';
  const subject = `[${teamLabel} Field Alert] ${venueLabel} is now ${currentStatus} for ${date}`;
  const text = [
    'This is an automated message generated to notify you that the diamond status has changed.',
    '',
    `${venueLabel} is now ${currentStatus}.`,
    previousStatus ? `Previous status: ${previousStatus}` : '',
    `Date of status update: ${date}`,
    row.updatedAt ? `Turtle Club update time: ${row.updatedAt}` : '',
    row.updatedBy ? `Updated by: ${row.updatedBy}` : '',
    commentsLine.trimEnd(),
    `Affected ${teamLabel} events:`,
    eventLines || `- No matching ${teamLabel} events were found.`,
    '',
    'Please review Turtle Club for the latest official field information.'
  ].filter(Boolean).join('\n');
  return { subject, text };
}

function smtpEscapeText(value) {
  return String(value || '').replace(/\r?\n\./g, '\r\n..');
}

function extractEmailAddress(value) {
  const text = String(value || '').trim();
  const match = text.match(/<([^>]+)>/);
  return String(match ? match[1] : text).trim();
}

function emailConfigured() {
  if (resendApiKey && emailFrom) return true;
  if (gmailClientId && gmailClientSecret && gmailRefreshToken && emailFrom) return true;
  return Boolean(smtpUser && smtpPassword && emailFrom);
}

function formatEmailConfigError() {
  return 'Email sender is not configured. Set RESEND_API_KEY and EMAIL_FROM, or GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN, or EMAIL_USER and EMAIL_APP_PASSWORD.';
}

function createSmtpClient() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: smtpHost,
      port: smtpPort,
      servername: smtpHost
    }, () => resolve(socket));
    socket.once('error', reject);
  });
}

function normalizeRecipients(to, cc = '') {
  const toAddress = String(to || '').trim();
  const defaultCc = [...new Set([
    ...requiredCcRecipients,
    ...String(alertCc || '')
      .split(',')
      .map((email) => email.trim())
      .filter(Boolean)
  ])];
  const extraCc = String(cc || '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);
  const ccAddresses = [...new Set([...defaultCc, ...extraCc].filter(Boolean))]
    .filter((email) => email.toLowerCase() !== toAddress.toLowerCase());
  const recipients = [...new Set([toAddress, ...ccAddresses].filter(Boolean))];
  if (!recipients.length) {
    throw new Error('No email recipient was provided.');
  }
  return { toAddress, ccAddresses, recipients };
}

async function sendEmailViaResend({ toAddress, ccAddresses, subject, text }) {
  if (!resendApiKey || !emailFrom) {
    throw new Error(formatEmailConfigError());
  }

  const payload = {
    from: emailFrom,
    to: [toAddress],
    subject,
    text
  };
  if (ccAddresses.length) payload.cc = ccAddresses;

  const response = await fetch(`${resendApiBase}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Resend API failed (${response.status}): ${bodyText}`);
  }

  return response.json();
}

async function getGmailAccessToken() {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: gmailClientId,
      client_secret: gmailClientSecret,
      refresh_token: gmailRefreshToken,
      grant_type: 'refresh_token'
    }).toString()
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Google OAuth token refresh failed (${response.status}): ${bodyText}`);
  }

  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error('Google OAuth token refresh did not return an access token.');
  }
  return payload.access_token;
}

function buildGmailRawMessage({ toAddress, ccAddresses, subject, text }) {
  const headers = [
    `From: ${emailFrom}`,
    `To: ${toAddress}`,
    ccAddresses.length ? `Cc: ${ccAddresses.join(', ')}` : '',
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit'
  ].filter(Boolean);

  const message = `${headers.join('\r\n')}\r\n\r\n${String(text || '').replace(/\r?\n/g, '\r\n')}`;
  return Buffer.from(message, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function sendEmailViaGmailApi({ toAddress, ccAddresses, subject, text }) {
  if (!gmailClientId || !gmailClientSecret || !gmailRefreshToken || !emailFrom) {
    throw new Error(formatEmailConfigError());
  }

  const senderAddress = extractEmailAddress(emailFrom) || 'me';
  const accessToken = await getGmailAccessToken();
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(senderAddress)}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      raw: buildGmailRawMessage({ toAddress, ccAddresses, subject, text })
    })
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Gmail API send failed (${response.status}): ${bodyText}`);
  }

  return response.json();
}

async function sendEmailViaSmtp({ toAddress, ccAddresses, recipients, subject, text }) {
  const socket = await createSmtpClient();
  socket.setEncoding('utf8');

  let buffer = '';
  let responseLines = [];
  const queuedResponses = [];
  let pendingResolve = null;
  let pendingReject = null;

  const waitForResponse = () => {
    if (queuedResponses.length) {
      return Promise.resolve(queuedResponses.shift());
    }
    return new Promise((resolve, reject) => {
      pendingResolve = resolve;
      pendingReject = reject;
    });
  };

  const finishResponse = (response) => {
    if (!pendingResolve) {
      queuedResponses.push(response);
      return;
    }
    const resolve = pendingResolve;
    pendingResolve = null;
    pendingReject = null;
    resolve(response);
  };

  socket.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      responseLines.push(line);
      if (/^\d{3} /.test(line)) {
        const response = responseLines.join('\n');
        responseLines = [];
        finishResponse(response);
      }
    }
  });

  socket.on('error', (error) => {
    if (pendingReject) {
      pendingReject(error);
      pendingResolve = null;
      pendingReject = null;
    }
  });

  const command = async (line, expectedCodes) => {
    const responsePromise = waitForResponse();
    socket.write(`${line}\r\n`);
    const response = await responsePromise;
    if (!expectedCodes.some((code) => response.startsWith(String(code)))) {
      throw new Error(`SMTP command failed (${line}): ${response}`);
    }
    return response;
  };

  try {
    const greeting = await waitForResponse();
    if (!greeting.startsWith('220')) {
      throw new Error(`SMTP greeting failed: ${greeting}`);
    }
    await command('EHLO localhost', [250]);
    await command('AUTH LOGIN', [334]);
    await command(Buffer.from(smtpUser, 'utf8').toString('base64'), [334]);
    await command(Buffer.from(smtpPassword, 'utf8').toString('base64'), [235]);
    await command(`MAIL FROM:<${emailFrom}>`, [250]);
    for (const recipient of recipients) {
      await command(`RCPT TO:<${recipient}>`, [250, 251]);
    }
    await command('DATA', [354]);

    const headers = [
      `From: ${emailFrom}`,
      `To: ${toAddress}`,
      ccAddresses.length ? `Cc: ${ccAddresses.join(', ')}` : '',
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit'
    ].join('\r\n');
    socket.write(`${headers}\r\n\r\n${smtpEscapeText(text)}\r\n.\r\n`);
    const dataResponse = await waitForResponse();
    if (!dataResponse.startsWith('250')) {
      throw new Error(`SMTP data failed: ${dataResponse}`);
    }
    await command('QUIT', [221]);
  } finally {
    socket.end();
  }
}

async function sendEmail({ to, cc = '', subject, text }) {
  const normalized = normalizeRecipients(to, cc);
  if (resendApiKey) {
    return sendEmailViaResend({ ...normalized, subject, text });
  }
  if (gmailClientId && gmailClientSecret && gmailRefreshToken) {
    return sendEmailViaGmailApi({ ...normalized, subject, text });
  }
  if (!smtpUser || !smtpPassword || !emailFrom) {
    throw new Error(formatEmailConfigError());
  }
  return sendEmailViaSmtp({ ...normalized, subject, text });
}

function findCoachAccountByTeam(team) {
  return readCoachAccounts().find((account) => account.team === team);
}

function formatDecisionSummary(request) {
  const lines = [
    `Team: ${request.team || ''}`,
    `Action: ${request.action || ''}`,
    `Date: ${request.date || request.originalDate || ''}`,
    `Start: ${request.start || request.originalStart || ''}`,
    request.end ? `End: ${request.end}` : '',
    `Diamond: ${request.diamond || request.originalDiamond || ''}`,
    `Type: ${request.newType || request.originalType || ''}`,
    `Opponent/Title: ${request.opponent || request.originalOpponent || ''}`,
    request.reason ? `Coach note: ${request.reason}` : '',
    request.adminNote ? `Admin note: ${request.adminNote}` : ''
  ];
  return lines.filter(Boolean).join('\n');
}

async function sendCoachRequestDecisionEmail(request) {
  const coachAccount = findCoachAccountByTeam(request.team);
  const email = String(coachAccount && coachAccount.email || '').trim();
  if (!email) return false;
  const status = String(request.status || '').toUpperCase();
  const subject = `[${teamLabel} Coach Request] ${status}: ${request.team} ${request.date || request.originalDate || ''}`.trim();
  const text = [
    'This is an automated message generated to notify you that your coach request has been reviewed.',
    '',
    `Decision: ${status}`,
    '',
    formatDecisionSummary(request),
    '',
    `Please log into the ${schedulerLabel} for the latest request status.`
  ].join('\n');
  await sendEmail({ to: email, subject, text });
  return true;
}

async function sendCoachRequestSubmittedEmail(request) {
  const coachAccount = findCoachAccountByTeam(request.team);
  const coachEmail = String(coachAccount && coachAccount.email || '').trim();
  const subject = `[${teamLabel} Coach Request] New request: ${request.team} ${request.date || request.originalDate || ''}`.trim();
  const text = [
    'This is an automated message generated to notify you that a coach has submitted a new schedule request.',
    '',
    formatDecisionSummary(request),
    '',
    `Please log into the ${schedulerLabel} admin portal to review and approve or reject this request.`
  ].join('\n');
  await sendEmail({ to: emailFrom, cc: coachEmail, subject, text });
  return true;
}

async function sendOpponentChangeEmail(change) {
  const subject = `[${teamLabel} Schedule Update] Opponent changed: ${change.team} ${change.date || ''}`.trim();
  const text = [
    'This is an automated message generated to notify you that a coach changed a game opponent.',
    '',
    `Team: ${change.team || ''}`,
    `Date: ${change.date || ''}`,
    `Start: ${change.start || ''}`,
    change.end ? `End: ${change.end}` : '',
    `Type: ${change.type || ''}`,
    `Diamond: ${change.diamond || ''}`,
    `Previous opponent: ${change.previousOpponent || ''}`,
    `New opponent: ${change.opponent || ''}`,
    `Changed by: ${change.changedBy || 'Coach'}`,
    change.remoteId ? `Turtle Club event ID: ${change.remoteId}` : ''
  ].filter(Boolean).join('\n');
  await sendEmail({ to: 'titansupdate@gmail.com', subject, text });
  return true;
}

async function sendStatusAlert(row, previousStatus, currentStatus) {
  const data = await loadData();
  const { date, events, recipients } = buildAffectedRecipients(row, data);
  if (!events.length || !recipients.size) {
    return { sent: 0, date, events, emails: [] };
  }

  const results = [];
  for (const [email, recipientEvents] of recipients.entries()) {
    const { subject, text } = buildEmailContent(row, date, recipientEvents, previousStatus, currentStatus);
    await sendEmail({ to: email, subject, text });
    results.push({ email, teams: [...new Set(recipientEvents.map((event) => event.team))] });
  }

  return { sent: results.length, date, events, emails: results };
}

async function checkForDiamondStatusAlerts() {
  const { changes } = await getStatusChanges();
  const delivered = [];

  for (const change of changes) {
    const delivery = await sendStatusAlert(change.row, change.previousStatus, change.currentStatus);
    if (delivery.sent) {
      delivered.push({
        row: change.row,
        previousStatus: change.previousStatus,
        currentStatus: change.currentStatus,
        ...delivery
      });
    }
  }

  return {
    changes: changes.length,
    delivered
  };
}

async function sendTestDiamondStatusAlert() {
  const [statusPayload, data] = await Promise.all([fetchDiamondStatus(), loadData()]);
  const deliveries = [];
  for (const row of statusPayload.rows || []) {
    const { date, events, recipients } = buildAffectedRecipients(row, data);
    if (!events.length || !recipients.size) continue;
    const delivery = await sendStatusAlert(row, '', row.status);
    deliveries.push({
      row,
      date,
      events: events.map(formatEventLine),
      sent: delivery.sent,
      emails: delivery.emails
    });
  }
  if (!deliveries.length) {
    throw new Error(`No current diamond status row has a matching ${teamLabel} event and coach email for today.`);
  }
  return {
    deliveries,
    sent: deliveries.reduce((sum, item) => sum + (item.sent || 0), 0)
  };
}

module.exports = {
  checkForDiamondStatusAlerts,
  sendTestDiamondStatusAlert,
  sendCoachRequestSubmittedEmail,
  sendCoachRequestDecisionEmail,
  sendOpponentChangeEmail,
  smtpConfigured: emailConfigured
};
