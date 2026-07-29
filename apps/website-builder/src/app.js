import {
  hydrateDraft,
  TEMPLATE_OPTIONS,
  getEditorSections,
  getTemplateById,
  renderTemplate,
  reseedDraftForTemplate,
} from './schema.js';
import { getValueByPath, setValueByPath } from './lib/draft.js';
import {
  loadPersistedLibrary,
  persistLibraryEntry,
} from './library-client.js';
import {
  buildWebsiteFromDesign,
  createSessionFromEntry,
  getEntryById,
  loadLibrary,
  loadSession,
  resetSession,
  saveEntryFromSession,
  saveLibrary,
  saveSession,
} from './storage.js';
import {
  buildPreviewUrl,
  renderBuildSelectionContent,
  renderOverviewContent,
} from './ui/workspace-markup.js';
import { renderEditorField } from './ui/editor-field-markup.js';
import {
  setupPanoramaTopBarState,
  setupScrollReveal,
} from './runtime/preview-motion.js';

const initialSession = loadSession();
const initialLibrary = loadLibrary();

function getInitialWorkspaceView() {
  if (initialLibrary.designs.length > 0) {
    return 'designs';
  }

  if (initialLibrary.websites.length > 0) {
    return 'websites';
  }

  return 'build';
}

const state = {
  library: initialLibrary,
  ...initialSession,
  workspaceView: getInitialWorkspaceView(),
  libraryPersistenceMode: 'local-fallback',
  viewport: 'desktop',
  activeTargetId: '',
  expandedSections: new Set(),
  selectedBuildDesignId: initialLibrary.designs[0]?.id || '',
};

const elements = {
  workspaceTabs: document.getElementById('workspace-tabs'),
  entryMetaPanel: document.getElementById('entry-meta-panel'),
  entryMetaTitle: document.getElementById('entry-meta-title'),
  entryTitleLabel: document.getElementById('entry-title-label'),
  entryTitleInput: document.getElementById('entry-title'),
  entryCompanyRow: document.getElementById('entry-company-row'),
  entryCompanyNameInput: document.getElementById('entry-company-name'),
  entrySummaryRow: document.getElementById('entry-summary-row'),
  entrySummaryLabel: document.getElementById('entry-summary-label'),
  entrySummaryInput: document.getElementById('entry-summary'),
  entrySourceNote: document.getElementById('entry-source-note'),
  templatePanel: document.getElementById('template-panel'),
  templateGrid: document.getElementById('template-grid'),
  controlsPanel: document.getElementById('controls-panel'),
  saveWebsiteButton: document.getElementById('save-website'),
  openPreviewButton: document.getElementById('open-preview'),
  resetDraftButton: document.getElementById('reset-draft'),
  exportDraftButton: document.getElementById('export-draft'),
  importDraftInput: document.getElementById('import-draft'),
  editorPanel: document.getElementById('editor-panel'),
  editorSections: document.getElementById('editor-sections'),
  draftStatus: document.getElementById('draft-status'),
  topbarEyebrow: document.getElementById('topbar-eyebrow'),
  topbarTitle: document.getElementById('topbar-title'),
  topbarDescription: document.getElementById('topbar-description'),
  topbarActions: document.getElementById('topbar-actions'),
  viewportSwitcher: document.getElementById('viewport-switcher'),
  previewStage: document.getElementById('preview-stage'),
  previewFrame: document.getElementById('preview-frame'),
  previewShell: document.getElementById('preview-shell'),
  previewRoot: document.getElementById('preview-root'),
  overviewStage: document.getElementById('overview-stage'),
  overviewGrid: document.getElementById('overview-grid'),
};

let teardownPreviewMotion = () => {};

function isEditorView() {
  return state.workspaceView === 'editor';
}

function getActiveWorkspaceTab() {
  return state.workspaceView === 'editor' ? 'websites' : state.workspaceView;
}

