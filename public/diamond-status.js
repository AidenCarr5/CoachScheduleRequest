(function () {
  const $ = (id) => document.getElementById(id);

  async function init() {
    const response = await fetch('/api/diamond-status', { cache: 'no-store' });
    if (!response.ok) {
      $('diamondStatusList').innerHTML = '<p class="muted">Diamond status could not be loaded.</p>';
      $('diamondStatusMeta').textContent = 'The live Turtle Club status page is unavailable right now.';
      return;
    }

    const payload = await response.json();
    const rows = payload.rows || [];
    const openCount = rows.filter((row) => /^open/i.test(row.status || '')).length;
    const closedCount = rows.filter((row) => /^closed/i.test(row.status || '')).length;

    $('statusOpenCount').textContent = openCount;
    $('statusClosedCount').textContent = closedCount;
    $('statusUpdatedAt').textContent = formatDateTime(payload.fetchedAt);
    $('diamondStatusMeta').textContent = 'Live from Turtle Club status.';

    const groups = [...new Set(rows.map((row) => row.group))];
    $('diamondStatusList').innerHTML = groups.map((group) => renderGroup(group, rows.filter((row) => row.group === group))).join('');
  }

  function renderGroup(group, rows) {
    return `
      <section class="diamond-status-group">
        <div class="subsection-head">
          <h3>${escapeHtml(group)}</h3>
        </div>
        <div class="diamond-status-grid">
          ${rows.map(renderRow).join('')}
        </div>
      </section>
    `;
  }

  function renderRow(row) {
    const statusClass = /^open/i.test(row.status || '')
      ? 'open'
      : /^closed/i.test(row.status || '')
        ? 'closed'
        : 'unknown';
    const details = [row.updatedAt, row.updatedBy, row.comments].filter(Boolean).join(' | ');
    return `
      <article class="diamond-status-card ${statusClass}">
        <div class="diamond-status-head">
          <strong>${escapeHtml(row.diamond)}</strong>
          <span>${escapeHtml(row.status || 'Unavailable')}</span>
        </div>
        <p>${details ? escapeHtml(details) : 'No extra update details posted.'}</p>
      </article>
    `;
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
