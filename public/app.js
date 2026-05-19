(function () {
  const $ = (id) => document.getElementById(id);
  const teamSelect = $('teamSelect');
  const monthSelect = $('monthSelect');
  const scheduleList = $('scheduleList');
  const calendarView = $('calendarView');
  const requestList = $('requestList');
  const processedRequestList = $('processedRequestList');
  const dialog = $('requestDialog');
  const calendarDayDialog = $('calendarDayDialog');
  const preloadBar = $('preloadBar');
  const loadingOverlay = $('loadingOverlay');
  let turtleClubVenueCatalog = [];
  let turtleClubOpponentCatalog = [];
  let data = null;
  let months = ['All months'];
  let diamonds = [];
  let venueOptions = [];
  let opponentOptions = [];
  let dateBounds = { min: '', max: '' };
  let refreshTimer = 0;
  let preloadTimer = 0;
  let currentDataVersion = '';
  let appStarted = false;
  const state = {
    team: '',
    month: 'All months',
    view: 'calendar',
    query: '',
    selectedDate: '',
    requests: [],
    submittingRequest: false,
    publicConfig: { adminPath: '/admin.html', fieldStatusPath: '' },
    user: null,
    preload: {
      promise: null,
      progress: 0,
      completed: false
    }
  };

  async function init() {
    $('coachLoginForm').addEventListener('submit', login);
    $('logoutBtn').addEventListener('click', logout);
    beginPreload();
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
    state.team = canViewAllTeams() ? data.teams[0] : state.user.team;
    rebuildDerivedData();
    state.month = preferredMonth(state.month);

    teamSelect.innerHTML = data.teams.map((team) => `<option>${escapeHtml(team)}</option>`).join('');
    monthSelect.innerHTML = months.map((month) => `<option>${escapeHtml(month)}</option>`).join('');
    $('diamondSelect').innerHTML = diamonds.map((diamond) => `<option>${escapeHtml(diamond)}</option>`).join('');
    rebuildAwayVenueOptions();
    rebuildOpponentSelect();
    $('gameDate').min = dateBounds.min;
    $('gameDate').max = dateBounds.max;

    teamSelect.value = state.team;
    teamSelect.disabled = !canViewAllTeams();
    monthSelect.value = state.month;

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
      $('listViewBtn').addEventListener('click', () => setView('list'));
      $('calendarViewBtn').addEventListener('click', () => setView('calendar'));
      $('newGameBtn').addEventListener('click', openNewEvent);
      $('eventTypeSelect').addEventListener('change', syncEventTypeControls);
      $('closeDialog').addEventListener('click', () => dialog.close());
      $('closeCalendarDayDialog').addEventListener('click', () => calendarDayDialog.close());
      $('calendarDayNewEventBtn').addEventListener('click', () => {
        const date = $('calendarDayNewEventBtn').dataset.date || state.selectedDate || '';
        calendarDayDialog.close();
        openNewEvent(date);
      });
      $('opponentInput').addEventListener('input', () => {
        showFilterSelect('opponent');
        renderFilteredSelect('opponent');
      });
      $('opponentInput').addEventListener('focus', () => {
        showFilterSelect('opponent');
        renderFilteredSelect('opponent');
      });
      $('opponentInput').addEventListener('blur', () => scheduleHideFilterSelect('opponent'));
      $('opponentMenu').addEventListener('mousedown', (event) => {
        const option = event.target.closest('[data-filter-value]');
        if (!option) return;
        event.preventDefault();
        syncFilterSelectChoice('opponent', option.dataset.filterValue);
      });
      $('awayDiamondInput').addEventListener('input', () => {
        showFilterSelect('venue');
        renderFilteredSelect('venue');
      });
      $('awayDiamondInput').addEventListener('focus', () => {
        showFilterSelect('venue');
        renderFilteredSelect('venue');
      });
      $('awayDiamondInput').addEventListener('blur', () => scheduleHideFilterSelect('venue'));
      $('awayDiamondMenu').addEventListener('mousedown', (event) => {
        const option = event.target.closest('[data-filter-value]');
        if (!option) return;
        event.preventDefault();
        syncFilterSelectChoice('venue', option.dataset.filterValue);
      });
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
    if (payload.redirectTo) {
      window.location.href = payload.redirectTo;
      return;
    }
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
    beginPreload(true);
    showLogin();
  }

  function beginPreload(force = false) {
    if (force) {
      state.preload.promise = null;
      state.preload.progress = 0;
      state.preload.completed = false;
    }
    if (state.preload.promise) return state.preload.promise;

    state.preload.progress = Math.max(state.preload.progress, 8);
    updatePreloadUi('Checking daily sync status...', 'The scheduler refreshes from Turtle Club every day at 8:00 AM, and you can also refresh it from the admin portal.');
    renderPreloadProgress();
    startPreloadAnimation();

    state.preload.promise = fetch('/api/preload-schedule', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to preload schedule');
        return response.json();
      })
      .then((payload) => {
        currentDataVersion = payload.dataVersion || currentDataVersion;
        state.preload.progress = 100;
        state.preload.completed = true;
        stopPreloadAnimation();
        renderPreloadProgress(true);
        const lastSync = formatDateTime(payload.dataVersion);
        const nextSync = formatDateTime(payload.nextRefreshAt);
        updatePreloadUi(
          'Schedule data ready',
          `Loaded ${payload.events || 0} events. Last sync: ${lastSync}. Next automatic refresh: ${nextSync}.`
        );
        return payload;
      })
      .catch(() => {
        state.preload.progress = Math.max(state.preload.progress, 100);
        state.preload.completed = true;
        stopPreloadAnimation();
        renderPreloadProgress();
        updatePreloadUi(
          'Schedule status unavailable',
          'The login page could not read the latest sync status, but the cached schedule is still available.'
        );
        return null;
      });

    return state.preload.promise;
  }

  function startPreloadAnimation() {
    stopPreloadAnimation();
    preloadTimer = window.setInterval(() => {
      if (state.preload.completed) {
        stopPreloadAnimation();
        return;
      }
      state.preload.progress = Math.min(state.preload.progress + 6, 88);
      renderPreloadProgress();
    }, 450);
  }

  function stopPreloadAnimation() {
    window.clearInterval(preloadTimer);
    preloadTimer = 0;
  }

  function renderPreloadProgress(complete = false) {
    if (!preloadBar) return;
    preloadBar.style.width = `${Math.max(6, Math.min(100, state.preload.progress))}%`;
    preloadBar.classList.toggle('complete', complete || state.preload.completed);
  }

  function updatePreloadUi(title, detail) {
    $('preloadStatusText').textContent = title;
    $('preloadStatusDetail').textContent = detail;
  }

  function formatDateTime(value) {
    if (!value) return 'Unavailable';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unavailable';
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  async function loadBootstrap() {
    const [response, catalogResponse] = await Promise.all([
      fetch('/api/bootstrap', { cache: 'no-store' }),
      fetch('/turtle-club-dropdowns.json', { cache: 'no-store' }).catch(() => null)
    ]);
    if (!response.ok) throw new Error('Unable to load schedule data');
    const payload = await response.json();
    if (catalogResponse && catalogResponse.ok) {
      const catalog = await catalogResponse.json().catch(() => ({}));
      turtleClubVenueCatalog = Array.isArray(catalog.venues) ? catalog.venues : [];
      turtleClubOpponentCatalog = Array.isArray(catalog.opponents) ? catalog.opponents : [];
    }
    data = payload.data;
    state.publicConfig = payload.publicConfig || { adminPath: '/admin.html', fieldStatusPath: '' };
    state.user = state.publicConfig.user || state.user;
    currentDataVersion = state.publicConfig.dataVersion || data.scrapedAt || '';
  }

  function rebuildDerivedData() {
    months = ['All months', ...new Set(data.schedule.map((event) => event.month))];
    diamonds = [...new Set(data.availability.map((slot) => normalizeAvailabilityDiamond(slot.diamond)).filter(Boolean))].sort();
    venueOptions = buildVenueOptions();
    opponentOptions = buildOpponentOptions();
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
      state.publicConfig = { adminPath: '/admin.html', fieldStatusPath: '' };
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
        rebuildAwayVenueOptions();
        rebuildOpponentSelect();
        if (!data.teams.includes(state.team)) state.team = canViewAllTeams() ? data.teams[0] : state.user.team;
        state.month = preferredMonth(state.month);
        teamSelect.value = state.team;
        teamSelect.disabled = !canViewAllTeams();
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
      const keepHistoricalChange = state.view === 'list' && /cancel|replace/.test(event.pendingState || '');
      const matchesTiming = state.view !== 'list' || keepHistoricalChange || !eventHasPassed(event);
      return matchesTeam && matchesMonth && matchesTiming && haystack.includes(state.query);
    }).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  }

  function preferredMonth(currentMonth) {
    if (currentMonth && currentMonth !== 'All months' && months.includes(currentMonth)) return currentMonth;
    const today = new Date();
    const currentMonthLabel = today.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    if (months.includes(currentMonthLabel)) return currentMonthLabel;
    const datedMonths = months
      .filter((month) => month !== 'All months')
      .map((month) => ({ label: month, time: monthLabelToTime(month) }))
      .filter((month) => !Number.isNaN(month.time))
      .sort((a, b) => a.time - b.time);
    const todayMonthTime = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
    const upcoming = datedMonths.find((month) => month.time >= todayMonthTime);
    if (upcoming) return upcoming.label;
    return datedMonths[datedMonths.length - 1]?.label || 'All months';
  }

  function monthLabelToTime(label) {
    const parsed = new Date(`${label} 1 12:00:00`);
    return parsed.getTime();
  }

  function eventHasPassed(event) {
    const start = new Date(`${event.date}T12:00:00`);
    const startMinutes = minutesFromDisplay(event.time);
    const endMinutes = event.endTime
      ? minutesFromDisplay(event.endTime)
      : startMinutes + (event.durationMinutes || 120);
    if (Number.isNaN(startMinutes) || Number.isNaN(endMinutes)) return false;
    start.setHours(0, 0, 0, 0);
    const eventEnd = new Date(start.getTime() + endMinutes * 60000);
    return eventEnd < new Date();
  }

  function buildDisplaySchedule() {
    const schedule = data.schedule.map((event) => ({ ...event }));
    const byId = new Map(schedule.map((event) => [event.id, event]));

    state.requests
      .filter((request) => request.status !== 'rejected')
      .forEach((request, index) => {
        const eventStatus = request.status || 'pending';
        if (request.action.startsWith('Cancel ')) {
          const original = byId.get(request.originalId);
          if (original) {
            original.pendingState = eventStatus === 'approved' ? 'approved-cancel' : 'cancelled';
            original.pendingLabel = eventStatus === 'approved' ? 'Approved cancellation' : 'Pending cancellation';
            original.requestIndex = index;
          } else {
            schedule.push(buildHistoricalEvent(request, index, eventStatus === 'approved' ? 'approved-cancel' : 'cancelled', eventStatus === 'approved' ? 'Approved cancellation' : 'Pending cancellation'));
          }
          return;
        }

        if (request.action.startsWith('Replace ')) {
          const original = byId.get(request.originalId);
          if (original) {
            original.pendingState = eventStatus === 'approved' ? 'approved-replace' : 'replaced';
            original.pendingLabel = eventStatus === 'approved' ? 'Approved replacement' : 'Pending replacement';
            original.requestIndex = index;
          } else {
            schedule.push(buildHistoricalEvent(request, index, eventStatus === 'approved' ? 'approved-replace' : 'replaced', eventStatus === 'approved' ? 'Approved replacement' : 'Pending replacement'));
          }
        }

        if (request.status === 'approved') {
          const approvedEvent = schedule.find((event) => eventMatchesApprovedRequest(event, request));
          if (approvedEvent) {
            approvedEvent.pendingState = 'approved-new';
            approvedEvent.pendingLabel = 'Approved request';
            approvedEvent.requestIndex = index;
            return;
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

  function eventMatchesApprovedRequest(event, request) {
    if (!event || !request) return false;
    if (event.id === request.originalId) return false;
    if (event.pendingState && event.pendingState !== 'approved-new') return false;

    const eventTeam = normalizeScheduleComparison(event.team);
    const requestTeam = normalizeScheduleComparison(request.team);
    if (eventTeam !== requestTeam) return false;

    const eventDate = String(event.date || '');
    const requestDate = String(request.date || '');
    if (eventDate !== requestDate) return false;

    const eventDiamond = normalizeScheduleComparison(event.diamond);
    const requestDiamond = normalizeScheduleComparison(request.diamond);
    if (eventDiamond !== requestDiamond) return false;

    const eventStart = normalizeScheduleComparison(event.time);
    const requestStart = normalizeScheduleComparison(request.start);
    if (eventStart !== requestStart) return false;

    const eventEnd = normalizeScheduleComparison(event.endTime || '');
    const requestEnd = normalizeScheduleComparison(request.end || '');
    if (eventEnd !== requestEnd) return false;

    const eventKind = normalizeScheduleComparison(event.eventKind || event.type);
    const requestKind = normalizeScheduleComparison(request.newType || request.originalType || 'Event');
    if (eventKind !== requestKind) return false;

    const eventOpponent = normalizeScheduleComparison(event.opponent);
    const requestOpponent = normalizeScheduleComparison(request.opponent);
    return eventOpponent === requestOpponent;
  }

  function normalizeScheduleComparison(value) {
    return String(value || '')
      .replace(/^vs\.?\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function normalizeAvailabilityDiamond(value) {
    return String(value || '')
      .replace(/\s*\[[A-Z0-9-]+\]\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buildHistoricalEvent(request, index, pendingState, pendingLabel) {
    return {
      id: `history-${request.id}`,
      date: request.originalDate || request.date,
      month: monthLabelFromDate(request.originalDate || request.date),
      time: request.originalStart || request.start,
      endTime: request.end || '',
      durationMinutes: request.end
        ? Math.max(30, minutesFromDisplay(request.end) - minutesFromDisplay(request.originalStart || request.start))
        : 120,
      type: request.originalType || request.newType || 'Event',
      eventKind: request.originalType || request.newType || 'Event',
      team: request.team,
      opponent: request.originalOpponent || request.opponent,
      diamond: request.originalDiamond || request.diamond,
      status: request.status || 'pending',
      source: 'Coach request history',
      pendingState,
      pendingLabel,
      requestIndex: index
    };
  }

  function render() {
    const events = visibleEvents();
    const pendingRequests = state.requests.filter((request) => (request.status || 'pending') === 'pending');
    const processedRequests = state.requests.filter((request) => ['approved', 'rejected'].includes(request.status || 'pending'));
    $('visibleCount').textContent = events.length;
    $('requestCount').textContent = pendingRequests.length;
    $('availableCount').textContent = data.availability.length;
    $('teamScope').textContent = canViewAllTeams()
      ? `Viewing coach schedule: ${state.team}`
      : `${state.team} schedule only`;
    $('adminLink').href = state.publicConfig.adminPath || '/admin.html';
    $('adminLink').hidden = !isAdminUser();
    $('fieldStatusLink').href = state.publicConfig.fieldStatusPath || '/diamond-status-admin.html';
    $('fieldStatusLink').hidden = !state.publicConfig.fieldStatusPath;
    $('sessionLabel').hidden = false;
    $('sessionLabel').textContent = isAdminUser()
      ? 'Signed in as admin'
      : isStatusEditorUser()
        ? `Signed in: ${state.user.username} (all coach view)`
        : `Signed in: ${state.user.username}`;
    $('logoutBtn').hidden = false;
    $('newGameBtn').hidden = isReadOnlyCoachViewer();
    updateViewTabs();

    if (state.view === 'calendar') {
      scheduleList.hidden = true;
      calendarView.hidden = false;
      calendarView.innerHTML = renderCalendar(events);
      bindCalendarActions();
    } else {
      calendarView.hidden = true;
      scheduleList.hidden = false;
      scheduleList.innerHTML = events.length ? renderMonthGroups(events) : '<p class="muted">No events match this view.</p>';
      bindEventActions(scheduleList);
    }

    requestList.classList.toggle('empty', pendingRequests.length === 0);
    requestList.innerHTML = pendingRequests.length
      ? pendingRequests.map((request) => renderRequest(request, false)).join('')
      : '<p class="muted">No queued updates right now.</p>';
    processedRequestList.classList.toggle('empty', processedRequests.length === 0);
    processedRequestList.innerHTML = processedRequests.length
      ? processedRequests.map((request) => renderRequest(request, true)).join('')
      : '<p class="muted">No processed requests yet.</p>';
    bindRequestActions();
  }

  function setView(view) {
    state.view = view;
    render();
  }

  function updateViewTabs() {
    const listActive = state.view === 'list';
    $('listViewBtn').classList.toggle('active', listActive);
    $('calendarViewBtn').classList.toggle('active', !listActive);
    $('listViewBtn').setAttribute('aria-pressed', String(listActive));
    $('calendarViewBtn').setAttribute('aria-pressed', String(!listActive));
  }

  function bindEventActions(root) {
    root.querySelectorAll('[data-cancel]').forEach((button) => {
      button.addEventListener('click', () => openCancel(button.dataset.cancel));
    });
    root.querySelectorAll('[data-replace]').forEach((button) => {
      button.addEventListener('click', () => openReplace(button.dataset.replace));
    });
  }

  function bindCalendarActions() {
    calendarView.querySelectorAll('[data-calendar-date]').forEach((button) => {
      button.addEventListener('click', () => {
        const date = button.dataset.calendarDate;
        const hasEvents = button.dataset.calendarHasEvents === 'true';
        state.selectedDate = date;
        if (!hasEvents) {
          openNewEvent(date);
          return;
        }
        openCalendarDayDialog(date);
      });
    });
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

  function renderCalendar(events) {
    if (!events.length) {
      state.selectedDate = '';
      return '<p class="muted">No events match this view in calendar mode.</p>';
    }

    const allEventMap = new Map();
    events.forEach((event) => {
      if (!allEventMap.has(event.date)) allEventMap.set(event.date, []);
      allEventMap.get(event.date).push(event);
    });

    const firstEventDate = events[0].date;
    if (!state.selectedDate || !allEventMap.has(state.selectedDate)) {
      state.selectedDate = firstEventDate;
    }

    const initiallySelectedEvents = (allEventMap.get(state.selectedDate) || []).sort((a, b) => `${a.time} ${a.opponent}`.localeCompare(`${b.time} ${b.opponent}`));
    if (!initiallySelectedEvents.length && firstEventDate) {
      state.selectedDate = firstEventDate;
    }

    const monthNames = state.month === 'All months'
      ? [...new Set(events.map((event) => event.month))]
      : [state.month];
    const monthSections = monthNames.map((month) => {
      const monthEvents = events.filter((event) => event.month === month);
      if (!monthEvents.length) return '';
      const monthDates = monthEvents.map((event) => new Date(`${event.date}T12:00:00`));
      const firstDate = new Date(Math.min(...monthDates));
      const monthStart = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1, 12);
      const monthEnd = new Date(firstDate.getFullYear(), firstDate.getMonth() + 1, 0, 12);
      const startOffset = monthStart.getDay();
      const totalDays = monthEnd.getDate();
      const eventMap = new Map();

      monthEvents.forEach((event) => {
        if (!eventMap.has(event.date)) eventMap.set(event.date, []);
        eventMap.get(event.date).push(event);
      });

      const selectedInMonth = state.selectedDate && eventMap.has(state.selectedDate);
      const selectedEvents = selectedInMonth
        ? (eventMap.get(state.selectedDate) || []).sort((a, b) => `${a.time} ${a.opponent}`.localeCompare(`${b.time} ${b.opponent}`))
        : [];
      const selectedLabel = selectedInMonth
        ? new Date(`${state.selectedDate}T12:00:00`).toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
          })
        : '';

      const cells = [];
      for (let i = 0; i < startOffset; i += 1) cells.push('<div class="calendar-day filler" aria-hidden="true"></div>');
      for (let day = 1; day <= totalDays; day += 1) {
        const cellDate = new Date(firstDate.getFullYear(), firstDate.getMonth(), day, 12);
        const dateKey = cellDate.toISOString().slice(0, 10);
        const dayEvents = (eventMap.get(dateKey) || []).sort((a, b) => `${a.time} ${a.opponent}`.localeCompare(`${b.time} ${b.opponent}`));
        const preview = dayEvents.slice(0, 2).map((event) => `
          <span class="calendar-pill ${eventClass(event)}${/cancel|replace/.test(event.pendingState || '') || isCancelledSourceEvent(event) ? ' strike' : ''}">${escapeHtml(event.time)} ${escapeHtml(shortEventLabel(event))}</span>
        `).join('');
        const moreLabel = dayEvents.length > 2 ? `<span class="calendar-more">+${dayEvents.length - 2} more</span>` : '';
        const activeClass = state.selectedDate === dateKey ? ' active' : '';
        const hasEventsClass = dayEvents.length ? ' has-events' : ' empty';
        cells.push(`
          <button class="calendar-day${activeClass}${hasEventsClass}" type="button" data-calendar-date="${dateKey}" data-calendar-has-events="${dayEvents.length ? 'true' : 'false'}">
            <span class="calendar-date">${day}</span>
            <span class="calendar-count">${dayEvents.length ? `${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}` : 'No events'}</span>
            <span class="calendar-preview">${preview}${moreLabel}</span>
          </button>
        `);
      }

      return `
        <section class="calendar-shell">
          <div class="calendar-head">
            <h3>${escapeHtml(month)}</h3>
            <span>Click a day with events to review it, or an empty day to start a new request.</span>
          </div>
          <div class="calendar-grid" role="grid" aria-label="${escapeHtml(month)} team calendar">
            ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => `<div class="calendar-weekday">${day}</div>`).join('')}
            ${cells.join('')}
          </div>
        </section>
      `;
    }).join('');

    return monthSections;
  }

  function shortEventLabel(event) {
    const label = String(event.opponent || event.eventKind || event.type || 'Event').trim();
    return label.length > 28 ? `${label.slice(0, 28).trim()}...` : label;
  }

  function isCancelledSourceEvent(event) {
    return `${event.eventKind || ''} ${event.type || ''}`.toLowerCase().includes('cancelled');
  }

  function renderEvent(event) {
    const date = new Date(`${event.date}T12:00:00`);
    const dateLabel = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const kindClass = eventClass(event);
    const end = event.endTime ? `-${escapeHtml(event.endTime)}` : '';
    const pendingStateClass = event.pendingState ? ` ${event.pendingState}` : '';
    const sourceCancelled = isCancelledSourceEvent(event);
    const pendingBadge = event.pendingLabel
      ? `<span class="pending-badge">${escapeHtml(event.pendingLabel)}</span>`
      : sourceCancelled
        ? '<span class="pending-badge">Cancelled on Turtle Club</span>'
        : '';
    const strikeClass = /cancel|replace/.test(event.pendingState || '') || sourceCancelled ? ' strike' : '';
    const alreadyCancelled = sourceCancelled;
    const actions = isReadOnlyCoachViewer()
      ? '<div class="row-actions"><button class="replace-btn static-btn" type="button" disabled>View only</button></div>'
      : event.pendingState && event.pendingState !== 'approved-new'
      ? `<div class="row-actions"><button class="replace-btn static-btn" type="button" disabled>${event.status === 'approved' ? 'Approved' : 'Queued'}</button></div>`
      : alreadyCancelled
        ? `<div class="row-actions"><button class="replace-btn static-btn" type="button" disabled>Already cancelled</button></div>`
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

  function openCalendarDayDialog(date) {
    const events = visibleEvents().filter((event) => event.date === date);
    const dayDate = new Date(`${date}T12:00:00`);
    $('calendarDayTitle').textContent = dayDate.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
    $('calendarDaySubtitle').textContent = `${events.length} ${events.length === 1 ? 'event' : 'events'} for ${state.team}`;
    $('calendarDayEvents').innerHTML = events.length
      ? events.map(renderEvent).join('')
      : '<p class="muted">No events on this day.</p>';
    $('calendarDayNewEventBtn').dataset.date = date;
    $('calendarDayNewEventBtn').hidden = isReadOnlyCoachViewer();
    bindEventActions($('calendarDayEvents'));
    calendarDayDialog.showModal();
  }

  function renderRequest(request, processed) {
    const statusLabel = request.status === 'approved' ? 'Approved' : request.status === 'rejected' ? 'Rejected' : 'Pending';
    const reviewed = processed && request.reviewedAt
      ? `<span class="request-meta">Processed ${escapeHtml(formatDateTime(request.reviewedAt))}</span>`
      : '';
    const note = request.adminNote
      ? `<span class="request-note"><strong>Admin note:</strong> ${escapeHtml(request.adminNote)}</span>`
      : '';
    return `
      <article class="request-card ${escapeHtml(request.status || 'pending')} ${processed ? 'processed' : ''}">
        ${isReadOnlyCoachViewer() ? '' : `<button class="request-dismiss" type="button" data-delete-request="${escapeHtml(request.id)}" aria-label="Delete request">x</button>`}
        <strong>${escapeHtml(request.action)} - ${escapeHtml(request.team)}</strong>
        <span>${escapeHtml(request.date)} ${escapeHtml(request.start || '')} ${escapeHtml(request.opponent || '')}</span>
        <span>${escapeHtml(request.diamond || '')}</span>
        <span>${escapeHtml(statusLabel)}</span>
        ${reviewed}
        ${note}
      </article>
    `;
  }

  function bindRequestActions() {
    document.querySelectorAll('[data-delete-request]').forEach((button) => {
      button.addEventListener('click', async () => {
        const response = await fetch(`/api/requests/${button.dataset.deleteRequest}`, {
          method: 'DELETE'
        });
        if (!response.ok) return;
        await loadRequests();
        render();
      });
    });
  }

  function openCancel(eventId) {
    if (calendarDayDialog.open) calendarDayDialog.close();
    const event = data.schedule.find((item) => item.id === eventId);
    if (!event) return;
    if (`${event.eventKind || ''} ${event.type || ''}`.toLowerCase().includes('cancelled')) {
      alert('This event is already marked cancelled on Turtle Club, so there is nothing left to cancel.');
      return;
    }
    $('dialogTitle').textContent = `Cancel ${event.opponent}`;
    $('requestMode').value = 'cancel';
    $('eventId').value = eventId;
    $('cancelReason').value = '';
    $('cancelFields').hidden = false;
    $('newFields').hidden = true;
    $('checkBtn').hidden = true;
    dialog.showModal();
  }

  function openNewEvent(initialDate = '') {
    if (calendarDayDialog.open) calendarDayDialog.close();
    $('dialogTitle').textContent = 'Create New Event';
    $('requestMode').value = 'new';
    $('eventId').value = '';
    $('eventTypeSelect').value = 'Home Game';
    $('gameDate').value = initialDate || state.selectedDate || nextOpenDate();
    $('startTime').value = '18:00';
    $('endTime').value = '20:00';
    $('awayDiamondInput').value = '';
    setOpponentValue('');
    $('notesInput').value = '';
    $('availabilityResult').className = 'availability-result';
    $('availabilityResult').textContent = 'Choose a diamond and time, then check availability.';
    $('cancelFields').hidden = true;
    $('newFields').hidden = false;
    $('checkBtn').hidden = false;
    syncEventTypeControls();
    dialog.showModal();
  }

  function openReplace(eventId) {
    if (calendarDayDialog.open) calendarDayDialog.close();
    const original = data.schedule.find((item) => item.id === eventId);
    if (!original) return;
    if (`${original.eventKind || ''} ${original.type || ''}`.toLowerCase().includes('cancelled')) {
      alert('This event is already marked cancelled on Turtle Club. Create a new event instead of replacing it.');
      return;
    }
    $('dialogTitle').textContent = `Replace ${original.eventKind || original.type}`;
    $('requestMode').value = 'replace';
    $('eventId').value = eventId;
    $('eventTypeSelect').value = original.eventKind === 'Practice' ? 'Home Game' : 'Practice';
    $('gameDate').value = original.date;
    $('startTime').value = toInputTime(original.time);
    $('endTime').value = original.endTime ? toInputTime(original.endTime) : toInputTimeFromMinutes(minutesFromDisplay(original.time) + 120);
    if (diamonds.includes(original.diamond)) $('diamondSelect').value = original.diamond;
    $('awayDiamondInput').value = original.diamond || '';
    setOpponentValue(original.eventKind === 'Practice' ? original.opponent : '');
    $('notesInput').value = `Replacing ${original.eventKind || original.type}: ${original.opponent} at ${original.diamond}`;
    $('availabilityResult').className = 'availability-result';
    $('availabilityResult').textContent = 'This replacement will be checked against published availability and Turtle Club event conflicts.';
    $('cancelFields').hidden = true;
    $('newFields').hidden = false;
    $('checkBtn').hidden = false;
    syncEventTypeControls();
    dialog.showModal();
  }

  function nextOpenDate() {
    const teamEvents = data.schedule.filter((event) => event.team === state.team);
    return (teamEvents[0] && teamEvents[0].date) || dateBounds.min;
  }

  function buildOpponentOptions() {
    const titansTeams = new Set((data.teams || []).map((team) => normalizedSearchKey(normalizeOpponentLabel(team))).filter(Boolean));
    const choiceMap = new Map();

    function maybeAddOpponent(value) {
      const label = normalizeOpponentLabel(value);
      const key = normalizedSearchKey(label);
      if (!key || titansTeams.has(key) || !isOpponentChoice(label)) return;
      if (!choiceMap.has(key)) {
        choiceMap.set(key, label);
      }
    }

    turtleClubOpponentCatalog.forEach(maybeAddOpponent);
    (data.opponentOptions || []).forEach(maybeAddOpponent);
    if (!choiceMap.size) {
      const sources = [...(data.schedule || []), ...(data.conflictEvents || [])];
      sources.forEach((event) => {
        const isGame = /game/i.test(String(event.eventKind || event.type || ''));
        if (!isGame) return;
        maybeAddOpponent(event.opponent);
        maybeAddOpponent(event.team);
      });
    }
    return [...choiceMap.values()].sort((a, b) => a.localeCompare(b));
  }

  function buildVenueOptions() {
    const choiceMap = new Map();
    const excludedVenuePrefixes = ['turtle club', 'tc -', 'vollmer', 'villanova'];

    function maybeAddVenue(value) {
      const label = String(value || '').trim();
      const normalized = normalizeVenueLabel(label);
      const key = normalizedSearchKey(normalized);
      if (!key) return;
      if (key === 'home venues') return;
      if (excludedVenuePrefixes.some((prefix) => key.startsWith(prefix))) return;
      if (!choiceMap.has(key)) {
        choiceMap.set(key, label);
      }
    }

    turtleClubVenueCatalog.forEach(maybeAddVenue);
    if (!choiceMap.size) {
      [...(data.schedule || []), ...(data.conflictEvents || [])].forEach((item) => {
        maybeAddVenue(item.diamond);
      });
    }

    return [...choiceMap.values()].sort((a, b) => a.localeCompare(b));
  }

  function normalizeOpponentLabel(value) {
    return String(value || '')
      .replace(/^@+/, '')
      .replace(/^vs\.?\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeVenueLabel(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isOpponentChoice(value) {
    const clean = normalizeOpponentLabel(value);
    if (!clean) return false;
    return !/^(select an opponent|practice|tryout|field booking|event|home game|away game|tournament|regular season|local game|playoff round|intrasquad|global note)$/i.test(clean);
  }

  function rebuildOpponentSelect() {
    if (!opponentOptions.length) $('opponentInput').value = '';
    renderFilteredSelect('opponent');
  }

  function rebuildAwayVenueOptions() {
    if (!venueOptions.length) $('awayDiamondInput').value = '';
    renderFilteredSelect('venue');
  }

  function setOpponentValue(value) {
    const input = $('opponentInput');
    if (!input) return;
    const normalized = normalizeOpponentLabel(value);
    if (!normalized) {
      input.value = '';
      return;
    }
    input.value = normalized;
  }

  function normalizedSearchKey(value) {
    return String(value || '').trim().toLowerCase();
  }

  function canonicalOptionValue(options, value, normalize) {
    const target = normalizedSearchKey(normalize(value));
    if (!target) return '';
    return options.find((option) => normalizedSearchKey(normalize(option)) === target) || '';
  }

  function showFilterSelect(kind) {
    const config = filterSelectConfig(kind);
    if (!config.menu) return;
    config.menu.hidden = false;
  }

  function hideFilterSelect(kind) {
    const config = filterSelectConfig(kind);
    if (!config.menu) return;
    config.menu.hidden = true;
  }

  function scheduleHideFilterSelect(kind) {
    window.setTimeout(() => {
      const config = filterSelectConfig(kind);
      if (!config.shell) return;
      const active = document.activeElement;
      if (active && config.shell.contains(active)) return;
      hideFilterSelect(kind);
    }, 120);
  }

  function filterSelectConfig(kind) {
    if (kind === 'opponent') {
      return {
        shell: $('opponentInput').parentElement,
        input: $('opponentInput'),
        menu: $('opponentMenu'),
        options: opponentOptions,
        normalize: normalizeOpponentLabel
      };
    }
    return {
      shell: $('awayDiamondInput').parentElement,
      input: $('awayDiamondInput'),
      menu: $('awayDiamondMenu'),
      options: venueOptions,
      normalize: normalizeVenueLabel
    };
  }

  function renderFilteredSelect(kind) {
    const config = filterSelectConfig(kind);
    if (!config.input || !config.menu) return;
    const query = config.normalize(config.input.value);
    const queryKey = normalizedSearchKey(query);
    const choices = (query ? config.options.filter((option) => {
      const normalized = normalizedSearchKey(config.normalize(option));
      return !queryKey || normalized.includes(queryKey);
    }) : config.options);
    const exact = choices.find((option) => normalizedSearchKey(config.normalize(option)) === queryKey);
    config.menu.innerHTML = choices.map((option) => `
      <button class="filter-select-item" type="button" data-filter-value="${escapeHtml(option)}">${escapeHtml(option)}</button>
    `).join('');
    if (!choices.length) {
      config.menu.hidden = true;
    }
    if (exact) {
      config.shell && config.shell.classList.add('is-selected');
    } else if (choices.length) {
      config.shell && config.shell.classList.remove('is-selected');
    } else {
      config.shell && config.shell.classList.remove('is-selected');
    }
  }

  function syncFilterSelectChoice(kind, value) {
    const config = filterSelectConfig(kind);
    if (!config.input || !value) return;
    config.input.value = value;
    hideFilterSelect(kind);
    renderFilteredSelect(kind);
  }

  function selectedOpponentValue() {
    const eventType = $('eventTypeSelect').value;
    if (/practice/i.test(eventType)) return 'Practice';
    const selected = canonicalOptionValue(opponentOptions, $('opponentInput').value, normalizeOpponentLabel);
    return selected || normalizeOpponentLabel($('opponentInput').value);
  }

  function selectedVenueValue() {
    if (/away game/i.test($('eventTypeSelect').value)) {
      const selected = canonicalOptionValue(venueOptions, $('awayDiamondInput').value, normalizeVenueLabel);
      return selected || String($('awayDiamondInput').value || '').trim();
    }
    return $('diamondSelect').value;
  }

  function syncEventTypeControls() {
    const eventType = $('eventTypeSelect').value;
    const isPractice = /practice/i.test(eventType);
    const isAwayGame = /away game/i.test(eventType);
    $('opponentField').hidden = isPractice;
    $('opponentInput').disabled = isPractice;
    if (isPractice) hideFilterSelect('opponent');
    renderFilteredSelect('opponent');
    $('diamondSelect').parentElement.hidden = isAwayGame;
    $('diamondSelect').disabled = isAwayGame;
    $('awayFieldField').hidden = !isAwayGame;
    $('awayDiamondInput').disabled = !isAwayGame;
    if (!isAwayGame) hideFilterSelect('venue');
    renderFilteredSelect('venue');
  }

  async function queueRequest(event) {
    event.preventDefault();
    if (state.submittingRequest) return;
    if (isReadOnlyCoachViewer()) {
      alert('This account can review all coach requests here, but it cannot queue schedule changes from the coach page.');
      return;
    }
    const mode = $('requestMode').value;
    let payload;

    if (mode === 'cancel') {
      const original = data.schedule.find((item) => item.id === $('eventId').value);
      const cancelReason = $('cancelReason').value.trim();
      if (!cancelReason) {
        alert('Please enter a reason for cancellation before queuing this request.');
        return;
      }
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
        reason: cancelReason,
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
      const selectedOpponent = selectedOpponentValue();
      const selectedVenue = selectedVenueValue();
      if (!/practice/i.test($('eventTypeSelect').value) && !selectedOpponent) {
        const box = $('availabilityResult');
        box.className = 'availability-result bad';
        box.textContent = 'Choose the opponent team from the Turtle Club list before queuing this request.';
        return;
      }
      if (!/practice/i.test($('eventTypeSelect').value) && opponentOptions.length && !opponentOptions.includes(selectedOpponent)) {
        const box = $('availabilityResult');
        box.className = 'availability-result bad';
        box.textContent = 'Choose an opponent from the Turtle Club suggestion list.';
        return;
      }
      if (!selectedVenue) {
        const box = $('availabilityResult');
        box.className = 'availability-result bad';
        box.textContent = /away game/i.test($('eventTypeSelect').value)
          ? 'Choose the away field before queuing this request.'
          : 'Choose a diamond before queuing this request.';
        return;
      }
      if (/away game/i.test($('eventTypeSelect').value) && venueOptions.length && !venueOptions.includes(selectedVenue)) {
        const box = $('availabilityResult');
        box.className = 'availability-result bad';
        box.textContent = 'Choose an away field from the Turtle Club venue suggestions.';
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
        opponent: selectedOpponent || 'Practice',
        diamond: selectedVenue,
        reason: $('notesInput').value.trim(),
        availabilityStatus: check.message,
        submittedBy: state.team
      };
    }

    if ((mode === 'new' || mode === 'replace') && payload.date && payload.date < todayIsoLocal()) {
      alert('Turtle Club does not allow creating back-dated events. Please choose today or a future date.');
      return;
    }

    try {
      setRequestSubmitting(true, mode === 'cancel'
        ? 'Queueing cancellation...'
        : mode === 'replace'
          ? 'Queueing replacement...'
          : 'Queueing request...');
      const response = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        let message = 'The request could not be saved to the server.';
        try {
          const errorPayload = await response.json();
          message = errorPayload.details || errorPayload.error || message;
        } catch (_) {
          // Leave the generic message in place.
        }
        throw new Error(message);
      }
      await loadRequests();
      dialog.close();
      render();
    } catch (error) {
      alert(error.message || 'The request could not be saved to the server.');
    } finally {
      setRequestSubmitting(false);
    }
  }

  function setRequestSubmitting(isSubmitting, title = 'Working...', detail = 'Please wait while the scheduler saves your request.') {
    state.submittingRequest = isSubmitting;
    if (loadingOverlay) {
      loadingOverlay.hidden = !isSubmitting;
      $('loadingOverlayTitle').textContent = title;
      $('loadingOverlayTextLabel').textContent = detail;
    }
    const dialogOverlay = $('requestDialogOverlay');
    if (dialogOverlay) {
      dialogOverlay.hidden = !isSubmitting;
      $('requestDialogOverlayTitle').textContent = title;
      $('requestDialogOverlayTextLabel').textContent = detail;
    }
    const submitButton = $('queueRequestBtn');
    if (submitButton) {
      submitButton.disabled = isSubmitting;
      submitButton.textContent = isSubmitting ? 'Queueing' : 'Queue request';
      submitButton.classList.toggle('button-loading-text', isSubmitting);
    }
    $('checkBtn').disabled = isSubmitting;
    $('closeDialog').disabled = isSubmitting;
    $('newGameBtn').disabled = isSubmitting;
  }

  function renderAvailabilityCheck() {
    const result = checkAvailability();
    const box = $('availabilityResult');
    box.className = `availability-result ${result.ok ? 'good' : 'bad'}`;
    box.textContent = result.message;
  }

  function checkAvailability() {
    const date = $('gameDate').value;
    const diamond = selectedVenueValue();
    const normalizedDiamond = normalizeAvailabilityDiamond(diamond);
    const eventType = $('eventTypeSelect').value;
    const isAwayGame = /away game/i.test(eventType);
    const start = minutes($('startTime').value);
    const end = minutes($('endTime').value);
    if (!date || !diamond || start >= end) return { ok: false, message: 'Enter a valid date, start, and end time.' };
    if (($('requestMode').value === 'new' || $('requestMode').value === 'replace') && date < todayIsoLocal()) {
      return { ok: false, message: 'Turtle Club does not allow creating back-dated events. Choose today or a future date.' };
    }

    const ignoredId = $('requestMode').value === 'replace' ? $('eventId').value : '';
    const original = ignoredId ? data.schedule.find((item) => item.id === ignoredId) : null;
    const freedSlots = [];

    if (original && original.date === date && normalizeAvailabilityDiamond(original.diamond) === normalizedDiamond) {
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
        if (request.originalDate !== date || normalizeAvailabilityDiamond(request.originalDiamond) !== normalizedDiamond || !request.originalId) return;
        if (ignoredId && request.originalId === ignoredId) return;
        freedSlots.push({
          id: request.originalId,
          start: minutesFromDisplay(request.originalStart),
          end: request.end ? minutesFromDisplay(request.end) : minutesFromDisplay(request.originalStart) + 120,
          source: request.originalType || 'event'
        });
      });

    const conflict = (data.conflictEvents || data.schedule).find((item) => {
      if (item.id === ignoredId) return false;
      if (freedSlots.some((slot) => slot.id === item.id)) return false;
      const eventStart = minutesFromDisplay(item.time);
      const eventEnd = item.endTime ? minutesFromDisplay(item.endTime) : eventStart + (item.durationMinutes || 120);
      return item.date === date && normalizeAvailabilityDiamond(item.diamond) === normalizedDiamond && start < eventEnd && end > eventStart;
    });
    if (conflict) return { ok: false, message: `Diamond conflict with ${conflict.team} ${conflict.opponent} (${conflict.eventKind || conflict.type}) at ${conflict.time}.` };

    if (isAwayGame) {
      return { ok: true, message: `Available: no Turtle Club away-game conflict overlaps at ${diamond}.` };
    }

    const openSlot = data.availability.find((slot) => {
      return slot.date === date && normalizeAvailabilityDiamond(slot.diamond) === normalizedDiamond && minutesFromDisplay(slot.start) <= start && minutesFromDisplay(slot.end) >= end;
    });
    const fitsFreedSlot = freedSlots.find((slot) => slot.start <= start && slot.end >= end);
    if (!openSlot && !fitsFreedSlot) return { ok: false, message: 'This request does not fit a published open diamond block or a time slot already being freed by a queued change.' };

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

  function todayIsoLocal() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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

  function isStatusEditorUser() {
    return state.user && state.user.role === 'status_editor';
  }

  function canViewAllTeams() {
    return isAdminUser() || isStatusEditorUser();
  }

  function isReadOnlyCoachViewer() {
    return isStatusEditorUser();
  }

  function showLogin() {
    $('loginShell').hidden = false;
    $('appShell').hidden = true;
    $('sessionLabel').hidden = true;
    $('logoutBtn').hidden = true;
    $('adminLink').hidden = true;
    $('fieldStatusLink').hidden = true;
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
