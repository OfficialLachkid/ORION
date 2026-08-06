import { getValueByPath } from '../lib/draft.js';

const CONTENT_MESSAGE = 'orion:website-builder-content';
const NAVIGATE_MESSAGE = 'orion:website-builder-navigate';
const READY_MESSAGE = 'orion:website-builder-ready';
const SELECTION_MESSAGE = 'orion:website-builder-selection';

function getTargetOrigin(previewUrl) {
  try {
    return new URL(previewUrl, globalThis.location.href).origin;
  } catch {
    return '*';
  }
}

function buildOperations(draft, bindings) {
  return Object.entries(bindings || {}).flatMap(([path, targets]) => {
    const value = getValueByPath(draft, path);
    return targets.map((target) => ({ ...target, value }));
  });
}

export function syncPublishedReferenceFrame(root, draft, template) {
  const frame = root.querySelector('.reference-preview-frame');
  if (!frame || !template?.referenceBindings) {
    return false;
  }

  frame.contentWindow?.postMessage(
    {
      type: CONTENT_MESSAGE,
      operations: buildOperations(draft, template.referenceBindings),
    },
    getTargetOrigin(frame.src)
  );
  return true;
}

export function setupPublishedReferenceFrame(root, draft, template, options = {}) {
  const frame = root.querySelector('.reference-preview-frame');
  if (!frame || !template?.referenceBindings) {
    return null;
  }

  const currentTargetOrigin = () => getTargetOrigin(frame.src);
  const send = (message) => frame.contentWindow?.postMessage(message, currentTargetOrigin());
  const sync = (nextDraft) => syncPublishedReferenceFrame(root, nextDraft, template);
  const navigate = (targetId) => {
    const selector = template.referenceNavigation?.[targetId];
    if (!selector) {
      return false;
    }

    send({ type: NAVIGATE_MESSAGE, selector });
    return true;
  };
  const handleMessage = (event) => {
    const targetOrigin = currentTargetOrigin();
    if (event.source !== frame.contentWindow || (targetOrigin !== '*' && event.origin !== targetOrigin)) {
      return;
    }

    if (event.data?.type === READY_MESSAGE) {
      sync(draft);
      return;
    }

    if (event.data?.type === SELECTION_MESSAGE) {
      const path = template.referenceSelectionPaths?.[event.data.fieldKey];
      if (path) {
        options.onSelect?.(path);
      }
    }
  };
  const handleLoad = () => {
    const fallbackUrl = frame.dataset.fallbackSrc;
    const isLocalFrame = getTargetOrigin(frame.src) === globalThis.location.origin;
    let loadFailed = false;

    if (isLocalFrame && !frame.dataset.fallbackApplied) {
      try {
        const bodyText = frame.contentDocument?.body?.textContent?.trim() || '';
        loadFailed = /^(Cannot GET|Not found)\b/i.test(bodyText);
      } catch {
        loadFailed = false;
      }
    }

    if (loadFailed && fallbackUrl && fallbackUrl !== frame.src) {
      frame.dataset.fallbackApplied = 'true';
      frame.src = fallbackUrl;
      return;
    }

    sync(draft);
  };

  frame.addEventListener('load', handleLoad);
  globalThis.addEventListener('message', handleMessage);

  return {
    sync,
    navigate,
    teardown() {
      frame.removeEventListener('load', handleLoad);
      globalThis.removeEventListener('message', handleMessage);
    },
  };
}
