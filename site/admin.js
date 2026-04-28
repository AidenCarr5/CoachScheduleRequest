(function () {
  const $ = (id) => document.getElementById(id);
  let currentRequests = [];

  async function init() {
    $('loginForm').addEventListener('submit', login);
    $('logoutBtn').addEventListener('click', logout);
    $('adminExportBtn').addEventListener('click', exportRequests);
    $('resetScheduleBtn').addEventListener('click', resetSchedule);
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
      await loadRequests();
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
    await loadRequests();
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
        <div class="admin-request-actions">
          <button class="primary" type="button" data-approve="${request.id}"${disabled}>Approve</button>
          <button class="cancel-btn" type="button" data-reject="${request.id}"${disabled}>Reject</button>
          ${showClear ? `<button class="secondary" type="button" data-clear="${request.id}">Clear</button>` : ''}
        </div>
      </article>
    `;
  }

  async function reviewRequest(requestId, action) {
    const response = await fetch(`/api/admin/requests/${requestId}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminNote: '' })
    });
    if (!response.ok) return;
    await loadRequests();
  }

  async function clearRequest(requestId) {
    const response = await fetch(`/api/admin/requests/${requestId}`, {
      method: 'DELETE'
    });
    if (!response.ok) return;
    await loadRequests();
  }

  async function resetSchedule() {
    $('adminMessage').textContent = 'Refreshing schedule from Turtle Club...';
    const response = await fetch('/api/admin/reset-schedule', {
      method: 'POST'
    });
    if (!response.ok) {
      $('adminMessage').textContent = 'The schedule reset did not complete.';
      return;
    }
    await loadRequests();
    $('adminMessage').textContent = 'Schedule reset to the current Turtle Club version. Coach requests were cleared.';
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
  }

  function showLogin() {
    $('loginPanel').hidden = false;
    $('adminPanel').hidden = true;
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

  init();
})();
