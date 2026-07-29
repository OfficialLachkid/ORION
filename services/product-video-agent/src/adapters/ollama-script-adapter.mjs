import { createStableId } from '../ids.mjs';
import { ScriptVariantSchema } from '../schemas.mjs';

const SCRIPT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    hook: { type: 'string' },
    body: { type: 'string' },
    closing_line: { type: 'string' },
  },
  required: ['hook', 'body', 'closing_line'],
  additionalProperties: false,
};

const UNSUPPORTED_MARKETING_PATTERNS = [
  { pattern: /\b(our|we|us)\b/iu, issue: 'first-person brand affiliation' },
  { pattern: /\b(?:meet|introducing|introduce)\s+(?:the|this)\b/iu, issue: 'advertorial product introduction' },
  { pattern: /\b(?:buy now|get yours|shop now|check it out|learn more)\b/iu, issue: 'purchase-oriented call to action' },
  { pattern: /\b(?:comment|follow|subscribe|tell us|let us know)\b/iu, issue: 'generic engagement bait' },
  { pattern: /\b(?:perfect|ultimate|must-have|ideal|immersive|effortless(?:ly)?|effective(?:ly)?|efficient(?:ly)?|convenient)\b/iu, issue: 'promotional adjective or superlative' },
  { pattern: /\bversatile tool\b/iu, issue: 'generic promotional description' },
  { pattern: /\b(?:cleaning solution|tough messes|now easier)\b/iu, issue: 'advertorial benefit framing' },
  { pattern: /\bwatch as\b/iu, issue: 'advertorial demonstration cue' },
  { pattern: /\b(?:now you can|you can now|easily)\b/iu, issue: 'viewer-directed promotional framing' },
  { pattern: /\b(?:instantly|immediately)\b/iu, issue: 'unverified speed or instant-result claim' },
  { pattern: /\b(?:without gaps?|gap-free|clear audio separation)\b/iu, issue: 'unverified performance outcome' },
  { pattern: /\b(?:the user|you)\s+blows?\s+into\b/iu, issue: 'invented user action' },
  { pattern: /\bwithout (?:extra )?(?:wires|adapters)\b/iu, issue: 'unsupported accessory or setup claim' },
  { pattern: /\bwithout being tied down by cables\b/iu, issue: 'unsupported accessory or setup claim' },
  { pattern: /\b(?:dust|debris)\s+disappears?\b/iu, issue: 'unverified cleaning outcome' },
  { pattern: /\bit(?:'s| is) now possible\b/iu, issue: 'promotional possibility framing' },
  { pattern: /\bmaintaining (?:connection stability|audio separation|audio output)\b/iu, issue: 'unverified performance outcome' },
  { pattern: /\b(?:in|within)\s+(?:a few\s+)?seconds?\b/iu, issue: 'unverified speed or instant-result claim' },
  { pattern: /\b(?:suit(?:s|ed)? your needs|ready to go|optimal|versatile)\b/iu, issue: 'generic promotional wording' },
  { pattern: /\b(?:allows? you|allowing you|enables? you|enabling)\b/iu, issue: 'viewer-directed promotional framing' },
  { pattern: /\b(?:without inventing|inventing capabilities|capabilities like)\b/iu, issue: 'prompt or restriction leakage' },
  { pattern: /\b(?:easy to|making it)\b/iu, issue: 'generic promotional wording' },
];

const GENERIC_ENGAGEMENT_QUESTION = /\b(?:would you|what would you|what else can you|which one would you)\b/iu;
const MAX_GENERATION_ATTEMPTS = 8;

function getLocalEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error('Ollama endpoint must be local for tokenless preview execution.');
  }
  return url.toString().replace(/\/$/u, '');
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = 60_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function buildPrompt(product, scriptJob, revisionIssues = []) {
  const targetWords = Math.round(scriptJob.target_duration_seconds * 2.3);
  const minimumWords = Math.round(targetWords * 0.8);
  const maximumWords = Math.round(targetWords * 1.2);
  return [
    'Create one original editorial short-form product-video script as JSON.',
    `Product category: ${product.category}`,
    `Angle: ${scriptJob.angle}`,
    `Target duration: ${scriptJob.target_duration_seconds} seconds.`,
    `Write ${minimumWords}-${maximumWords} spoken words; aim for approximately ${targetWords}.`,
    `Hook goal: ${scriptJob.creative_brief.hook_goal}`,
    'Supported facts:',
    ...scriptJob.creative_brief.key_facts.map((fact) => `- ${fact}`),
    'Restrictions:',
    ...scriptJob.creative_brief.prohibited_claims.map((claim) => `- ${claim}`),
    ...scriptJob.creative_brief.blocked_phrases.map((phrase) => (
      `- Do not use or paraphrase this unsupported capability: ${phrase}`
    )),
    'Editorial direction:',
    ...scriptJob.creative_brief.editorial_direction.map((direction) => `- ${direction}`),
    '- This is faceless entertainment and useful product discovery, not an advertisement.',
    '- Start directly with the problem, visual behavior, or surprising mechanism.',
    '- Use one short complete grammatical hook sentence with a finite verb, two or three body sentences, and one short closing sentence.',
    '- Never use a headline fragment or bare noun phrase as the hook.',
    '- Do not introduce the item with phrases such as "meet", "introducing", or a marketplace-style product title.',
    `- Do not say the brand or company name "${product.brand}".`,
    '- Treat the product as a third-party item. Never say our, we, or us.',
    '- Every capability, speed, battery-life statement, and cleaning outcome must be directly supported by the facts above.',
    '- Do not invent a demonstration action, product behavior, connection topology, or visible outcome that is absent from the supported facts.',
    '- Preserve measurement relationships exactly. For example, a phone-to-speaker range is not the distance between two speaker halves.',
    '- Never narrate these instructions, restrictions, excluded features, or phrases about inventing or claiming capabilities.',
    '- Omit unknown or unspecified information instead of narrating that it is unknown.',
    '- Do not infer a power source, adapter, port, compatibility, or before-and-after result from a charging connector.',
    '- Open a curiosity gap, show the visual mechanism, and explain a relatable use case.',
    '- Use at most one relatable use case. Write conversationally, with short clauses that sound natural when spoken.',
    '- Do not repeatedly begin sentences with "this device", "this unit", "this product", or "this system".',
    '- Do not use filler such as allows you, enabling, suitable for, versatile, optimal, ready to go, or easy to.',
    '- State each supported fact at most once. The closing must add a final mechanism or honest limitation instead of repeating the hook or body.',
    '- Do not sound like a specification list, product page, sales pitch, or review conclusion.',
    '- Omit model codes, wattage, battery capacity, and secondary specifications unless the editorial direction explicitly requires them.',
    '- Write closing_line as a factual payoff, not a call to action.',
    '- End with a concrete observation, result, limitation, or visual payoff. Do not end with a question.',
    '- Do not address the viewer as "you" in the closing line.',
    '- Use plain descriptive verbs and nouns in the closing line; do not rate or praise the item.',
    '- A closing can connect the mechanism to the problem, such as replacing another disposable air can.',
    '- Never ask viewers whether they would try, buy, use, or rate the item.',
    '- Do not request comments, follows, subscriptions, or other engagement.',
    '- Avoid promotional adjectives such as perfect, ultimate, effective, and effortless.',
    '- Do not use ad cues such as "watch as", "cleaning solution", "tough messes", or "now easier".',
    '- Prioritize the visually demonstrable product mechanism before technical details.',
    ...(revisionIssues.length > 0 ? [
      'Revision required. The previous draft failed these deterministic checks:',
      ...revisionIssues.map((issue) => `- ${issue}`),
      '- Discard the previous draft and rewrite from scratch.',
      '- The standalone words our, we, and us are forbidden anywhere in the rewrite.',
    ] : []),
    'Return only JSON with string fields: hook, body, closing_line.',
    'Do not include or speak an affiliate disclosure; the pipeline stores disclosure metadata separately.',
  ].join('\n');
}

export function findScriptQualityIssues(generated, blockedPhrases = [], product = null) {
  const callToAction = generated.callToAction || generated.closing_line || generated.call_to_action || '';
  const text = `${generated.hook} ${generated.body} ${callToAction}`;
  const patternIssues = UNSUPPORTED_MARKETING_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ issue }) => issue);
  const closingIssues = [
    ...(callToAction.includes('?') ? ['question-style closing line'] : []),
    ...(GENERIC_ENGAGEMENT_QUESTION.test(callToAction) ? ['generic engagement question'] : []),
  ];
  const punctuationIssues = ['hook', 'body']
    .filter((key) => !/[.!?]$/u.test(generated[key]?.trim() || ''))
    .map((key) => `${key} must end with sentence punctuation`);
  if (!/[.!]$/u.test(callToAction.trim())) {
    punctuationIssues.push('closing line must end with sentence punctuation');
  }
  const brandIssue = product?.brand
    && text.toLocaleLowerCase('en-US').includes(product.brand.toLocaleLowerCase('en-US'))
    ? [`brand/company mention: ${product.brand}`]
    : [];
  const blockedPhraseIssues = blockedPhrases
    .filter((phrase) => text.toLocaleLowerCase('en-US').includes(phrase.toLocaleLowerCase('en-US')))
    .map((phrase) => `blocked product claim: ${phrase}`);
  return [...new Set([
    ...patternIssues,
    ...closingIssues,
    ...punctuationIssues,
    ...brandIssue,
    ...blockedPhraseIssues,
  ])];
}