function getCurrentSession() {
  return {
    recordKind: state.recordKind,
    recordId: state.recordId,
    entryTitle: state.entryTitle,
    companyName: state.companyName,
    summary: state.summary,
    sourceDesignId: state.sourceDesignId,
    draft: state.draft,
  };
}

function persistSessionState() {
  saveSession(getCurrentSession());
}

function replaceSession(nextSession) {
  state.recordKind = nextSession.recordKind;
  state.recordId = nextSession.recordId;
  state.entryTitle = nextSession.entryTitle;
  state.companyName = nextSession.companyName;
  state.summary = nextSession.summary;
  state.sourceDesignId = nextSession.sourceDesignId;
  state.draft = nextSession.draft;
  persistSessionState();
}

function setWorkspaceView(nextView) {
  state.workspaceView = nextView;

  if (nextView === 'build' && !getSelectedBuildDesign() && state.library.designs.length > 0) {
    state.selectedBuildDesignId = state.library.designs[0].id;
  }
}

function replaceLibrary(nextLibrary, options = {}) {
  state.library = nextLibrary;

  if (options.persistenceMode) {
    state.libraryPersistenceMode = options.persistenceMode;
  }

  if (!getDesignById(state.selectedBuildDesignId)) {
    state.selectedBuildDesignId = nextLibrary.designs[0]?.id || '';
  }
}

function normalizeFieldValue(field, rawValue) {
  if (field?.type === 'checkbox') {
    return Boolean(rawValue);
  }

  return String(rawValue || '').trim();
}

function updateStatus(text, kind = 'muted') {
  elements.draftStatus.textContent = text;
  elements.draftStatus.className = kind === 'success' ? 'success-text' : 'muted';
}

function openStandalonePreview(mode, entryKind = '', entryId = '') {
  globalThis.open(buildPreviewUrl(mode, entryKind, entryId), '_blank', 'noopener');
}

function getCurrentEditorSections() {
  return getEditorSections(state.draft.templateId);
}

function getFieldLookup() {
  return new Map(
    getCurrentEditorSections().flatMap((section) =>
      section.fields.map((field) => [field.path, { ...field, sectionId: section.id }])
    )
  );
}

function getFieldByPath(fieldPath) {
  return getFieldLookup().get(fieldPath) || null;
}

function getDesignById(designId) {
  return getEntryById(state.library, 'design', designId);
}

function getSelectedBuildDesign() {
  return getDesignById(state.selectedBuildDesignId) || state.library.designs[0] || null;
}

function getWorkspaceEntries() {
  const entries = state.workspaceView === 'websites'
    ? state.library.websites
    : state.library.designs;

  return [...entries].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || '') || 0;
    const rightTime = Date.parse(right.updatedAt || '') || 0;
    return rightTime - leftTime;
  });
}

function describePersistenceMode(persistenceMode) {
  return persistenceMode === 'supabase'
    ? 'Synced to Supabase.'
    : 'Saved locally. Supabase sync is not active yet.';
}

function isReferenceTemplateDraft(draft) {
  return Boolean(draft?.reference?.previewUrl);
}

function renderWorkspaceTabs() {
  const activeView = getActiveWorkspaceTab();

  elements.workspaceTabs.querySelectorAll('[data-workspace-view]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.workspaceView === activeView);
  });
}

function renderEntryMetaPanel() {
  const sourceDesign = getDesignById(state.sourceDesignId);
  const usesReferenceTemplate = isReferenceTemplateDraft(state.draft);

  elements.entryMetaTitle.textContent = 'Website details';
  elements.entryTitleLabel.textContent = 'Website name';
  elements.entryTitleInput.value = state.entryTitle || '';
  elements.entryCompanyRow.hidden = false;
  elements.entryCompanyNameInput.value = state.companyName || '';
  elements.entrySummaryRow.hidden = true;
  elements.entrySourceNote.textContent = usesReferenceTemplate
    ? 'This design is currently a reusable reference layout. Full field-level editing for this imported family is a separate import step.'
    : sourceDesign
      ? `Based on reusable design: ${sourceDesign.title}. Replace the mock copy with real company information before delivery.`
      : 'This is a company-specific website draft. Add real business details before delivery.';
}

