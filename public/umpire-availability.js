(function () {
  const $ = (id) => document.getElementById(id);
  const state = {
    user: null,
    games: [],
    accounts: [],
    categories: ['Titans', 'Athletics', 'House League Baseball', 'House League Softball'],
    category: 'All programs',
    month: 'All months',
    status: 'All games',
    query: '',
    view: 'calendar',
    portalView: 'calendar',
    assignmentsDate: '',
    accountQuery: '',
    accountProgram: 'All programs'
  };

  async function init() {
    $('umpireLoginForm').addEventListener('submit', login);
    $('umpireCategorySelect').addEventListener('change', () => {
      state.category = $('umpireCategorySelect').value;
      render();
    });
    $('umpireMonthSelect').addEventListener('change', () => {
      state.month = $('umpireMonthSelect').value;
      render();
    });
    $('umpireStatusSelect').addEventListener('change', () => {
      state.status = $('umpireStatusSelect').value;
      render();
    });
    $('umpireSearchInput').addEventListener('input', (event) => {
      state.query = event.target.value.toLowerCase();
      render();
    });
    $('umpireCalendarViewBtn').addEventListener('click', () => setView('calendar'));
    $('umpireListViewBtn').addEventListener('click', () => setView('list'));
    $('umpirePortalCalendarBtn').addEventListener('click', () => setPortalView('calendar'));
    $('umpirePortalAssignmentsBtn').addEventListener('click', () => setPortalView('assignments'));
    $('umpirePortalMyGamesBtn').addEventListener('click', () => setPortalView('my-games'));
    $('umpirePortalAccountsBtn').addEventListener('click', () => setPortalView('accounts'));
    $('umpireAssignmentsBackWeekBtn').addEventListener('click', () => shiftAssignmentsDate(-7));
    $('umpireAssignmentsBackDayBtn').addEventListener('click', () => shiftAssignmentsDate(-1));
    $('umpireAssignmentsNextDayBtn').addEventListener('click', () => shiftAssignmentsDate(1));
    $('umpireAssignmentsNextWeekBtn').addEventListener('click', () => shiftAssignmentsDate(7));
    $('closeUmpireDayDialog').addEventListener('click', () => $('umpireDayDialog').close());
    $('refreshUmpireDataBtn').addEventListener('click', refreshUmpireData);
    $('saveUmpireAccountsBtn').addEventListener('click', saveUmpireAccounts);
    $('umpireAccountSearch').addEventListener('input', (event) => {
      state.accountQuery = event.target.value.toLowerCase();
      renderUmpireAccounts();
    });
    $('umpireAccountProgramFilter').addEventListener('change', () => {
      state.accountProgram = $('umpireAccountProgramFilter').value;
      renderUmpireAccounts();
    });
    window.addEventListener('hashchange', applyPortalHash);

    const session = await currentPortalSession();
    if (session.authenticated) {
      state.user = session.user;
      await loadGames();
      applyPortalHash(false);
      showPortal();
    } else {
      showLogin();
    }
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, { cache: 'no-store', ...(options || {}) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload;
  }

  async function currentPortalSession() {
    try {
      const session = await fetchJson('/api/umpire/session');
      if (session.authenticated) return session;
    } catch (_) {
      // Fall back to the normal admin session below.
    }
    try {
      const adminSession = await fetchJson('/api/admin/session');
      if (adminSession.authenticated) return adminSession;
    } catch (_) {
      // The login form will be shown.
    }
    return { authenticated: false };
  }

  async function login(event) {
    event.preventDefault();
    $('umpireLoginMessage').textContent = '';
    try {
      const payload = await fetchJson('/api/umpire/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: $('umpireUsername').value.trim(),
          password: $('umpirePassword').value
        })
      });
      state.user = payload.user;
      $('umpirePassword').value = '';
      await loadGames();
      showPortal();
      if (window.refreshTopNav) window.refreshTopNav();
    } catch (error) {
      $('umpireLoginMessage').textContent = error.message || 'Username or password did not match.';
    }
  }

  async function loadGames() {
    const payload = await fetchJson('/api/umpire/games');
    state.games = payload.games || [];
    state.categories = payload.categories || state.categories;
    rebuildFilters();
    $('umpireDataVersion').textContent = payload.dataVersion ? `Synced ${formatDateTime(payload.dataVersion)}` : '';
    render();
  }

  async function refreshUmpireData() {
    const button = $('refreshUmpireDataBtn');
    const message = $('umpireRefreshMessage');
    button.disabled = true;
    message.hidden = false;
    message.textContent = 'Refreshing Titans, Athletics, House League, and Officials data...';
    try {
      const payload = await fetchJson('/api/umpire/refresh-data', { method: 'POST' });
      state.games = payload.games || [];
      rebuildFilters();
      $('umpireDataVersion').textContent = payload.version ? `Synced ${formatDateTime(payload.version)}` : '';
      message.textContent = 'Umpire data refreshed.';
      if (state.user && state.user.role === 'admin') loadUmpireAccounts();
      render();
    } catch (error) {
      message.textContent = error.message || 'Umpire data refresh failed.';
    } finally {
      button.disabled = false;
    }
  }

  function showLogin() {
    $('umpireLoadingShell').hidden = true;
    $('umpireLoginShell').hidden = false;
    $('umpireShell').hidden = true;
  }

  function showPortal() {
    $('umpireLoadingShell').hidden = true;
    $('umpireLoginShell').hidden = true;
    $('umpireShell').hidden = false;
    $('umpireAdminRefreshField').hidden = !(state.user && state.user.role === 'admin');
    $('umpirePortalAssignmentsBtn').hidden = true;
    $('umpirePortalAccountsBtn').hidden = !(state.user && state.user.role === 'admin');
    if ((state.portalView === 'accounts' && !(state.user && state.user.role === 'admin')) || (state.portalView === 'assignments' && !isAdminViewing())) {
      state.portalView = 'calendar';
    }
    if (state.user && state.user.role === 'admin') loadUmpireAccounts();
    setPortalView(state.portalView);
  }

  function setPortalView(view) {
    const canSeeAccounts = state.user && state.user.role === 'admin';
    const canSeeAssignments = isAdminViewing();
    state.portalView = (view === 'accounts' && !canSeeAccounts) || (view === 'assignments' && !canSeeAssignments) ? 'calendar' : view;
    $('umpireCalendarPage').hidden = state.portalView !== 'calendar';
    $('umpireAssignmentsSection').hidden = state.portalView !== 'assignments' || !canSeeAssignments;
    $('umpireMyGamesSection').hidden = state.portalView !== 'my-games';
    $('umpireAccountsSection').hidden = state.portalView !== 'accounts' || !canSeeAccounts;
    const portalNav = $('umpirePortalNav');
    if (portalNav) portalNav.hidden = state.portalView === 'assignments';
    [
      ['umpirePortalCalendarBtn', 'calendar'],
      ['umpirePortalAssignmentsBtn', 'assignments'],
      ['umpirePortalMyGamesBtn', 'my-games'],
      ['umpirePortalAccountsBtn', 'accounts']
    ].forEach(([id, key]) => {
      const button = $(id);
      if (!button) return;
      const active = state.portalView === key;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    render();
    if (state.portalView === 'accounts' && canSeeAccounts && !state.accounts.length) {
      loadUmpireAccounts();
    }
    updateTopNavStateForPortalView();
  }

  function applyPortalHash(renderAfterChange = true) {
    const hash = String(window.location.hash || '').toLowerCase();
    if (hash === '#assignments' && isAdminViewing()) {
      state.portalView = 'assignments';
    } else if (hash === '#calendar') {
      state.portalView = 'calendar';
    }
    if (renderAfterChange && $('umpireShell') && !$('umpireShell').hidden) {
      setPortalView(state.portalView);
    }
  }

  function updateTopNavStateForPortalView() {
    const umpireLink = document.getElementById('umpireAvailabilityLink');
    const assignmentsLink = document.getElementById('umpireAssignmentsDayLink');
    if (!umpireLink && !assignmentsLink) return;
    [umpireLink, assignmentsLink].forEach((link) => {
      if (!link) return;
      link.classList.remove('current');
      link.removeAttribute('aria-current');
    });
    const activeLink = state.portalView === 'assignments' ? assignmentsLink : umpireLink;
    if (activeLink && !activeLink.hidden) {
      activeLink.classList.add('current');
      activeLink.setAttribute('aria-current', 'page');
    }
  }

  function setView(view) {
    state.view = view;
    $('umpireCalendarViewBtn').classList.toggle('active', view === 'calendar');
    $('umpireCalendarViewBtn').setAttribute('aria-pressed', view === 'calendar' ? 'true' : 'false');
    $('umpireListViewBtn').classList.toggle('active', view === 'list');
    $('umpireListViewBtn').setAttribute('aria-pressed', view === 'list' ? 'true' : 'false');
    render();
  }

  function rebuildFilters() {
    const categoryOptions = ['All programs', ...state.categories];
    const months = ['All months', ...orderedMonthLabels(state.games)];
    $('umpireCategorySelect').innerHTML = categoryOptions.map((value) => `<option>${escapeHtml(value)}</option>`).join('');
    $('umpireMonthSelect').innerHTML = months.map((value) => `<option>${escapeHtml(value)}</option>`).join('');
    if (!categoryOptions.includes(state.category)) state.category = 'All programs';
    if (!months.includes(state.month)) state.month = 'All months';
    $('umpireCategorySelect').value = state.category;
    $('umpireMonthSelect').value = state.month;
  }

  function visibleGames() {
    const username = String(state.user && state.user.username || '').toLowerCase();
    const allowedPrograms = allowedProgramsForUser();
    return state.games.filter((game) => {
      if (allowedPrograms && !allowedPrograms.has(game.category)) return false;
      if (state.category !== 'All programs' && game.category !== state.category) return false;
      if (state.month !== 'All months' && monthLabel(game.date) !== state.month) return false;
      if (state.status === 'Open games' && game.filled) return false;
      if (state.status === 'Filled games' && !game.filled) return false;
      if (state.status === 'My assigned games' && !userAssigned(game, username)) return false;
      if (state.status === 'My availability' && !userClaimed(game, username)) return false;
      if (state.query) {
        const haystack = `${game.category} ${game.type} ${game.team} ${game.opponent} ${game.diamond}`.toLowerCase();
        if (!haystack.includes(state.query)) return false;
      }
      return true;
    });
  }

  function render() {
    const games = visibleGames();
    renderMyGames();
    renderAssignmentsBoard();
    $('umpireCalendarSection').hidden = state.view !== 'calendar';
    $('umpireListSection').hidden = state.view !== 'list';
    if (state.view === 'calendar') {
      renderCalendar(games);
    } else {
      renderList(games);
    }
  }

  function renderMyGames() {
    const username = String(state.user && state.user.username || '').toLowerCase();
    const assignedGames = state.games
      .filter((game) => userAssigned(game, username))
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    const availabilityGames = state.games
      .filter((game) => userClaimed(game, username) && !userAssigned(game, username))
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    $('umpireMyGamesSummary').textContent = `${assignedGames.length} assigned, ${availabilityGames.length} availability request${availabilityGames.length === 1 ? '' : 's'}`;
    if (!assignedGames.length && !availabilityGames.length) {
      $('umpireMyGamesList').innerHTML = '<p class="muted">No assigned games or availability found for this login.</p>';
      return;
    }
    $('umpireMyGamesList').innerHTML = `
      ${renderPersonalGameSection('Confirmed Assignments', assignedGames, username, 'These are games the admin has assigned to you.')}
      ${renderPersonalGameSection('My Availability Requests', availabilityGames, username, 'These are games you said you can do. They are not assigned to you until an admin confirms them.', true)}
    `;
    bindClaimButtons($('umpireMyGamesList'));
  }

  function renderPersonalGameSection(title, games, username, emptyText, availabilityContext = false) {
    if (!games.length) {
      return `
        <section class="umpire-personal-section">
          <div class="umpire-personal-head">
            <h3>${escapeHtml(title)}</h3>
            <span>0</span>
          </div>
          <p class="muted">${escapeHtml(emptyText)}</p>
        </section>
      `;
    }
    let lastDate = '';
    const rows = games.map((game) => {
      const dateHead = game.date !== lastDate ? `<h3 class="umpire-date-head">${formatDate(game.date)}</h3>` : '';
      lastDate = game.date;
      return `${dateHead}${availabilityContext ? '<p class="availability-note">Availability only - admin confirmation is still required.</p>' : ''}${renderGameCard(game, username)}`;
    }).join('');
    return `
      <section class="umpire-personal-section">
        <div class="umpire-personal-head">
          <h3>${escapeHtml(title)}</h3>
          <span>${games.length}</span>
        </div>
        ${availabilityContext ? '<p class="muted">These games are not assigned yet. They show that you are available for the admin to review.</p>' : ''}
        ${rows}
      </section>
    `;
  }

  function renderCalendar(games) {
    const calendar = $('umpireCalendar');
    const months = orderedMonthLabels(games);
    if (!months.length) {
      calendar.innerHTML = '<p class="muted">No games match these filters.</p>';
      return;
    }
    calendar.innerHTML = months.map((month) => renderMonth(month, games.filter((game) => monthLabel(game.date) === month))).join('');
  }

  function renderMonth(month, games) {
    const firstDate = new Date(`${games[0].date}T12:00:00`);
    const year = firstDate.getFullYear();
    const monthIndex = firstDate.getMonth();
    const firstOfMonth = new Date(year, monthIndex, 1);
    const lastOfMonth = new Date(year, monthIndex + 1, 0);
    const byDate = new Map();
    games.forEach((game) => {
      if (!byDate.has(game.date)) byDate.set(game.date, []);
      byDate.get(game.date).push(game);
    });
    const fillerCount = firstOfMonth.getDay();
    const cells = [];
    for (let i = 0; i < fillerCount; i += 1) cells.push('<div class="calendar-day filler"></div>');
    for (let day = 1; day <= lastOfMonth.getDate(); day += 1) {
      const date = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayGames = byDate.get(date) || [];
      cells.push(`
        <button class="calendar-day ${dayGames.length ? 'has-events' : 'empty'}" type="button" data-open-umpire-day="${date}"${dayGames.length ? '' : ' disabled'}>
          <span class="calendar-date">${day}</span>
          <span class="calendar-count">${dayGames.length ? `${dayGames.length} game${dayGames.length === 1 ? '' : 's'}` : 'No games'}</span>
          <span class="calendar-preview">
            ${dayGames.slice(0, 3).map((game) => `<span class="calendar-pill ${categoryClass(game.category)}">${escapeHtml(game.time)} ${escapeHtml(game.team)}</span>`).join('')}
            ${dayGames.length > 3 ? `<span class="calendar-more">+${dayGames.length - 3} more</span>` : ''}
          </span>
        </button>
      `);
    }
    setTimeout(() => {
      document.querySelectorAll('[data-open-umpire-day]').forEach((button) => {
        if (button.dataset.boundUmpireDay) return;
        button.dataset.boundUmpireDay = 'true';
        button.addEventListener('click', () => {
          openDayDialog(button.dataset.openUmpireDay);
        });
      });
    }, 0);
    return `
      <div class="calendar-shell">
        <div class="calendar-head">
          <h3>${escapeHtml(month)}</h3>
          <span>${games.length} game${games.length === 1 ? '' : 's'}</span>
        </div>
        <div class="calendar-grid">
          ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => `<div class="calendar-weekday">${day}</div>`).join('')}
          ${cells.join('')}
        </div>
      </div>
    `;
  }

  function renderList(games) {
    const username = String(state.user && state.user.username || '').toLowerCase();
    if (!games.length) {
      $('umpireGameList').innerHTML = '<p class="muted">No games match these filters.</p>';
      return;
    }
    let lastDate = '';
    $('umpireGameList').innerHTML = games.map((game) => {
      const dateHead = game.date !== lastDate ? `<h3 id="umpire-date-${escapeHtml(game.date)}" class="umpire-date-head">${formatDate(game.date)}</h3>` : '';
      lastDate = game.date;
      return `${dateHead}${renderGameCard(game, username)}`;
    }).join('');
    bindClaimButtons($('umpireGameList'));
  }

  function openDayDialog(date) {
    const games = visibleGames().filter((game) => game.date === date);
    const username = String(state.user && state.user.username || '').toLowerCase();
    $('umpireDayDialogTitle').textContent = formatDate(date);
    $('umpireDayDialogSubtitle').textContent = `${games.length} game${games.length === 1 ? '' : 's'} available in the current filters`;
    $('umpireDayDialogList').innerHTML = games.length
      ? games.map((game) => renderGameCard(game, username)).join('')
      : '<p class="muted">No games match these filters.</p>';
    bindClaimButtons($('umpireDayDialogList'));
    if (!$('umpireDayDialog').open) $('umpireDayDialog').showModal();
  }

  function renderAssignmentsBoard() {
    if (!isAdminViewing() || !$('umpireAssignmentsTable')) return;
    ensureAssignmentsDate();
    const dayGames = state.games
      .filter((game) => game.date === state.assignmentsDate)
      .sort((a, b) => `${minutesFromTime(a.time)} ${a.category} ${a.team}`.localeCompare(`${minutesFromTime(b.time)} ${b.category} ${b.team}`));
    $('umpireAssignmentsDateTitle').textContent = formatDate(state.assignmentsDate);
    if (!dayGames.length) {
      $('umpireAssignmentsTable').innerHTML = '<p class="umpire-assignments-empty">No local umpire games found for this day.</p>';
      return;
    }
    $('umpireAssignmentsTable').innerHTML = `
      <div class="umpire-assignment-legend" aria-label="Official status legend">
        <span><i class="legend-swatch confirmed"></i>Confirmed on our end</span>
        <span><i class="legend-swatch pending"></i>Pending on Turtle Club</span>
        <span><i class="legend-swatch rejected"></i>Rejected on Turtle Club</span>
        <span><i class="legend-swatch available"></i>Available on this site</span>
      </div>
      <table class="umpire-assignments-table">
        <thead>
          <tr>
            <th>Game #</th>
            <th>Date</th>
            <th>Time</th>
            <th>Category</th>
            <th>Team</th>
            <th>Opponent</th>
            <th>Venue</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          ${dayGames.map((game, index) => renderAssignmentRows(game, index)).join('')}
        </tbody>
      </table>
    `;
    bindAssignmentAdminButtons($('umpireAssignmentsTable'));
  }

  function renderAssignmentRows(game, index) {
    const available = game.claims || [];
    const confirmed = game.assignedOfficials || [];
    const pending = game.pendingOfficials || [];
    const rejected = game.rejectedOfficials || [];
    const gameNumber = game.gameNumber || `G${String(index + 1).padStart(2, '0')}`;
    const officialChips = [
      ...confirmed.map((official) => renderOfficialChip('confirmed', 'Confirmed', official)),
      ...pending.map((official) => renderOfficialChip('pending', 'Pending', official)),
      ...rejected.map((official) => renderOfficialChip('rejected', 'Rejected', official)),
      ...available.map((claim) => renderAvailableChip(claim, game))
    ];
    return `
      <tr class="umpire-assignment-game-row ${categoryClass(game.category)}">
        <td>${escapeHtml(gameNumber)}</td>
        <td>${escapeHtml(shortDate(game.date))}</td>
        <td>${escapeHtml(game.time)}</td>
        <td>${escapeHtml(game.category)}</td>
        <td>${escapeHtml(game.team)}</td>
        <td>${escapeHtml(cleanOpponent(game.opponent))}</td>
        <td>${escapeHtml(cleanAssignmentVenue(game.diamond))}</td>
        <td>${escapeHtml(gameDescription(game))}</td>
      </tr>
      <tr class="umpire-assignment-official-row">
        <td colspan="8">
          <div class="umpire-assignment-officials">
            ${officialChips.length ? officialChips.join('') : '<span class="assignment-empty">No officials confirmed, pending, rejected, or available yet.</span>'}
          </div>
        </td>
      </tr>
    `;
  }

  function cleanAssignmentVenue(value) {
    return String(value || '').replace(/\s*\[G\d{2}-\d+\]\s*/g, '').trim();
  }

  function renderOfficialChip(statusClass, statusLabel, official) {
    const syncLabel = official.turtleClubSync === 'failed' ? '<small class="assignment-sync-warning">TC sync failed</small>' : '';
    const removeButton = canAdminMutateUmpires() && official.source === 'local-admin' && official.id
      ? `<button class="assignment-chip-btn danger" type="button" data-remove-assignment="${escapeHtml(official.id)}" data-remove-game="${escapeHtml(official.gameId)}">Remove</button>`
      : '';
    return `
      <span class="assignment-official ${statusClass}">
        <small>${escapeHtml(statusLabel)}</small>
        ${escapeHtml(official.name)}${official.position ? ` (${escapeHtml(official.position)})` : ''}
        ${syncLabel}
        ${removeButton}
      </span>
    `;
  }

  function renderAvailableChip(claim, game) {
    const assignButtons = canAdminMutateUmpires() && !game.filled
      ? `
        <span class="assignment-chip-actions">
          <button class="assignment-chip-btn" type="button" data-assign-umpire="${escapeHtml(claim.username)}" data-assign-game="${escapeHtml(game.id)}" data-assign-position="Home Plate">Assign HP</button>
          <button class="assignment-chip-btn" type="button" data-assign-umpire="${escapeHtml(claim.username)}" data-assign-game="${escapeHtml(game.id)}" data-assign-position="Bases">Assign Bases</button>
        </span>
      `
      : '';
    return `
      <span class="assignment-official available" title="${escapeHtml(claim.submittedAt ? `Submitted ${formatDateTime(claim.submittedAt)}` : 'Available on this site')}">
        <small>Available</small>
        ${escapeHtml(claim.name || claim.username)}
        ${assignButtons}
      </span>
    `;
  }

  function canAdminMutateUmpires() {
    return Boolean(state.user && state.user.role === 'admin');
  }

  function bindAssignmentAdminButtons(root) {
    if (!root || !canAdminMutateUmpires()) return;
    root.querySelectorAll('[data-assign-umpire]').forEach((button) => {
      button.addEventListener('click', () => assignUmpireToGame(button));
    });
    root.querySelectorAll('[data-remove-assignment]').forEach((button) => {
      button.addEventListener('click', () => removeUmpireAssignment(button));
    });
  }

  async function assignUmpireToGame(button) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Assigning...';
    try {
      const payload = await fetchJson(`/api/umpire/games/${encodeURIComponent(button.dataset.assignGame)}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: button.dataset.assignUmpire,
          position: button.dataset.assignPosition
        })
      });
      upsertGame(payload.game);
      render();
      if (payload.turtleClubSync === 'failed') {
        alert(`Assigned locally, but Turtle Club did not update: ${payload.turtleClubError || 'Unknown error'}`);
      }
    } catch (error) {
      alert(error.message || 'Could not assign this umpire.');
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function removeUmpireAssignment(button) {
    if (!confirm('Remove this umpire assignment?')) return;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Removing...';
    try {
      const payload = await fetchJson(`/api/umpire/games/${encodeURIComponent(button.dataset.removeGame)}/assignments/${encodeURIComponent(button.dataset.removeAssignment)}`, {
        method: 'DELETE'
      });
      upsertGame(payload.game);
      render();
      if (payload.turtleClubSync === 'failed') {
        alert(`Removed locally, but Turtle Club did not update: ${payload.turtleClubError || 'Unknown error'}`);
      }
    } catch (error) {
      alert(error.message || 'Could not remove this assignment.');
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function upsertGame(game) {
    if (!game || !game.id) return;
    const index = state.games.findIndex((item) => item.id === game.id);
    if (index >= 0) state.games.splice(index, 1, game);
    else state.games.push(game);
  }

  function ensureAssignmentsDate() {
    if (state.assignmentsDate) return;
    const today = new Date().toISOString().slice(0, 10);
    const dates = unique(state.games.map((game) => game.date).filter(Boolean)).sort();
    state.assignmentsDate = dates.find((date) => date >= today) || dates[0] || today;
  }

  function shiftAssignmentsDate(days) {
    ensureAssignmentsDate();
    const date = new Date(`${state.assignmentsDate}T12:00:00`);
    date.setDate(date.getDate() + days);
    state.assignmentsDate = date.toISOString().slice(0, 10);
    renderAssignmentsBoard();
  }

  function renderGameCard(game, username) {
    const viewOnlyAdmin = Boolean(state.user && state.user.role === 'admin_viewer');
    const mine = userClaimed(game, username);
    const assignedToMe = userAssigned(game, username);
    const claimLabel = mine ? 'Remove my availability' : 'Add my availability';
    const claimAction = mine ? 'cancel' : 'claim';
    const hideClaimButton = viewOnlyAdmin || assignedToMe || (game.filled && !mine);
    const assignedText = assignedToMe
      ? 'You are assigned to this game.'
      : assignedOfficialsText(game);
    return `
      <article class="umpire-game-card ${categoryClass(game.category)} ${game.filled ? 'filled' : 'open'}">
        <div class="umpire-game-main">
          <div>
            <span class="umpire-category">${escapeHtml(game.category)}</span>
            <strong>${escapeHtml(game.time)}${game.endTime ? `-${escapeHtml(game.endTime)}` : ''} ${escapeHtml(game.type)}</strong>
            <p>${escapeHtml(game.team)} ${escapeHtml(game.opponent)}</p>
            <p>${escapeHtml(game.diamond)}</p>
          </div>
          <div class="umpire-game-status">
            <span class="umpire-status-badge ${game.filled ? 'filled' : 'open'}">${game.filled ? 'Filled' : 'Open'}</span>
            <span>${game.confirmedUmpires}/${game.requiredUmpires} confirmed</span>
            <span>${game.claimCount} available</span>
          </div>
        </div>
        <div class="umpire-claim-row">
          <span>
            ${assignedText ? `<strong>${escapeHtml(assignedText)}</strong>` : ''}
            ${assignedText && game.claims.length ? '<br>' : ''}
            ${game.claims.length ? `Availability submitted: ${escapeHtml(game.claims.map((claim) => claim.name).join(', '))}` : (assignedText ? '' : 'No availability submitted yet.')}
          </span>
          ${hideClaimButton ? '' : `<button class="${mine ? 'secondary' : 'primary'}" type="button" data-claim-game="${escapeHtml(game.id)}" data-claim-action="${claimAction}">${claimLabel}</button>`}
        </div>
      </article>
    `;
  }

  function bindClaimButtons(root) {
    if (!root) return;
    root.querySelectorAll('[data-claim-game]').forEach((button) => {
      button.addEventListener('click', () => toggleClaim(button.dataset.claimGame, button.dataset.claimAction));
    });
  }

  async function toggleClaim(gameId, action) {
    try {
      const payload = await fetchJson(`/api/umpire/games/${encodeURIComponent(gameId)}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      state.games = state.games.map((game) => game.id === gameId ? payload.game : game);
      render();
      if ($('umpireDayDialog').open) {
        const openGame = state.games.find((game) => game.id === gameId);
        if (openGame) openDayDialog(openGame.date);
      }
    } catch (error) {
      window.alert(error.message || 'Availability could not be saved.');
    }
  }

  function userClaimed(game, username) {
    return Boolean(username && (game.claims || []).some((claim) => String(claim.username || '').toLowerCase() === username));
  }

  function userAssigned(game, username) {
    return Boolean(username && (game.assignedOfficials || []).some((official) => String(official.username || '').toLowerCase() === username));
  }

  function assignedOfficialsText(game) {
    const assigned = game.assignedOfficials || [];
    if (!assigned.length) return '';
    return `Assigned: ${assigned.map((official) => `${official.name}${official.position ? ` (${official.position})` : ''}`).join(', ')}`;
  }

  function isAdminViewing() {
    return Boolean(state.user && (state.user.role === 'admin' || state.user.role === 'admin_viewer'));
  }

  async function loadUmpireAccounts() {
    try {
      const payload = await fetchJson('/api/umpire/accounts');
      state.accounts = payload.accounts || [];
      renderUmpireAccounts();
    } catch (error) {
      $('umpireAccountsSummary').textContent = error.message || 'Could not load official logins.';
    }
  }

  function renderUmpireAccounts() {
    rebuildAccountProgramFilter();
    const accounts = filteredUmpireAccounts();
    $('umpireAccountsSummary').textContent = `${accounts.length} of ${state.accounts.length} official account${state.accounts.length === 1 ? '' : 's'}`;
    if (!state.accounts.length) {
      $('umpireAccountsList').innerHTML = '<p class="muted">No official accounts found yet. Refresh umpire data first.</p>';
      return;
    }
    if (!accounts.length) {
      $('umpireAccountsList').innerHTML = '<p class="muted">No official accounts match these filters.</p>';
      return;
    }
    const byLetter = new Map();
    accounts.forEach((account) => {
      const letter = String(account.name || account.username || '#').trim().slice(0, 1).toUpperCase() || '#';
      if (!byLetter.has(letter)) byLetter.set(letter, []);
      byLetter.get(letter).push(account);
    });
    $('umpireAccountsList').innerHTML = `
      ${[...byLetter.entries()].map(([letter, group]) => `
        <section class="umpire-account-group">
          <h3>${escapeHtml(letter)}</h3>
          <div class="umpire-account-grid">
            ${group.map((account) => `
              <details class="umpire-account-card">
                <summary class="umpire-account-summary">
                  <span>
                    <strong>${escapeHtml(account.name)}</strong>
                    <small>${escapeHtml(account.username)}</small>
                  </span>
                  <em>${escapeHtml(account.qualification || 'Not Set')}</em>
                </summary>
                <div class="umpire-account-body">
                  <dl class="umpire-account-meta">
                    <div><dt>Username</dt><dd>${escapeHtml(account.username)}</dd></div>
                    <div><dt>Password</dt><dd>${escapeHtml(account.password)}</dd></div>
                  </dl>
                  ${renderProgramCheckboxes(account)}
                </div>
              </details>
            `).join('')}
          </div>
        </section>
      `).join('')}
    `;
  }

  function rebuildAccountProgramFilter() {
    const select = $('umpireAccountProgramFilter');
    const options = ['All programs', ...state.categories];
    const current = options.includes(state.accountProgram) ? state.accountProgram : 'All programs';
    if (select.options.length !== options.length || [...select.options].some((option, index) => option.value !== options[index])) {
      select.innerHTML = options.map((value) => `<option>${escapeHtml(value)}</option>`).join('');
    }
    state.accountProgram = current;
    select.value = current;
  }

  function filteredUmpireAccounts() {
    const query = state.accountQuery;
    return state.accounts.filter((account) => {
      const programs = new Set(Array.isArray(account.programs) ? account.programs : state.categories);
      if (state.accountProgram !== 'All programs' && !programs.has(state.accountProgram)) return false;
      if (query) {
        const haystack = `${account.name || ''} ${account.username || ''} ${account.qualification || ''}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }

  async function saveUmpireAccounts() {
    const button = $('saveUmpireAccountsBtn');
    const message = $('umpireAccountsSaveMessage');
    const accounts = state.accounts.map((account) => ({
      username: account.username,
      programs: visibleProgramsForAccount(account)
    }));
    button.disabled = true;
    message.hidden = false;
    message.textContent = 'Saving umpire game designations...';
    try {
      const payload = await fetchJson('/api/umpire/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts })
      });
      state.accounts = payload.accounts || [];
      renderUmpireAccounts();
      message.textContent = 'Umpire game designations saved.';
      await loadGames();
    } catch (error) {
      message.textContent = error.message || 'Umpire game designations could not be saved.';
    } finally {
      button.disabled = false;
    }
  }

  function visibleProgramsForAccount(account) {
    const inputs = [...document.querySelectorAll(`[data-account-program][data-username="${cssEscape(account.username)}"]`)];
    if (!inputs.length) return Array.isArray(account.programs) ? account.programs : state.categories;
    return inputs.filter((input) => input.checked).map((input) => input.dataset.accountProgram);
  }

  function renderProgramCheckboxes(account) {
    const programs = new Set(Array.isArray(account.programs) ? account.programs : state.categories);
    return `
      <div class="umpire-program-grid">
        ${state.categories.map((program) => {
          const inputId = `umpire-program-${slug(account.username)}-${slug(program)}`;
          return `
            <label for="${inputId}" class="checkbox-pill">
              <input id="${inputId}" type="checkbox" data-account-program="${escapeHtml(program)}" data-username="${escapeHtml(account.username)}"${programs.has(program) ? ' checked' : ''}>
              <span>${escapeHtml(program)}</span>
            </label>
          `;
        }).join('')}
      </div>
    `;
  }

  function categoryClass(category) {
    return String(category || '').toLowerCase().replace(/\s+/g, '-');
  }

  function unique(values) {
    return [...new Set(values)];
  }

  function allowedProgramsForUser() {
    if (!state.user || state.user.role !== 'umpire') return null;
    const programs = Array.isArray(state.user.programs) ? state.user.programs : [];
    return programs.length ? new Set(programs) : new Set(state.categories);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value || ''));
    return String(value || '').replace(/"/g, '\\"');
  }

  function slug(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
  }

  function orderedMonthLabels(games) {
    const byLabel = new Map();
    (games || []).forEach((game) => {
      const label = monthLabel(game.date);
      const key = monthKey(game.date);
      if (label && key) byLabel.set(label, key);
    });
    const currentKey = monthKey(new Date().toISOString().slice(0, 10));
    return [...byLabel.entries()]
      .sort((a, b) => {
        const aPast = a[1] < currentKey;
        const bPast = b[1] < currentKey;
        if (aPast !== bPast) return aPast ? 1 : -1;
        return a[1].localeCompare(b[1]);
      })
      .map(([label]) => label);
  }

  function monthKey(dateString) {
    const date = new Date(`${dateString}T12:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function monthLabel(dateString) {
    const date = new Date(`${dateString}T12:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  }

  function formatDate(dateString) {
    const date = new Date(`${dateString}T12:00:00`);
    if (Number.isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function shortDate(dateString) {
    const date = new Date(`${dateString}T12:00:00`);
    if (Number.isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: '2-digit' });
  }

  function minutesFromTime(value) {
    const match = String(value || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return 9999;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const period = match[3].toUpperCase();
    if (period === 'PM' && hour !== 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
    return hour * 60 + minute;
  }

  function cleanOpponent(value) {
    return String(value || '').replace(/^(vs\.?|@)\s*/i, '').trim();
  }

  function gameDescription(game) {
    if (game.description) return game.description;
    if (game.endTime) return `${game.time}-${game.endTime}`;
    return game.requiredUmpires > 1 ? '2 umpires' : '1 umpire';
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
