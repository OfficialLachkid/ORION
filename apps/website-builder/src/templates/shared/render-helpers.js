export function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function escapeAttribute(value) {
  return escapeHtml(value);
}

export function buildTargetAttributes(targetId, sectionId, className = 'preview-target') {
  return [
    `class="${escapeAttribute(className)}"`,
    `data-preview-target-id="${escapeAttribute(targetId)}"`,
    `data-editor-section="${escapeAttribute(sectionId)}"`,
  ].join(' ');
}

export function buildRevealAttributes(delayMs) {
  return `data-scroll-reveal="true" style="--scroll-reveal-delay:${Number(delayMs) || 0}ms;"`;
}
