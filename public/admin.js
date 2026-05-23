(function () {
  const $ = (id) => document.getElementById(id);
  let currentRequests = [];
  let currentAccounts = [];
  let currentAdminLogins = [];
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
    const password = $('adminPassword').value;
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!response.ok) {
      $('loginMessage').textContent = 'Password did not match.';
      return;
    }
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
        : `Generated from ${currentAccounts.length} ${teamLabel} team login${currentAccounts.length === 1 ? '' : 's'}. Passwords are masked for view-only access.`)
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
        : 'These accounts can reach the protected admin tools shown in this portal. Passwords are masked for view-only access.')
      : 'No admin logins are available right now.';
    $('adminLoginsList').innerHTML = currentAdminLogins.length
      ? currentAdminLogins.map(renderAdminLogin).join('')
      : '<p class="muted">No admin logins are available right now.</p>';
  }

  async function loadDashboard() {
    await Promise.all([loadRequests(), loadCoachAccounts(), loadAdminLogins()]);
  }

  function renderRequest(request) {
    const forceDisabled = request.status !== 'pending' ? ' disabled data-force-disabled="true"' : '';
    const showClear = request.status === 'approved' || request.status === 'rejected';
    const readOnly = isReadOnlyAdminViewer();
    const noteAttributes = readOnly ? ' readonly aria-readonly="true"' : '';
    const actionDisabled = readOnly ? ' disabled' : '';
    return `
      <article class="admin-request-card ${escapeHtml(request.status || 'pending')}">
        <div class="admin-request-head">
          <strong>${escapeHtml(request.action)} - ${escapeHtml(request.team)}</strong>
          <span>${escapeHtml(request.status || 'pending')}</span>
        </div>
        <p>${escapeHtml(request.date)} ${escapeHtml(request.start || '')} ${escapeHtml(request.opponent || '')}</p>
        <p>${escapeHtml(request.diamond || '')}</p>
        <p>${escapeHtml(request.reason || '')}</p>
        <p>${escapeHtml(request.availabilityStatus || '')}</p>
        <label class="admin-note-label" for="admin-note-${escapeHtml(request.id)}">Admin note</label>
        <textarea id="admin-note-${escapeHtml(request.id)}" class="admin-note-input" data-admin-note="${escapeHtml(request.id)}" rows="3" placeholder="Why was this approved or rejected?"${noteAttributes}>${escapeHtml(request.adminNote || '')}</textarea>
        <div class="admin-request-actions">
          <button class="primary" type="button" data-approve="${request.id}"${forceDisabled}${actionDisabled}>Approve</button>
          <button class="cancel-btn" type="button" data-reject="${request.id}"${forceDisabled}${actionDisabled}>Reject</button>
          ${showClear ? `<button class="secondary" type="button" data-clear="${request.id}"${actionDisabled}>Clear</button>` : ''}
        </div>
      </article>
    `;
  }

  function renderCoachAccount(account) {
    const readOnly = isReadOnlyAdminViewer();
    const inputAttributes = readOnly ? ' readonly aria-readonly="true"' : '';
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
              ${inputAttributes}
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
              ${inputAttributes}
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
    const noteField = document.getElementById(`admin-note-${requestId}`);
    const adminNote = noteField ? noteField.value.trim() : '';
    $('adminMessage').textContent = action === 'approve'
      ? 'Applying approved change to Turtle Club...'
      : 'Saving request review...';
    setAdminBusy(true, action === 'approve' ? 'Applying approval...' : 'Saving rejection...', action === 'approve'
      ? 'Please wait while Turtle Club is updated and the scheduler syncs back.'
      : 'Please wait while the request review is saved.');
    try {
      const response = await fetch(`/api/admin/requests/${requestId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminNote })
      });
      if (!response.ok) {
        let message = action === 'approve'
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
      if (action === 'approve') {
        const approvedTarget = payload.appliedToTurtleClub === false ? 'recorded in the scheduler' : 'applied to Turtle Club and synced back into the scheduler';
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
    if (isReadOnlyAdminViewer()) return;
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
    if (accounts.some((account) => !account.password)) {
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
    document.querySelectorAll('[data-approve], [data-reject], [data-clear], #refreshScheduleBtn, #sendDiamondStatusEmailBtn, #rescanTeamsBtn, #saveCoachPasswordsBtn, #logoutBtn, #adminExportBtn').forEach((element) => {
      if (element.id === 'adminExportBtn' || element.id === 'logoutBtn') {
        element.disabled = isBusy;
        return;
      }
      element.disabled = isBusy || isReadOnlyAdminViewer();
    });
  }

  function isReadOnlyAdminViewer() {
    return Boolean(adminSession && adminSession.user && adminSession.user.role === 'admin_viewer');
  }

  function applyReadOnlyUi() {
    const readOnly = isReadOnlyAdminViewer();
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
    ['refreshScheduleBtn', 'sendDiamondStatusEmailBtn', 'rescanTeamsBtn', 'saveCoachPasswordsBtn'].forEach((id) => {
      const button = $(id);
      if (button) button.disabled = readOnly;
    });
    document.querySelectorAll('[data-approve], [data-reject], [data-clear]').forEach((element) => {
      const shouldStayDisabled = element.hasAttribute('data-force-disabled');
      element.disabled = readOnly || adminBusy || shouldStayDisabled;
    });
    document.querySelectorAll('[data-admin-note], [data-coach-password], [data-coach-email]').forEach((element) => {
      if ('readOnly' in element) element.readOnly = readOnly;
      if (readOnly) element.setAttribute('aria-readonly', 'true');
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