function renderTemplateGrid() {
  elements.templateGrid.innerHTML = TEMPLATE_OPTIONS.map((template) => `
    <button
      class="template-card ${state.draft.templateId === template.id ? 'is-active' : ''}"
      data-template-id="${template.id}"
      type="button"
      ${template.builderEnabled ? '' : 'disabled'}
    >
      <span class="template-state">${template.builderEnabled ? 'Imported' : 'Coming soon'}</span>
      <strong>${template.name}</strong>
      <span>${template.description}</span>
    </button>
  `).join('');

  elements.templateGrid.querySelectorAll('[data-template-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const templateId = button.dataset.templateId;
      if (!templateId || templateId === state.draft.templateId) {
        return;
      }

      state.draft = reseedDraftForTemplate(state.draft, templateId);
      state.activeTargetId = '';
      state.expandedSections = new Set();
      persistSessionState();
      renderAll({ resetPreviewScroll: true });
      updateStatus(`Switched to ${getTemplateById(templateId).name}.`, 'success');
    });
  });
}

function bindFieldEvents(container) {
  container.querySelectorAll('[data-path]').forEach((input) => {
    const fieldPath = input.dataset.path;
    const field = getFieldByPath(fieldPath);

    const handleChange = () => {
      const rawValue = input.type === 'checkbox' ? input.checked : input.value;
      state.draft = setValueByPath(state.draft, fieldPath, normalizeFieldValue(field, rawValue));
      persistSessionState();
      renderPreview();
      updateStatus('Website draft updated locally. Save it to My websites when ready.');
    };

    const handleFocus = () => {
      handleEditorSelection(fieldPath);
    };

    input.addEventListener('input', handleChange);
    input.addEventListener('change', handleChange);
    input.addEventListener('focus', handleFocus);
  });

  container.querySelectorAll('[data-position-path]').forEach((button) => {
    const fieldPath = button.dataset.positionPath;

    button.addEventListener('click', () => {
      state.draft = setValueByPath(state.draft, fieldPath, button.dataset.positionValue || 'center');
      persistSessionState();
      renderPreview();
      renderEditor();
      handleEditorSelection(fieldPath);
      updateStatus('Website draft updated locally. Save it to My websites when ready.');
    });

    button.addEventListener('focus', () => {
      handleEditorSelection(fieldPath);
    });
  });
}

function renderEditor() {
  elements.editorSections.innerHTML = getCurrentEditorSections().map((section) => `
    <details class="editor-section" data-section-id="${section.id}" ${state.expandedSections.has(section.id) ? 'open' : ''}>
      <summary data-summary-target-id="${section.previewTargetId}" data-summary-section-id="${section.id}">
        <span class="editor-section-summary-copy">${section.title}</span>
        <span class="editor-section-icon" aria-hidden="true"></span>
      </summary>
      <div class="editor-section-body">
        <div class="field-grid">
          ${section.fields
            .map((field) => renderEditorField(field, getValueByPath(state.draft, field.path)))
            .join('')}
        </div>
      </div>
    </details>
  `).join('');

  elements.editorSections.querySelectorAll('.editor-section').forEach((details) => {
    details.addEventListener('toggle', () => {
      if (details.open) {
        state.expandedSections.add(details.dataset.sectionId);
      } else {
        state.expandedSections.delete(details.dataset.sectionId);
      }
    });
  });

  elements.editorSections.querySelectorAll('[data-summary-target-id]').forEach((summary) => {
    summary.addEventListener('click', () => {
      globalThis.setTimeout(() => {
        handleEditorSelection(summary.dataset.summaryTargetId || '');
      }, 0);
    });
  });

  elements.editorSections.querySelectorAll('[data-editor-target-id]').forEach((node) => {
    node.addEventListener('click', () => {
      handleEditorSelection(node.dataset.editorTargetId || '');
    });
  });

  bindFieldEvents(elements.editorSections);
  applyActiveTargetClasses();
}

