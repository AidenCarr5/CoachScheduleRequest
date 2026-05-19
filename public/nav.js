(function () {
  async function refreshTopNav() {
    const homeLink = document.getElementById('homeNavLink');
    const adminLink = document.getElementById('adminLink');
    const fieldStatusLink = document.getElementById('fieldStatusLink');
    if (!homeLink) return;

    let session = { authenticated: false };
    let publicConfig = { adminPath: '/admin.html', fieldStatusPath: '' };

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
      // Keep the default public nav if the session check fails.
    }

    const role = session && session.authenticated && session.user ? session.user.role : '';
    homeLink.textContent = session && session.authenticated ? 'Coach Schedule' : 'Log in';
    homeLink.href = '/';

    if (adminLink) {
      adminLink.href = publicConfig.adminPath || '/admin.html';
      adminLink.hidden = role !== 'admin';
    }

    if (fieldStatusLink) {
      const canAccessFieldStatus = Boolean(publicConfig.fieldStatusPath) && (role === 'admin' || role === 'status_editor');
      fieldStatusLink.href = publicConfig.fieldStatusPath || '/diamond-status-admin.html';
      fieldStatusLink.hidden = !canAccessFieldStatus;
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
  }

  window.refreshTopNav = refreshTopNav;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refreshTopNav, { once: true });
  } else {
    refreshTopNav();
  }
})();
