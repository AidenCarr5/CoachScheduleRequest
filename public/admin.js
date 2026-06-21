(function () {
  const $ = (id) => document.getElementById(id);
  let currentRequests = [];
  let currentAccounts = [];
  let currentAdminLogins = [];
  let currentSeasons = [];
  let currentAdminPrivileges = [];
  let activeSeasonId = '';
  let adminBusy = false;
  let adminSession = { authenticated: false, user: null };
  let teamLabel = 'Titans';

  async function init() {
    $('loginForm').addEventListener('submit', login);
    $('adminExportBtn').addEventListener('click', exportRequests);
    $('refreshScheduleBtn').addEventListener('click', refreshSchedule);
    $('sendDiamondStatusEmailBtn').addEventListener('click', sendDiamondStatusEmail);
    $('rescanTeamsBtn').addEventListener('click', rescanTeams);
    $('saveCoachPasswordsBtn').addEventListener('click', saveCoachPasswords);
    $('newSeasonBtn').addEventListener('click', toggleSeasonPlanner);
    $('seasonCreateForm').addEventListener('submit', createSeasonWorkspace);
    $('saveSeasonCoachesBtn').addEventListener('click', saveSeasonCoaches);
    $('sendSeasonLinksBtn').addEventListener('click', sendSeasonLinks);
    $('saveAdminPrivilegesBtn').addEventListener('click', saveAdminPrivileges);
    await loadPublicConfig();
    await acceptIncomingSwitchLogin();
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

  async function acceptIncomingSwitchLogin() {
    const params = new URLSearchParams(window.location.search);
    const switchToken = params.get('switchToken');
    if (!switchToken) return;
    params.delete('switchToken');
    const cleanQuery = params.toString();
    const cleanUrl = `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', cleanUrl);
    try {
      const response = await fetch('/api/admin/switch-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ switchToken })
      });
      if (!response.ok) {
        $('loginMessage').textContent = 'The admin switch login expired. Please switch again from the original admin page.';
      }
    } catch (_) {
      $('loginMessage').textContent = 'The admin switch login could not be completed.';
    }
  }

  async function refreshSession() {
    const response = await fetch('/api/admin/session', { cache: 'no-store' });
    if (response.ok) {
      const payload = await response.json();
      adminSession = payload;
      if (!payload.authenticated) {
        showLogin();
        if (window.refreshTopNav) window.refreshTopNav();
        return;
      }
      showAdmin();
      if (window.refreshTopNav) window.refreshTopNav();
      await loadDashboard();
      return;
    }
    showLogin();
    if (window.refreshTopNav) window.refreshTopNav();
  }

  async function login(event) {
    event.preventDefault();
    const usernameField = $('adminUsername');
    const password = $('adminPassword').value;
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: usernameField ? usernameField.value.trim() : '',
        password
      })
    });
    if (!response.ok) {
      $('loginMessage').textContent = 'Password did not match.';
      return;
    }
    if (usernameField) usernameField.value = '';
    $('adminPassword').value = '';
    $('loginMessage').textContent = '';
    await refreshSession();
  }

  async function loadRequests() {
    const response = await fetch('/api/admin/requests', { cache: 'no-store' });
    if (!response.ok) {
      showLogin();
      return;
    }
    const payload = await response.json();
    currentRequests = payload.requests || [];
    const list = $('adminRequestList');
    list.innerHTML = currentRequests.length ? currentRequests.map(renderRequest).join('') : '<p class="muted">No coach requests yet.</p>';
    applyReadOnlyUi();
    if (isReadOnlyAdminViewer()) return;
    list.querySelectorAll('[data-approve]').forEach((button) => {
      button.addEventListener('click', () => reviewRequest(button.dataset.approve, 'approve'));
    });
    list.querySelectorAll('[data-manual-approve]').forEach((button) => {
      button.addEventListener('click', () => reviewRequest(button.dataset.manualApprove, 'manual-approve'));
    });
    list.querySelectorAll('[data-reject]').forEach((button) => {
      button.addEventListener('click', () => reviewRequest(button.dataset.reject, 'reject'));
    });
    list.querySelectorAll('[data-clear]').forEach((button) => {
      button.addEventListener('click', () => clearRequest(button.dataset.clear));
    });
  }

  async function loadCoachAccounts() {
    const response = await fetch('/api/admin/coach-accounts', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json();
    currentAccounts = payload.accounts || [];
    $('coachAccountsMessage').textContent = currentAccounts.length
      ? (payload.canRevealPasswords
        ? `Generated from ${currentAccounts.length} ${teamLabel} team login${currentAccounts.length === 1 ? '' : 's'}.`
        : payload.canEditCoachEmails
          ? `Generated from ${currentAccounts.length} ${teamLabel} team login${currentAccounts.length === 1 ? '' : 's'}. Passwords are masked; emails can be updated.`
          : `Generated from ${currentAccounts.length} ${teamLabel} team login${currentAccounts.length === 1 ? '' : 's'}. Passwords are masked for this account.`)
      : `No ${teamLabel} teams were found in the latest Turtle Club sync.`;
    $('coachAccountsList').innerHTML = currentAccounts.length
      ? currentAccounts.map(renderCoachAccount).join('')
      : '<p class="muted">No coach logins are available yet.</p>';
    applyReadOnlyUi();
  }

  async function loadAdminLogins() {
    const response = await fetch('/api/admin/logins', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json();
    currentAdminLogins = payload.logins || [];
    $('adminLoginsMessage').textContent = currentAdminLogins.length
      ? (payload.canRevealPasswords
        ? 'These accounts can reach the protected admin tools shown in this portal.'
        : 'These accounts can reach the protected admin tools shown in this portal. Passwords are masked for this account.')
      : 'No admin logins are available right now.';
    $('adminLoginsList').innerHTML = currentAdminLogins.length
      ? currentAdminLogins.map(renderAdminLogin).join('')
      : '<p class="muted">No admin logins are available right now.</p>';
  }

  async function loadDashboard() {
    const tasks = [loadRequests(), loadCoachAccounts(), loadAdminLogins()];
    if (canRevealPasswords()) tasks.push(loadSeasonPlanner());
    await Promise.all(tasks);
  }

  async function loadSeasonPlanner() {
    if (!canRevealPasswords()) return;
    const [response, privilegesResponse] = await Promise.all([
      fetch('/api/admin/season-planner', { cache: 'no-store' }),
      fetch('/api/admin/privileges', { cache: 'no-store' })
    ]);
    if (!response.ok) return;
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

  function toggleSeasonPlanner() {
    const panel = $('seasonPlannerPanel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function createSeasonWorkspace(event) {
    event.preventDefault();
    if (!canRevealPasswords()) return;
    const year = $('seasonYearInput').value.trim() || String(new Date().getFullYear() + 1);
    const label = $('seasonLabelInput').value.trim() || `${year} Season`;
    $('seasonPlannerMessage').textContent = 'Creating season workspace...';
    const response = await fetch('/api/admin/season-planner/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, label })
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

  async function saveSeasonCoaches() {
    if (!canRevealPasswords() || !activeSeasonId) return;
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
    if (!canRevealPasswords() || !activeSeasonId) return;
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
    const panel = $('seasonPlannerPanel');
    $('newSeasonBtn').hidden = !canRevealPasswords();
    if (!canRevealPasswords()) {
      panel.hidden = true;
      return;
    }
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
    if (!list) return;
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
    if (!canRevealPasswords()) return;
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

  function renderRequest(request) {
    const allocation = request.allocationApproval || {};
    const allocationPending = request.status === 'pending' && allocation.status === 'pending';
    const approveDisabled = request.status !== 'pending' || allocationPending ? ' disabled data-force-disabled="true"' : '';
    const manualApproveDisabled = request.status !== 'pending' || allocationPending ? ' disabled data-force-disabled="true"' : '';
    const rejectDisabled = request.status !== 'pending' ? ' disabled data-force-disabled="true"' : '';
    const showClear = request.status === 'approved' || request.status === 'rejected';
    const readOnly = isReadOnlyAdminViewer();
    const noteAttributes = readOnly ? ' readonly aria-readonly="true"' : '';
    const actionDisabled = readOnly ? ' disabled' : '';
    const manualApproveButton = canManualApprove()
      ? `<button class="secondary" type="button" data-manual-approve="${request.id}"${manualApproveDisabled}${actionDisabled}>Manual approve</button>`
      : '';
    const cardClass = allocationPending ? 'allocation-pending' : escapeHtml(request.status || 'pending');
    const statusLabel = allocationPending ? 'requires additional approval' : (request.status || 'pending');
    const allocationText = allocationPending
      ? `<p class="allocation-approval-note"><strong>Additional approval required.</strong> ${escapeHtml(allocation.reason || '')}</p>`
      : allocation.status === 'approved'
        ? `<p class="allocation-approval-note approved"><strong>Additional approval accepted.</strong> ${escapeHtml(allocation.reason || '')}${allocation.approvedNote ? `<br><strong>Note:</strong> ${escapeHtml(allocation.approvedNote)}` : ''}</p>`
        : '';
    const hideFailedSync = adminSession && adminSession.user && adminSession.user.hideSyncFailures && request.turtleClubSyncStatus === 'failed';
    const syncText = request.status === 'approved' && request.turtleClubSyncStatus && !hideFailedSync
      ? `<p class="turtle-sync-note ${escapeHtml(request.turtleClubSyncStatus)}"><strong>Turtle Club sync:</strong> ${escapeHtml(request.turtleClubSyncStatus)}${request.turtleClubSyncDetails ? ` - ${escapeHtml(request.turtleClubSyncDetails)}` : ''}</p>`
      : '';
    return `
      <article class="admin-request-card ${cardClass}">
        <div class="admin-request-head">
          <strong>${escapeHtml(request.action)} - ${escapeHtml(request.team)}</strong>
          <span>${escapeHtml(statusLabel)}</span>
        </div>
        <p>${escapeHtml(request.date)} ${escapeHtml(request.start || '')} ${escapeHtml(request.opponent || '')}</p>
        <p>${escapeHtml(request.diamond || '')}</p>
        <p>${escapeHtml(request.reason || '')}</p>
        <p>${escapeHtml(request.availabilityStatus || '')}</p>
        ${allocationText}
        ${syncText}
        <label class="admin-note-label" for="admin-note-${escapeHtml(request.id)}">Admin note</label>
        <textarea id="admin-note-${escapeHtml(request.id)}" class="admin-note-input" data-admin-note="${escapeHtml(request.id)}" rows="3" placeholder="Why was this approved or rejected?"${noteAttributes}>${escapeHtml(request.adminNote || '')}</textarea>
        <div class="admin-request-actions">
          <button class="primary" type="button" data-approve="${request.id}"${approveDisabled}${actionDisabled}>Approve</button>
          ${manualApproveButton}
          <button class="cancel-btn" type="button" data-reject="${request.id}"${rejectDisabled}${actionDisabled}>Reject</button>
          ${showClear ? `<button class="secondary" type="button" data-clear="${request.id}"${actionDisabled}>Clear</button>` : ''}
        </div>
      </article>
    `;
  }

  function renderCoachAccount(account) {
    const passwordLocked = !canRevealPasswords();
    const emailLocked = !canEditCoachEmails();
    const passwordAttributes = passwordLocked ? ' readonly aria-readonly="true"' : '';
    const emailAttributes = emailLocked ? ' readonly aria-readonly="true"' : '';
    return `
      <article class="coach-account-card">
        <div>
          <strong>${escapeHtml(account.team)}</strong>
          <p>${escapeHtml(account.username)}</p>
        </div>
        <div class="coach-account-fields">
          <div class="coach-account-password">
            <label for="coach-password-${escapeHtml(account.username)}">Password</label>
            <input
              id="coach-password-${escapeHtml(account.username)}"
              type="text"
              value="${escapeHtml(account.password)}"
              data-coach-password="${escapeHtml(account.username)}"
              autocomplete="off"
              ${passwordAttributes}
            >
          </div>
          <div class="coach-account-email">
            <label for="coach-email-${escapeHtml(account.username)}">Email</label>
            <input
              id="coach-email-${escapeHtml(account.username)}"
              type="email"
              value="${escapeHtml(account.email || '')}"
              data-coach-email="${escapeHtml(account.username)}"
              autocomplete="off"
              placeholder="coach@example.com"
              ${emailAttributes}
            >
          </div>
        </div>
      </article>
    `;
  }

  function renderAdminLogin(login) {
    return `
      <article class="coach-account-card admin-login-card">
        <div>
          <strong>${escapeHtml(login.label || 'Admin Login')}</strong>
          <p>${escapeHtml(login.access || '')}</p>
        </div>
        <div class="coach-account-fields">
          <div class="coach-account-password">
            <label>Username</label>
            <input type="text" value="${escapeHtml(login.username || '')}" readonly aria-readonly="true">
          </div>
          <div class="coach-account-password">
            <label>Password</label>
            <input type="text" value="${escapeHtml(login.password || '')}" readonly aria-readonly="true">
          </div>
        </div>
      </article>
    `;
  }

  async function reviewRequest(requestId, action) {
    if (adminBusy || isReadOnlyAdminViewer()) return;
    const isManualApprove = action === 'manual-approve';
    const isApprove = action === 'approve' || isManualApprove;
    const noteField = document.getElementById(`admin-note-${requestId}`);
    const adminNote = noteField ? noteField.value.trim() : '';
    $('adminMessage').textContent = isManualApprove
      ? 'Manually approving request and sending coach email...'
      : action === 'approve'
      ? 'Applying approved change to Turtle Club...'
      : 'Saving request review...';
    setAdminBusy(true, isManualApprove ? 'Manual approval...' : action === 'approve' ? 'Applying approval...' : 'Saving rejection...', isManualApprove
      ? 'Please wait while the request is marked approved and the coach email is sent.'
      : action === 'approve'
      ? 'Please wait while Turtle Club is updated and the scheduler syncs back.'
      : 'Please wait while the request review is saved.');
    try {
      const response = await fetch(`/api/admin/requests/${requestId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminNote })
      });
      if (!response.ok) {
        let message = isManualApprove
          ? 'The request could not be manually approved.'
          : action === 'approve'
          ? 'The request could not be applied on Turtle Club.'
          : 'The request review could not be saved.';
        try {
          const payload = await response.json();
          if (payload.details) {
            message = `${message} ${payload.details}`;
          } else if (payload.error) {
            message = `${message} ${payload.error}`;
          }
        } catch (_) {
          // Ignore JSON parsing errors and keep the generic message.
        }
        $('adminMessage').textContent = message;
        return;
      }
      const payload = await response.json();
      await loadRequests();
      if (isApprove) {
        if (payload.backgroundSync) {
          let message = payload.verificationDetails || 'Approved locally. Turtle Club sync is running in the background.';
          if (!payload.emailSent && payload.emailError) {
            message = `${message} Coach email failed: ${payload.emailError}`;
          }
          $('adminMessage').textContent = message;
          return;
        }
        const approvedTarget = isManualApprove
          ? 'manually recorded in the scheduler'
          : payload.appliedToTurtleClub === false ? 'recorded in the scheduler' : 'applied to Turtle Club and synced back into the scheduler';
        let message = payload.verified
          ? `Approved request was ${approvedTarget}. ${payload.verificationDetails || ''}`.trim()
          : `Approved request was applied, but the follow-up verification did not confirm the change yet. ${payload.verificationDetails || ''}`.trim();
        if (!payload.emailSent && payload.emailError) {
          message = `${message} Coach email failed: ${payload.emailError}`;
        }
        $('adminMessage').textContent = message;
        return;
      }
      $('adminMessage').textContent = !payload.emailSent && payload.emailError
        ? `Request rejected. Coach email failed: ${payload.emailError}`
        : 'Request rejected.';
    } finally {
      setAdminBusy(false);
    }
  }

  async function clearRequest(requestId) {
    if (isReadOnlyAdminViewer()) return;
    const response = await fetch(`/api/admin/requests/${requestId}`, {
      method: 'DELETE'
    });
    if (!response.ok) return;
    await loadDashboard();
  }

  async function refreshSchedule() {
    if (isReadOnlyAdminViewer()) return;
    $('adminMessage').textContent = 'Refreshing schedule from Turtle Club...';
    const response = await fetch('/api/admin/refresh-schedule', {
      method: 'POST'
    });
    if (!response.ok) {
      $('adminMessage').textContent = 'The schedule refresh did not complete.';
      return;
    }
    await loadDashboard();
    $('adminMessage').textContent = 'Schedule refreshed from Turtle Club. Coach requests were left in place.';
  }

  async function sendDiamondStatusEmail() {
    if (isReadOnlyAdminViewer()) return;
    $('adminMessage').textContent = 'Sending diamond status email...';
    const response = await fetch('/api/admin/test-diamond-status-email', {
      method: 'POST'
    });
    if (!response.ok) {
      let message = 'The diamond status email could not be sent.';
      try {
        const payload = await response.json();
        if (payload.details) message = `${message} ${payload.details}`;
        else if (payload.error) message = `${message} ${payload.error}`;
      } catch (_) {
        // Keep the generic message.
      }
      $('adminMessage').textContent = message;
      return;
    }
    const payload = await response.json();
    const sent = payload.result && payload.result.sent ? payload.result.sent : 0;
    const deliveries = payload.result && Array.isArray(payload.result.deliveries) ? payload.result.deliveries : [];
    $('adminMessage').textContent = deliveries.length
      ? `Diamond status email sent for ${deliveries.length} status row${deliveries.length === 1 ? '' : 's'} affecting today. ${sent} email${sent === 1 ? '' : 's'} delivered.`
      : `Diamond status email sent. ${sent} email${sent === 1 ? '' : 's'} delivered.`;
  }

  async function rescanTeams() {
    if (isReadOnlyAdminViewer()) return;
    $('coachAccountsMessage').textContent = `Rescanning ${teamLabel} teams from Turtle Club...`;
    const response = await fetch('/api/admin/rescan-teams', {
      method: 'POST'
    });
    if (!response.ok) {
      let message = `The ${teamLabel} team rescan did not complete.`;
      try {
        const payload = await response.json();
        if (payload.details) message = `${message} ${payload.details}`;
      } catch (_) {
        // Keep the generic message.
      }
      $('coachAccountsMessage').textContent = message;
      return;
    }
    const payload = await response.json();
    currentAccounts = payload.accounts || [];
    $('coachAccountsMessage').textContent = currentAccounts.length
      ? `Rescan complete. ${currentAccounts.length} coach login${currentAccounts.length === 1 ? '' : 's'} regenerated from Turtle Club.`
      : `Rescan complete, but no ${teamLabel} teams were found.`;
    $('coachAccountsList').innerHTML = currentAccounts.length
      ? currentAccounts.map(renderCoachAccount).join('')
      : '<p class="muted">No coach logins are available yet.</p>';
    applyReadOnlyUi();
  }

  async function saveCoachPasswords() {
    if (!canEditCoachLogins()) return;
    const fields = Array.from(document.querySelectorAll('[data-coach-password]'));
    const accounts = fields.map((field) => {
      const username = field.dataset.coachPassword;
      const emailField = document.querySelector(`[data-coach-email="${cssEscape(username)}"]`);
      return {
        username,
        password: field.value.trim(),
        email: emailField ? emailField.value.trim() : ''
      };
    });
    if (canRevealPasswords() && accounts.some((account) => !account.password)) {
      $('coachAccountsMessage').textContent = 'Every coach login needs a password before saving.';
      return;
    }
    $('coachAccountsMessage').textContent = 'Saving coach login details...';
    const response = await fetch('/api/admin/coach-accounts/update-passwords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accounts })
    });
    if (!response.ok) {
      $('coachAccountsMessage').textContent = 'Coach login details could not be saved.';
      return;
    }
    const payload = await response.json();
    currentAccounts = payload.accounts || [];
    $('coachAccountsMessage').textContent = 'Coach login details saved.';
    $('coachAccountsList').innerHTML = currentAccounts.length
      ? currentAccounts.map(renderCoachAccount).join('')
      : '<p class="muted">No coach logins are available yet.</p>';
    applyReadOnlyUi();
  }

  function exportRequests() {
    if (!currentRequests.length) {
      alert('No requests to export.');
      return;
    }
    const rows = currentRequests.map((request, index) => ({
      '#': index + 1,
      Status: request.status,
      Action: request.action,
      Team: request.team,
      'Original Type': request.originalType,
      'Original Date': request.originalDate,
      'Original Start': request.originalStart,
      'Original Opponent/Title': request.originalOpponent,
      'Original Diamond': request.originalDiamond,
      'New Type': request.newType,
      Date: request.date,
      Start: request.start,
      End: request.end,
      'Opponent/Title': request.opponent,
      Diamond: request.diamond,
      Notes: request.reason,
      'Availability Check': request.availabilityStatus,
      'Submitted By': request.submittedBy,
      'Submitted At': request.submittedAt,
      'Reviewed By': request.reviewedBy,
      'Reviewed At': request.reviewedAt
    }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Requests');
    XLSX.writeFile(book, `titans-admin-requests-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function showAdmin() {
    $('loginPanel').hidden = true;
    $('adminPanel').hidden = false;
    $('coachAccountsPanel').hidden = false;
    $('adminLoginsPanel').hidden = false;
    applyReadOnlyUi();
  }

  function showLogin() {
    $('loginPanel').hidden = false;
    $('adminPanel').hidden = true;
    $('coachAccountsPanel').hidden = true;
    $('adminLoginsPanel').hidden = true;
    adminSession = { authenticated: false, user: null };
  }

  function setAdminBusy(isBusy, title = 'Working...', detail = 'Please wait.') {
    adminBusy = isBusy;
    const overlay = $('loadingOverlay');
    if (overlay) {
      overlay.hidden = !isBusy;
      $('loadingOverlayTitle').textContent = title;
      $('loadingOverlayTextLabel').textContent = detail;
    }
    document.querySelectorAll('[data-approve], [data-manual-approve], [data-reject], [data-clear], #refreshScheduleBtn, #sendDiamondStatusEmailBtn, #rescanTeamsBtn, #saveCoachPasswordsBtn, #logoutBtn, #adminExportBtn').forEach((element) => {
      if (element.id === 'adminExportBtn' || element.id === 'logoutBtn') {
        element.disabled = isBusy;
        return;
      }
      if (element.id === 'rescanTeamsBtn' || element.id === 'saveCoachPasswordsBtn') {
        element.disabled = isBusy || (element.id === 'rescanTeamsBtn' ? !canRevealPasswords() : !canEditCoachLogins());
        return;
      }
      element.disabled = isBusy || isReadOnlyAdminViewer();
    });
  }

  function isReadOnlyAdminViewer() {
    return Boolean(adminSession && adminSession.user && adminSession.user.role === 'admin_viewer');
  }

  function canRevealPasswords() {
    return Boolean(adminSession && adminSession.user && adminSession.user.canRevealPasswords);
  }

  function canEditCoachEmails() {
    return Boolean(adminSession && adminSession.user && adminSession.user.canEditCoachEmails);
  }

  function canEditCoachLogins() {
    return canRevealPasswords() || canEditCoachEmails();
  }

  function canManualApprove() {
    return Boolean(adminSession && adminSession.user && adminSession.user.canManualApprove);
  }

  function applyReadOnlyUi() {
    const readOnly = isReadOnlyAdminViewer();
    const coachPasswordsLocked = !canRevealPasswords();
    const coachEmailsLocked = !canEditCoachEmails();
    const adminMessage = $('adminMessage');
    const coachAccountsMessage = $('coachAccountsMessage');
    if (readOnly) {
      if (!adminMessage.textContent) {
        adminMessage.textContent = 'View-only access: you can review requests here, but only the full admin account can approve, reject, refresh, or save changes.';
      }
      if (!coachAccountsMessage.textContent || /^Generated from /.test(coachAccountsMessage.textContent) || /^Rescan complete/.test(coachAccountsMessage.textContent)) {
        coachAccountsMessage.textContent = currentAccounts.length
          ? `Generated from ${currentAccounts.length} ${teamLabel} team login${currentAccounts.length === 1 ? '' : 's'}. View-only access: this account cannot edit the coach passwords or emails.`
          : `No ${teamLabel} teams were found in the latest Turtle Club sync. View-only access is active for this account.`;
      }
    }
    ['refreshScheduleBtn', 'sendDiamondStatusEmailBtn'].forEach((id) => {
      const button = $(id);
      if (button) button.disabled = readOnly;
    });
    ['rescanTeamsBtn', 'saveCoachPasswordsBtn'].forEach((id) => {
      const button = $(id);
      if (button) button.disabled = id === 'rescanTeamsBtn' ? !canRevealPasswords() : !canEditCoachLogins();
    });
    document.querySelectorAll('[data-approve], [data-manual-approve], [data-reject], [data-clear]').forEach((element) => {
      const shouldStayDisabled = element.hasAttribute('data-force-disabled');
      element.disabled = readOnly || adminBusy || shouldStayDisabled;
    });
    document.querySelectorAll('[data-admin-note]').forEach((element) => {
      if ('readOnly' in element) element.readOnly = readOnly;
      if (readOnly) element.setAttribute('aria-readonly', 'true');
      else element.removeAttribute('aria-readonly');
    });
    document.querySelectorAll('[data-coach-password], [data-coach-email]').forEach((element) => {
      const locked = element.hasAttribute('data-coach-password') ? coachPasswordsLocked : coachEmailsLocked;
      if ('readOnly' in element) element.readOnly = locked;
      if (locked) element.setAttribute('aria-readonly', 'true');
      else element.removeAttribute('aria-readonly');
    });
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