function renderPreview({ resetScroll = false } = {}) {
  elements.previewShell.className = `preview-shell viewport-${state.viewport}`;
  elements.previewRoot.dataset.templateId = state.draft.templateId;
  elements.previewRoot.style.setProperty('--theme-background', state.draft.theme.backgroundColor);
  elements.previewRoot.style.setProperty('--theme-surface', state.draft.theme.surfaceColor);
  elements.previewRoot.style.setProperty('--theme-accent', state.draft.theme.accentColor);
  elements.previewRoot.style.setProperty('--theme-text', state.draft.theme.textColor);
  elements.previewRoot.style.setProperty('--theme-panel', state.draft.theme.panelColor);
  elements.previewRoot.innerHTML = renderTemplate(state.draft);

  bindPreviewEvents();
  teardownPreviewMotion();
  const teardownScrollReveal = setupScrollReveal(elements.previewRoot, elements.previewFrame);
  const teardownTopBarState = setupPanoramaTopBarState(elements.previewRoot, elements.previewFrame);
  teardownPreviewMotion = () => {
    teardownScrollReveal();
    teardownTopBarState();
  };
  applyActiveTargetClasses();

  if (resetScroll) {
    elements.previewFrame.scrollTo({ top: 0, behavior: 'auto' });
  }
}

function renderViewportButtons() {
  document.querySelectorAll('[data-viewport]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.viewport === state.viewport);
  });
}

function renderTopbarActions() {
  let markup = '';

  if (state.workspaceView === 'build') {
    const selectedDesign = getSelectedBuildDesign();
    markup = `
      <button
        id="topbar-build-preview"
        class="secondary-button"
        type="button"
        ${selectedDesign ? '' : 'disabled'}
      >
        Open selected preview
      </button>
      <button
        id="topbar-build-website"
        class="primary-button"
        type="button"
        ${selectedDesign ? '' : 'disabled'}
      >
        Build website
      </button>
    `;
  } else if (state.workspaceView === 'editor') {
    markup = `
      <button id="topbar-back-to-websites" class="secondary-button" type="button">
        Back to My websites
      </button>
    `;
  }

  elements.topbarActions.hidden = !markup;
  elements.topbarActions.innerHTML = markup;

  if (state.workspaceView === 'build') {
    elements.topbarActions.querySelector('#topbar-build-preview')?.addEventListener('click', () => {
      const selectedDesign = getSelectedBuildDesign();
      if (selectedDesign) {
        openStandalonePreview('entry', 'design', selectedDesign.id);
      }
    });

    elements.topbarActions.querySelector('#topbar-build-website')?.addEventListener('click', () => {
      void buildSelectedDesign();
    });
  }

  if (state.workspaceView === 'editor') {
    elements.topbarActions.querySelector('#topbar-back-to-websites')?.addEventListener('click', () => {
      setWorkspaceView('websites');
      renderAll();
      updateStatus('Returned to My websites.', 'success');
    });
  }
}

function renderTopbar() {
  if (state.workspaceView === 'editor') {
    const sourceDesign = getDesignById(state.sourceDesignId);

    elements.topbarEyebrow.textContent = 'Website editor';
    elements.topbarTitle.textContent = state.entryTitle || state.draft.site.title || 'Untitled website';
    elements.topbarDescription.textContent = sourceDesign
      ? `Editing a company-specific website built from ${sourceDesign.title}.`
      : 'Editing a company-specific website draft.';
    elements.viewportSwitcher.hidden = false;
    renderTopbarActions();
    return;
  }

  const entries = getWorkspaceEntries();
  const selectedDesign = getSelectedBuildDesign();

  elements.viewportSwitcher.hidden = true;
  elements.topbarEyebrow.textContent = 'Workspace';

  if (state.workspaceView === 'build') {
    elements.topbarTitle.textContent = 'Build website';
    elements.topbarDescription.textContent = selectedDesign
      ? `Selected design: ${selectedDesign.title}. Building creates a website draft in My websites, ready to open in the editor.`
      : 'Select a reusable design first. Building creates a website draft in My websites, ready to open in the editor.';
    renderTopbarActions();
    return;
  }

  const viewIsWebsites = state.workspaceView === 'websites';
  elements.topbarTitle.textContent = viewIsWebsites ? 'My websites' : 'Design library';
  elements.topbarDescription.textContent = viewIsWebsites
    ? `${entries.length} saved website${entries.length === 1 ? '' : 's'} ready for company-specific iteration.`
    : `${entries.length} reusable design${entries.length === 1 ? '' : 's'} created by Claude Design and available for later reuse.`;
  renderTopbarActions();
}

