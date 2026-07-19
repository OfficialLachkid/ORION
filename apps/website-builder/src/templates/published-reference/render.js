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

const LOCAL_PREVIEW_PATHS = [
  '/ruflo/sites/vink-elektrotechniek/',
  '/ruflo/sites/newman-partners-v2/',
  '/ruflo/sites/vbj-services/',
];

function shouldUseLocalPreviews(location = globalThis.location) {
  const hostname = location?.hostname || '';
  if (!['localhost', '127.0.0.1'].includes(hostname)) {
    return false;
  }

  return location?.port === '4173'
    || new URLSearchParams(location?.search || '').get('localPreviews') === '1';
}

export function resolvePublishedPreviewUrl(value, location = globalThis.location) {
  const previewUrl = normalizeUrl(value);
  if (!shouldUseLocalPreviews(location)) {
    return previewUrl;
  }

  try {
    const parsed = new URL(previewUrl);
    if (
      parsed.hostname === 'officiallachkid.github.io'
      && LOCAL_PREVIEW_PATHS.some((path) => parsed.pathname.startsWith(path))
    ) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    return previewUrl;
  }

  return previewUrl;
}

export function renderPublishedReferenceTemplate(draft) {
  const reference = draft?.reference || {};
  const title = normalizeText(draft?.site?.title) || 'Imported reference layout';
  const subtitle = normalizeText(draft?.site?.subtitle);
  const sourcePreviewUrl = normalizeUrl(reference.previewUrl);
  const previewUrl = resolvePublishedPreviewUrl(sourcePreviewUrl);
  const sourceLabel = normalizeText(reference.sourceLabel);
  const previewNote = normalizeText(reference.previewNote)
    || 'Edit content from the left panel. Layout, styling, and motion remain locked to this design.';

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
          data-fallback-src="${escapeHtml(sourcePreviewUrl)}"
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
