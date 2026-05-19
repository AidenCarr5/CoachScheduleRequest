(function () {
  const $ = (id) => document.getElementById(id);
  let currentRows = [];
  let busyTargetId = '';
  let currentUser = null;

  async function init() {
    await loadEditor();
  }

  async function loadEditor() {
    const response = await fetch('/api/status-editor/bootstrap', { cache: 'no-store' });
    if (response.status === 401 || response.status === 403) {
      window.location.href = '/';
      return;
    }
    if (!response.ok) {
      $('statusEditorList').innerHTML = '<p class="muted">The Turtle Club status editor could not be loaded.</p>';
      $('statusEditorMessage').textContent = 'Status editor access is unavailable right now.';
      return;
    }

    const payload = await response.json();
    currentUser = payload.user || null;
    currentRows = payload.rows || [];
    renderSummary(payload.fetchedAt);
    renderRows();
  }

  function renderSummary(fetchedAt) {
    $('statusOpenCount').textContent = currentRows.filter((row) => /^open/i.test(row.status || '')).length;
    $('statusClosedCount').textContent = currentRows.filter((row) => /^closed/i.test(row.status || '')).length;
    $('statusUpdatedAt').textContent = formatDateTime(fetchedAt);
    $('diamondStatusMeta').textContent = isReadOnlyViewer()
      ? 'View-only access. This page shows the live Turtle Club status rows but cannot submit updates from this account.'
      : 'This page writes directly to Turtle Club status and then checks the public status page again.';
    $('statusEditorMessage').textContent = isReadOnlyViewer()
      ? 'View-only access: you can review the live field status rows here, but only the full admin or field-status editor accounts can change them.'
      : '';
  }

  function renderRows() {
    const list = $('statusEditorList');
    if (!currentRows.length) {
      list.innerHTML = '<p class="muted">No editable field statuses were found.</p>';
      return;
    }
    list.innerHTML = currentRows.map(renderRow).join('');
    if (isReadOnlyViewer()) return;
    list.querySelectorAll('[data-status-action]').forEach((button) => {
      button.addEventListener('click', () => applyStatus(button.dataset.targetId, button.dataset.statusAction));
    });
  }

  function renderRow(row) {
    const readOnly = isReadOnlyViewer();
    const normalizedStatus = /^open/i.test(row.status || '')
      ? 'open'
      : /^closed/i.test(row.status || '')
        ? 'closed'
        : 'unknown';
    const detailBits = [row.updatedAt, row.updatedBy].filter(Boolean).join(' | ');
    const noteAttributes = readOnly ? ' readonly aria-readonly="true"' : '';
    const buttonDisabled = readOnly ? ' disabled' : '';
    return `
      <article class="status-editor-card ${escapeHtml(normalizedStatus)}">
        <div class="status-editor-head">
          <div>
            <strong>${escapeHtml(row.label)}</strong>
            <p>${escapeHtml(row.group)}</p>
          </div>
          <span class="status-editor-pill ${escapeHtml(normalizedStatus)}">${escapeHtml(row.status || 'Unavailable')}</span>
        </div>
        <p class="status-editor-meta">${escapeHtml(detailBits || 'No update time or initials are posted yet.')}</p>
        <label class="status-editor-label" for="status-note-${escapeHtml(row.targetId)}">Notes</label>
        <textarea id="status-note-${escapeHtml(row.targetId)}" class="status-editor-notes" rows="3" placeholder="Optional notes for coaches and families"${noteAttributes}>${escapeHtml(row.comments || '')}</textarea>
        <div class="status-editor-actions">
          <button class="primary" type="button" data-target-id="${escapeHtml(row.targetId)}" data-status-action="Open"${buttonDisabled}>Open</button>
          <button class="cancel-btn" type="button" data-target-id="${escapeHtml(row.targetId)}" data-status-action="Closed"${buttonDisabled}>Closed</button>
        </div>
      </article>
    `;
  }

  async function applyStatus(targetId, status) {
    if (busyTargetId || isReadOnlyViewer()) return;
    const noteField = $(`status-note-${targetId}`);
    const notes = noteField ? noteField.value.trim() : '';
    $('statusEditorMessage').textContent = `Updating ${status} status on Turtle Club...`;
    setBusy(targetId, true);
    try {
      const response = await fetch('/api/status-editor/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId, status, notes })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        $('statusEditorMessage').textContent = payload.details || payload.error || 'The Turtle Club status update did not complete.';
        return;
      }

      currentRows = payload.rows || currentRows.map((row) => (row.targetId === targetId ? (payload.row || row) : row));
      renderSummary(payload.fetchedAt);
      renderRows();
      $('statusEditorMessage').textContent = payload.message || 'Turtle Club status updated.';
    } finally {
      setBusy('', false);
    }
  }

  function setBusy(targetId, isBusy) {
    busyTargetId = isBusy ? targetId : '';
    $('loadingOverlay').hidden = !isBusy;
    document.querySelectorAll('[data-status-action], #logoutBtn').forEach((element) => {
      element.disabled = isBusy;
    });
  }

  function isReadOnlyViewer() {
    return Boolean(currentUser && currentUser.readOnly);
  }

  function formatDateTime(value) {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
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

  init();
})();