function openWebsiteEditor(entry) {
  replaceSession(createSessionFromEntry(entry));
  setWorkspaceView('editor');
  state.activeTargetId = '';
  state.expandedSections = new Set();
  renderAll({ resetPreviewScroll: true });
  updateStatus(`Opened ${entry.title} in the editor.`, 'success');
}

function selectDesignForBuild(entry) {
  state.selectedBuildDesignId = entry.id;
  setWorkspaceView('build');
  renderAll();
  updateStatus(`Selected ${entry.title} for website building.`, 'success');
}

async function buildSelectedDesign() {
  const selectedDesign = getSelectedBuildDesign();
  if (!selectedDesign) {
    updateStatus('No reusable design is selected for building.');
    return;
  }

  const result = buildWebsiteFromDesign(state.library, selectedDesign);
  replaceLibrary(result.library);
  saveLibrary(state.library);
  state.selectedBuildDesignId = selectedDesign.id;
  setWorkspaceView('websites');
  renderAll();
  updateStatus(`Built ${result.entry.title} from ${selectedDesign.title}. Syncing the website draft...`, 'success');

  const persistenceResult = await persistLibraryEntry('website', result.entry);
  replaceLibrary(persistenceResult.library, {
    persistenceMode: persistenceResult.persistenceMode,
  });
  renderAll();
  updateStatus(
    `Built ${result.entry.title} from ${selectedDesign.title}. ${describePersistenceMode(persistenceResult.persistenceMode)}`,
    'success'
  );
}

function renderOverview() {
  if (isEditorView()) {
    return;
  }

  const entries = state.workspaceView === 'build' ? state.library.designs : getWorkspaceEntries();

  if (state.workspaceView === 'build') {
    elements.overviewGrid.innerHTML = renderBuildSelectionContent({
      entries,
      selectedDesignId: getSelectedBuildDesign()?.id || '',
      renderTemplate,
      getTemplateName: (templateId) => getTemplateById(templateId).name,
    });

    elements.overviewGrid.querySelectorAll('[data-build-action]').forEach((button) => {
      const entryId = button.dataset.entryId || '';
      const entry = getDesignById(entryId);

      if (!entry) {
        return;
      }

      button.addEventListener('click', () => {
        const action = button.dataset.buildAction;

        if (action === 'select') {
          state.selectedBuildDesignId = entry.id;
          renderAll();
          updateStatus(`Selected ${entry.title} for website building.`, 'success');
          return;
        }

        if (action === 'preview') {
          openStandalonePreview('entry', 'design', entry.id);
        }
      });
    });

    return;
  }

  elements.overviewGrid.innerHTML = renderOverviewContent({
    view: state.workspaceView,
    entries,
    renderTemplate,
    getTemplateName: (templateId) => getTemplateById(templateId).name,
    getSourceDesignTitle: (designId) => getDesignById(designId)?.title || '',
  });

  elements.overviewGrid.querySelectorAll('[data-card-action]').forEach((button) => {
    const entryId = button.dataset.entryId || '';
    const entryKind = button.dataset.entryKind === 'website' ? 'website' : 'design';
    const entry = getEntryById(state.library, entryKind, entryId);

    if (!entry) {
      return;
    }

    button.addEventListener('click', () => {
      const action = button.dataset.cardAction;

      if (action === 'edit' && entry.kind === 'website') {
        openWebsiteEditor(entry);
        return;
      }

      if (action === 'preview') {
        openStandalonePreview('entry', entry.kind, entry.id);
        return;
      }

      if (action === 'choose-for-build' && entry.kind === 'design') {
        selectDesignForBuild(entry);
      }
    });
  });
}

