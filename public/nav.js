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
      return initials ? `${initials} · admin` : 'admin';
    }
    if (user.role === 'status_editor') {
      return initials ? `${initials} · ${username || 'ecarr'}` : (username || 'ecarr');
    }
    return initials && username ? `${initials} · ${username}` : (username || '');
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

  function applyNavState(session, publicConfig) {
    const homeLink = document.getElementById('homeNavLink');
    const profileLink = ensureProfileLink();
    const adminLink = document.getElementById('adminLink');
    const fieldStatusLink = document.getElementById('fieldStatusLink');
    const sessionLabel = document.getElementById('sessionLabel');
    const logoutButton = document.getElementById('logoutBtn');
    if (!homeLink) return;

    const role = session && session.authenticated && session.user ? session.user.role : '';
    homeLink.href = '/';

    if (profileLink) {
      const canAccessProfile = Boolean(publicConfig.profilePath) && role === 'coach';
      profileLink.href = publicConfig.profilePath || '/profile.html';
      profileLink.hidden = !canAccessProfile;
    }

    if (adminLink) {
      adminLink.href = publicConfig.adminPath || '/admin.html';
      adminLink.hidden = role !== 'admin';
    }

    if (fieldStatusLink) {
      const canAccessFieldStatus = Boolean(publicConfig.fieldStatusPath) && (role === 'admin' || role === 'status_editor');
      fieldStatusLink.href = publicConfig.fieldStatusPath || '/diamond-status-admin.html';
      fieldStatusLink.hidden = !canAccessFieldStatus;
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
  }

  async function refreshTopNav() {
    let session = { authenticated: false };
    let publicConfig = { adminPath: '/admin.html', fieldStatusPath: '', profilePath: '' };
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
