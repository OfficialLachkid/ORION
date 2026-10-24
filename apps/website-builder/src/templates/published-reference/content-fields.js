function fieldSelector(key) {
  return `[data-builder-field="${key}"]`;
}

function linkSelector(key) {
  return `[data-builder-link="${key}"]`;
}

export function textField(key, label, value, options = {}) {
  return {
    key,
    label,
    value,
    type: options.type || 'text',
    description: options.description || '',
    previewSelector: options.previewSelector,
    targets: options.targets || [
      { selector: fieldSelector(key) },
      ...(options.additionalTargets || []),
    ],
  };
}

export function imageField(key, label, value, options = {}) {
  return textField(key, label, value, {
    ...options,
    type: 'url',
    targets: [
      { selector: fieldSelector(key), attribute: 'src' },
      ...(options.additionalTargets || []),
    ],
  });
}

export function linkField(key, label, value, options = {}) {
  const prefix = options.prefix || '';
  return textField(key, label, value, {
    ...options,
    additionalTargets: [
      { selector: linkSelector(key), attribute: 'href', prefix },
      ...(options.additionalTargets || []),
    ],
  });
}
