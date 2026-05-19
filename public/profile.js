(function () {
  const $ = (id) => document.getElementById(id);
  let saving = false;

  async function init() {
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
  }

  async function changePassword(event) {
    event.preventDefault();
    if (saving) return;

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

    saving = true;
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
      saving = false;
      $('saveProfilePasswordBtn').disabled = false;
    }
  }

  function setMessage(text, ok) {
    const message = $('profileMessage');
    message.textContent = text;
    message.className = `profile-message ${ok ? 'ok' : 'error'}`;
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
