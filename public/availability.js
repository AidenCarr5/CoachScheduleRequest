(function () {
  const $ = (id) => document.getElementById(id);
  const state = {
    blocks: [],
    diamonds: [],
    month: 'All months',
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
    state.blocks = payload.blocks || [];
    state.diamonds = payload.diamonds || [];
    $('availabilityLoaded').textContent = `Loaded ${state.blocks.length} two-hour blocks`;
    buildFilters();
    $('availabilityMonthSelect').addEventListener('change', () => {
      state.month = $('availabilityMonthSelect').value;
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
    const months = ['All months', ...new Set(state.blocks.map((block) => block.month))];
    $('availabilityMonthSelect').innerHTML = months.map((month) => `<option>${escapeHtml(month)}</option>`).join('');
    $('availabilityDiamondSelect').innerHTML = ['All diamonds', ...state.diamonds]
      .map((diamond) => `<option>${escapeHtml(diamond)}</option>`)
      .join('');
  }

  function filteredBlocks() {
    return state.blocks.filter((block) => {
      const matchesMonth = state.month === 'All months' || block.month === state.month;
      const matchesDiamond = state.diamond === 'All diamonds' || block.diamond === state.diamond;
      const haystack = `${block.day} ${block.diamond} ${block.start} ${block.end}`.toLowerCase();
      return matchesMonth && matchesDiamond && haystack.includes(state.query);
    });
  }

  function render() {
    const blocks = filteredBlocks();
    const days = [...new Set(blocks.map((block) => block.date))];
    const diamonds = [...new Set(blocks.map((block) => block.diamond))];
    $('availabilityBlockCount').textContent = blocks.length;
    $('availabilityDayCount').textContent = days.length;
    $('availabilityDiamondCount').textContent = diamonds.length;
    $('availabilityList').innerHTML = blocks.length
      ? renderDayGroups(blocks)
      : '<p class="muted">No two-hour diamond blocks match this view.</p>';
  }

  function renderDayGroups(blocks) {
    const groups = new Map();
    blocks.forEach((block) => {
      if (!groups.has(block.date)) groups.set(block.date, []);
      groups.get(block.date).push(block);
    });
    return [...groups.entries()].map(([, dayBlocks]) => {
      const dayLabel = dayBlocks[0].day;
      const diamonds = groupByDiamond(dayBlocks);
      return `
        <section class="availability-day">
          <div class="month-head">
            <h3>${escapeHtml(dayLabel)}</h3>
            <span>${dayBlocks.length} ${dayBlocks.length === 1 ? 'block' : 'blocks'}</span>
          </div>
          <div class="availability-diamond-grid">
            ${[...diamonds.entries()].map(renderDiamondCard).join('')}
          </div>
        </section>
      `;
    }).join('');
  }

  function groupByDiamond(blocks) {
    const groups = new Map();
    blocks.forEach((block) => {
      if (!groups.has(block.diamond)) groups.set(block.diamond, []);
      groups.get(block.diamond).push(block);
    });
    return groups;
  }

  function renderDiamondCard([diamond, blocks]) {
    return `
      <article class="availability-card">
        <h4>${escapeHtml(diamond)}</h4>
        <div class="availability-times">
          ${blocks.map((block) => `<span>${escapeHtml(block.start)}-${escapeHtml(block.end)}</span>`).join('')}
        </div>
      </article>
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
