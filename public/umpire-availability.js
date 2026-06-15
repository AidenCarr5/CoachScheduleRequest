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
    portalView: 'calendar'
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
    $('umpirePortalMyGamesBtn').addEventListener('click', () => setPortalView('my-games'));
    $('umpirePortalAccountsBtn').addEventListener('click', () => setPortalView('accounts'));
    $('closeUmpireDayDialog').addEventListener('click', () => $('umpireDayDialog').close());
    $('refreshUmpireDataBtn').addEventListener('click', refreshUmpireData);
    $('saveUmpireAccountsBtn').addEventListener('click', saveUmpireAccounts);

    const session = await currentPortalSession();
    if (session.authenticated) {
      state.user = session.user;
      await loadGames();
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
    $('umpirePortalAccountsBtn').hidden = !(state.user && state.user.role === 'admin');
    if (state.portalView === 'accounts' && !(state.user && state.user.role === 'admin')) {
      state.portalView = 'calendar';
    }
    if (state.user && state.user.role === 'admin') loadUmpireAccounts();
    setPortalView(state.portalView);
  }

  function setPortalView(view) {
    const canSeeAccounts = state.user && state.user.role === 'admin';
    state.portalView = view === 'accounts' && !canSeeAccounts ? 'calendar' : view;
    $('umpireCalendarPage').hidden = state.portalView !== 'calendar';
    $('umpireMyGamesSection').hidden = state.portalView !== 'my-games';
    $('umpireAccountsSection').hidden = state.portalView !== 'accounts' || !canSeeAccounts;
    [
      ['umpirePortalCalendarBtn', 'calendar'],
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
    const username = String(state.user && state.user.username || '').toLowerCase();
    $('umpireVisibleCount').textContent = games.length;
    $('umpireOpenCount').textContent = games.filter((game) => !game.filled).length;
    $('umpireMyCount').textContent = state.games.filter((game) => userAssigned(game, username) || userClaimed(game, username)).length;
    renderMyGames();
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
    const games = state.games
      .filter((game) => userAssigned(game, username) || userClaimed(game, username))
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    const assignedCount = games.filter((game) => userAssigned(game, username)).length;
    const availableCount = games.filter((game) => userClaimed(game, username) && !userAssigned(game, username)).length;
    $('umpireMyGamesSummary').textContent = `${assignedCount} assigned, ${availableCount} volunteered`;
    if (!games.length) {
      $('umpireMyGamesList').innerHTML = '<p class="muted">No assigned games or availability found for this login.</p>';
      return;
    }
    let lastDate = '';
    $('umpireMyGamesList').innerHTML = games.map((game) => {
      const dateHead = game.date !== lastDate ? `<h3 class="umpire-date-head">${formatDate(game.date)}</h3>` : '';
      lastDate = game.date;
      return `${dateHead}${renderGameCard(game, username)}`;
    }).join('');
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
    $('umpireGameList').querySelectorAll('[data-claim-game]').forEach((button) => {
      button.addEventListener('click', () => toggleClaim(button.dataset.claimGame, button.dataset.claimAction));
    });
  }

  function openDayDialog(date) {
    const games = visibleGames().filter((game) => game.date === date);
    const username = String(state.user && state.user.username || '').toLowerCase();
    $('umpireDayDialogTitle').textContent = formatDate(date);
    $('umpireDayDialogSubtitle').textContent = `${games.length} game${games.length === 1 ? '' : 's'} available in the current filters`;
    $('umpireDayDialogList').innerHTML = games.length
      ? games.map((game) => renderGameCard(game, username)).join('')
      : '<p class="muted">No games match these filters.</p>';
    $('umpireDayDialogList').querySelectorAll('[data-claim-game]').forEach((button) => {
      button.addEventListener('click', () => toggleClaim(button.dataset.claimGame, button.dataset.claimAction));
    });
    if (!$('umpireDayDialog').open) $('umpireDayDialog').showModal();
  }

  function renderGameCard(game, username) {
    const mine = userClaimed(game, username);
    const assignedToMe = userAssigned(game, username);
    const claimLabel = mine ? 'Remove my availability' : 'I will umpire this';
    const claimAction = mine ? 'cancel' : 'claim';
    const hideClaimButton = assignedToMe || (game.filled && !mine);
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
            ${game.claims.length ? `Available: ${escapeHtml(game.claims.map((claim) => claim.name).join(', '))}` : (assignedText ? '' : 'No umpire availability submitted yet.')}
          </span>
          ${hideClaimButton ? '' : `<button class="${mine ? 'secondary' : 'primary'}" type="button" data-claim-game="${escapeHtml(game.id)}" data-claim-action="${claimAction}">${claimLabel}</button>`}
        </div>
      </article>
    `;
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
    $('umpireAccountsSummary').textContent = `${state.accounts.length} official account${state.accounts.length === 1 ? '' : 's'}`;
    if (!state.accounts.length) {
      $('umpireAccountsList').innerHTML = '<p class="muted">No official accounts found yet. Refresh umpire data first.</p>';
      return;
    }
    $('umpireAccountsList').innerHTML = `
      <table class="umpire-accounts-table">
        <thead>
          <tr><th>Official</th><th>Username</th><th>Password</th><th>Qualification</th><th>Visible games</th></tr>
        </thead>
        <tbody>
          ${state.accounts.map((account) => `
            <tr>
              <td>${escapeHtml(account.name)}</td>
              <td>${escapeHtml(account.username)}</td>
              <td>${escapeHtml(account.password)}</td>
              <td>${escapeHtml(account.qualification || '')}</td>
              <td>${renderProgramCheckboxes(account)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  async function saveUmpireAccounts() {
    const button = $('saveUmpireAccountsBtn');
    const message = $('umpireAccountsSaveMessage');
    const accounts = state.accounts.map((account) => ({
      username: account.username,
      programs: [...document.querySelectorAll(`[data-account-program][data-username="${cssEscape(account.username)}"]:checked`)]
        .map((input) => input.dataset.accountProgram)
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
