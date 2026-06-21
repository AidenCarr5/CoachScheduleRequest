(function () {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || '';
  let uploadContext = null;

  async function init() {
    $('seasonUploadForm').addEventListener('submit', uploadSchedule);
    if (!token) {
      setMessage('This upload link is missing its secure token.');
      $('seasonUploadForm').hidden = true;
      return;
    }
    await verifyToken();
  }

  async function verifyToken() {
    try {
      const response = await fetch('/api/season-upload/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      if (!response.ok) throw new Error('Upload link was not accepted.');
      uploadContext = await response.json();
      $('seasonUploadTeam').textContent = `${uploadContext.coach.team} - ${uploadContext.season.label}`;
      setMessage(uploadContext.coach.eventCount
        ? `A schedule with ${uploadContext.coach.eventCount} event${uploadContext.coach.eventCount === 1 ? '' : 's'} was already uploaded. Uploading again will replace that staged file.`
        : 'Upload your full season schedule when ready.');
    } catch (error) {
      setMessage(error.message || 'This upload link could not be verified.');
      $('seasonUploadForm').hidden = true;
    }
  }

  async function uploadSchedule(event) {
    event.preventDefault();
    const file = $('seasonUploadFile').files && $('seasonUploadFile').files[0];
    if (!file) {
      setMessage('Choose an Excel or CSV file first.');
      return;
    }
    setMessage('Reading schedule file...');
    try {
      const rows = await readSpreadsheet(file);
      if (!rows.length) {
        setMessage('No schedule rows were found in that file.');
        return;
      }
      renderPreview(rows);
      setMessage(`Uploading ${rows.length} staged event${rows.length === 1 ? '' : 's'}...`);
      const response = await fetch('/api/season-upload/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, events: rows })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error || 'Schedule upload failed.');
        return;
      }
      setMessage(`Upload saved. ${payload.eventCount || rows.length} event${(payload.eventCount || rows.length) === 1 ? '' : 's'} staged. Admin conflict preview currently shows ${payload.conflictCount || 0} conflict${payload.conflictCount === 1 ? '' : 's'}.`);
    } catch (error) {
      setMessage(error.message || 'Schedule upload failed.');
    }
  }

  function readSpreadsheet(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const workbook = XLSX.read(reader.result, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
          resolve(rows.map(normalizeRow).filter((row) => row.date || row.start || row.opponent || row.diamond));
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('The file could not be read.'));
      reader.readAsArrayBuffer(file);
    });
  }

  function normalizeRow(row) {
    const find = (...keys) => {
      const wanted = keys.map((key) => key.toLowerCase());
      const match = Object.keys(row).find((key) => wanted.includes(String(key).trim().toLowerCase()));
      return match ? row[match] : '';
    };
    return {
      date: find('date', 'day', 'game date'),
      start: find('start', 'time', 'start time'),
      end: find('end', 'finish', 'end time'),
      type: find('type', 'event type', 'game type'),
      opponent: find('opponent', 'title', 'description'),
      diamond: find('diamond', 'venue', 'location', 'field'),
      notes: find('notes', 'note')
    };
  }

  function renderPreview(rows) {
    $('seasonUploadPreview').innerHTML = `
      <section class="season-card">
        <h3>Preview</h3>
        <div class="season-conflict-table">
          ${rows.slice(0, 12).map((row) => `
            <article class="season-conflict-row">
              <strong>${escapeHtml(row.date)} ${escapeHtml(row.start)}${row.end ? `-${escapeHtml(row.end)}` : ''}</strong>
              <span>${escapeHtml(row.type || 'Event')} ${escapeHtml(row.opponent || '')}</span>
              <small>${escapeHtml(row.diamond || '')}</small>
            </article>
          `).join('')}
        </div>
        ${rows.length > 12 ? `<p class="muted">Showing 12 of ${rows.length} rows.</p>` : ''}
      </section>
    `;
  }

  function setMessage(message) {
    $('seasonUploadMessage').textContent = message;
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
