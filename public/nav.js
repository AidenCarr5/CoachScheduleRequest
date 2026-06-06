(function () {
  let logoutBound = false;
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
    umpireLink.textContent = 'Umpire';

    const fieldStatusLink = document.getElementById('fieldStatusLink');
    if (fieldStatusLink && fieldStatusLink.parentElement === topbarInner) {
      topbarInner.insertBefore(umpireLink, fieldStatusLink);
      return umpireLink;
    }

    const adminLink = document.getElementById('adminLink');
    if (adminLink && adminLink.parentElement === topbarInner) {
      topbarInner.insertBefore(umpireLink, adminLink.nextSibling);
      return umpireLink;
    }

    topbarInner.appendChild(umpireLink);
    return umpireLink;
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
    const umpireLink = ensureUmpireAvailabilityLink();
    const adminLink = document.getElementById('adminLink');
    const fieldStatusLink = document.getElementById('fieldStatusLink');
    const sessionLabel = document.getElementById('sessionLabel');
    const logoutButton = document.getElementById('logoutBtn');
    if (!homeLink) return;

    const role = session && session.authenticated && session.user ? session.user.role : '';
    homeLink.href = '/';
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

    if (umpireLink) {
      const canAccessUmpires = Boolean(publicConfig.umpirePath) && (role === 'admin' || role === 'admin_viewer' || role === 'umpire');
      umpireLink.href = publicConfig.umpirePath || '/umpire-availability.html';
      umpireLink.hidden = !canAccessUmpires;
    }

    if (siteSwitchLink) {
      const canSwitchAdminSite = Boolean(publicConfig.alternateAdminSite && publicConfig.alternateAdminSite.url)
        && (role === 'admin' || role === 'admin_viewer');
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

    const currentKey = document.body && document.body.dataset ? document.body.dataset.nav || '' : '';
    if (currentKey) {
      const currentLink = document.querySelector(`.topbar-link[data-nav-key="${currentKey}"]`);
      if (currentLink && !currentLink.hidden) {
        currentLink.classList.add('current');
        currentLink.setAttribute('aria-current', 'page');
      }
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
    let publicConfig = { adminPath: '/admin.html', fieldStatusPath: '', profilePath: '', umpirePath: '' };
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
