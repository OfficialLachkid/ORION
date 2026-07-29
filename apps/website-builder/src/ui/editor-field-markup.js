import { escapeHtml } from './workspace-markup.js';

function renderPositionMatrixField(field, value) {
  return `
    <fieldset class="field position-matrix-field" data-editor-target-id="${field.path}">
      <legend>${field.label}</legend>
      ${field.description ? `<p class="field-help">${field.description}</p>` : ''}
      <div class="position-matrix-grid">
        ${field.options.map((option) => `
          <button
            type="button"
            class="position-matrix-button ${value === option.value ? 'is-selected' : ''}"
            data-position-path="${field.path}"
            data-position-value="${option.value}"
            aria-label="${option.label}"
            title="${option.label}"
          >
            <span class="position-matrix-button-frame" aria-hidden="true">
              <span class="position-matrix-button-dot"></span>
            </span>
          </button>
        `).join('')}
      </div>
    </fieldset>
  `;
}

export function renderEditorField(field, value, source = 'editor') {
  const fieldId = `${source}-${field.path.replaceAll('.', '-')}`;

  if (field.type === 'position-matrix') {
    return renderPositionMatrixField(field, String(value || ''));
  }

  if (field.type === 'textarea') {
    return `
      <label class="field" data-editor-target-id="${field.path}">
        <span>${field.label}</span>
        ${field.description ? `<small class="field-help">${field.description}</small>` : ''}
        <textarea id="${fieldId}" data-path="${field.path}" rows="4">${escapeHtml(value || '')}</textarea>
      </label>
    `;
  }

  if (field.type === 'checkbox') {
    return `
      <label class="checkbox-field" data-editor-target-id="${field.path}">
        <input id="${fieldId}" data-path="${field.path}" type="checkbox" ${value ? 'checked' : ''} />
        <span>${field.label}</span>
        ${field.description ? `<small class="field-help">${field.description}</small>` : ''}
      </label>
    `;
  }

  return `
    <label class="field" data-editor-target-id="${field.path}">
      <span>${field.label}</span>
      ${field.description ? `<small class="field-help">${field.description}</small>` : ''}
      <input
        id="${fieldId}"
        data-path="${field.path}"
        type="${field.type === 'color' ? 'color' : field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text'}"
        value="${escapeHtml(value || '')}"
      />
    </label>
  `;
}
