(function () {
  let logoutBound = false;
  let schedulingSwitchBound = false;
  const navCacheKey = 'titans-topbar-state';

  function readCachedState() {
    try {
      const raw = window.sessionStorage.getItem(navCacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function writeCachedState(session, publicConfig) {
    try {
      window.sessionStorage.setItem(navCacheKey, JSON.stringify({ session, publicConfig }));
    } catch (_) {
      // Ignore storage write failures.
    }
  }

  function clearCachedState() {
    try {
      window.sessionStorage.removeItem(navCacheKey);
    } catch (_) {
      // Ignore storage clear failures.
    }
  }

  function formatSessionLabel(session) {
    if (!session || !session.authenticated || !session.user) return '';
    const user = session.user || {};
    const initials = String(user.initials || '').trim();
    const username = String(user.username || '').trim();
    if (user.role === 'admin') {
      return initials ? `${initials} - admin` : 'admin';
    }
    if (user.role === 'admin_viewer') {
      return initials ? `${initials} - ${username || 'DonHunt'} (view only)` : `${username || 'DonHunt'} (view only)`;
    }
    if (user.role === 'status_editor') {
      return initials ? `${initials} - ${username || 'ecarr'}` : (username || 'ecarr');
    }
    if (user.role === 'umpire') {
      return initials ? `${initials} - umpire` : `${username || 'umpire'}`;
    }
    return initials && username ? `${initials} - ${username}` : (username || '');
  }

  async function logout() {
    try {
      await fetch('/api/coach/logout', { method: 'POST' });
    } catch (_) {
      // Redirect anyway so the user lands back on the public home state.
    }
    clearCachedState();
    window.location.href = '/';
  }

  function bindLogoutButton() {
    if (logoutBound) return;
    const logoutButton = document.getElementById('logoutBtn');
    if (!logoutButton) return;
    logoutBound = true;
    logoutButton.addEventListener('click', logout);
  }

  function bindSchedulingSwitchLink(link) {
    if (schedulingSwitchBound || !link) return;
    schedulingSwitchBound = true;
    link.addEventListener('click', async (event) => {
      if (link.dataset.clearUmpireSession !== 'true') return;
      event.preventDefault();
      try {
        await fetch('/api/coach/logout', { method: 'POST' });
      } catch (_) {
        // Navigate back to scheduling even if the logout request is interrupted.
      }
      clearCachedState();
      window.location.href = '/';
    });
  }

  function ensureProfileLink() {
    const topbarInner = document.querySelector('.topbar-inner');
    if (!topbarInner) return null;
    let profileLink = document.getElementById('profileLink');
    if (profileLink) return profileLink;

    profileLink = document.createElement('a');
    profileLink.id = 'profileLink';
    profileLink.className = 'topbar-link';
    profileLink.dataset.navKey = 'profile';
    profileLink.href = '/profile.html';
    profileLink.hidden = true;
    profileLink.textContent = 'Profile';

    const adminLink = document.getElementById('adminLink');
    if (adminLink && adminLink.parentElement === topbarInner) {
      topbarInner.insertBefore(profileLink, adminLink);
      return profileLink;
    }

    topbarInner.appendChild(profileLink);
    return profileLink;
  }

  function ensureAdminSiteSwitchLink() {
    const topbarInner = document.querySelector('.topbar-inner');
    if (!topbarInner) return null;
    let switchLink = document.getElementById('topbarSiteSwitchLink');
    if (switchLink) return switchLink;

    switchLink = document.createElement('a');
    switchLink.id = 'topbarSiteSwitchLink';
    switchLink.className = 'topbar-link';
    switchLink.dataset.navKey = 'site-switch';
    switchLink.dataset.brandStatic = 'true';
    switchLink.href = '#';
    switchLink.hidden = true;
    switchLink.textContent = 'Switch Admin Site';

    const fieldStatusLink = document.getElementById('fieldStatusLink');
    if (fieldStatusLink && fieldStatusLink.parentElement === topbarInner) {
      topbarInner.insertBefore(switchLink, fieldStatusLink.nextSibling);
      return switchLink;
    }

    topbarInner.appendChild(switchLink);
    return switchLink;
  }

  function ensureTournamentScoresLink() {
    const topbarInner = document.querySelector('.topbar-inner');
    if (!topbarInner) return null;
    let tournamentLink = document.getElementById('tournamentScoresLink');
    if (tournamentLink) return tournamentLink;

    tournamentLink = document.createElement('a');
    tournamentLink.id = 'tournamentScoresLink';
    tournamentLink.className = 'topbar-link';
    tournamentLink.dataset.navKey = 'tournament-scores';
    tournamentLink.href = '/tournament-scores.html';
    tournamentLink.hidden = true;
    tournamentLink.textContent = 'Tournament Scores';

    const fieldStatusLink = document.getElementById('fieldStatusLink');
    if (fieldStatusLink && fieldStatusLink.parentElement === topbarInner && fieldStatusLink.nextSibling) {
      topbarInner.insertBefore(tournamentLink, fieldStatusLink.nextSibling);
      return tournamentLink;
    }
    if (fieldStatusLink && fieldStatusLink.parentElement === topbarInner) {
      topbarInner.appendChild(tournamentLink);
      return tournamentLink;
    }

    topbarInner.appendChild(tournamentLink);
    return tournamentLink;
  }

  function ensureUmpireAvailabilityLink() {
    const topbarInner = document.querySelector('.topbar-inner');
    if (!topbarInner) return null;
    let umpireLink = document.getElementById('umpireAvailabilityLink');
    if (umpireLink) return umpireLink;

    umpireLink = document.createElement('a');
    umpireLink.id = 'umpireAvailabilityLink';
    umpireLink.className = 'topbar-link';
    umpireLink.dataset.navKey = 'umpires';
    umpireLink.href = '/umpire-availability.html';
    umpireLink.hidden = true;
    umpireLink.textContent = 'Umpire Assignments';

    const homeLink = document.getElementById('homeNavLink');
    if (homeLink && homeLink.parentElement === topbarInner && homeLink.nextSibling) {
      topbarInner.insertBefore(umpireLink, homeLink.nextSibling);
      return umpireLink;
    }

    if (homeLink && homeLink.parentElement === topbarInner) {
      topbarInner.appendChild(umpireLink);
      return umpireLink;
    }

    topbarInner.appendChild(umpireLink);
    return umpireLink;
  }

  function ensureUmpireAssignmentsDayLink() {
    const topbarInner = document.querySelector('.topbar-inner');
    if (!topbarInner) return null;
    let assignmentsLink = document.getElementById('umpireAssignmentsDayLink');
    if (assignmentsLink) return assignmentsLink;

    assignmentsLink = document.createElement('a');
    assignmentsLink.id = 'umpireAssignmentsDayLink';
    assignmentsLink.className = 'topbar-link';
    assignmentsLink.dataset.navKey = 'umpire-assignments';
    assignmentsLink.href = '/umpire-availability.html#assignments';
    assignmentsLink.hidden = true;
    assignmentsLink.textContent = 'Assignments by Day';

    const umpireLink = ensureUmpireAvailabilityLink();
    if (umpireLink && umpireLink.parentElement === topbarInner && umpireLink.nextSibling) {
      topbarInner.insertBefore(assignmentsLink, umpireLink.nextSibling);
      return assignmentsLink;
    }

    if (umpireLink && umpireLink.parentElement === topbarInner) {
      topbarInner.appendChild(assignmentsLink);
      return assignmentsLink;
    }

    topbarInner.appendChild(assignmentsLink);
    return assignmentsLink;
  }

  async function switchAdminSite(event) {
    event.preventDefault();
    const link = event.currentTarget;
    const originalText = link.textContent;
    link.textContent = 'Switching...';
    try {
      const targetPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const response = await fetch(`/api/admin/switch-link?targetPath=${encodeURIComponent(targetPath)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Switch failed');
      const payload = await response.json();
      window.location.href = payload.url;
    } catch (_) {
      link.textContent = originalText;
      window.location.href = '/admin.html';
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
      await fetch('/api/admin/switch-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ switchToken })
      });
    } catch (_) {
      // The normal session refresh below will show the logged-out state if the handoff fails.
    }
  }

  function applyNavState(session, publicConfig) {
    const homeLink = document.getElementById('homeNavLink');
    const profileLink = ensureProfileLink();
    const siteSwitchLink = ensureAdminSiteSwitchLink();
    const tournamentScoresLink = ensureTournamentScoresLink();
    const umpireLink = ensureUmpireAvailabilityLink();
    const umpireAssignmentsLink = ensureUmpireAssignmentsDayLink();
    const adminLink = document.getElementById('adminLink');
    const fieldStatusLink = document.getElementById('fieldStatusLink');
    const sessionLabel = document.getElementById('sessionLabel');
    const logoutButton = document.getElementById('logoutBtn');
    if (!homeLink) return;

    const role = session && session.authenticated && session.user ? session.user.role : '';
    const currentKey = document.body && document.body.dataset ? document.body.dataset.nav || '' : '';
    const onUmpirePortal = currentKey === 'umpires';
    homeLink.href = '/';
    homeLink.textContent = onUmpirePortal ? 'Switch to Scheduling' : 'Coach Schedule';
    homeLink.dataset.clearUmpireSession = onUmpirePortal && role === 'umpire' ? 'true' : 'false';
    bindSchedulingSwitchLink(homeLink);
    ['home', 'availability', 'status', 'contact'].forEach((key) => {
      const link = document.querySelector(`.topbar-link[data-nav-key="${key}"]`);
      if (link) link.hidden = role === 'umpire';
    });

    if (profileLink) {
      const canAccessProfile = Boolean(publicConfig.profilePath) && role === 'coach';
      profileLink.href = publicConfig.profilePath || '/profile.html';
      profileLink.hidden = !canAccessProfile;
    }

    if (adminLink) {
      adminLink.href = publicConfig.adminPath || '/admin.html';
      adminLink.hidden = !(role === 'admin' || role === 'admin_viewer');
    }

    if (fieldStatusLink) {
      const canAccessFieldStatus = Boolean(publicConfig.fieldStatusPath) && (role === 'admin' || role === 'admin_viewer' || role === 'status_editor');
      fieldStatusLink.href = publicConfig.fieldStatusPath || '/diamond-status-admin.html';
      fieldStatusLink.hidden = !canAccessFieldStatus;
    }

    if (tournamentScoresLink) {
      const canAccessTournamentScores = Boolean(publicConfig.tournamentScoresPath);
      tournamentScoresLink.href = publicConfig.tournamentScoresPath || '/tournament-scores.html';
      tournamentScoresLink.hidden = !canAccessTournamentScores || role === 'umpire';
    }

    if (umpireLink) {
      const canAccessUmpires = Boolean(publicConfig.umpirePath);
      umpireLink.href = publicConfig.umpirePath || '/umpire-availability.html';
      umpireLink.textContent = onUmpirePortal ? 'Umpire Calendar' : 'Umpire Assignments';
      umpireLink.hidden = !canAccessUmpires;
    }

    if (umpireAssignmentsLink) {
      const canSeeUmpireAssignments = onUmpirePortal && (role === 'admin' || role === 'admin_viewer');
      umpireAssignmentsLink.href = `${publicConfig.umpirePath || '/umpire-availability.html'}#assignments`;
      umpireAssignmentsLink.hidden = !canSeeUmpireAssignments;
    }

    if (siteSwitchLink) {
      const canSwitchAdminSite = Boolean(publicConfig.alternateAdminSite && publicConfig.alternateAdminSite.url)
        && (role === 'admin' || role === 'admin_viewer')
        && (!session.user || session.user.canSwitchSites !== false);
      siteSwitchLink.textContent = publicConfig.alternateAdminSite && publicConfig.alternateAdminSite.label
        ? `Switch to ${publicConfig.alternateAdminSite.label}`
        : 'Switch Admin Site';
      siteSwitchLink.hidden = !canSwitchAdminSite;
      if (!siteSwitchLink.dataset.boundSwitch) {
        siteSwitchLink.dataset.boundSwitch = 'true';
        siteSwitchLink.addEventListener('click', switchAdminSite);
      }
    }

    if (sessionLabel) {
      const text = formatSessionLabel(session);
      sessionLabel.textContent = text;
      sessionLabel.hidden = !text;
    }

    if (logoutButton) {
      logoutButton.hidden = !session.authenticated;
      bindLogoutButton();
    }

    document.querySelectorAll('.topbar-link').forEach((link) => {
      link.classList.remove('current');
      link.removeAttribute('aria-current');
    });

    if (onUmpirePortal) {
      document.querySelectorAll('.topbar-link').forEach((link) => {
        const key = link.dataset ? link.dataset.navKey : '';
        link.hidden = !(key === 'home'
          || key === 'umpires'
          || (key === 'umpire-assignments' && (role === 'admin' || role === 'admin_viewer'))
          || (key === 'site-switch' && (role === 'admin' || role === 'admin_viewer') && (!session.user || session.user.canSwitchSites !== false)));
      });
      homeLink.hidden = false;
      if (umpireLink) {
        umpireLink.href = publicConfig.umpirePath || '/umpire-availability.html';
        umpireLink.textContent = 'Umpire Calendar';
        umpireLink.hidden = false;
      }
      if (umpireAssignmentsLink) {
        umpireAssignmentsLink.href = `${publicConfig.umpirePath || '/umpire-availability.html'}#assignments`;
      }
    }

    if (currentKey) {
      const currentLink = document.querySelector(`.topbar-link[data-nav-key="${currentKey}"]`);
      if (currentLink && !currentLink.hidden) {
        currentLink.classList.add('current');
        currentLink.setAttribute('aria-current', 'page');
      }
    }

    if (onUmpirePortal && String(window.location.hash || '').toLowerCase() === '#assignments' && umpireAssignmentsLink && !umpireAssignmentsLink.hidden) {
      if (umpireLink) {
        umpireLink.classList.remove('current');
        umpireLink.removeAttribute('aria-current');
      }
      umpireAssignmentsLink.classList.add('current');
      umpireAssignmentsLink.setAttribute('aria-current', 'page');
    }

    document.body.classList.add('nav-ready');
    applyBrandText(publicConfig);
  }

  function replaceTextNodeContent(root, replacements) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((node) => {
      if (node.parentElement && node.parentElement.closest('[data-brand-static]')) return;
      let value = node.nodeValue;
      replacements.forEach(([from, to]) => {
        value = value.replace(from, to);
      });
      node.nodeValue = value;
    });
  }

  function applyBrandText(publicConfig) {
    const brandName = publicConfig.brandName || 'LaSalle Titans';
    const teamLabel = publicConfig.teamLabel || 'Titans';
    const sportName = publicConfig.sportName || 'Baseball';
    if (brandName === 'LaSalle Titans' && teamLabel === 'Titans' && sportName === 'Baseball') return;

    document.title = document.title
      .replace(/LaSalle Titans/g, brandName)
      .replace(/\bTitans\b/g, teamLabel)
      .replace(/\bBaseball\b/g, sportName);
    replaceTextNodeContent(document.body, [
      [/LaSalle Titans/g, brandName],
      [/\bTitans\b/g, teamLabel],
      [/\bBaseball\b/g, sportName]
    ]);
  }

  async function refreshTopNav() {
    await acceptIncomingSwitchLogin();
    let session = { authenticated: false };
    let publicConfig = { adminPath: '/admin.html', fieldStatusPath: '', profilePath: '', umpirePath: '', tournamentScoresPath: '' };
    const cached = readCachedState();
    if (cached) {
      session = cached.session || session;
      publicConfig = cached.publicConfig || publicConfig;
      applyNavState(session, publicConfig);
    }

    try {
      const [sessionResponse, configResponse] = await Promise.all([
        fetch('/api/coach/session', { cache: 'no-store' }),
        fetch('/api/public-config', { cache: 'no-store' })
      ]);
      if (sessionResponse.ok) {
        session = await sessionResponse.json().catch(() => ({ authenticated: false }));
      }
      if (configResponse.ok) {
        publicConfig = await configResponse.json().catch(() => publicConfig);
      }
    } catch (_) {
      applyNavState(session, publicConfig);
      return;
    }

    applyNavState(session, publicConfig);
    if (session && session.authenticated) {
      writeCachedState(session, publicConfig);
    } else {
      clearCachedState();
    }
  }

  window.refreshTopNav = refreshTopNav;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refreshTopNav, { once: true });
  } else {
    refreshTopNav();
  }
})();
