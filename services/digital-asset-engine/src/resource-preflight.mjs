async function fetchJsonWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function inspectGenerationResources(config, options = {}) {
  const endpoint = new URL(config.generation.endpoint);
  const reasons = [];
  try {
    const payload = await fetchJsonWithTimeout(
      options.fetchImpl || globalThis.fetch,
      new URL('/api/ps', endpoint).toString(),
      options.timeoutMs || 5_000,
    );
    const loaded = (payload.models || []).map((model) => model.name || model.model).filter(Boolean);
    const conflicting = loaded.filter((model) => model !== config.generation.model);
    if (conflicting.length > 0) reasons.push(`ollama_models_loaded=${conflicting.join(',')}`);
  } catch (error) {
    reasons.push(`ollama_ps_unavailable=${error.message}`);
  }
  return {
    status: reasons.length === 0 ? 'ready' : 'deferred',
    reasons,
    checked_at: options.checkedAt || new Date().toISOString(),
  };
}

export async function assertGenerationResourcesAvailable(config, options = {}) {
  const report = await inspectGenerationResources(config, options);
  if (report.status !== 'ready') {
    const error = new Error(`[RUNTIME_RESOURCE_BUSY] Digital asset generation deferred: ${report.reasons.join('; ')}`);
    error.code = 'RUNTIME_RESOURCE_BUSY';
    error.report = report;
    throw error;
  }
  return report;
}
