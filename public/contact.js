(function () {
  const contactGrid = document.getElementById('contactGrid');
  const contactIntro = document.getElementById('contactIntro');

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function renderContacts(config) {
    const teamLabel = config.teamLabel || 'Titans';
    const contacts = Array.isArray(config.contacts) ? config.contacts : [];
    if (contactIntro) {
      contactIntro.textContent = `Use these contacts for ${teamLabel} schedule request questions.`;
    }
    if (!contactGrid || !contacts.length) return;
    contactGrid.innerHTML = contacts.map((contact) => {
      const name = escapeHtml(contact.name);
      const email = escapeHtml(contact.email);
      return `
        <article class="contact-card">
          <h3>${name}</h3>
          <a href="mailto:${email}">${email}</a>
        </article>
      `;
    }).join('');
  }

  async function init() {
    try {
      const response = await fetch('/api/public-config', { cache: 'no-store' });
      if (!response.ok) return;
      renderContacts(await response.json());
    } catch (_) {
      // Keep the static fallback contacts.
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
