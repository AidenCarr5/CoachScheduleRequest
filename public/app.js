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
  const opponentDialog = $('opponentDialog');
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
    submittingOpponentChange: false,
    publicConfig: { adminPath: '/admin.html', fieldStatusPath: '', profilePath: '' },
    user: null,
    preload: {
      promise: null,
      progress: 0,
      completed: false
    }
  };

  const MASTER_SCHEDULE_UNAVAILABLE_RULES = {
    weekly: [
      { day: 'Monday', start: '5:00 PM', end: '9:00 PM', diamonds: ['Vollmer #2', 'Vollmer #5', 'Vollmer #6', 'Vollmer #7', 'Vollmer #8'] },
      { day: 'Monday', start: '5:00 PM', end: '9:00 PM', diamonds: ['River Canard #1', 'River Canard #3', 'River Canard #4'] },
      { day: 'Tuesday', start: '5:00 PM', end: '9:00 PM', diamonds: ['River Canard #1', 'River Canard #2'] },
      { day: 'Wednesday', start: '5:00 PM', end: '9:00 PM', diamonds: ['River Canard #1', 'River Canard #3', 'River Canard #4'] },
      { day: 'Thursday', start: '5:00 PM', end: '9:00 PM', diamonds: ['Vollmer #1', 'River Canard #1', 'River Canard #3', 'River Canard #4'] },
      { day: 'Friday', start: '5:00 PM', end: '9:00 PM', diamonds: ['Vollmer #1', 'River Canard #1', 'River Canard #2', 'River Canard #3', 'River Canard #4'] },
      { day: 'Saturday', start: '9:00 AM', end: '8:00 PM', diamonds: ['Vollmer #8'] },
      { day: 'Sunday', start: '9:00 AM', end: '2:00 PM', diamonds: ['Vollmer #4', 'Vollmer #5', 'Vollmer #6', 'Vollmer #7', 'Vollmer #8'] }
    ],
    postHouseLeague: [
      { day: 'Monday', start: '5:00 PM', end: '9:00 PM', diamonds: ['Vollmer #2', 'Vollmer #5', 'Vollmer #6', 'Vollmer #7', 'Vollmer #8', 'River Canard #1'] },
      { day: 'Tuesday', start: '5:00 PM', end: '9:00 PM', diamonds: ['River Canard #1', 'River Canard #2'] },
      { day: 'Wednesday', start: '5:00 PM', end: '9:00 PM', diamonds: ['River Canard #1'] },
      { day: 'Thursday', start: '5:00 PM', end: '9:00 PM', diamonds: ['Vollmer #1', 'Vollmer #2', 'Vollmer #5', 'Vollmer #6', 'Vollmer #7', 'Vollmer #8', 'River Canard #1'] },
      { day: 'Friday', start: '5:00 PM', end: '9:00 PM', diamonds: ['Vollmer #1'] },
      { day: 'Saturday', start: '9:00 AM', end: '3:00 PM', diamonds: ['Vollmer #1'] },
      { day: 'Saturday', start: '9:00 AM', end: '8:00 PM', diamonds: ['Vollmer #2', 'Vollmer #3', 'Vollmer #5', 'Vollmer #6', 'Vollmer #7', 'Vollmer #8', 'River Canard #1', 'River Canard #2', 'River Canard #3', 'River Canard #4'] },
      { day: 'Saturday', start: '9:00 AM', end: '1:00 PM', diamonds: ['Vollmer #4'] },
      { day: 'Saturday', start: '5:00 PM', end: '8:00 PM', diamonds: ['Vollmer #4'] },
      { day: 'Sunday', start: '9:00 AM', end: '8:00 PM', diamonds: ['Vollmer #2', 'Vollmer #3', 'Vollmer #5', 'Vollmer #6', 'Vollmer #7', 'Vollmer #8', 'River Canard #1', 'River Canard #2', 'River Canard #3', 'River Canard #4'] },
      { day: 'Sunday', start: '2:00 PM', end: '8:00 PM', diamonds: ['Vollmer #1', 'Vollmer #4'] }
    ]
  };

  async function init() {
    $('coachLoginForm').addEventListener('submit', login);
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
      $('closeOpponentDialog').addEventListener('click', () => opponentDialog.close());
      $('cancelOpponentChangeBtn').addEventListener('click', () => opponentDialog.close());
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
      $('opponentChangeInput').addEventListener('input', () => {
        showFilterSelect('opponentChange');
        renderFilteredSelect('opponentChange');
      });
      $('opponentChangeInput').addEventListener('focus', () => {
        showFilterSelect('opponentChange');
        renderFilteredSelect('opponentChange');
      });
      $('opponentChangeInput').addEventListener('blur', () => scheduleHideFilterSelect('opponentChange'));
      $('opponentChangeMenu').addEventListener('mousedown', (event) => {
        const option = event.target.closest('[data-filter-value]');
        if (!option) return;
        event.preventDefault();
        syncFilterSelectChoice('opponentChange', option.dataset.filterValue);
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
      $('opponentForm').addEventListener('submit', submitOpponentChange);
      window.addEventListener('focus', syncRequests);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && state.user) syncRequests();
      });
      appStarted = true;
    }

    await loadPublicConfig();
    if (window.refreshTopNav) {
      window.refreshTopNav();
    }
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
    state.publicConfig = payload.publicConfig || { adminPath: '/admin.html', fieldStatusPath: '', profilePath: '' };
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
      state.publicConfig = { adminPath: '/admin.html', fieldStatusPath: '', profilePath: '' };
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
          const originals = matchingCancellationEvents(schedule, request, byId);
          if (originals.length) {
            originals.forEach((original) => {
              original.pendingState = eventStatus === 'approved' ? 'approved-cancel' : 'cancelled';
              original.pendingLabel = eventStatus === 'approved' ? 'Approved cancellation' : 'Pending cancellation';
              original.requestIndex = index;
            });
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
          const approvedMatches = schedule.filter((event) => eventMatchesApprovedRequest(event, request));
          if (approvedMatches.length) {
            const approvedEvent = approvedMatches[0];
            approvedEvent.pendingState = 'approved-new';
            approvedEvent.pendingLabel = 'Approved request';
            approvedEvent.requestIndex = index;
            for (let matchIndex = schedule.length - 1; matchIndex >= 0; matchIndex -= 1) {
              const candidate = schedule[matchIndex];
              if (candidate !== approvedEvent && approvedMatches.includes(candidate)) {
                schedule.splice(matchIndex, 1);
              }
            }
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

    return consolidateDisplaySchedule(schedule);
  }

  function consolidateDisplaySchedule(schedule) {
    const byKey = new Map();
    const result = [];
    for (const event of schedule) {
      const key = displayEventKey(event);
      const existingIndex = byKey.get(key);
      if (existingIndex === undefined) {
        byKey.set(key, result.length);
        result.push(event);
        continue;
      }
      const existing = result[existingIndex];
      if (displayEventRank(event) > displayEventRank(existing)) {
        result[existingIndex] = event;
      }
    }
    return result;
  }

  function displayEventRank(event) {
    if (/approved/i.test(event.pendingState || '')) return 4;
    if (event.pendingState) return 3;
    if (/control panel/i.test(event.source || '')) return 2;
    return 1;
  }

  function displayEventKey(event) {
    const kind = normalizeDisplayGameKind(event.eventKind || event.type);
    const homeLikeGame = kind.includes('home') || kind.includes('local');
    return [
      event.date || '',
      minutesFromDisplay(event.time),
      event.endTime ? minutesFromDisplay(event.endTime) : '',
      normalizeScheduleComparison(event.team),
      kind,
      homeLikeGame ? '' : normalizeScheduleComparison(normalizeAvailabilityDiamond(event.diamond)),
      normalizeDisplayOpponent(event.opponent)
    ].join('|');
  }

  function matchingCancellationEvents(schedule, request, byId) {
    if (request.originalGroupId) {
      const groupMatches = schedule.filter((event) => tournamentGroupKey(event) === request.originalGroupId);
      if (groupMatches.length) return groupMatches;
    }
    const original = byId.get(request.originalId);
    return original ? [original] : [];
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

    const eventKind = normalizeDisplayGameKind(event.eventKind || event.type);
    const requestKind = normalizeDisplayGameKind(request.newType || request.originalType || 'Event');
    if (!displayGameKindsMatch(eventKind, requestKind)) return false;

    const isAwayGame = eventKind.includes('away');
    const isHomeLikeGame = eventKind.includes('home') || eventKind.includes('local') || requestKind.includes('home') || requestKind.includes('local');
    if (!isAwayGame && !isHomeLikeGame) {
      const eventDiamond = normalizeScheduleComparison(normalizeAvailabilityDiamond(event.diamond));
      const requestDiamond = normalizeScheduleComparison(normalizeAvailabilityDiamond(request.diamond));
      if (eventDiamond !== requestDiamond) return false;
    }

    if (!approvedRequestTimeMatches(event, request, eventKind)) return false;

    const eventEnd = normalizeScheduleComparison(event.endTime || '');
    const requestEnd = normalizeScheduleComparison(request.end || '');
    if (eventEnd && requestEnd && eventEnd !== requestEnd) return false;
    if ((!eventEnd || !requestEnd) && !eventKind.includes('game')) return false;

    const eventOpponent = normalizeDisplayOpponent(event.opponent);
    const requestOpponent = normalizeDisplayOpponent(request.opponent);
    if (eventKind.includes('local') && (!eventOpponent || !requestOpponent)) return true;
    return displayOpponentMatches(eventOpponent, requestOpponent);
  }

  function normalizeDisplayOpponent(value) {
    return normalizeScheduleComparison(value)
      .replace(/^(lasalle\s+)?(athletics|titans)\s*-\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function displayOpponentMatches(left, right) {
    if (!left || !right) return false;
    return left === right || left.includes(right) || right.includes(left);
  }

  function normalizeDisplayGameKind(value) {
    const normalized = normalizeScheduleComparison(value);
    if (normalized.includes('local') && normalized.includes('game')) return 'local game';
    if (normalized.includes('home') && normalized.includes('game')) return 'home game';
    if (normalized.includes('away') && normalized.includes('game')) return 'away game';
    return normalized;
  }

  function displayGameKindsMatch(left, right) {
    if (left === right) return true;
    const homeLike = new Set(['home game', 'local game']);
    return homeLike.has(left) && homeLike.has(right);
  }

  function approvedRequestTimeMatches(event, request, eventKind) {
    const eventStart = minutesFromDisplay(event.time);
    const requestStart = minutesFromDisplay(request.start);
    if (!eventStart || !requestStart) {
      return normalizeScheduleComparison(event.time) === normalizeScheduleComparison(request.start);
    }
    if (eventStart === requestStart) return true;
    if (!eventKind.includes('game')) return false;

    const eventEnd = event.endTime
      ? minutesFromDisplay(event.endTime)
      : eventStart + (event.durationMinutes || 120);
    const requestEnd = request.end
      ? minutesFromDisplay(request.end)
      : requestStart + 120;
    if (!eventEnd || !requestEnd || eventEnd <= eventStart || requestEnd <= requestStart) return false;
    return eventStart < requestEnd && eventEnd > requestStart;
  }

  function normalizeScheduleComparison(value) {
    return String(value || '')
      .replace(/^(vs\.?|@|at)\s*/i, '')
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

  function isHomeVenueDiamond(value) {
    const normalized = normalizeScheduleComparison(normalizeAvailabilityDiamond(value));
    return ['turtle club', 'vollmer', 'villanova', 'river canard'].some((prefix) => normalized.startsWith(prefix));
  }

  function isAllHomeDiamondsEvent(event) {
    return normalizeScheduleComparison(normalizeAvailabilityDiamond(event && event.diamond)) === 'home diamonds';
  }

  function eventMatchesSelectedDiamond(event, normalizedDiamond) {
    const eventDiamond = normalizeAvailabilityDiamond(event && event.diamond);
    return eventDiamond === normalizedDiamond || (isAllHomeDiamondsEvent(event) && isHomeVenueDiamond(normalizedDiamond));
  }

  function buildHistoricalEvent(request, index, pendingState, pendingLabel) {
    return {
      id: `history-${request.id}`,
      date: request.originalDate || request.date,
      month: monthLabelFromDate(request.originalDate || request.date),
      time: request.originalStart || request.start,
      endTime: request.originalEnd || request.end || '',
      durationMinutes: (request.originalEnd || request.end)
        ? Math.max(30, minutesFromDisplay(request.originalEnd || request.end) - minutesFromDisplay(request.originalStart || request.start))
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
    $('adminLink').hidden = !(isAdminUser() || isReadOnlyAdminUser());
    $('fieldStatusLink').href = state.publicConfig.fieldStatusPath || '/diamond-status-admin.html';
    $('fieldStatusLink').hidden = !(state.publicConfig.fieldStatusPath && (isAdminUser() || isReadOnlyAdminUser() || isStatusEditorUser()));
    $('sessionLabel').hidden = false;
    $('sessionLabel').textContent = isAdminUser()
      ? `${state.user.initials || 'AC'} - admin`
      : isReadOnlyAdminUser()
        ? `${state.user.initials || 'DH'} - ${state.user.username || 'DonHunt'} (view only)`
        : isStatusEditorUser()
          ? `${state.user.initials || 'EC'} - ${state.user.username} (all coach view)`
          : `${state.user.initials ? `${state.user.initials} - ` : ''}${state.user.username}`;
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
    root.querySelectorAll('[data-change-opponent]').forEach((button) => {
      button.addEventListener('click', () => openOpponentChange(button.dataset.changeOpponent));
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

  function isTournamentEvent(event) {
    return `${event.eventKind || ''} ${event.type || ''}`.toLowerCase().includes('tournament');
  }

  function eventTeamAge(event) {
    const match = String(event && event.team || '').match(/(\d+)U/i);
    return match ? Number(match[1]) : NaN;
  }

  function derivedUmpireStatus(event) {
    const savedStatus = event && event.umpireStatus;
    if (savedStatus) return savedStatus;

    const age = eventTeamAge(event);
    if (Number.isFinite(age) && age >= 14) {
      return {
        source: 'auto-age',
        autoConfirmed: true,
        umpire1Confirmed: true,
        umpire2Confirmed: true,
        umpire1Name: '',
        umpire2Name: ''
      };
    }

    return {
      source: 'pending-refresh',
      autoConfirmed: false,
      umpire1Confirmed: false,
      umpire2Confirmed: false,
      umpire1Name: '',
      umpire2Name: ''
    };
  }

  function showUmpireStatus(event) {
    return String(event && event.eventKind || '').toLowerCase() === 'home game'
      && !isCancelledSourceEvent(event);
  }

  function renderUmpireStatus(event) {
    if (!showUmpireStatus(event)) return '';
    const status = derivedUmpireStatus(event);
    let note = '';
    if (status.source === 'pending-refresh') {
      note = '<span class="umpire-status-note">Official confirmation appears after Turtle Club refresh.</span>';
    }
    return `
      <div class="umpire-status-block">
        <div class="umpire-status-head">
          <span class="umpire-status-title">Umpires</span>
          ${note}
        </div>
        <div class="umpire-status-grid">
          <div class="umpire-status-card ${status.umpire1Confirmed ? 'confirmed' : 'pending'}">
            <span class="umpire-status-label">Umpire #1</span>
            <span class="umpire-status-state">${status.umpire1Confirmed ? 'Confirmed' : 'Pending'}</span>
          </div>
          <div class="umpire-status-card ${status.umpire2Confirmed ? 'confirmed' : 'pending'}">
            <span class="umpire-status-label">Umpire #2</span>
            <span class="umpire-status-state">${status.umpire2Confirmed ? 'Confirmed' : 'Pending'}</span>
          </div>
        </div>
      </div>
    `;
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
      ? `<div class="row-actions"><button class="replace-btn static-btn" type="button" disabled>${String(event.pendingState).startsWith('approved') ? 'Approved' : 'Queued'}</button></div>`
      : alreadyCancelled
        ? `<div class="row-actions"><button class="replace-btn static-btn" type="button" disabled>Already cancelled</button></div>`
      : isTournamentEvent(event)
        ? `<div class="row-actions"><button class="cancel-btn" data-cancel="${event.id}">Cancel</button></div>`
      : `<div class="row-actions">
          ${canChangeOpponent(event) ? `<button class="secondary" data-change-opponent="${event.id}">Change opponent</button>` : ''}
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
          ${renderUmpireStatus(event)}
        </div>
        ${actions}
      </article>
    `;
  }

  function canChangeOpponent(event) {
    const kind = `${event.eventKind || ''} ${event.type || ''}`.toLowerCase();
    return kind.includes('game') && !kind.includes('cancelled') && !isTournamentEvent(event);
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
    const event = findDisplayEventById(eventId);
    if (!event) return;
    if (`${event.eventKind || ''} ${event.type || ''}`.toLowerCase().includes('cancelled')) {
      alert('This event is already marked cancelled on Turtle Club, so there is nothing left to cancel.');
      return;
    }
    const title = isTournamentEvent(event) ? tournamentCancelTitle(event) : `Cancel ${event.opponent}`;
    $('dialogTitle').textContent = title;
    $('requestMode').value = 'cancel';
    $('eventId').value = eventId;
    $('cancelReason').value = '';
    $('cancelFields').hidden = false;
    $('newFields').hidden = true;
    $('checkBtn').hidden = true;
    dialog.showModal();
  }

  function tournamentCancelTitle(event) {
    const groupEvents = tournamentGroupEvents(event);
    if (groupEvents.length <= 1) return `Cancel ${event.opponent}`;
    return `Cancel ${event.opponent} (${groupEvents.length} days)`;
  }

  function tournamentGroupEvents(event) {
    if (!event) return [];
    const groupId = tournamentGroupKey(event);
    if (!groupId) return [event];
    return data.schedule.filter((item) => tournamentGroupKey(item) === groupId);
  }

  function tournamentGroupKey(event) {
    if (!event || !isTournamentEvent(event)) return '';
    if (event.tournamentGroupId) return event.tournamentGroupId;
    const key = `${event.team || ''}|${event.opponent || 'Tournament'}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `tournament-${key || 'event'}`;
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
    const original = findDisplayEventById(eventId);
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

  function openOpponentChange(eventId) {
    if (calendarDayDialog.open) calendarDayDialog.close();
    const event = data.schedule.find((item) => item.id === eventId);
    if (!event || !canChangeOpponent(event)) return;
    $('opponentEventId').value = eventId;
    $('opponentDialogTitle').textContent = 'Change Opponent';
    $('opponentDialogSubtitle').textContent = `${event.date} ${event.time} - ${event.eventKind || event.type}`;
    $('opponentChangeEventLabel').textContent = `${event.time}${event.endTime ? `-${event.endTime}` : ''} at ${event.diamond}`;
    $('opponentChangeCurrent').textContent = normalizeOpponentLabel(event.opponent) || 'Not set';
    $('opponentChangeInput').value = normalizeOpponentLabel(event.opponent);
    $('opponentDialogMessage').textContent = '';
    $('opponentDialogMessage').className = 'profile-message';
    renderFilteredSelect('opponentChange');
    setOpponentSubmitting(false);
    opponentDialog.showModal();
    window.setTimeout(() => {
      $('opponentChangeInput').focus();
      $('opponentChangeInput').select();
      showFilterSelect('opponentChange');
      renderFilteredSelect('opponentChange');
    }, 60);
  }

  function selectedOpponentChangeValue() {
    const selected = canonicalOptionValue(opponentOptions, $('opponentChangeInput').value, normalizeOpponentLabel);
    return selected || normalizeOpponentLabel($('opponentChangeInput').value);
  }

  async function submitOpponentChange(event) {
    event.preventDefault();
    if (state.submittingOpponentChange) return;
    const eventId = $('opponentEventId').value;
    const original = data.schedule.find((item) => item.id === eventId);
    const opponent = selectedOpponentChangeValue();
    if (!original || !canChangeOpponent(original)) {
      $('opponentDialogMessage').textContent = 'This game can no longer be changed.';
      $('opponentDialogMessage').className = 'profile-message error';
      return;
    }
    if (!opponent) {
      $('opponentDialogMessage').textContent = 'Choose the new opponent.';
      $('opponentDialogMessage').className = 'profile-message error';
      return;
    }
    if (opponentOptions.length && !canonicalOptionValue(opponentOptions, opponent, normalizeOpponentLabel)) {
      $('opponentDialogMessage').textContent = 'Choose an opponent from the Turtle Club list.';
      $('opponentDialogMessage').className = 'profile-message error';
      return;
    }
    if (normalizeScheduleComparison(original.opponent) === normalizeScheduleComparison(opponent)) {
      $('opponentDialogMessage').textContent = 'That opponent is already on this game.';
      $('opponentDialogMessage').className = 'profile-message error';
      return;
    }

    try {
      setOpponentSubmitting(true);
      const response = await fetch('/api/coach/events/opponent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, opponent })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.details || payload.error || 'Opponent could not be updated.');
      }
      const updatedEvent = payload.event || {};
      const updatedOpponent = updatedEvent.opponent || opponent;
      data.schedule = data.schedule.map((item) => item.id === eventId ? { ...item, ...updatedEvent, opponent: updatedOpponent } : item);
      render();
      opponentDialog.close();
      const emailNote = payload.syncPending
        ? 'Opponent updated on our scheduler. Turtle Club is syncing in the background.'
        : payload.emailSent
        ? 'Notification email sent.'
        : payload.emailError
          ? `Opponent updated. Email issue: ${payload.emailError}`
          : 'Opponent updated.';
      window.alert(emailNote);
    } catch (error) {
      $('opponentDialogMessage').textContent = error.message || 'Opponent could not be updated.';
      $('opponentDialogMessage').className = 'profile-message error';
    } finally {
      setOpponentSubmitting(false);
    }
  }

  function setOpponentSubmitting(isSubmitting) {
    state.submittingOpponentChange = isSubmitting;
    $('opponentDialogOverlay').hidden = !isSubmitting;
    $('saveOpponentChangeBtn').disabled = isSubmitting;
    $('cancelOpponentChangeBtn').disabled = isSubmitting;
    $('closeOpponentDialog').disabled = isSubmitting;
  }

  function nextOpenDate() {
    const teamEvents = data.schedule.filter((event) => event.team === state.team);
    return (teamEvents[0] && teamEvents[0].date) || dateBounds.min;
  }

  function buildOpponentOptions() {
    const choiceMap = new Map();

    function maybeAddOpponent(value) {
      const label = normalizeOpponentLabel(value);
      const key = normalizedSearchKey(label);
      if (!key || !isOpponentChoice(label)) return;
      if (!choiceMap.has(key)) {
        choiceMap.set(key, label);
      }
    }

    (data.teams || []).forEach(maybeAddOpponent);
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
    if (kind === 'opponentChange') {
      return {
        shell: $('opponentChangeInput').parentElement,
        input: $('opponentChangeInput'),
        menu: $('opponentChangeMenu'),
        options: opponentOptions,
        normalize: normalizeOpponentLabel
      };
    }
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
        originalGroupId: tournamentGroupKey(original),
        originalType: original.eventKind || original.type,
        originalDate: original.date,
        originalStart: original.time,
        originalEnd: original.endTime || '',
        originalOpponent: original.opponent,
        originalDiamond: original.diamond,
        newType: '',
        date: original.date,
        start: original.time,
        end: original.endTime || '',
        opponent: original.opponent,
        diamond: original.diamond,
        reason: cancelReason,
        availabilityStatus: isTournamentEvent(original)
          ? `Tournament cancellation request: all ${tournamentGroupEvents(original).length} day(s) for this coach tournament will be cancelled in the scheduler.`
          : 'Original event cancellation',
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
      const original = mode === 'replace' ? findDisplayEventById($('eventId').value) : null;
      payload = {
        action: mode === 'replace' ? `Replace ${original.eventKind || 'event'}` : `Create ${$('eventTypeSelect').value}`,
        team: state.team,
        originalId: original ? original.id : '',
        originalType: original ? (original.eventKind || original.type) : '',
        originalDate: original ? original.date : '',
        originalStart: original ? original.time : '',
        originalEnd: original ? (original.endTime || '') : '',
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

  function masterUnavailablePhase(date) {
    const seasonYear = Number(data && data.seasonYear) || Number(String(date || '').slice(0, 4)) || new Date().getFullYear();
    if (date < `${seasonYear}-04-01` || date > `${seasonYear}-12-31`) return '';
    return date <= `${seasonYear}-06-29` ? 'weekly' : 'postHouseLeague';
  }

  function masterUnavailableConflict(date, normalizedDiamond, start, end) {
    const phase = masterUnavailablePhase(date);
    if (!phase) return null;
    const dayName = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
    const rules = MASTER_SCHEDULE_UNAVAILABLE_RULES[phase] || [];
    for (const rule of rules) {
      if (rule.day !== dayName) continue;
      if (!rule.diamonds.some((diamond) => normalizeAvailabilityDiamond(diamond) === normalizedDiamond)) continue;
      const unavailableStart = minutesFromDisplay(rule.start);
      const unavailableEnd = minutesFromDisplay(rule.end);
      if (start < unavailableEnd && end > unavailableStart) {
        return rule;
      }
    }
    return null;
  }

  function isWithinWeekdayOpenWindow(date, start, end) {
    const day = new Date(`${date}T12:00:00`).getDay();
    return day !== 0 && day !== 6 && start >= 1020 && end <= 1260;
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
    const original = ignoredId ? findDisplayEventById(ignoredId) : null;
    const { freedSlots, queuedConflicts } = queuedScheduleAdjustments(date, normalizedDiamond, ignoredId, original);

    const conflict = (data.conflictEvents || data.schedule).find((item) => {
      if (item.id === ignoredId) return false;
      if (freedSlots.some((slot) => slot.id === item.id)) return false;
      const eventStart = minutesFromDisplay(item.time);
      const eventEnd = item.endTime ? minutesFromDisplay(item.endTime) : eventStart + (item.durationMinutes || 120);
      return item.date === date && eventMatchesSelectedDiamond(item, normalizedDiamond) && start < eventEnd && end > eventStart;
    });
    if (conflict) {
      if (isOwnTeam(conflict.team)) {
        return {
          ok: false,
          message: `This overlaps your own ${conflict.eventKind || conflict.type || 'event'} vs ${conflict.opponent || 'Practice'} at ${conflict.time}. To change that event, click the existing event on your schedule and choose Replace instead of creating a new request.`
        };
      }
      return { ok: false, message: `Diamond conflict with ${conflict.team} ${conflict.opponent} (${conflict.eventKind || conflict.type}) at ${conflict.time}.` };
    }

    const queuedConflict = queuedConflicts.find((item) => start < item.end && end > item.start);
    if (queuedConflict) {
      return { ok: false, message: `Queued ${state.team} conflict with ${queuedConflict.opponent} (${queuedConflict.source}) at ${queuedConflict.time}.` };
    }

    if (isAwayGame) {
      return { ok: true, message: `Available: no Turtle Club away-game conflict overlaps at ${diamond}.` };
    }

    const unavailable = masterUnavailableConflict(date, normalizedDiamond, start, end);
    if (unavailable) {
      return { ok: false, message: `Not available - no reservation: ${diamond} is unavailable ${unavailable.start}-${unavailable.end}.` };
    }

    const openSlot = data.availability.find((slot) => {
      return slot.date === date && normalizeAvailabilityDiamond(slot.diamond) === normalizedDiamond && minutesFromDisplay(slot.start) <= start && minutesFromDisplay(slot.end) >= end;
    });
    const fitsWeekdayWindow = isWithinWeekdayOpenWindow(date, start, end);
    const fitsFreedSlot = freedSlots.find((slot) => slot.start <= start && slot.end >= end);
    if (!openSlot && !fitsWeekdayWindow && !fitsFreedSlot) return { ok: false, message: 'This request does not fit the weekday 5:00 PM-9:00 PM window, a published open diamond block, or a time slot already being freed by a queued change.' };

    if (fitsFreedSlot && !openSlot && !fitsWeekdayWindow) {
      return { ok: true, message: `Available: this request uses the ${fitsFreedSlot.source} time being freed, and no other Turtle Club ${eventType.toLowerCase()} conflict overlaps.` };
    }
    if (fitsWeekdayWindow && !openSlot) {
      return { ok: true, message: `Available: ${diamond} fits the weekday 5:00 PM-9:00 PM window, and no Turtle Club ${eventType.toLowerCase()} conflict overlaps.` };
    }
    return { ok: true, message: `Available: ${diamond} is open ${openSlot.start}-${openSlot.end}, and no Turtle Club ${eventType.toLowerCase()} conflict overlaps.` };
  }

  function queuedScheduleAdjustments(date, normalizedDiamond, ignoredId, original) {
    const freedSlots = [];
    const queuedConflicts = [];
    if (original && original.date === date && normalizeAvailabilityDiamond(original.diamond) === normalizedDiamond) {
      freedSlots.push(eventToFreedSlot(original));
    }

    state.requests
      .filter((request) => request.status !== 'rejected')
      .filter((request) => request.team === state.team)
      .forEach((request, index) => {
        const replacingThisApprovedRequest = original && (original.requestIndex === index || queuedRequestMatchesEvent(request, original));
        const action = String(request.action || '');
        if ((action.startsWith('Cancel ') || action.startsWith('Replace ')) && request.originalId) {
          if (!(ignoredId && request.originalId === ignoredId) && !replacingThisApprovedRequest) {
            const originalEvent = findEventById(request.originalId);
            const slot = originalEvent ? eventToFreedSlot(originalEvent) : originalRequestToFreedSlot(request);
            if (slot && slot.date === date && normalizeAvailabilityDiamond(slot.diamond) === normalizedDiamond) {
              freedSlots.push(slot);
            }
          }
        }

        if ((action.startsWith('Create ') || action.startsWith('Replace '))
          && !replacingThisApprovedRequest
          && request.date === date
          && normalizeAvailabilityDiamond(request.diamond) === normalizedDiamond) {
          const queuedStart = minutesFromDisplay(request.start);
          const queuedEnd = request.end ? minutesFromDisplay(request.end) : queuedStart + 120;
          if (queuedStart && queuedEnd > queuedStart) {
            queuedConflicts.push({
              start: queuedStart,
              end: queuedEnd,
              time: request.start,
              opponent: request.opponent || 'event',
              source: request.newType || request.action || 'event'
            });
          }
        }
      });

    return { freedSlots, queuedConflicts };
  }

  function findDisplayEventById(id) {
    return buildDisplaySchedule().find((event) => event.id === id)
      || data.schedule.find((event) => event.id === id)
      || null;
  }

  function queuedRequestMatchesEvent(request, event) {
    if (!request || !event) return false;
    if (request.team !== event.team) return false;
    if (String(request.date || '') !== String(event.date || '')) return false;
    if (minutesFromDisplay(request.start) !== minutesFromDisplay(event.time)) return false;
    if (!displayGameKindsMatch(normalizeDisplayGameKind(request.newType || request.action), normalizeDisplayGameKind(event.eventKind || event.type))) return false;
    return displayOpponentMatches(normalizeDisplayOpponent(request.opponent), normalizeDisplayOpponent(event.opponent));
  }

  function findEventById(id) {
    return [...(data.schedule || []), ...(data.conflictEvents || [])].find((event) => event.id === id) || null;
  }

  function isOwnTeam(team) {
    return normalizeScheduleComparison(team) === normalizeScheduleComparison(state.team);
  }

  function eventToFreedSlot(event) {
    const start = minutesFromDisplay(event.time);
    const end = event.endTime ? minutesFromDisplay(event.endTime) : start + (event.durationMinutes || 120);
    return {
      id: event.id,
      date: event.date,
      diamond: event.diamond,
      start,
      end,
      source: event.eventKind || event.type || 'event'
    };
  }

  function originalRequestToFreedSlot(request) {
    const start = minutesFromDisplay(request.originalStart);
    if (!start) return null;
    const end = request.originalEnd ? minutesFromDisplay(request.originalEnd) : start + 120;
    return {
      id: request.originalId,
      date: request.originalDate,
      diamond: request.originalDiamond,
      start,
      end,
      source: request.originalType || 'event'
    };
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
    if (type.includes('tournament')) return 'tournament';
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

  function isReadOnlyAdminUser() {
    return state.user && state.user.role === 'admin_viewer';
  }

  function isStatusEditorUser() {
    return state.user && state.user.role === 'status_editor';
  }

  function canViewAllTeams() {
    return isAdminUser() || isReadOnlyAdminUser() || isStatusEditorUser();
  }

  function isReadOnlyCoachViewer() {
    return isStatusEditorUser() || isReadOnlyAdminUser();
  }

  function showLogin() {
    $('loadingShell').hidden = true;
    $('loginShell').hidden = false;
    $('appShell').hidden = true;
    $('sessionLabel').hidden = true;
    $('logoutBtn').hidden = true;
    $('adminLink').hidden = true;
    $('fieldStatusLink').hidden = true;
    const profileLink = $('profileLink');
    if (profileLink) profileLink.hidden = true;
  }

  function showApp() {
    $('loadingShell').hidden = true;
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

