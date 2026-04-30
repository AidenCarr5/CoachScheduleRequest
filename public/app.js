(function () {
  const $ = (id) => document.getElementById(id);
  const teamSelect = $('teamSelect');
  const monthSelect = $('monthSelect');
  const scheduleList = $('scheduleList');
  const requestList = $('requestList');
  const dialog = $('requestDialog');
  let data = null;
  let months = ['All months'];
  let diamonds = [];
  let dateBounds = { min: '', max: '' };
  let refreshTimer = 0;
  let currentDataVersion = '';
  let appStarted = false;
  const state = {
    team: '',
    month: 'All months',
    query: '',
    requests: [],
    publicConfig: { adminPath: '/admin.html' },
    user: null
  };

  async function init() {
    $('coachLoginForm').addEventListener('submit', login);
    $('logoutBtn').addEventListener('click', logout);
    const session = await loadSession();
    if (!session.authenticated) {
      showLogin();
      return;
    }
    state.user = session.user;
    await startApp();
  }

  async function startApp() {
    await loadBootstrap();
    if (!data || !data.teams.length) {
      throw new Error('No schedule data was returned by the server.');
    }
    state.team = isAdminUser() ? data.teams[0] : state.user.team;
    rebuildDerivedData();

    teamSelect.innerHTML = data.teams.map((team) => `<option>${escapeHtml(team)}</option>`).join('');
    monthSelect.innerHTML = months.map((month) => `<option>${escapeHtml(month)}</option>`).join('');
    $('diamondSelect').innerHTML = diamonds.map((diamond) => `<option>${escapeHtml(diamond)}</option>`).join('');
    $('scrapeDate').textContent = `Loaded ${data.schedule.length} events from Turtle Club`;
    $('gameDate').min = dateBounds.min;
    $('gameDate').max = dateBounds.max;

    teamSelect.value = state.team;
    teamSelect.disabled = !isAdminUser();

    if (!appStarted) {
      teamSelect.addEventListener('change', () => {
        state.team = teamSelect.value;
        render();
      });
      monthSelect.addEventListener('change', () => {
        state.month = monthSelect.value;
        render();
      });
      $('searchInput').addEventListener('input', (event) => {
        state.query = event.target.value.toLowerCase();
        render();
      });
      $('newGameBtn').addEventListener('click', openNewEvent);
      $('closeDialog').addEventListener('click', () => dialog.close());
      $('checkBtn').addEventListener('click', renderAvailabilityCheck);
      $('requestForm').addEventListener('submit', queueRequest);
      window.addEventListener('focus', syncRequests);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && state.user) syncRequests();
      });
      appStarted = true;
    }

    await loadPublicConfig();
    await loadRequests();
    showApp();
    window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(syncRequests, 20000);
    render();
  }

  async function loadSession() {
    const response = await fetch('/api/coach/session', { cache: 'no-store' });
    if (!response.ok) return { authenticated: false };
    return response.json();
  }

  async function login(event) {
    event.preventDefault();
    const response = await fetch('/api/coach/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: $('coachUsername').value.trim(),
        password: $('coachPassword').value
      })
    });
    if (!response.ok) {
      $('coachLoginMessage').textContent = 'Username or password did not match.';
      return;
    }
    const payload = await response.json();
    $('coachPassword').value = '';
    $('coachLoginMessage').textContent = '';
    state.user = payload.user;
    await startApp();
  }

  async function logout() {
    await fetch('/api/coach/logout', { method: 'POST' });
    state.user = null;
    state.requests = [];
    data = null;
    window.clearInterval(refreshTimer);
    refreshTimer = 0;
    showLogin();
  }

  async function loadBootstrap() {
    const response = await fetch('/api/bootstrap', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Unable to load schedule data');
    }
    const payload = await response.json();
    data = payload.data;
    state.publicConfig = payload.publicConfig || { adminPath: '/admin.html' };
    state.user = state.publicConfig.user || state.user;
    currentDataVersion = state.publicConfig.dataVersion || data.scrapedAt || '';
  }

  function rebuildDerivedData() {
    months = ['All months', ...new Set(data.schedule.map((event) => event.month))];
    diamonds = [...new Set(data.availability.map((slot) => slot.diamond))].sort();
    dateBounds = getDateBounds();
  }

  async function loadPublicConfig() {
    try {
      const response = await fetch('/api/public-config');
      if (!response.ok) return;
      const payload = await response.json();
      state.publicConfig = payload;
      currentDataVersion = payload.dataVersion || currentDataVersion;
    } catch (_) {
      state.publicConfig = { adminPath: '/admin.html' };
    }
  }

  async function loadRequests() {
    try {
      const response = await fetch('/api/requests', { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load requests');
      const payload = await response.json();
      state.requests = payload.requests || [];
    } catch (error) {
      alert('The request queue could not be loaded from the server.');
      state.requests = [];
    }
  }

  async function syncRequests() {
    await syncDataVersion();
    await loadRequests();
    render();
  }

  async function syncDataVersion() {
    try {
      const response = await fetch('/api/data-version', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      if (payload.version && currentDataVersion && payload.version !== currentDataVersion) {
        await loadBootstrap();
        rebuildDerivedData();
        teamSelect.innerHTML = data.teams.map((team) => `<option>${escapeHtml(team)}</option>`).join('');
        monthSelect.innerHTML = months.map((month) => `<option>${escapeHtml(month)}</option>`).join('');
        $('diamondSelect').innerHTML = diamonds.map((diamond) => `<option>${escapeHtml(diamond)}</option>`).join('');
        if (!data.teams.includes(state.team)) state.team = isAdminUser() ? data.teams[0] : state.user.team;
        if (!months.includes(state.month)) state.month = 'All months';
        teamSelect.value = state.team;
        teamSelect.disabled = !isAdminUser();
        monthSelect.value = state.month;
        $('gameDate').min = dateBounds.min;
        $('gameDate').max = dateBounds.max;
        return;
      }
      currentDataVersion = payload.version || currentDataVersion;
    } catch (_) {
      return;
    }
  }

  function visibleEvents() {
    return buildDisplaySchedule().filter((event) => {
      const matchesTeam = event.team === state.team;
      const matchesMonth = state.month === 'All months' || event.month === state.month;
      const haystack = `${event.opponent} ${event.diamond} ${event.type} ${event.eventKind}`.toLowerCase();
      return matchesTeam && matchesMonth && haystack.includes(state.query);
    }).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  }

  function buildDisplaySchedule() {
    const schedule = data.schedule.map((event) => ({ ...event }));
    const byId = new Map(schedule.map((event) => [event.id, event]));

    state.requests
      .filter((request) => request.status !== 'rejected')
      .forEach((request, index) => {
        if (request.action.startsWith('Cancel ')) {
          const original = byId.get(request.originalId);
          if (original) {
            original.pendingState = request.status === 'approved' ? 'approved-cancel' : 'cancelled';
            original.pendingLabel = request.status === 'approved' ? 'Approved cancellation' : 'Pending cancellation';
            original.requestIndex = index;
          }
          return;
        }

        if (request.action.startsWith('Replace ')) {
          const original = byId.get(request.originalId);
          if (original) {
            original.pendingState = request.status === 'approved' ? 'approved-replace' : 'replaced';
            original.pendingLabel = request.status === 'approved' ? 'Approved replacement' : 'Pending replacement';
            original.requestIndex = index;
          }
        }

        schedule.push({
          id: `request-${request.id}`,
          date: request.date,
          month: monthLabelFromDate(request.date),
          time: request.start,
          endTime: request.end || '',
          durationMinutes: request.end ? minutesFromDisplay(request.end) - minutesFromDisplay(request.start) : 120,
          type: request.newType || request.originalType || 'Event',
          eventKind: request.newType || request.originalType || 'Event',
          team: request.team,
          opponent: request.opponent,
          diamond: request.diamond,
          status: request.status || 'pending',
          source: 'Coach request',
          pendingState: request.status === 'approved' ? 'approved-new' : 'new',
          pendingLabel: request.status === 'approved' ? 'Approved request' : 'Pending request',
          requestIndex: index
        });
      });

    return schedule;
  }

  function render() {
    const events = visibleEvents();
    $('visibleCount').textContent = events.length;
    $('requestCount').textContent = state.requests.length;
    $('availableCount').textContent = data.availability.length;
    $('teamScope').textContent = `${state.team} schedule only`;
    $('adminLink').href = state.publicConfig.adminPath || '/admin.html';
    $('adminLink').hidden = !isAdminUser();
    $('sessionLabel').hidden = false;
    $('sessionLabel').textContent = isAdminUser() ? 'Signed in as admin' : `Signed in: ${state.user.username}`;
    $('logoutBtn').hidden = false;

    scheduleList.innerHTML = events.length ? renderMonthGroups(events) : '<p class="muted">No events match this view.</p>';
    scheduleList.querySelectorAll('[data-cancel]').forEach((button) => {
      button.addEventListener('click', () => openCancel(button.dataset.cancel));
    });
    scheduleList.querySelectorAll('[data-replace]').forEach((button) => {
      button.addEventListener('click', () => openReplace(button.dataset.replace));
    });

    requestList.classList.toggle('empty', state.requests.length === 0);
    requestList.innerHTML = state.requests.map(renderRequest).join('');
  }

  function renderMonthGroups(events) {
    const groups = new Map();
    events.forEach((event) => {
      if (!groups.has(event.month)) groups.set(event.month, []);
      groups.get(event.month).push(event);
    });
    return [...groups.entries()].map(([month, monthEvents]) => `
      <section class="month-group">
        <div class="month-head">
          <h3>${escapeHtml(month)}</h3>
          <span>${monthEvents.length} ${monthEvents.length === 1 ? 'event' : 'events'}</span>
        </div>
        <div class="month-events">
          ${monthEvents.map(renderEvent).join('')}
        </div>
      </section>
    `).join('');
  }

  function renderEvent(event) {
    const date = new Date(`${event.date}T12:00:00`);
    const dateLabel = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const kindClass = eventClass(event);
    const end = event.endTime ? `-${escapeHtml(event.endTime)}` : '';
    const pendingStateClass = event.pendingState ? ` ${event.pendingState}` : '';
    const pendingBadge = event.pendingLabel ? `<span class="pending-badge">${escapeHtml(event.pendingLabel)}</span>` : '';
    const strikeClass = /cancel|replace/.test(event.pendingState || '') ? ' strike' : '';
    const actions = event.pendingState
      ? `<div class="row-actions"><button class="replace-btn static-btn" type="button" disabled>${event.status === 'approved' ? 'Approved' : 'Queued'}</button></div>`
      : `<div class="row-actions">
          <button class="replace-btn" data-replace="${event.id}">Replace</button>
          <button class="cancel-btn" data-cancel="${event.id}">Cancel</button>
        </div>`;
    return `
      <article class="game-row ${kindClass}${pendingStateClass}">
        <div class="date-box">${dateLabel}</div>
        <div class="time-box">${escapeHtml(event.time)}${end}</div>
        <div class="game-main${strikeClass}">
          <span class="tag ${kindClass}">${escapeHtml(event.eventKind || event.type)}</span>
          ${pendingBadge}
          <strong>${escapeHtml(event.opponent)}</strong>
          <span>${escapeHtml(event.diamond)}</span>
        </div>
        ${actions}
      </article>
    `;
  }

  function renderRequest(request) {
    const statusLabel = request.status === 'approved' ? 'Approved' : request.status === 'rejected' ? 'Rejected' : 'Pending';
    return `
      <article class="request-card ${escapeHtml(request.status || 'pending')}">
        <strong>${escapeHtml(request.action)} - ${escapeHtml(request.team)}</strong>
        <span>${escapeHtml(request.date)} ${escapeHtml(request.start || '')} ${escapeHtml(request.opponent || '')}</span>
        <span>${escapeHtml(request.diamond || '')}</span>
        <span>${escapeHtml(statusLabel)}</span>
      </article>
    `;
  }

  function openCancel(eventId) {
    const event = data.schedule.find((item) => item.id === eventId);
    if (!event) return;
    $('dialogTitle').textContent = `Cancel ${event.opponent}`;
    $('requestMode').value = 'cancel';
    $('eventId').value = eventId;
    $('cancelReason').value = '';
    $('cancelFields').hidden = false;
    $('newFields').hidden = true;
    $('checkBtn').hidden = true;
    dialog.showModal();
  }

  function openNewEvent() {
    $('dialogTitle').textContent = 'Create New Event';
    $('requestMode').value = 'new';
    $('eventId').value = '';
    $('eventTypeSelect').value = 'Home Game';
    $('gameDate').value = nextOpenDate();
    $('startTime').value = '18:00';
    $('endTime').value = '20:00';
    $('opponentInput').value = '';
    $('notesInput').value = '';
    $('availabilityResult').className = 'availability-result';
    $('availabilityResult').textContent = 'Choose a diamond and time, then check availability.';
    $('cancelFields').hidden = true;
    $('newFields').hidden = false;
    $('checkBtn').hidden = false;
    dialog.showModal();
  }

  function openReplace(eventId) {
    const original = data.schedule.find((item) => item.id === eventId);
    if (!original) return;
    $('dialogTitle').textContent = `Replace ${original.eventKind || original.type}`;
    $('requestMode').value = 'replace';
    $('eventId').value = eventId;
    $('eventTypeSelect').value = original.eventKind === 'Practice' ? 'Home Game' : 'Practice';
    $('gameDate').value = original.date;
    $('startTime').value = toInputTime(original.time);
    $('endTime').value = original.endTime ? toInputTime(original.endTime) : toInputTimeFromMinutes(minutesFromDisplay(original.time) + 120);
    if (diamonds.includes(original.diamond)) $('diamondSelect').value = original.diamond;
    $('opponentInput').value = original.eventKind === 'Practice' ? 'vs ' : 'Practice';
    $('notesInput').value = `Replacing ${original.eventKind || original.type}: ${original.opponent} at ${original.diamond}`;
    $('availabilityResult').className = 'availability-result';
    $('availabilityResult').textContent = 'This replacement will be checked against published availability and Turtle Club event conflicts.';
    $('cancelFields').hidden = true;
    $('newFields').hidden = false;
    $('checkBtn').hidden = false;
    dialog.showModal();
  }

  function nextOpenDate() {
    const teamEvents = data.schedule.filter((event) => event.team === state.team);
    return (teamEvents[0] && teamEvents[0].date) || dateBounds.min;
  }

  async function queueRequest(event) {
    event.preventDefault();
    const mode = $('requestMode').value;
    let payload;

    if (mode === 'cancel') {
      const original = data.schedule.find((item) => item.id === $('eventId').value);
      payload = {
        action: `Cancel ${original.eventKind || 'event'}`,
        team: original.team,
        originalId: original.id,
        originalType: original.eventKind || original.type,
        originalDate: original.date,
        originalStart: original.time,
        originalOpponent: original.opponent,
        originalDiamond: original.diamond,
        newType: '',
        date: original.date,
        start: original.time,
        end: original.endTime || '',
        opponent: original.opponent,
        diamond: original.diamond,
        reason: $('cancelReason').value,
        availabilityStatus: 'Original event cancellation',
        submittedBy: state.team
      };
    } else {
      const check = checkAvailability();
      if (!check.ok) {
        const box = $('availabilityResult');
        box.className = 'availability-result bad';
        box.textContent = check.message;
        return;
      }
      const original = mode === 'replace' ? data.schedule.find((item) => item.id === $('eventId').value) : null;
      payload = {
        action: mode === 'replace' ? `Replace ${original.eventKind || 'event'}` : `Create ${$('eventTypeSelect').value}`,
        team: state.team,
        originalId: original ? original.id : '',
        originalType: original ? (original.eventKind || original.type) : '',
        originalDate: original ? original.date : '',
        originalStart: original ? original.time : '',
        originalOpponent: original ? original.opponent : '',
        originalDiamond: original ? original.diamond : '',
        newType: $('eventTypeSelect').value,
        date: $('gameDate').value,
        start: toDisplayTime($('startTime').value),
        end: toDisplayTime($('endTime').value),
        opponent: $('opponentInput').value || $('eventTypeSelect').value,
        diamond: $('diamondSelect').value,
        reason: $('notesInput').value,
        availabilityStatus: check.message,
        submittedBy: state.team
      };
    }

    try {
      const response = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error('Unable to save request');
      await loadRequests();
      dialog.close();
      render();
    } catch (_) {
      alert('The request could not be saved to the server.');
    }
  }

  function renderAvailabilityCheck() {
    const result = checkAvailability();
    const box = $('availabilityResult');
    box.className = `availability-result ${result.ok ? 'good' : 'bad'}`;
    box.textContent = result.message;
  }

  function checkAvailability() {
    const date = $('gameDate').value;
    const diamond = $('diamondSelect').value;
    const eventType = $('eventTypeSelect').value;
    const start = minutes($('startTime').value);
    const end = minutes($('endTime').value);
    if (!date || !diamond || start >= end) return { ok: false, message: 'Enter a valid date, start, and end time.' };

    const ignoredId = $('requestMode').value === 'replace' ? $('eventId').value : '';
    const original = ignoredId ? data.schedule.find((item) => item.id === ignoredId) : null;
    const freedSlots = [];

    if (original && original.date === date && original.diamond === diamond) {
      freedSlots.push({
        id: original.id,
        start: minutesFromDisplay(original.time),
        end: original.endTime ? minutesFromDisplay(original.endTime) : minutesFromDisplay(original.time) + (original.durationMinutes || 120),
        source: original.eventKind || original.type
      });
    }

    state.requests
      .filter((request) => request.status !== 'rejected')
      .filter((request) => request.action.startsWith('Cancel ') || request.action.startsWith('Replace '))
      .forEach((request) => {
        if (request.originalDate !== date || request.originalDiamond !== diamond || !request.originalId) return;
        if (ignoredId && request.originalId === ignoredId) return;
        freedSlots.push({
          id: request.originalId,
          start: minutesFromDisplay(request.originalStart),
          end: request.end ? minutesFromDisplay(request.end) : minutesFromDisplay(request.originalStart) + 120,
          source: request.originalType || 'event'
        });
      });

    const openSlot = data.availability.find((slot) => {
      return slot.date === date && slot.diamond === diamond && minutesFromDisplay(slot.start) <= start && minutesFromDisplay(slot.end) >= end;
    });
    const fitsFreedSlot = freedSlots.find((slot) => slot.start <= start && slot.end >= end);
    if (!openSlot && !fitsFreedSlot) return { ok: false, message: 'This request does not fit a published open diamond block or a time slot already being freed by a queued change.' };

    const conflict = (data.conflictEvents || data.schedule).find((item) => {
      if (item.id === ignoredId) return false;
      if (freedSlots.some((slot) => slot.id === item.id)) return false;
      if (`${item.type || ''} ${item.eventKind || ''}`.toLowerCase().includes('tryout')) return false;
      const eventStart = minutesFromDisplay(item.time);
      const eventEnd = item.endTime ? minutesFromDisplay(item.endTime) : eventStart + (item.durationMinutes || 120);
      return item.date === date && item.diamond === diamond && start < eventEnd && end > eventStart;
    });
    if (conflict) return { ok: false, message: `Diamond conflict with ${conflict.team} ${conflict.opponent} (${conflict.eventKind || conflict.type}) at ${conflict.time}.` };

    if (fitsFreedSlot && !openSlot) {
      return { ok: true, message: `Available: this request uses the ${fitsFreedSlot.source} time being freed, and no other Turtle Club ${eventType.toLowerCase()} conflict overlaps.` };
    }
    return { ok: true, message: `Available: ${diamond} is open ${openSlot.start}-${openSlot.end}, and no Turtle Club ${eventType.toLowerCase()} conflict overlaps.` };
  }

  function minutes(value) {
    const [hours, mins] = value.split(':').map(Number);
    return hours * 60 + mins;
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

  function toDisplayTime(value) {
    const [rawHour, mins] = value.split(':').map(Number);
    const meridiem = rawHour >= 12 ? 'PM' : 'AM';
    const hour = rawHour % 12 || 12;
    return `${hour}:${String(mins).padStart(2, '0')} ${meridiem}`;
  }

  function toInputTime(value) {
    return toInputTimeFromMinutes(minutesFromDisplay(value));
  }

  function toInputTimeFromMinutes(total) {
    const hours = Math.floor(total / 60) % 24;
    const mins = total % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  function eventClass(event) {
    const type = `${event.eventKind || event.type}`.toLowerCase();
    if (type.includes('practice')) return 'practice';
    if (type.includes('away')) return 'away';
    return 'home';
  }

  function monthLabelFromDate(dateString) {
    const date = new Date(`${dateString}T12:00:00`);
    return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  }

  function getDateBounds() {
    const dates = [
      ...data.schedule.map((event) => event.date),
      ...data.availability.map((slot) => slot.date)
    ].filter(Boolean).sort();
    const seasonYear = data.seasonYear || new Date().getFullYear();
    return {
      min: dates[0] || `${seasonYear}-01-01`,
      max: dates[dates.length - 1] || `${seasonYear}-12-31`
    };
  }

  function isAdminUser() {
    return state.user && state.user.role === 'admin';
  }

  function showLogin() {
    $('loginShell').hidden = false;
    $('appShell').hidden = true;
    $('sessionLabel').hidden = true;
    $('logoutBtn').hidden = true;
    $('adminLink').hidden = true;
  }

  function showApp() {
    $('loginShell').hidden = true;
    $('appShell').hidden = false;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[char]);
  }

  init().catch(() => {
    alert('The schedule could not be loaded from the server.');
  });
})();
