export const HERO_ALIGNMENT_OPTIONS = Object.freeze([
  { value: 'top-left', label: 'Top left' },
  { value: 'top-center', label: 'Top center' },
  { value: 'top-right', label: 'Top right' },
  { value: 'center-left', label: 'Center left' },
  { value: 'center', label: 'Center' },
  { value: 'center-right', label: 'Center right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-center', label: 'Bottom center' },
  { value: 'bottom-right', label: 'Bottom right' },
]);

export const createField = (label, path, type = 'text', extra = {}) => ({
  label,
  path,
  type,
  ...extra,
});

export const createTextField = (label, path, extra = {}) => createField(label, path, 'text', extra);
export const createTextAreaField = (label, path, extra = {}) =>
  createField(label, path, 'textarea', extra);
export const createToggleField = (label, path, extra = {}) =>
  createField(label, path, 'checkbox', extra);
export const createUrlField = (label, path, extra = {}) => createField(label, path, 'url', extra);
export const createEmailField = (label, path, extra = {}) =>
  createField(label, path, 'email', extra);
export const createColorField = (label, path, extra = {}) =>
  createField(label, path, 'color', extra);
