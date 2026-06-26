(function () {
  const state = {
    games: [],
    canSubmit: false,
    loading: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showMessage(text, tone) {
    const message = $('scoreMessage');
    if (!message) return;
    message.textContent = text || '';
    message.className = `form-message ${tone || ''}`.trim();
    message.hidden = !text;
  }

  function setStatus(text) {
    const status = $('scoreStatus');
    if (status) status.textContent = text || '';
  }

  function gameTitle(game) {
    const visitor = game.visitor || game.opponent || 'Visitor';
    const home = game.home || game.team || 'Home';
    return `${visitor} at ${home}`;
  }

  function renderGames() {
    const container = $('scoreGames');
    if (!container) return;
    if (state.loading) {
      container.innerHTML = '<div class="empty-state">Loading tournament games from Turtle Club...</div>';
      return;
    }
    if (!state.games.length) {
      container.innerHTML = '<div class="empty-state">No unreported tournament games were found.</div>';
      return;
    }
    container.innerHTML = state.games.map((game, index) => `
      <article class="tournament-score-card" data-index="${index}">
        <div class="tournament-score-meta">
          <span class="score-pill">${escapeHtml(game.status || 'Tournament')}</span>
          <strong>${escapeHtml(game.date || 'Date TBD')}</strong>
          <span>${escapeHtml(game.time || '')}</span>
          ${game.venue ? `<span>${escapeHtml(game.venue)}</span>` : ''}
        </div>
        <div class="tournament-score-main">
          <div>
            <h3>${escapeHtml(gameTitle(game))}</h3>
            <p>${escapeHtml(game.summary || '')}</p>
          </div>
          <form class="tournament-score-form" data-index="${index}">
            <label>
              <span>Visitor score</span>
              <input name="visitorScore" type="number" min="0" step="1" inputmode="numeric" required>
            </label>
            <label>
              <span>Home score</span>
              <input name="homeScore" type="number" min="0" step="1" inputmode="numeric" required>
            </label>
            <button class="primary" type="submit"${state.canSubmit ? '' : ' disabled'}>Submit score</button>
          </form>
        </div>
      </article>
    `).join('');

    container.querySelectorAll('.tournament-score-form').forEach((form) => {
      form.addEventListener('submit', submitScore);
    });
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, {
      cache: 'no-store',
      ...(options || {})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.details || payload.error || `Request failed (${response.status})`);
    }
    return payload;
  }

  async function loadBootstrap() {
    const payload = await fetchJson('/api/tournament-scores/bootstrap');
    state.canSubmit = Boolean(payload.canSubmit);
  }

  async function loadGames() {
    state.loading = true;
    showMessage('', '');
    setStatus('Loading tournament games');
    renderGames();
    try {
      const payload = await fetchJson('/api/tournament-scores/games');
      state.games = Array.isArray(payload.games) ? payload.games : [];
      setStatus(`${state.games.length} game${state.games.length === 1 ? '' : 's'} found`);
    } catch (error) {
      state.games = [];
      setStatus('Tournament games unavailable');
      showMessage(error.message || 'Tournament games could not be loaded.', 'error');
    } finally {
      state.loading = false;
      renderGames();
    }
  }

  async function submitScore(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const index = Number(form.dataset.index);
    const game = state.games[index];
    if (!game) return;
    const button = form.querySelector('button[type="submit"]');
    const originalText = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Submitting...';
    }
    showMessage('', '');
    try {
      const formData = new FormData(form);
      await fetchJson('/api/tournament-scores/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game,
          visitorScore: formData.get('visitorScore'),
          homeScore: formData.get('homeScore'),
          awayScore: formData.get('visitorScore')
        })
      });
      showMessage('Score submitted to Turtle Club.', 'success');
      await loadGames();
    } catch (error) {
      showMessage(error.message || 'The score could not be submitted.', 'error');
    } finally {
      if (button) {
        button.disabled = !state.canSubmit;
        button.textContent = originalText;
      }
    }
  }

  async function init() {
    const refresh = $('refreshScoresBtn');
    if (refresh) refresh.addEventListener('click', loadGames);
    try {
      await loadBootstrap();
      await loadGames();
    } catch (error) {
      setStatus('Access unavailable');
      showMessage(error.message || 'You do not have access to tournament score updates.', 'error');
      state.loading = false;
      renderGames();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
