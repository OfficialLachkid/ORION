const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function normalizeEndpoint(endpoint, requireLocal) {
  const url = new URL(endpoint);
  if (requireLocal && !LOCAL_HOSTS.has(url.hostname)) {
    throw new Error('Ollama image generation must use a local endpoint; cloud fallback is disabled.');
  }
  return url.toString().replace(/\/$/u, '');
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parseImageResponse(text) {
  const payloads = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const payload = [...payloads].reverse().find((item) => item.image);
  if (!payload?.image || typeof payload.image !== 'string') {
    const error = payloads.find((item) => item.error)?.error;
    throw new Error(error ? `Ollama image generation failed: ${error}` : 'Ollama returned no image.');
  }
  return payload;
}

function assertSupportedImage(buffer) {
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (!png && !jpeg) throw new Error('Ollama returned an unsupported or corrupt image payload.');
  return png ? 'png' : 'jpeg';
}

export class OllamaImageAdapter {
  constructor(config, options = {}) {
    this.name = 'ollama';
    this.model = config.model;
    this.endpoint = normalizeEndpoint(config.endpoint, config.require_local_endpoint);
    this.timeoutMs = options.timeoutMs || config.timeout_ms;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.steps = config.steps;
    this.keepAlive = config.keep_alive;
    this.negativePrompt = config.negative_prompt;
  }

  async checkReadiness() {
    try {
      const response = await fetchWithTimeout(
        this.fetchImpl,
        `${this.endpoint}/api/tags`,
        {},
        Math.min(this.timeoutMs, 5_000),
      );
      if (!response.ok) return { status: 'blocked', detail: `Ollama returned HTTP ${response.status}.` };
      const payload = await response.json();
      const installed = (payload.models || []).flatMap((model) => [model.name, model.model]);
      return installed.includes(this.model)
        ? { status: 'ready', detail: `${this.model} is installed locally.` }
        : { status: 'blocked', detail: `${this.model} is not installed.` };
    } catch (error) {
      return { status: 'blocked', detail: `Ollama is unavailable: ${error.message}` };
    }
  }

  async generateAsset({ asset, sourceWidth, sourceHeight }) {
    const response = await fetchWithTimeout(this.fetchImpl, `${this.endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: asset.generation_prompt,
        stream: false,
        width: sourceWidth,
        height: sourceHeight,
        steps: this.steps,
        seed: asset.seed,
        negative: this.negativePrompt,
        keep_alive: this.keepAlive,
      }),
    }, this.timeoutMs);

    const text = await response.text();
    if (!response.ok) {
      let detail = text.slice(0, 300);
      try { detail = JSON.parse(text).error || detail; } catch { /* keep response text */ }
      throw new Error(`Ollama image generation failed with HTTP ${response.status}: ${detail}`);
    }

    const payload = parseImageResponse(text);
    const buffer = Buffer.from(payload.image, 'base64');
    const format = assertSupportedImage(buffer);
    return {
      buffer,
      format,
      provider: this.name,
      model: this.model,
      seed: asset.seed,
      estimated_cost: 0,
      execution: 'local',
      created_at: payload.created_at || new Date().toISOString(),
    };
  }
}