function parseGeneratedPayload(responseText) {
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error('Ollama returned a non-JSON script response.');
  }

  for (const key of ['hook', 'body']) {
    if (typeof payload?.[key] !== 'string' || !payload[key].trim()) {
      throw new Error(`Ollama script response requires a non-empty string field: ${key}.`);
    }
  }
  const closingLine = payload.closing_line || payload.call_to_action;
  if (typeof closingLine !== 'string' || !closingLine.trim()) {
    throw new Error('Ollama script response requires a non-empty string field: closing_line.');
  }

  return {
    hook: payload.hook.trim(),
    body: payload.body.trim(),
    callToAction: closingLine.trim(),
  };
}

export class OllamaScriptAdapter {
  constructor(config, options = {}) {
    this.name = 'ollama';
    this.model = config.model;
    this.keepAlive = config.keep_alive;
    this.thinking = config.thinking === true;
    this.numPredict = config.num_predict || (this.thinking ? 1024 : 350);
    this.endpoint = getLocalEndpoint(config.endpoint);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = options.timeoutMs || 60_000;
  }

  async checkReadiness() {
    try {
      const response = await fetchWithTimeout(
        this.fetchImpl,
        `${this.endpoint}/api/tags`,
        {},
        Math.min(this.timeoutMs, 5_000),
      );
      if (!response.ok) {
        return { status: 'blocked', detail: `Ollama tags request failed with HTTP ${response.status}.` };
      }

      const payload = await response.json();
      const modelNames = (payload.models || []).flatMap((model) => [model.name, model.model]);
      if (!modelNames.includes(this.model)) {
        return { status: 'blocked', detail: `Configured model ${this.model} is not installed.` };
      }

      return { status: 'ready', detail: `Ollama model ${this.model} is installed locally.` };
    } catch (error) {
      return { status: 'blocked', detail: `Ollama is unavailable: ${error.message}` };
    }
  }