function renderLayoutVisibility() {
  const showEditor = isEditorView();
  document.body.classList.toggle('website-builder-editor-mode', showEditor);

  elements.entryMetaPanel.hidden = !showEditor;
  elements.templatePanel.hidden = !showEditor;
  elements.controlsPanel.hidden = !showEditor;
  elements.editorPanel.hidden = !showEditor;
  elements.previewStage.hidden = !showEditor;
  elements.overviewStage.hidden = showEditor;
}

function exportDraft() {
  const blob = new Blob([JSON.stringify(state.draft, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'orion-website-builder-draft.json';
  link.click();
  URL.revokeObjectURL(url);
}

function importDraft(file) {
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || '{}'));
      state.draft = hydrateDraft(parsed);
      state.activeTargetId = '';
      state.expandedSections = new Set();
      persistSessionState();
      renderAll({ resetPreviewScroll: true });
      updateStatus('Draft imported into the current website session.', 'success');
    } catch {
      updateStatus('Import failed. The selected file is not valid Website Builder JSON.');
    }
  };
  reader.readAsText(file);
}

function findEditorNode(targetId) {
  return elements.editorSections.querySelector(`[data-editor-target-id="${CSS.escape(targetId)}"]`);
}

function scrollIntoEditorView(node, sectionId, targetId = '') {
  if (sectionId && !state.expandedSections.has(sectionId)) {
    state.expandedSections.add(sectionId);
    renderEditor();
    node = targetId ? findEditorNode(targetId) : node;
  }

  const targetNode = node || elements.editorSections.querySelector(`[data-section-id="${CSS.escape(sectionId)}"]`);
  targetNode?.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  });
}

function findPreviewNode(targetId) {
  return elements.previewRoot.querySelector(`[data-preview-target-id="${CSS.escape(targetId)}"]`);
}

function scrollPreviewNodeIntoView(node) {
  if (!node) {
    return;
  }

  const frameRect = elements.previewFrame.getBoundingClientRect();
  const targetRect = node.getBoundingClientRect();
  const offset = targetRect.top - frameRect.top - 36;

  elements.previewFrame.scrollTo({
    top: Math.max(0, elements.previewFrame.scrollTop + offset),
    behavior: 'smooth',
  });
}

function activateTarget(targetId) {
  state.activeTargetId = targetId || '';
  applyActiveTargetClasses();
}

function handleEditorSelection(targetId) {
  if (!targetId) {
    return;
  }

  activateTarget(targetId);
  scrollPreviewNodeIntoView(findPreviewNode(targetId));
}

function handlePreviewSelection(targetId, sectionId = '') {
  if (!targetId) {
    return;
  }

  activateTarget(targetId);
  scrollIntoEditorView(
    findEditorNode(targetId),
    sectionId || getFieldByPath(targetId)?.sectionId || '',
    targetId
  );
}

function applyActiveTargetClasses() {
  elements.previewRoot
    .querySelectorAll('.preview-target.is-active')
    .forEach((node) => node.classList.remove('is-active'));
  elements.editorSections
    .querySelectorAll('[data-editor-target-id].is-active')
    .forEach((node) => node.classList.remove('is-active'));

  if (!state.activeTargetId) {
    return;
  }

  findPreviewNode(state.activeTargetId)?.classList.add('is-active');
  findEditorNode(state.activeTargetId)?.classList.add('is-active');
}

