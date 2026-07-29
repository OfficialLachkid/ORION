function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeUrl(value) {
  const url = normalizeText(value);
  return url || 'about:blank';
}

export function renderPublishedReferenceTemplate(draft) {
  const reference = draft?.reference || {};
  const title = normalizeText(draft?.site?.title) || 'Imported reference layout';
  const subtitle = normalizeText(draft?.site?.subtitle);
  const previewUrl = normalizeUrl(reference.previewUrl);
  const sourceLabel = normalizeText(reference.sourceLabel);
  const previewNote = normalizeText(reference.previewNote)
    || 'Reference preview only. Template-specific field editing comes next.';

  return `
    <section
      class="reference-preview preview-target"
      data-preview-target-id="reference-preview"
      data-editor-section="reference-preview"
    >
      <div class="reference-preview-meta">
        <p class="reference-preview-eyebrow">Imported layout</p>
        <div class="reference-preview-copy">
          <div>
            <h2>${escapeHtml(title)}</h2>
            ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
          </div>
          ${sourceLabel ? `<span class="reference-preview-source">${escapeHtml(sourceLabel)}</span>` : ''}
        </div>
      </div>

      <div class="reference-preview-frame-shell">
        <iframe
          class="reference-preview-frame"
          src="${escapeHtml(previewUrl)}"
          title="${escapeHtml(title)}"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"
        ></iframe>
      </div>

      <div class="reference-preview-note">
        <strong>Template status</strong>
        <p>${escapeHtml(previewNote)}</p>
      </div>
    </section>
  `;
}