  async generateVariant({ product, scriptJob, runAt }) {
    let generated;
    let qualityIssues = [];
    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const response = await fetchWithTimeout(this.fetchImpl, `${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: buildPrompt(product, scriptJob, qualityIssues),
          stream: false,
          think: this.thinking,
          format: SCRIPT_RESPONSE_SCHEMA,
          options: {
            seed: 42 + attempt,
            temperature: 0.2,
            num_ctx: 4096,
            num_predict: this.numPredict,
          },
          keep_alive: this.keepAlive,
        }),
      }, this.timeoutMs);

      if (!response.ok) {
        throw new Error(`Ollama generation failed with HTTP ${response.status}.`);
      }

      const ollamaPayload = await response.json();
      generated = parseGeneratedPayload(ollamaPayload.response);
      qualityIssues = findScriptQualityIssues(
        generated,
        scriptJob.creative_brief.blocked_phrases,
        product,
      );
      if (qualityIssues.length === 0) break;
    }
    if (qualityIssues.length > 0) {
      throw new Error(`Ollama script failed deterministic quality checks: ${qualityIssues.join(', ')}.`);
    }
    const disclosure = scriptJob.creative_brief.disclosure;
    const spokenText = `${generated.hook} ${generated.body} ${generated.callToAction}`;

    return ScriptVariantSchema.parse({
      script_variant_id: createStableId('script-variant', {
        scriptJobId: scriptJob.script_job_id,
        model: this.model,
      }),
      product_id: product.product_id,
      angle: scriptJob.angle,
      target_duration_seconds: scriptJob.target_duration_seconds,
      hook: generated.hook,
      body: generated.body,
      call_to_action: generated.callToAction,
      affiliate_disclosure: disclosure,
      spoken_text: spokenText,
      generation_provider: this.name,
      model: this.model,
      status: 'awaiting_approval',
      approval_status: 'pending',
      created_at: runAt,
    });
  }
}
