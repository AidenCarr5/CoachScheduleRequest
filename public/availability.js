(function () {
  const $ = (id) => document.getElementById(id);
  const state = {
    days: [],
    diamonds: [],
    selectedDate: '',
    diamond: 'All diamonds',
    query: ''
  };

  async function init() {
    const response = await fetch('/api/availability', { cache: 'no-store' });
    if (!response.ok) {
      $('availabilityList').innerHTML = '<p class="muted">Availability could not be loaded.</p>';
      return;
    }
    const payload = await response.json();
    state.days = payload.days || [];
    state.diamonds = payload.diamonds || [];
    state.selectedDate = state.days[0] ? state.days[0].date : '';
    $('availabilityLoaded').textContent = `Loaded ${state.days.length} days from Turtle Club`;
    buildFilters();
    $('availabilityDaySelect').addEventListener('change', () => {
      state.selectedDate = $('availabilityDaySelect').value;
      render();
    });
    $('availabilityDiamondSelect').addEventListener('change', () => {
      state.diamond = $('availabilityDiamondSelect').value;
      render();
    });
    $('availabilitySearchInput').addEventListener('input', (event) => {
      state.query = event.target.value.toLowerCase();
      render();
    });
    render();
  }

  function buildFilters() {
    $('availabilityDaySelect').innerHTML = state.days
      .map((day) => `<option value="${escapeHtml(day.date)}">${escapeHtml(day.day)}</option>`)
      .join('');
    $('availabilityDiamondSelect').innerHTML = ['All diamonds', ...state.diamonds]
      .map((diamond) => `<option>${escapeHtml(diamond)}</option>`)
      .join('');
  }

  function selectedDay() {
    return state.days.find((day) => day.date === state.selectedDate) || state.days[0] || null;
  }

  function visibleDiamonds(day) {
    if (!day) return [];
    return day.diamonds.filter((row) => {
      const matchesDiamond = state.diamond === 'All diamonds' || row.diamond === state.diamond;
      const matchesQuery = row.diamond.toLowerCase().includes(state.query);
      return matchesDiamond && matchesQuery;
    });
  }

  function render() {
    const day = selectedDay();
    const rows = visibleDiamonds(day);
    if (!day) {
      $('availabilityList').innerHTML = '<p class="muted">No availability days were found.</p>';
      return;
    }
    const availableCount = rows.reduce((count, row) => count + row.slots.filter((slot) => slot.status === 'available').length, 0);
    const bookedCount = rows.reduce((count, row) => count + row.slots.filter((slot) => slot.status !== 'available').length, 0);
    $('availabilityBlockCount').textContent = availableCount;
    $('bookedBlockCount').textContent = bookedCount;
    $('availabilityDiamondCount').textContent = rows.length;
    $('selectedDayTitle').textContent = day.day;
    $('availabilityList').innerHTML = rows.length
      ? renderGrid(day, rows)
      : '<p class="muted">No diamonds match this view.</p>';
  }

  function renderGrid(day, rows) {
    return `
      <div class="availability-grid-wrap">
        <div class="availability-grid" style="--slot-count: ${day.slots.length}">
          <div class="availability-grid-head diamond-title">Diamond</div>
          ${day.slots.map((slot) => `<div class="availability-grid-head">${escapeHtml(slot.start)}-${escapeHtml(slot.end)}</div>`).join('')}
          ${rows.map(renderDiamondRow).join('')}
        </div>
      </div>
    `;
  }

  function renderDiamondRow(row) {
    return `
      <div class="availability-diamond-name">${escapeHtml(row.diamond)}</div>
      ${row.slots.map((slot) => `
        <div class="availability-slot ${escapeHtml(slot.status)}" title="${escapeHtml(slot.conflict || slot.label)}">
          <strong>${escapeHtml(slot.label)}</strong>
          <span>${slot.conflict ? escapeHtml(slot.conflict) : ''}</span>
        </div>
      `).join('')}
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

  init();
})();
