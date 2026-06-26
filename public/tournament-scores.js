(function () {
  const state = {
    games: [],
    bracket: null,
    canSubmit: false,
    loading: false,
    bracketLoading: false
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

  function showBracketMessage(text, tone) {
    const message = $('bracketMessage');
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

  function renderStandingsTable(pool) {
    const teams = Array.isArray(pool.teams) ? pool.teams : [];
    if (!teams.length) {
      return '<div class="empty-state compact">No teams found for this pool.</div>';
    }
    return `
      <div class="standings-table-wrap">
        <table class="standings-table">
          <thead>
            <tr>
              <th>Team</th>
              <th>W</th>
              <th>L</th>
              <th>T</th>
              <th>Pts</th>
              <th>RF</th>
              <th>RA</th>
              <th>Def Inn</th>
              <th>RA/DI</th>
            </tr>
          </thead>
          <tbody>
            ${teams.map((team) => `
              <tr>
                <td>${escapeHtml(team.team)}</td>
                <td>${escapeHtml(team.wins)}</td>
                <td>${escapeHtml(team.losses)}</td>
                <td>${escapeHtml(team.ties)}</td>
                <td>${escapeHtml(team.points)}</td>
                <td>${escapeHtml(team.runsFor)}</td>
                <td>${escapeHtml(team.runsAgainst)}</td>
                <td>${escapeHtml(team.defensiveInnings)}</td>
                <td>${escapeHtml(team.runsAgainstRatio)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderBracketGames(games) {
    if (!Array.isArray(games) || !games.length) {
      return '<div class="empty-state compact">No bracket games found yet.</div>';
    }
    return `
      <div class="bracket-game-grid">
        ${games.map((game) => `
          <article class="bracket-game-card">
            <div class="bracket-game-meta">
              <strong>${escapeHtml(game.gameNumber || 'Bracket')}</strong>
              <span>${escapeHtml(game.date || '')}</span>
              <span>${escapeHtml(game.time || '')}</span>
              <span>${escapeHtml(game.venue || '')}</span>
            </div>
            <div class="bracket-matchup">
              <span>${escapeHtml(game.visitor || 'TBD')}</span>
              <span>at</span>
              <span>${escapeHtml(game.home || 'TBD')}</span>
            </div>
            ${(game.projectedVisitor || game.projectedHome) ? `
              <div class="bracket-projection">
                <span>Projected</span>
                <strong>${escapeHtml(game.projectedVisitor || game.visitor || 'TBD')} at ${escapeHtml(game.projectedHome || game.home || 'TBD')}</strong>
              </div>
            ` : ''}
            ${game.score ? `<div class="bracket-score">${escapeHtml(game.score)}</div>` : ''}
          </article>
        `).join('')}
      </div>
    `;
  }

  function renderBracket() {
    const container = $('tournamentBracket');
    if (!container) return;
    if (state.bracketLoading) {
      container.innerHTML = '<div class="empty-state">Loading tournament brackets from Turtle Club...</div>';
      return;
    }
    const divisions = state.bracket && Array.isArray(state.bracket.divisions) ? state.bracket.divisions : [];
    if (!divisions.length) {
      container.innerHTML = '<div class="empty-state">No tournament bracket data was found.</div>';
      return;
    }
    container.innerHTML = divisions.map((division) => `
      <article class="division-bracket-card">
        <div class="division-bracket-head">
          <h3>${escapeHtml(division.name)}</h3>
          <span>${escapeHtml((division.games || []).length)} games</span>
        </div>
        <div class="pool-grid">
          ${(division.pools || []).map((pool) => `
            <section class="pool-card">
              <h4>${escapeHtml(pool.name)}</h4>
              ${renderStandingsTable(pool)}
            </section>
          `).join('')}
        </div>
        <section class="bracket-games-section">
          <h4>Bracket Games</h4>
          ${renderBracketGames(division.bracketGames)}
        </section>
      </article>
    `).join('');
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

  async function loadBracket() {
    state.bracketLoading = true;
    showBracketMessage('', '');
    renderBracket();
    try {
      const payload = await fetchJson('/api/tournament-scores/bracket');
      state.bracket = payload.bracket || null;
    } catch (error) {
      state.bracket = null;
      showBracketMessage(error.message || 'Tournament bracket could not be loaded.', 'error');
    } finally {
      state.bracketLoading = false;
      renderBracket();
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
    const refreshBracket = $('refreshBracketBtn');
    if (refreshBracket) refreshBracket.addEventListener('click', loadBracket);
    try {
      await loadBootstrap();
      await Promise.all([loadGames(), loadBracket()]);
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
