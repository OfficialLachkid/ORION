import { z } from 'zod';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export const ItchThemeDesignSchema = z.object({
  colors: z.object({
    background: z.string().regex(/^#[0-9a-f]{6}$/iu),
    panel: z.string().regex(/^#[0-9a-f]{6}$/iu),
    text: z.string().regex(/^#[0-9a-f]{6}$/iu),
    link: z.string().regex(/^#[0-9a-f]{6}$/iu),
    header: z.string().regex(/^#[0-9a-f]{6}$/iu),
    button: z.string().regex(/^#[0-9a-f]{6}$/iu),
  }),
  panel_alpha: z.number().min(0.82).max(1),
  typography: z.object({
    body_font: z.enum(['Lato', 'Sans Serif', 'Anonymous Pro', 'Serif']),
    header_font: z.enum(['Default font', 'Pixel', 'Lato', 'Sans Serif', 'Anonymous Pro', 'Serif']),
    size: z.enum(['Medium', 'Large', 'Very Large']),
  }),
  screenshots: z.literal('Sidebar'),
  rationale: z.string().min(1).max(600),
}).strict();

const THEME_FORMAT = {
  type: 'object',
  additionalProperties: false,
  required: ['colors', 'panel_alpha', 'typography', 'screenshots', 'rationale'],
  properties: {
    colors: {
      type: 'object',
      additionalProperties: false,
      required: ['background', 'panel', 'text', 'link', 'header', 'button'],
      properties: Object.fromEntries(
        ['background', 'panel', 'text', 'link', 'header', 'button']
          .map((key) => [key, { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' }]),
      ),
    },
    panel_alpha: { type: 'number', minimum: 0.82, maximum: 1 },
    typography: {
      type: 'object',
      additionalProperties: false,
      required: ['body_font', 'header_font', 'size'],
      properties: {
        body_font: { enum: ['Lato', 'Sans Serif', 'Anonymous Pro', 'Serif'] },
        header_font: { enum: ['Default font', 'Pixel', 'Lato', 'Sans Serif', 'Anonymous Pro', 'Serif'] },
        size: { enum: ['Medium', 'Large', 'Very Large'] },
      },
    },
    screenshots: { const: 'Sidebar' },
    rationale: { type: 'string', minLength: 1, maxLength: 600 },
  },
};

function normalizeEndpoint(endpoint) {
  const url = new URL(String(endpoint || 'http://127.0.0.1:11434'));
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error('Theme generation must use the local Ollama endpoint; cloud fallback is disabled.');
  }
  return url.toString().replace(/\/$/u, '');
}

function channel(value) {
  const normalized = String(value).replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255);
}

function luminance(color) {
  return channel(color)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    .reduce((sum, value, index) => sum + (value * [0.2126, 0.7152, 0.0722][index]), 0);
}

export function contrastRatio(left, right) {
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

export function validateThemeContrast(design) {
  const failures = [];
  if (contrastRatio(design.colors.text, design.colors.panel) < 4.5) failures.push('text/panel');
  if (contrastRatio(design.colors.header, design.colors.panel) < 4.5) failures.push('header/panel');
  if (contrastRatio(design.colors.link, design.colors.panel) < 3) failures.push('link/panel');
  if (contrastRatio('#ffffff', design.colors.button) < 3) failures.push('white/button');
  if (failures.length) {
    throw new Error(`Local theme proposal failed contrast requirements: ${failures.join(', ')}.`);
  }
  return design;
}

function hexFromChannels(channels) {
  return `#${channels
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'))
    .join('')}`;
}

function mixColor(source, target, amount) {
  const sourceChannels = channel(source).map((value) => value * 255);
  const targetChannels = channel(target).map((value) => value * 255);
  return hexFromChannels(sourceChannels.map((value, index) => (
    value + ((targetChannels[index] - value) * amount)
  )));
}

function closestReadableColor(foreground, background, minimumRatio) {
  if (contrastRatio(foreground, background) >= minimumRatio) return foreground.toLowerCase();
  for (let step = 1; step <= 20; step += 1) {
    const amount = step / 20;
    const candidates = [mixColor(foreground, '#ffffff', amount), mixColor(foreground, '#000000', amount)];
    const readable = candidates.filter((candidate) => contrastRatio(candidate, background) >= minimumRatio);
    if (readable.length) {
      return readable.sort((left, right) => (
        contrastRatio(right, background) - contrastRatio(left, background)
      ))[0];
    }
  }
  return contrastRatio('#ffffff', background) >= minimumRatio ? '#ffffff' : '#000000';
}

export function repairThemeContrast(input) {
  const design = structuredClone(input);
  const adjustments = [];
  const replace = (key, background, minimumRatio) => {
    const original = design.colors[key];
    const repaired = closestReadableColor(original, background, minimumRatio);
    if (repaired !== original.toLowerCase()) {
      design.colors[key] = repaired;
      adjustments.push({ field: key, from: original.toLowerCase(), to: repaired, minimum_ratio: minimumRatio });
    }
  };
  replace('text', design.colors.panel, 4.5);
  replace('header', design.colors.panel, 4.5);
  replace('link', design.colors.panel, 3);
  replace('button', '#ffffff', 3);
  if (adjustments.length) {
    const suffix = ' Contrast was adjusted deterministically for storefront readability.';
    design.rationale = `${design.rationale.replace(/\s+$/u, '')}${suffix}`.slice(0, 600);
  }
  return { design: validateThemeContrast(design), adjustments };
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

export class OllamaThemeAdapter {
  constructor(options = {}) {
    this.endpoint = normalizeEndpoint(options.endpoint);
    this.model = String(options.model || 'llama3.1:8b');
    this.timeoutMs = Number(options.timeoutMs) || 120_000;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  async propose({ product, listing, revision = null }) {
    const prompt = [
      `Product: ${product.title}`,
      `Product theme: ${product.theme}`,
      `Product type: ${product.product_type}`,
      `Approved palette: ${product.style.palette.join(', ')}`,
      `Short description: ${listing.short_description}`,
      ...(revision ? [
        '',
        `Theme revision: ${revision.number}`,
        `Previous built-in theme: ${JSON.stringify(revision.previous_design)}`,
        `Binding human feedback: ${revision.feedback}`,
        'Return a visibly revised design that directly resolves the feedback while retaining unaffected strengths.',
        'Do not repeat the previous design unchanged, and do not introduce white or unthemed surfaces unless the feedback explicitly requests them.',
      ] : []),
      '',
      'Design a polished itch.io built-in theme for this exact product.',
      'Derive the visual direction from this product theme, type, approved palette, and description.',
      'Do not reuse science-fiction, fantasy, nature, cartoon, industrial, or other genre conventions unless this product supports them.',
      'Choose a restrained background, readable content panel, clear information accent, and distinct purchase-button accent.',
      'Prefer Lato for body text and select the clearest allowed heading font for this product.',
      'Maintain accessible contrast, keep screenshots in the sidebar, and do not propose CSS or new product artwork.',
    ].join('\n');
    const response = await fetchWithTimeout(this.fetchImpl, `${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: THEME_FORMAT,
        options: { temperature: 0.2, seed: 146 },
        messages: [
          {
            role: 'system',
            content: 'You are ORION storefront art director. Return only the requested JSON. Never invent included assets.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    }, this.timeoutMs);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Local Ollama theme generation failed with HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error('Local Ollama theme generation returned invalid JSON.');
    }
    let design;
    try {
      design = ItchThemeDesignSchema.parse(JSON.parse(payload.message?.content || ''));
    } catch (error) {
      throw new Error(`Local Ollama theme proposal did not match the required schema: ${error.message}`);
    }
    const repaired = repairThemeContrast(design);
    return {
      design: repaired.design,
      contrast_adjustments: repaired.adjustments,
      provider: 'ollama',
      model: this.model,
      execution: 'local',
      estimated_cost: 0,
      created_at: payload.created_at || new Date().toISOString(),
    };
  }
}
