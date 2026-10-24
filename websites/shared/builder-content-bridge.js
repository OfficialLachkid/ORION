const CONTENT_MESSAGE = 'orion:website-builder-content';
const NAVIGATE_MESSAGE = 'orion:website-builder-navigate';
const READY_MESSAGE = 'orion:website-builder-ready';
const SELECTION_MESSAGE = 'orion:website-builder-selection';

function isAllowedBuilderOrigin(origin) {
  if (origin === 'https://officiallachkid.github.io') {
    return true;
  }

  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function applyOperation(operation) {
  if (!operation?.selector) {
    return;
  }

  document.querySelectorAll(operation.selector).forEach((node) => {
    const value = `${operation.prefix || ''}${String(operation.value ?? '')}`;
    if (operation.attribute) {
      if (node.getAttribute(operation.attribute) !== value) {
        node.setAttribute(operation.attribute, value);
      }
      return;
    }

    if (node.textContent !== value) {
      node.textContent = value;
    }
  });
}

export function installWebsiteBuilderContentBridge() {
  if (globalThis.parent === globalThis) {
    return () => {};
  }

  let latestOperations = [];
  let applyScheduled = false;

  const applyLatestOperations = () => {
    applyScheduled = false;
    latestOperations.forEach(applyOperation);
  };

  const scheduleApply = () => {
    if (applyScheduled || latestOperations.length === 0) {
      return;
    }

    applyScheduled = true;
    queueMicrotask(applyLatestOperations);
  };

  const handleMessage = (event) => {
    if (!isAllowedBuilderOrigin(event.origin)) {
      return;
    }

    if (event.data?.type === CONTENT_MESSAGE && Array.isArray(event.data.operations)) {
      latestOperations = event.data.operations;
      applyLatestOperations();
      return;
    }

    if (event.data?.type === NAVIGATE_MESSAGE && event.data.selector) {
      document.querySelector(event.data.selector)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleClick = (event) => {
    const editableNode = event.target?.closest?.('[data-builder-field]');
    const fieldKey = editableNode?.dataset?.builderField;
    if (fieldKey) {
      globalThis.parent.postMessage({ type: SELECTION_MESSAGE, fieldKey }, '*');
    }
  };

  const observer = new MutationObserver(scheduleApply);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  globalThis.addEventListener('message', handleMessage);
  document.addEventListener('click', handleClick, true);
  globalThis.parent.postMessage({ type: READY_MESSAGE }, '*');

  return () => {
    observer.disconnect();
    globalThis.removeEventListener('message', handleMessage);
    document.removeEventListener('click', handleClick, true);
  };
}
