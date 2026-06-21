(function () {
  const $ = (id) => document.getElementById(id);
  let currentSeasons = [];
  let currentAdminPrivileges = [];
  let activeSeasonId = '';
  let adminSession = { authenticated: false, user: null };
  let teamLabel = 'Titans';

  async function init() {
    $('seasonCreateForm').addEventListener('submit', createSeasonWorkspace);
    $('discoverSeasonCoachesBtn').addEventListener('click', discoverSeasonCoaches);
    $('saveSeasonCoachesBtn').addEventListener('click', saveSeasonCoaches);
    $('sendSeasonLinksBtn').addEventListener('click', sendSeasonLinks);
    $('saveAdminPrivilegesBtn').addEventListener('click', saveAdminPrivileges);
    await loadPublicConfig();
    await refreshSession();
  }

  async function loadPublicConfig() {
    try {
      const response = await fetch('/api/public-config', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      teamLabel = payload.teamLabel || teamLabel;
    } catch (_) {
      // Keep the default label.
    }
  }

  async function refreshSession() {
    const response = await fetch('/api/admin/session', { cache: 'no-store' });
    if (!response.ok) {
      window.location.href = '/admin.html';
      return;
    }
    adminSession = await response.json();
    if (!adminSession.authenticated) {
      window.location.href = '/admin.html';
      return;
    }
    if (!canRevealPasswords()) {
      $('seasonAccessPanel').hidden = false;
      $('seasonPlannerPanel').hidden = true;
      return;
    }
    $('seasonAccessPanel').hidden = true;
    $('seasonPlannerPanel').hidden = false;
    await loadSeasonPlanner();
  }

  function canRevealPasswords() {
    return Boolean(adminSession && adminSession.user && adminSession.user.canRevealPasswords);
  }

  async function loadSeasonPlanner() {
    const [response, privilegesResponse] = await Promise.all([
      fetch('/api/admin/season-planner', { cache: 'no-store' }),
      fetch('/api/admin/privileges', { cache: 'no-store' })
    ]);
    if (!response.ok) {
      $('seasonPlannerMessage').textContent = 'Season setup could not be loaded.';
      return;
    }
    const payload = await response.json();
    currentSeasons = payload.seasons || [];
    if (privilegesResponse.ok) {
      const privilegesPayload = await privilegesResponse.json();
      currentAdminPrivileges = privilegesPayload.admins || [];
    }
    if (!activeSeasonId && currentSeasons.length) activeSeasonId = currentSeasons[0].id;
    renderSeasonPlanner();
    renderAdminPrivileges();
  }

  async function createSeasonWorkspace(event) {
    event.preventDefault();
    const season = seasonInputValue();
    const label = $('seasonLabelInput').value.trim() || `${season} Season`;
    $('seasonPlannerMessage').textContent = 'Creating season workspace...';
    const response = await fetch('/api/admin/season-planner/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ season, year: season, label })
    });
    if (!response.ok) {
      $('seasonPlannerMessage').textContent = 'Season workspace could not be created.';
      return;
    }
    const payload = await response.json();
    activeSeasonId = payload.season && payload.season.id || '';
    $('seasonPlannerMessage').textContent = 'Season workspace ready. Add coaches below.';
    await loadSeasonPlanner();
  }

  function parseCoachLines(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(',').map((part) => part.trim());
        return {
          team: parts[0] || '',
          email: parts[1] || '',
          program: parts[2] || teamLabel
        };
      })
      .filter((coach) => coach.team || coach.email);
  }

  function coachLineKey(coach) {
    return String(coach && coach.team || '').trim().toLowerCase();
  }

  function mergeCoachLines(existing, discovered) {
    const byTeam = new Map();
    existing.forEach((coach) => {
      const key = coachLineKey(coach);
      if (key) byTeam.set(key, { ...coach });
    });
    discovered.forEach((coach) => {
      const key = coachLineKey(coach);
      if (!key) return;
      const current = byTeam.get(key) || {};
      byTeam.set(key, {
        team: coach.team || current.team || '',
        email: current.email || coach.email || '',
        program: current.program || coach.program || teamLabel
      });
    });
    return [...byTeam.values()].sort((a, b) => String(a.team || '').localeCompare(String(b.team || ''), undefined, { numeric: true }));
  }

  async function discoverSeasonCoaches() {
    const season = seasonInputValue();
    $('seasonPlannerMessage').textContent = `Searching Turtle Club for ${season} published ${teamLabel} coaches...`;
    const response = await fetch('/api/admin/season-planner/discover-coaches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ season, year: season })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      $('seasonPlannerMessage').textContent = payload.error || 'Published coaches could not be searched.';
      return;
    }
    const existing = parseCoachLines($('seasonCoachInput').value);
    const merged = mergeCoachLines(existing, payload.coaches || []);
    $('seasonCoachInput').value = merged.map((coach) => `${coach.team || ''}, ${coach.email || ''}, ${coach.program || teamLabel}`).join('\n');
    const warning = payload.warning ? ` ${payload.warning}` : '';
    const sourceYear = payload.discoveredSeasonYear && String(payload.discoveredSeasonYear) !== String(payload.season || payload.year || season)
      ? ` using ${payload.discoveredSeasonYear} published data`
      : '';
    $('seasonPlannerMessage').textContent = `Found ${payload.teams && payload.teams.length || 0} published ${teamLabel} team${payload.teams && payload.teams.length === 1 ? '' : 's'} for ${payload.season || payload.year || season}${sourceYear}.${warning}`;
  }

  function seasonInputValue() {
    return $('seasonYearInput').value.trim() || String(new Date().getFullYear() + 1);
  }

  async function saveSeasonCoaches() {
    if (!activeSeasonId) return;
    const coaches = parseCoachLines($('seasonCoachInput').value);
    if (!coaches.length) {
      $('seasonPlannerMessage').textContent = 'Add at least one coach line before saving.';
      return;
    }
    $('seasonPlannerMessage').textContent = 'Saving season coaches...';
    const response = await fetch('/api/admin/season-planner/coaches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonId: activeSeasonId, coaches })
    });
    if (!response.ok) {
      $('seasonPlannerMessage').textContent = 'Season coaches could not be saved.';
      return;
    }
    $('seasonPlannerMessage').textContent = 'Season coaches saved. Each coach now has a season-specific login and upload link.';
    await loadSeasonPlanner();
  }

  async function sendSeasonLinks() {
    if (!activeSeasonId) return;
    $('seasonPlannerMessage').textContent = 'Sending upload links...';
    const response = await fetch('/api/admin/season-planner/send-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonId: activeSeasonId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      $('seasonPlannerMessage').textContent = payload.error || 'Upload links could not be sent.';
      return;
    }
    $('seasonPlannerMessage').textContent = `Sent ${payload.sent || 0} upload link${payload.sent === 1 ? '' : 's'}${payload.failures && payload.failures.length ? `; ${payload.failures.length} failed.` : '.'}`;
    await loadSeasonPlanner();
  }

  function renderSeasonPlanner() {
    if (!currentSeasons.length) {
      $('seasonPlannerList').innerHTML = '<p class="muted">No season workspaces yet. Create one above.</p>';
      $('seasonConflictList').innerHTML = '';
      renderAdminPrivileges();
      return;
    }
    const active = currentSeasons.find((season) => season.id === activeSeasonId) || currentSeasons[0];
    activeSeasonId = active.id;
    const activeCoaches = active.coaches || [];
    $('seasonCoachInput').value = activeCoaches.map((coach) => `${coach.team || ''}, ${coach.email || ''}, ${coach.program || teamLabel}`).join('\n');
    $('seasonPlannerList').innerHTML = `
      <div class="season-tabs">
        ${currentSeasons.map((season) => `<button type="button" class="${season.id === active.id ? 'current' : ''}" data-season-select="${escapeHtml(season.id)}">${escapeHtml(season.label || season.year)}</button>`).join('')}
      </div>
      <div class="season-summary">
        <strong>${escapeHtml(active.label || active.year)}</strong>
        <span>${activeCoaches.length} coach${activeCoaches.length === 1 ? '' : 'es'}</span>
        <span>${active.stagedEventCount || 0} staged event${active.stagedEventCount === 1 ? '' : 's'}</span>
        <span>${active.conflictCount || 0} conflict${active.conflictCount === 1 ? '' : 's'}</span>
      </div>
      <div class="season-coach-table">
        ${activeCoaches.map(renderSeasonCoach).join('') || '<p class="muted">No coaches saved for this season yet.</p>'}
      </div>
    `;
    $('seasonPlannerList').querySelectorAll('[data-season-select]').forEach((button) => {
      button.addEventListener('click', () => {
        activeSeasonId = button.dataset.seasonSelect;
        renderSeasonPlanner();
      });
    });
    $('seasonConflictList').innerHTML = renderSeasonConflicts(active);
    renderAdminPrivileges();
  }

  function renderAdminPrivileges() {
    const list = $('adminPrivilegesList');
    if (!currentAdminPrivileges.length) {
      list.innerHTML = '<p class="muted">No configurable admin accounts found.</p>';
      return;
    }
    list.innerHTML = currentAdminPrivileges.map((admin) => `
      <article class="season-coach-row admin-privilege-row">
        <div>
          <strong>${escapeHtml(admin.username)}</strong>
          <span>${escapeHtml(admin.label || '')}${admin.locked ? ' (locked)' : ''}</span>
        </div>
        ${renderPrivilegeToggle(admin, 'canSwitchSites', 'Switch sites')}
        ${renderPrivilegeToggle(admin, 'canEditCoachEmails', 'Edit coach emails')}
        ${renderPrivilegeToggle(admin, 'canManualApprove', 'Manual approve')}
        ${renderPrivilegeToggle(admin, 'hideSyncFailures', 'Hide sync failures')}
      </article>
    `).join('');
  }

  function renderPrivilegeToggle(admin, key, label) {
    const disabled = admin.locked ? ' disabled' : '';
    const checked = admin[key] ? ' checked' : '';
    return `
      <label class="privilege-toggle">
        <input type="checkbox" data-admin-privilege="${escapeHtml(admin.username)}" data-privilege-key="${key}"${checked}${disabled}>
        <span>${escapeHtml(label)}</span>
      </label>
    `;
  }

  async function saveAdminPrivileges() {
    const updates = currentAdminPrivileges
      .filter((admin) => !admin.locked)
      .map((admin) => {
        const next = { username: admin.username };
        ['canSwitchSites', 'canEditCoachEmails', 'canManualApprove', 'hideSyncFailures'].forEach((key) => {
          const input = document.querySelector(`[data-admin-privilege="${cssEscape(admin.username)}"][data-privilege-key="${key}"]`);
          next[key] = Boolean(input && input.checked);
        });
        return next;
      });
    const response = await fetch('/api/admin/privileges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admins: updates })
    });
    $('seasonPlannerMessage').textContent = response.ok
      ? 'Admin privileges saved. Changes apply the next time that admin session is refreshed or they log in.'
      : 'Admin privileges could not be saved.';
    await loadSeasonPlanner();
  }

  function renderSeasonCoach(coach) {
    const origin = window.location.origin;
    const link = `${origin}${coach.uploadLink || ''}`;
    return `
      <article class="season-coach-row">
        <div>
          <strong>${escapeHtml(coach.team || '')}</strong>
          <span>${escapeHtml(coach.email || '')}</span>
        </div>
        <div>
          <label>Username</label>
          <code>${escapeHtml(coach.username || '')}</code>
        </div>
        <div>
          <label>Password</label>
          <code>${escapeHtml(coach.password || '')}</code>
        </div>
        <div>
          <label>Upload</label>
          <a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(coach.uploadStatus || 'not-sent')} (${coach.eventCount || 0})</a>
        </div>
      </article>
    `;
  }

  function renderSeasonConflicts(season) {
    if (!season || !season.conflicts || !season.conflicts.length) {
      return '<section class="season-card"><h3>Conflict Preview</h3><p class="muted">No staged conflicts found yet.</p></section>';
    }
    return `
      <section class="season-card">
        <h3>Conflict Preview</h3>
        <div class="season-conflict-table">
          ${season.conflicts.map((conflict) => `
            <article class="season-conflict-row ${escapeHtml(conflict.severity || '')}">
              <strong>${escapeHtml(conflict.date)} ${escapeHtml(conflict.time)} ${escapeHtml(conflict.diamond)}</strong>
              <span>${escapeHtml(conflict.event)}</span>
              <span>Conflicts with: ${escapeHtml(conflict.conflictsWith)}</span>
              <small>${escapeHtml(conflict.source)}</small>
            </article>
          `).join('')}
        </div>
      </section>
    `;
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

  function cssEscape(value) {
    return String(value || '').replace(/["\\]/g, '\\$&');
  }

  init();
})();
