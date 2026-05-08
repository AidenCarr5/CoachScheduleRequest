(function () {
  const $ = (id) => document.getElementById(id);
  let currentRequests = [];
  let currentAccounts = [];

  async function init() {
    $('loginForm').addEventListener('submit', login);
    $('logoutBtn').addEventListener('click', logout);
    $('adminExportBtn').addEventListener('click', exportRequests);
    $('refreshScheduleBtn').addEventListener('click', refreshSchedule);
    $('sendDiamondStatusEmailBtn').addEventListener('click', sendDiamondStatusEmail);
    $('rescanTeamsBtn').addEventListener('click', rescanTeams);
    $('saveCoachPasswordsBtn').addEventListener('click', saveCoachPasswords);
    await refreshSession();
  }

  async function refreshSession() {
    const response = await fetch('/api/admin/session', { cache: 'no-store' });
    if (response.ok) {
      const payload = await response.json();
      if (!payload.authenticated) {
        showLogin();
        return;
      }
      showAdmin();
      await loadDashboard();
      return;
    }
    showLogin();
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
    showAdmin();
    await loadDashboard();
  }

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    showLogin();
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
      ? `Generated from ${currentAccounts.length} Titans team login${currentAccounts.length === 1 ? '' : 's'}.`
      : 'No Titans teams were found in the latest Turtle Club sync.';
    $('coachAccountsList').innerHTML = currentAccounts.length
      ? currentAccounts.map(renderCoachAccount).join('')
      : '<p class="muted">No coach logins are available yet.</p>';
  }

  async function loadDashboard() {
    await Promise.all([loadRequests(), loadCoachAccounts()]);
  }

  function renderRequest(request) {
    const disabled = request.status !== 'pending' ? ' disabled' : '';
    const showClear = request.status === 'approved' || request.status === 'rejected';
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
        <textarea id="admin-note-${escapeHtml(request.id)}" class="admin-note-input" data-admin-note="${escapeHtml(request.id)}" rows="3" placeholder="Why was this approved or rejected?">${escapeHtml(request.adminNote || '')}</textarea>
        <div class="admin-request-actions">
          <button class="primary" type="button" data-approve="${request.id}"${disabled}>Approve</button>
          <button class="cancel-btn" type="button" data-reject="${request.id}"${disabled}>Reject</button>
          ${showClear ? `<button class="secondary" type="button" data-clear="${request.id}">Clear</button>` : ''}
        </div>
      </article>
    `;
  }

  function renderCoachAccount(account) {
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
            >
          </div>
        </div>
      </article>
    `;
  }

  async function reviewRequest(requestId, action) {
    const noteField = document.getElementById(`admin-note-${requestId}`);
    const adminNote = noteField ? noteField.value.trim() : '';
    $('adminMessage').textContent = action === 'approve'
      ? 'Applying approved change to Turtle Club...'
      : 'Saving request review...';
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
    await loadRequests();
    $('adminMessage').textContent = action === 'approve'
      ? 'Approved request was applied to Turtle Club and synced back into the scheduler.'
      : 'Request rejected.';
  }

  async function clearRequest(requestId) {
    const response = await fetch(`/api/admin/requests/${requestId}`, {
      method: 'DELETE'
    });
    if (!response.ok) return;
    await loadDashboard();
  }

  async function refreshSchedule() {
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
    $('coachAccountsMessage').textContent = 'Rescanning Titans teams from Turtle Club...';
    const response = await fetch('/api/admin/rescan-teams', {
      method: 'POST'
    });
    if (!response.ok) {
      let message = 'The Titans team rescan did not complete.';
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
      : 'Rescan complete, but no Titans teams were found.';
    $('coachAccountsList').innerHTML = currentAccounts.length
      ? currentAccounts.map(renderCoachAccount).join('')
      : '<p class="muted">No coach logins are available yet.</p>';
  }

  async function saveCoachPasswords() {
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
  }

  function showLogin() {
    $('loginPanel').hidden = false;
    $('adminPanel').hidden = true;
    $('coachAccountsPanel').hidden = true;
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
