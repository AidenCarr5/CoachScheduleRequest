(function () {
  const state = {
    games: [],
    reportedGames: [],
    bracket: null,
    canSubmit: false,
    loading: false,
    reportedLoading: false,
    bracketLoading: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

  function showReportedScoreMessage(text, tone) {
    const message = $('reportedScoreMessage');
    if (!message) return;
    message.textContent = text || '';
    message.className = `form-message ${tone || ''}`.trim();
    message.hidden = !text;
  }

  function gameTitle(game) {
    const visitor = gameVisitorLabel(game);
    const home = gameHomeLabel(game);
    return `${visitor} at ${home}`;
  }

  function gameVisitorLabel(game) {
    return game.visitor || game.opponent || 'Visitor';
  }

  function gameHomeLabel(game) {
    return game.home || game.team || 'Home';
  }

  function defaultVisitorInnings(visitorScore, homeScore) {
    const visitor = Number(visitorScore);
    const home = Number(homeScore);
    if (Number.isFinite(visitor) && Number.isFinite(home) && home > visitor) return '6';
    return '7';
  }

  function scoreParts(game) {
    const result = String(game && game.result || game && game.score || '').trim();
    const match = result.match(/(\d+)\D+(\d+)/);
    if (!match) return { visitor: '', home: '' };
    return { visitor: match[1], home: match[2] };
  }

  function renderScoreTable({ containerId, games, loading, emptyText, loadingText, submitText, listName, showResult }) {
    const container = $(containerId);
    if (!container) return;
    if (loading) {
      container.innerHTML = `<div class="empty-state">${escapeHtml(loadingText)}</div>`;
      return;
    }
    if (!games.length) {
      container.innerHTML = `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
      return;
    }
    container.innerHTML = `
      <div class="tournament-score-table">
        <div class="score-table-head">
          <span>Game</span>
          <span>Matchup</span>
          <span>Score / Innings</span>
        </div>
        ${games.map((game, index) => {
          const currentScore = scoreParts(game);
          return `
          <article class="score-table-row" data-index="${index}">
            <div class="score-game-cell">
              <span class="score-pill">${escapeHtml(game.status || 'Tournament')}</span>
              <strong>${escapeHtml([game.date, game.time].filter(Boolean).join(' ') || 'Date TBD')}</strong>
              <span>${escapeHtml([game.division, game.gameNumber, game.venue].filter(Boolean).join(' - '))}</span>
              ${showResult && game.result ? `<span class="score-current-result">Current: ${escapeHtml(game.result)}</span>` : ''}
            </div>
            <div class="score-matchup-cell">
              <strong>${escapeHtml(gameVisitorLabel(game))}</strong>
              <span>at</span>
              <strong>${escapeHtml(gameHomeLabel(game))}</strong>
            </div>
            <form class="tournament-score-form compact" data-index="${index}" data-list="${escapeHtml(listName)}">
              <label>
                <span>V Score</span>
                <input name="visitorScore" type="number" min="0" step="1" inputmode="numeric" aria-label="Visitor score" value="${escapeHtml(currentScore.visitor)}" required>
              </label>
              <label>
                <span>H Score</span>
                <input name="homeScore" type="number" min="0" step="1" inputmode="numeric" aria-label="Home score" value="${escapeHtml(currentScore.home)}" required>
              </label>
              <label>
                <span>V Inn</span>
                <input name="visitorDefensiveInnings" type="text" inputmode="decimal" value="7" placeholder="7" title="Use baseball notation: 6.1 means 6 innings and 1 out; 6.2 means 6 innings and 2 outs." required>
              </label>
              <label>
                <span>H Inn</span>
                <input name="homeDefensiveInnings" type="text" inputmode="decimal" value="7" placeholder="7" title="Use baseball notation: 6.1 means 6 innings and 1 out; 6.2 means 6 innings and 2 outs." required>
              </label>
              <button class="primary" type="submit"${state.canSubmit ? '' : ' disabled'}>${escapeHtml(submitText)}</button>
            </form>
          </article>
        `;
        }).join('')}
      </div>
    `;

    container.querySelectorAll('.tournament-score-form').forEach((form) => {
      form.addEventListener('submit', submitScore);
      const visitorScore = form.elements.visitorScore;
      const homeScore = form.elements.homeScore;
      const visitorInnings = form.elements.visitorDefensiveInnings;
      function refreshSuggestedInnings() {
        if (!visitorInnings || visitorInnings.dataset.userEdited === '1') return;
        visitorInnings.value = defaultVisitorInnings(visitorScore && visitorScore.value, homeScore && homeScore.value);
      }
      if (visitorInnings) {
        visitorInnings.addEventListener('input', () => {
          visitorInnings.dataset.userEdited = '1';
        });
      }
      if (visitorScore) visitorScore.addEventListener('input', refreshSuggestedInnings);
      if (homeScore) homeScore.addEventListener('input', refreshSuggestedInnings);
    });
  }

  function renderGames() {
    renderScoreTable({
      containerId: 'scoreGames',
      games: state.games,
      loading: state.loading,
      emptyText: 'No unreported tournament games were found.',
      loadingText: 'Loading tournament games from Turtle Club...',
      submitText: 'Submit',
      listName: 'unreported',
      showResult: false
    });
  }

  function renderReportedGames() {
    renderScoreTable({
      containerId: 'reportedScoreGames',
      games: state.reportedGames,
      loading: state.reportedLoading,
      emptyText: 'No reported tournament scores were found.',
      loadingText: 'Loading reported tournament scores from Turtle Club...',
      submitText: 'Update',
      listName: 'reported',
      showResult: true
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
    container.innerHTML = divisions.map((division, index) => `
      <details class="division-bracket-card" ${index === 0 ? 'open' : ''}>
        <summary class="division-bracket-head">
          <div>
            <h3>${escapeHtml(division.name)}</h3>
          </div>
        </summary>
        <div class="division-bracket-body">
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
        </div>
      </details>
    `).join('');
  }

  function setTournamentPanel(panelName) {
    const selected = ['scores', 'reported', 'bracket'].includes(panelName) ? panelName : 'scores';
    document.querySelectorAll('[data-tournament-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.tournamentPanel !== selected;
    });
    document.querySelectorAll('.tournament-tab').forEach((tab) => {
      const active = tab.dataset.panel === selected;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
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

  async function loadGames(forceRefresh = false) {
    state.loading = true;
    showMessage('', '');
    renderGames();
    try {
      const payload = await fetchJson(`/api/tournament-scores/games${forceRefresh ? '?refresh=1' : ''}`);
      state.games = Array.isArray(payload.games) ? payload.games : [];
    } catch (error) {
      state.games = [];
      showMessage(error.message || 'Tournament games could not be loaded.', 'error');
    } finally {
      state.loading = false;
      renderGames();
    }
  }

  async function loadReportedGames(forceRefresh = false) {
    state.reportedLoading = true;
    showReportedScoreMessage('', '');
    renderReportedGames();
    try {
      const payload = await fetchJson(`/api/tournament-scores/reported${forceRefresh ? '?refresh=1' : ''}`);
      state.reportedGames = Array.isArray(payload.games) ? payload.games : [];
    } catch (error) {
      state.reportedGames = [];
      showReportedScoreMessage(error.message || 'Reported tournament scores could not be loaded.', 'error');
    } finally {
      state.reportedLoading = false;
      renderReportedGames();
    }
  }

  async function loadBracket(forceRefresh = false) {
    state.bracketLoading = true;
    showBracketMessage('', '');
    renderBracket();
    try {
      const payload = await fetchJson(`/api/tournament-scores/bracket${forceRefresh ? '?refresh=1' : ''}`);
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
    const listName = form.dataset.list === 'reported' ? 'reported' : 'unreported';
    const games = listName === 'reported' ? state.reportedGames : state.games;
    const game = games[index];
    if (!game) return;
    const button = form.querySelector('button[type="submit"]');
    const originalText = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Sending...';
    }
    const showActiveMessage = listName === 'reported' ? showReportedScoreMessage : showMessage;
    showActiveMessage('', '');
    const startedAt = Date.now();
    try {
      const formData = new FormData(form);
      await fetchJson('/api/tournament-scores/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game,
          visitorScore: formData.get('visitorScore'),
          homeScore: formData.get('homeScore'),
          awayScore: formData.get('visitorScore'),
          visitorDefensiveInnings: formData.get('visitorDefensiveInnings'),
          homeDefensiveInnings: formData.get('homeDefensiveInnings')
        })
      });
      const remaining = 900 - (Date.now() - startedAt);
      if (remaining > 0) await delay(remaining);
      showActiveMessage(
        listName === 'reported'
          ? 'Score correction queued. Turtle Club will update in the background.'
          : 'Score queued. Turtle Club will update in the background.',
        'success'
      );
      form.dataset.queued = 'true';
    } catch (error) {
      const remaining = 900 - (Date.now() - startedAt);
      if (remaining > 0) await delay(remaining);
      showActiveMessage(error.message || 'The score could not be submitted.', 'error');
    } finally {
      if (button) {
        if (form.dataset.queued === 'true') {
          button.disabled = true;
          button.textContent = 'Queued';
        } else {
          button.disabled = !state.canSubmit;
          button.textContent = originalText;
        }
      }
    }
  }

  async function init() {
    document.querySelectorAll('.tournament-tab').forEach((tab) => {
      tab.addEventListener('click', () => setTournamentPanel(tab.dataset.panel));
    });
    setTournamentPanel('scores');
    const refresh = $('refreshScoresBtn');
    if (refresh) refresh.addEventListener('click', () => loadGames(true));
    const refreshReported = $('refreshReportedScoresBtn');
    if (refreshReported) refreshReported.addEventListener('click', () => loadReportedGames(true));
    const refreshBracket = $('refreshBracketBtn');
    if (refreshBracket) refreshBracket.addEventListener('click', () => loadBracket(true));
    try {
      await loadBootstrap();
      await Promise.all([loadGames(), loadReportedGames(), loadBracket()]);
    } catch (error) {
      showMessage(error.message || 'You do not have access to tournament score updates.', 'error');
      state.loading = false;
      state.reportedLoading = false;
      renderGames();
      renderReportedGames();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
