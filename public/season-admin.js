(function () {
  const $ = (id) => document.getElementById(id);
  let currentSeasons = [];
  let currentAdminPrivileges = [];
  let activeSeasonId = '';
  let adminSession = { authenticated: false, user: null };
  let teamLabel = 'Titans';

  async function init() {
    $('seasonCreateForm').addEventListener('submit', createSeasonWorkspace);
    $('manualCoachForm').addEventListener('submit', addManualCoach);
    $('adminSeasonUploadForm').addEventListener('submit', uploadAdminSeasonSheet);
    $('adminAccountForm').addEventListener('submit', addAdminAccount);
    $('discoverSeasonCoachesBtn').addEventListener('click', discoverSeasonCoaches);
    $('saveSeasonCoachesBtn').addEventListener('click', saveSeasonCoaches);
    $('sendSeasonLinksBtn').addEventListener('click', sendSeasonLinks);
    $('saveAdminPrivilegesBtn').addEventListener('click', saveAdminPrivileges);
    document.addEventListener('click', (event) => {
      const approveButton = event.target.closest('[data-approve-season]');
      if (approveButton) approveSeason(approveButton.dataset.approveSeason);
      const deleteButton = event.target.closest('[data-delete-season]');
      if (deleteButton) deleteSeason(deleteButton.dataset.deleteSeason);
    });
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
      $('seasonPlannerMessage').textContent = 'Could not load seasons.';
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
    await openSeasonWorkspace(true);
  }

  async function openSeasonWorkspace(renderAfterOpen) {
    const season = seasonInputValue();
    if (!season) {
      $('seasonPlannerMessage').textContent = 'Enter a season first, for example 2025-2026.';
      return null;
    }
    const label = $('seasonLabelInput').value.trim() || `${season} Season`;
    $('seasonPlannerMessage').textContent = 'Opening season...';
    const response = await fetch('/api/admin/season-planner/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ season, year: season, label })
    });
    if (!response.ok) {
      $('seasonPlannerMessage').textContent = 'Could not create season.';
      return;
    }
    const payload = await response.json();
    activeSeasonId = payload.season && payload.season.id || '';
    $('seasonPlannerMessage').textContent = 'Season open.';
    if (renderAfterOpen) await loadSeasonPlanner();
    return payload.season || null;
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

  async function addManualCoach(event) {
    event.preventDefault();
    const team = $('manualCoachTeamInput').value.trim();
    const email = $('manualCoachEmailInput').value.trim();
    const program = $('manualCoachProgramInput').value.trim() || teamLabel;
    if (!team) {
      $('seasonPlannerMessage').textContent = 'Add a team name first.';
      return;
    }
    const merged = mergeCoachLines(collectSeasonCoaches(), [{ team, email, program }]);
    $('seasonCoachInput').value = merged.map((coach) => `${coach.team || ''}, ${coach.email || ''}, ${coach.program || teamLabel}`).join('\n');
    $('manualCoachTeamInput').value = '';
    $('manualCoachEmailInput').value = '';
    $('manualCoachProgramInput').value = '';
    if (activeSeasonId) {
      await saveSeasonCoachList(merged, true);
    } else {
      $('seasonPlannerMessage').textContent = 'Team added. Click Save coach emails when the roster is ready.';
    }
  }

  async function discoverSeasonCoaches() {
    const season = seasonInputValue();
    const opened = await openSeasonWorkspace(false);
    if (!opened) return;
    $('seasonPlannerMessage').textContent = `Searching ${season}...`;
    const response = await fetch('/api/admin/season-planner/discover-coaches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ season, year: season })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      $('seasonPlannerMessage').textContent = payload.error || 'Could not find coaches.';
      return;
    }
    const existing = Array.isArray(opened.coaches) ? opened.coaches : [];
    const merged = mergeCoachLines(existing, payload.coaches || []);
    $('seasonCoachInput').value = merged.map((coach) => `${coach.team || ''}, ${coach.email || ''}, ${coach.program || teamLabel}`).join('\n');
    const warning = payload.warning ? ` ${payload.warning}` : '';
    const sourceYear = payload.discoveredSeasonYear && String(payload.discoveredSeasonYear) !== String(payload.season || payload.year || season)
      ? ` using ${payload.discoveredSeasonYear} published data`
      : '';
    await saveSeasonCoachList(merged, false);
    $('seasonPlannerMessage').textContent = `Generated ${payload.teams && payload.teams.length || 0} ${teamLabel} team${payload.teams && payload.teams.length === 1 ? '' : 's'} for ${payload.season || payload.year || season}${sourceYear}.${warning}`;
  }

  function seasonInputValue() {
    return $('seasonYearInput').value.trim();
  }

  async function saveSeasonCoaches() {
    if (!activeSeasonId) {
      const opened = await openSeasonWorkspace(false);
      if (!opened) return;
    }
    const coaches = collectSeasonCoaches();
    if (!coaches.length) {
      $('seasonPlannerMessage').textContent = 'Add at least one coach.';
      return;
    }
    $('seasonPlannerMessage').textContent = 'Saving coaches...';
    await saveSeasonCoachList(coaches, true);
  }

  function collectSeasonCoaches() {
    const rows = [...document.querySelectorAll('[data-season-coach-row]')];
    if (rows.length) {
      return rows.map((row) => ({
        id: row.dataset.coachId || '',
        team: row.dataset.coachTeam || '',
        username: row.dataset.coachUsername || '',
        password: row.dataset.coachPassword || '',
        email: row.querySelector('[data-season-coach-email]')?.value.trim() || '',
        program: row.querySelector('[data-season-coach-program]')?.value.trim() || teamLabel
      })).filter((coach) => coach.team || coach.email);
    }
    return parseCoachLines($('seasonCoachInput').value);
  }

  async function saveSeasonCoachList(coaches, showMessage) {
    const response = await fetch('/api/admin/season-planner/coaches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonId: activeSeasonId, coaches })
    });
    if (!response.ok) {
      $('seasonPlannerMessage').textContent = 'Could not save coaches.';
      return;
    }
    if (showMessage) $('seasonPlannerMessage').textContent = 'Coach emails saved.';
    await loadSeasonPlanner();
  }

  async function sendSeasonLinks() {
    if (!activeSeasonId) return;
    $('seasonPlannerMessage').textContent = 'Sending links...';
    const response = await fetch('/api/admin/season-planner/send-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonId: activeSeasonId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      $('seasonPlannerMessage').textContent = payload.error || 'Could not send links.';
      return;
    }
    $('seasonPlannerMessage').textContent = `Sent ${payload.sent || 0} link${payload.sent === 1 ? '' : 's'}${payload.failures && payload.failures.length ? `; ${payload.failures.length} failed.` : '.'}`;
    await loadSeasonPlanner();
  }

  async function uploadAdminSeasonSheet(event) {
    event.preventDefault();
    if (!activeSeasonId) {
      const opened = await openSeasonWorkspace(false);
      if (!opened) return;
    }
    const file = $('adminSeasonUploadFile').files && $('adminSeasonUploadFile').files[0];
    if (!file) {
      $('seasonPlannerMessage').textContent = 'Choose the completed Excel template first.';
      return;
    }
    if (!window.XLSX) {
      $('seasonPlannerMessage').textContent = 'Spreadsheet reader did not load. Refresh the page and try again.';
      return;
    }
    $('seasonPlannerMessage').textContent = 'Reading season workbook...';
    try {
      const rows = await readSeasonWorkbook(file);
      if (!rows.length) {
        $('seasonPlannerMessage').textContent = 'No season rows were found in that workbook.';
        return;
      }
      const response = await fetch('/api/admin/season-planner/admin-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seasonId: activeSeasonId, rows })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        $('seasonPlannerMessage').textContent = payload.error || 'Could not upload season workbook.';
        return;
      }
      $('adminSeasonUploadFile').value = '';
      $('seasonPlannerMessage').textContent = `Uploaded ${payload.eventCount || 0} event${payload.eventCount === 1 ? '' : 's'} for ${payload.coachCount || 0} team${payload.coachCount === 1 ? '' : 's'}.`;
      await loadSeasonPlanner();
    } catch (error) {
      $('seasonPlannerMessage').textContent = error.message || 'Could not read season workbook.';
    }
  }

  function readSeasonWorkbook(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const workbook = window.XLSX.read(reader.result, { type: 'array' });
          const preferred = workbook.SheetNames.find((name) => /schedule/i.test(name)) || workbook.SheetNames[0];
          const sheet = workbook.Sheets[preferred];
          const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
          resolve(rows.map(normalizeSeasonWorkbookRow).filter((row) => row.team && (row.date || row.start || row.opponent || row.diamond)));
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('The file could not be read.'));
      reader.readAsArrayBuffer(file);
    });
  }

  function normalizeSeasonWorkbookRow(row) {
    const find = (...keys) => {
      const wanted = keys.map(normalizeHeader);
      const match = Object.keys(row).find((key) => wanted.includes(normalizeHeader(key)));
      return match ? row[match] : '';
    };
    return {
      team: String(find('Team', 'Coach Team')).trim(),
      coachEmail: String(find('Coach Email', 'Email')).trim(),
      program: String(find('Program')).trim() || teamLabel,
      date: find('Date', 'Game Date', 'Day'),
      start: find('Start Time', 'Start', 'Time'),
      end: find('End Time', 'End', 'Finish'),
      eventType: find('Event Type', 'Type', 'Game Type'),
      opponentTitle: find('Opponent/Title', 'Opponent', 'Title', 'Description'),
      diamondVenue: find('Diamond/Venue', 'Diamond', 'Venue', 'Location'),
      notes: find('Notes', 'Note')
    };
  }

  function normalizeHeader(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function renderSeasonPlanner() {
    if (!currentSeasons.length) {
      $('seasonPlannerList').innerHTML = '<p class="muted">No seasons yet.</p>';
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
        <span>${active.stagedEventCount || 0} event${active.stagedEventCount === 1 ? '' : 's'}</span>
        <span>${active.conflictCount || 0} conflict${active.conflictCount === 1 ? '' : 's'}</span>
        <span>${escapeHtml(active.status || 'setup')}</span>
        <button class="secondary danger-light" type="button" data-delete-season="${escapeHtml(active.id || '')}">Delete season</button>
      </div>
      <div class="season-coach-table">
        ${activeCoaches.map(renderSeasonCoach).join('') || '<p class="muted">No coaches saved.</p>'}
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
      list.innerHTML = '<p class="muted">No admin accounts found.</p>';
      return;
    }
    list.innerHTML = currentAdminPrivileges.map((admin) => `
      <article class="season-coach-row admin-privilege-row">
        <div class="admin-privilege-identity">
          <strong>${escapeHtml(admin.username)}</strong>
          <span>${escapeHtml(admin.label || '')}${admin.locked ? ' (locked)' : ''}</span>
          ${admin.email ? `<span>${escapeHtml(admin.email)}</span>` : ''}
          <code>${escapeHtml(admin.password || '')}</code>
          ${admin.removable ? `<button class="secondary season-remove-admin" type="button" data-remove-admin="${escapeHtml(admin.username)}">Remove</button>` : ''}
        </div>
        <div class="admin-privilege-group">
          <span class="admin-privilege-group-title">Site access</span>
          ${renderPrivilegeToggle(admin, 'canAccessTitans', 'Titans')}
          ${renderPrivilegeToggle(admin, 'canAccessAthletics', 'Athletics')}
          ${renderPrivilegeToggle(admin, 'canSwitchSites', 'Can switch')}
        </div>
        <div class="admin-privilege-group">
          <span class="admin-privilege-group-title">Admin tools</span>
          ${renderPrivilegeToggle(admin, 'canEditCoachEmails', 'Edit coach emails')}
          ${renderPrivilegeToggle(admin, 'canManualApprove', 'Manual approve')}
          ${renderPrivilegeToggle(admin, 'notifyOnCoachRequests', 'Request emails')}
          ${renderPrivilegeToggle(admin, 'hideSyncFailures', 'Hide sync failures')}
        </div>
      </article>
    `).join('');
    list.querySelectorAll('[data-remove-admin]').forEach((button) => {
      button.addEventListener('click', () => removeAdminAccount(button.dataset.removeAdmin));
    });
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
        ['canAccessTitans', 'canAccessAthletics', 'canSwitchSites', 'canEditCoachEmails', 'canManualApprove', 'notifyOnCoachRequests', 'hideSyncFailures'].forEach((key) => {
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
      ? 'Admin access saved.'
      : 'Could not save admin access.';
    await loadSeasonPlanner();
  }

  async function addAdminAccount(event) {
    event.preventDefault();
    const username = $('adminUsernameInput').value.trim();
    const password = $('adminPasswordInput').value.trim();
    const email = $('adminEmailInput').value.trim();
    const initials = $('adminInitialsInput').value.trim();
    if (!username || !password) {
      $('seasonPlannerMessage').textContent = 'Admin username and password are required.';
      return;
    }
    const response = await fetch('/api/admin/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password,
        email,
        initials,
        accessLabel: 'Site Admin',
        canSwitchSites: true,
        canAccessTitans: true,
        canAccessAthletics: true,
        canEditCoachEmails: true,
        notifyOnCoachRequests: true,
        canManualApprove: true
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      $('seasonPlannerMessage').textContent = payload.error || 'Could not add admin.';
      return;
    }
    $('adminUsernameInput').value = '';
    $('adminPasswordInput').value = '';
    $('adminEmailInput').value = '';
    $('adminInitialsInput').value = '';
    $('seasonPlannerMessage').textContent = 'Admin added.';
    await loadSeasonPlanner();
  }

  async function removeAdminAccount(username) {
    if (!username) return;
    if (!window.confirm(`Remove admin ${username}?`)) return;
    const response = await fetch(`/api/admin/accounts/${encodeURIComponent(username)}`, {
      method: 'DELETE'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      $('seasonPlannerMessage').textContent = payload.error || 'Could not remove admin.';
      return;
    }
    $('seasonPlannerMessage').textContent = 'Admin removed.';
    await loadSeasonPlanner();
  }

  async function deleteSeason(seasonId) {
    if (!seasonId) return;
    const active = currentSeasons.find((season) => season.id === seasonId);
    const label = active && (active.label || active.year) || 'this season';
    if (!window.confirm(`Delete ${label}? This removes the saved new-season workspace, coach upload links, and staged uploads for this setup only.`)) return;
    const response = await fetch(`/api/admin/season-planner/${encodeURIComponent(seasonId)}`, {
      method: 'DELETE'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      $('seasonPlannerMessage').textContent = payload.error || 'Could not delete season.';
      return;
    }
    activeSeasonId = '';
    $('seasonPlannerMessage').textContent = 'Season deleted.';
    await loadSeasonPlanner();
  }

  async function approveSeason(seasonId) {
    if (!seasonId) return;
    $('seasonPlannerMessage').textContent = 'Approving staged season...';
    const response = await fetch('/api/admin/season-planner/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      $('seasonPlannerMessage').textContent = payload.error || 'Could not approve season.';
      return;
    }
    $('seasonPlannerMessage').textContent = 'Season approved. Staged schedules are ready for the next upload step.';
    await loadSeasonPlanner();
  }

  function renderSeasonCoach(coach) {
    const origin = window.location.origin;
    const link = `${origin}${coach.uploadLink || ''}`;
    return `
      <article class="season-coach-row season-coach-edit-row"
        data-season-coach-row
        data-coach-id="${escapeHtml(coach.id || '')}"
        data-coach-team="${escapeHtml(coach.team || '')}"
        data-coach-username="${escapeHtml(coach.username || '')}"
        data-coach-password="${escapeHtml(coach.password || '')}">
        <div>
          <strong>${escapeHtml(coachNameFromTeam(coach.team) || coach.team || '')}</strong>
          <span>${escapeHtml(coach.team || '')}</span>
        </div>
        <div>
          <label>Email</label>
          <input type="email" value="${escapeHtml(coach.email || '')}" data-season-coach-email placeholder="coach@example.com">
        </div>
        <div>
          <label>Program</label>
          <input type="text" value="${escapeHtml(coach.program || teamLabel)}" data-season-coach-program>
        </div>
        <div>
          <label>Link</label>
          <a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(coach.uploadStatus || 'not-sent')} (${coach.eventCount || 0})</a>
        </div>
      </article>
    `;
  }

  function coachNameFromTeam(team) {
    const match = String(team || '').match(/\(([^)]+)\)/);
    return match ? match[1].trim() : '';
  }

  function renderSeasonConflicts(season) {
    const coachCount = season && season.coaches ? season.coaches.length : 0;
    const uploadedCount = season && season.coaches ? season.coaches.filter((coach) => String(coach.uploadStatus || '').startsWith('uploaded')).length : 0;
    const conflictCount = season && season.conflicts ? season.conflicts.length : 0;
    const canApprove = season && coachCount > 0 && uploadedCount === coachCount && conflictCount === 0 && season.status !== 'approved';
    const approvalPanel = season ? `
      <section class="season-card season-approval-card">
        <div>
          <h3>4. One-Time Season Approval</h3>
          <p class="muted">${uploadedCount} of ${coachCount} coach schedule${coachCount === 1 ? '' : 's'} uploaded. Conflicts must be cleared before approval.</p>
        </div>
        <button class="primary" type="button" data-approve-season="${escapeHtml(season.id || '')}"${canApprove ? '' : ' disabled'}>${season.status === 'approved' ? 'Season approved' : 'Approve season'}</button>
      </section>
    ` : '';
    if (!season || !season.conflicts || !season.conflicts.length) {
      return `<section class="season-card"><h3>3. Conflict Preview</h3><p class="muted">No conflicts found.</p></section>${approvalPanel}`;
    }
    return `
      <section class="season-card">
        <h3>3. Conflict Preview</h3>
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
      ${approvalPanel}
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