function bindPreviewEvents() {
  elements.previewRoot.querySelectorAll('[data-nav-anchor]').forEach((anchor) => {
    anchor.addEventListener('click', (event) => {
      event.preventDefault();

      const targetId = anchor.dataset.navTargetId || '';
      const sectionId = anchor.dataset.navSection || '';
      const previewAnchorId = anchor.dataset.navAnchor || '';
      activateTarget(targetId);
      handlePreviewSelection(targetId, sectionId);

      const sectionNode = elements.previewRoot.querySelector(`#${CSS.escape(previewAnchorId)}`);
      scrollPreviewNodeIntoView(sectionNode);
    });
  });

  elements.previewRoot.querySelectorAll('[data-preview-target-id]').forEach((node) => {
    node.addEventListener('click', (event) => {
      const targetNode = event.currentTarget;
      handlePreviewSelection(
        targetNode.dataset.previewTargetId || '',
        targetNode.dataset.editorSection || ''
      );
    });
  });
}

async function saveCurrentWebsite() {
  const result = saveEntryFromSession(state.library, getCurrentSession(), 'website');
  replaceLibrary(result.library);
  saveLibrary(state.library);
  replaceSession(result.session);
  renderAll();
  updateStatus(`Saved ${result.entry.title} to My websites. Syncing the latest draft...`, 'success');

  const persistenceResult = await persistLibraryEntry('website', result.entry);
  replaceLibrary(persistenceResult.library, {
    persistenceMode: persistenceResult.persistenceMode,
  });
  renderAll();
  updateStatus(
    `Saved ${result.entry.title} to My websites. ${describePersistenceMode(persistenceResult.persistenceMode)}`,
    'success'
  );
}

async function syncLibraryFromPersistence() {
  const persistenceResult = await loadPersistedLibrary();
  replaceLibrary(persistenceResult.library, {
    persistenceMode: persistenceResult.persistenceMode,
  });
  renderAll();
}

function bindWorkspaceEvents() {
  elements.workspaceTabs.querySelectorAll('[data-workspace-view]').forEach((button) => {
    button.addEventListener('click', () => {
      setWorkspaceView(button.dataset.workspaceView || 'designs');
      renderAll();
    });
  });

  elements.entryTitleInput.addEventListener('input', () => {
    state.entryTitle = elements.entryTitleInput.value.trim();
    persistSessionState();
    renderTopbar();
  });

  elements.entryCompanyNameInput.addEventListener('input', () => {
    state.companyName = elements.entryCompanyNameInput.value.trim();
    persistSessionState();
    renderTopbar();
  });

  elements.entrySummaryInput.addEventListener('input', () => {
    state.summary = elements.entrySummaryInput.value.trim();
    persistSessionState();
  });

  elements.saveWebsiteButton.addEventListener('click', () => {
    void saveCurrentWebsite();
  });

  elements.openPreviewButton.addEventListener('click', () => {
    openStandalonePreview('session');
  });

  elements.resetDraftButton.addEventListener('click', () => {
    replaceSession(resetSession(getCurrentSession()));
    state.activeTargetId = '';
    state.expandedSections = new Set();
    renderAll({ resetPreviewScroll: true });
    updateStatus('Reset the current website session to its template seed.', 'success');
  });

  elements.exportDraftButton.addEventListener('click', exportDraft);
  elements.importDraftInput.addEventListener('change', (event) => {
    importDraft(event.target.files?.[0] || null);
  });

  document.querySelectorAll('[data-viewport]').forEach((button) => {
    button.addEventListener('click', () => {
      state.viewport = button.dataset.viewport || 'desktop';
      renderPreview();
      renderViewportButtons();
    });
  });
}

function renderAll({ resetPreviewScroll = false } = {}) {
  renderWorkspaceTabs();
  renderTopbar();
  renderLayoutVisibility();

  if (isEditorView()) {
    renderEntryMetaPanel();
    renderTemplateGrid();
    renderEditor();
    renderPreview({ resetScroll: resetPreviewScroll });
    renderViewportButtons();
    return;
  }

  teardownPreviewMotion();
  renderOverview();
}

bindWorkspaceEvents();
renderAll({ resetPreviewScroll: true });
void syncLibraryFromPersistence();
