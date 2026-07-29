function normalize(value) {
  return String(value || '').trim();
}

export function resolveCiRefContext(input = {}) {
  const eventName = normalize(input.eventName);
  const fallbackRef = normalize(input.refName) || 'unknown';
  const headRef = normalize(input.headRef);
  const baseRef = normalize(input.baseRef);
  const isPullRequest = eventName === 'pull_request' && headRef && baseRef;

  if (isPullRequest) {
    return {
      displayRef: `${headRef} -> ${baseRef}`,
      sourceBranch: headRef,
      targetBranch: baseRef,
      rawRef: fallbackRef,
    };
  }

  return {
    displayRef: fallbackRef,
    sourceBranch: fallbackRef,
    targetBranch: '',
    rawRef: fallbackRef,
  };
}
