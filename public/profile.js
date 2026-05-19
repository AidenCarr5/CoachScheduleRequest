(function () {
  const $ = (id) => document.getElementById(id);
  let savingPassword = false;
  let savingEmail = false;

  async function init() {
    $('profileEmailForm').addEventListener('submit', updateEmail);
    $('profilePasswordForm').addEventListener('submit', changePassword);
    await loadProfile();
  }

  async function loadProfile() {
    const response = await fetch('/api/coach/profile', { cache: 'no-store' });
    if (!response.ok) {
      window.location.href = '/';
      return;
    }
    const payload = await response.json();
    renderProfile(payload.profile || {});
  }

  function renderProfile(profile) {
    $('profileSummary').innerHTML = `
      <div class="profile-summary-row">
        <strong>Username</strong>
        <span>${escapeHtml(profile.username || '')}</span>
      </div>
      <div class="profile-summary-row">
        <strong>Team</strong>
        <span>${escapeHtml(profile.team || '')}</span>
      </div>
      <div class="profile-summary-row">
        <strong>Email</strong>
        <span>${escapeHtml(profile.email || 'Not set yet')}</span>
      </div>
    `;
    $('profileEmail').value = profile.email || '';
  }

  async function changePassword(event) {
    event.preventDefault();
    if (savingPassword) return;

    const currentPassword = $('currentPassword').value;
    const newPassword = $('newPassword').value;
    const confirmPassword = $('confirmPassword').value;
    const message = $('profileMessage');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setMessage('Enter your current password and the new password twice.', false);
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage('The new password confirmation did not match.', false);
      return;
    }
    if (newPassword.length < 6) {
      setMessage('Use at least 6 characters for the new password.', false);
      return;
    }

    savingPassword = true;
    message.textContent = 'Saving your new password...';
    message.className = 'profile-message';
    $('saveProfilePasswordBtn').disabled = true;

    try {
      const response = await fetch('/api/coach/profile/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error || 'The password could not be updated.', false);
        return;
      }

      $('profilePasswordForm').reset();
      setMessage('Password updated.', true);
      if (payload.profile) renderProfile(payload.profile);
    } finally {
      savingPassword = false;
      $('saveProfilePasswordBtn').disabled = false;
    }
  }

  async function updateEmail(event) {
    event.preventDefault();
    if (savingEmail) return;

    const email = $('profileEmail').value.trim();
    const message = $('profileEmailMessage');

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setNamedMessage(message, 'Enter a valid email address.', false);
      return;
    }

    savingEmail = true;
    message.textContent = 'Saving your email...';
    message.className = 'profile-message';
    $('saveProfileEmailBtn').disabled = true;

    try {
      const response = await fetch('/api/coach/profile/update-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNamedMessage(message, payload.error || 'The email could not be updated.', false);
        return;
      }

      setNamedMessage(message, 'Email updated.', true);
      if (payload.profile) renderProfile(payload.profile);
    } finally {
      savingEmail = false;
      $('saveProfileEmailBtn').disabled = false;
    }
  }

  function setMessage(text, ok) {
    setNamedMessage($('profileMessage'), text, ok);
  }

  function setNamedMessage(element, text, ok) {
    element.textContent = text;
    element.className = `profile-message ${ok ? 'ok' : 'error'}`;
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
