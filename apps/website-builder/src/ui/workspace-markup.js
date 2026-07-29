export function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatTimestamp(value) {
  const timestamp = Date.parse(value || '');
  if (Number.isNaN(timestamp)) {
    return 'Unknown';
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(timestamp));
}

export function buildPreviewUrl(mode, entryKind = '', entryId = '') {
  const params = new URLSearchParams({ mode });
  if (entryKind) {
    params.set('kind', entryKind);
  }
  if (entryId) {
    params.set('id', entryId);
  }
  return `./preview.html?${params.toString()}`;
}

function getThemeStyle(draft) {
  const theme = draft?.theme || {};
  return [
    `--theme-background:${theme.backgroundColor || '#f4efe5'}`,
    `--theme-surface:${theme.surfaceColor || '#fffaf2'}`,
    `--theme-accent:${theme.accentColor || '#234c3d'}`,
    `--theme-text:${theme.textColor || '#17211f'}`,
    `--theme-panel:${theme.panelColor || '#f8f1e5'}`,
  ].join(';');
}

function renderEmptyState(view) {
  const isWebsitesView = view === 'websites';
  const isBuildView = view === 'build';

  return `
    <article class="workspace-empty-state">
      <p class="workspace-empty-title">
        ${isWebsitesView
          ? 'No saved websites yet.'
          : isBuildView
            ? 'No reusable designs are available to build from yet.'
            : 'No reusable designs saved yet.'}
      </p>
      <p class="workspace-empty-copy">
        ${isWebsitesView
          ? 'Build a website from a reusable design first, then open it here for company-specific editing.'
          : isBuildView
            ? 'Claude Design should add reusable design skeletons into the design library before operators build a website from them.'
            : 'Claude Design stores reusable skeletons here first so O.R.I.O.N. can reuse them before generating a brand-new website.'}
      </p>
    </article>
  `;
}

function renderOverviewCard(entry, view, renderTemplate, templateName, sourceDesignTitle) {
  const isWebsite = entry.kind === 'website';

  return `
    <article class="workspace-card">
      <div class="workspace-card-preview-shell">
        <div class="workspace-card-preview-scale">
          <div class="preview-root workspace-card-preview-root preview-static-root" style="${getThemeStyle(entry.draft)}">
            ${renderTemplate(entry.draft)}
          </div>
        </div>
      </div>

      <div class="workspace-card-copy">
        <p class="workspace-card-label">${isWebsite ? 'Saved website' : 'Reusable design'}</p>
        <h3>${escapeHtml(entry.title)}</h3>
        ${entry.companyName ? `<p class="workspace-card-company">${escapeHtml(entry.companyName)}</p>` : ''}
        ${entry.summary ? `<p class="workspace-card-summary">${escapeHtml(entry.summary)}</p>` : ''}
        <div class="workspace-card-meta">
          <span>Template: ${escapeHtml(templateName)}</span>
          <span>Updated: ${escapeHtml(formatTimestamp(entry.updatedAt))}</span>
          ${sourceDesignTitle ? `<span>Based on: ${escapeHtml(sourceDesignTitle)}</span>` : ''}
        </div>

        <div class="button-row stacked workspace-card-actions">
          <button class="secondary-button" type="button" data-card-action="preview" data-entry-kind="${entry.kind}" data-entry-id="${entry.id}">
            Open preview
          </button>
          ${isWebsite ? `
            <button class="primary-button" type="button" data-card-action="edit" data-entry-kind="${entry.kind}" data-entry-id="${entry.id}">
              Open editor
            </button>
          ` : ''}
          ${!isWebsite ? `
            <button class="primary-button" type="button" data-card-action="choose-for-build" data-entry-kind="${entry.kind}" data-entry-id="${entry.id}">
              ${view === 'designs' ? 'Open build flow' : 'Select design'}
            </button>
          ` : ''}
        </div>
      </div>
    </article>
  `;
}

function renderBuildCard(entry, isSelected, renderTemplate, templateName) {
  return `
    <article class="workspace-card workspace-card-selectable ${isSelected ? 'is-selected' : ''}">
      <div class="workspace-card-preview-shell">
        <div class="workspace-card-preview-scale">
          <div class="preview-root workspace-card-preview-root preview-static-root" style="${getThemeStyle(entry.draft)}">
            ${renderTemplate(entry.draft)}
          </div>
        </div>
      </div>

      <div class="workspace-card-copy">
        <p class="workspace-card-label">${isSelected ? 'Selected design' : 'Reusable design'}</p>
        <h3>${escapeHtml(entry.title)}</h3>
        ${entry.summary ? `<p class="workspace-card-summary">${escapeHtml(entry.summary)}</p>` : ''}
        <div class="workspace-card-meta">
          <span>Template: ${escapeHtml(templateName)}</span>
          <span>Updated: ${escapeHtml(formatTimestamp(entry.updatedAt))}</span>
        </div>

        <div class="button-row stacked workspace-card-actions">
          <button
            class="${isSelected ? 'secondary-button' : 'primary-button'}"
            type="button"
            data-build-action="select"
            data-entry-id="${entry.id}"
          >
            ${isSelected ? 'Selected' : 'Select design'}
          </button>
          <button class="secondary-button" type="button" data-build-action="preview" data-entry-id="${entry.id}">
            Open preview
          </button>
        </div>
      </div>
    </article>
  `;
}

export function renderOverviewContent({
  view,
  entries,
  renderTemplate,
  getTemplateName,
  getSourceDesignTitle,
}) {
  if (entries.length < 1) {
    return renderEmptyState(view);
  }

  return entries
    .map((entry) =>
      renderOverviewCard(
        entry,
        view,
        renderTemplate,
        getTemplateName(entry.templateId),
        entry.kind === 'website' ? getSourceDesignTitle(entry.sourceDesignId) : ''
      )
    )
    .join('');
}

export function renderBuildSelectionContent({
  entries,
  selectedDesignId,
  renderTemplate,
  getTemplateName,
}) {
  if (entries.length < 1) {
    return renderEmptyState('build');
  }

  return entries
    .map((entry) =>
      renderBuildCard(
        entry,
        entry.id === selectedDesignId,
        renderTemplate,
        getTemplateName(entry.templateId)
      )
    )
    .join('');
}
