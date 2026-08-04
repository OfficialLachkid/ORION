const METADATA_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    hashtags: {
      type: 'array',
      items: { type: 'string' },
      minItems: 3,
      maxItems: 6,
    },
  },
  required: ['title', 'description', 'hashtags'],
  additionalProperties: false,
};

function titleCaseWord(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function normalizeTagToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^#+/u, '')
    .replace(/[^a-z0-9]+/gu, '');
}

function normalizeHashtags(values) {
  const unique = new Set();
  for (const value of values || []) {
    const token = normalizeTagToken(value);
    if (!token) continue;
    unique.add(`#${token}`);
    if (unique.size >= 6) break;
  }
  return [...unique];
}

function getLocalEndpoint(endpoint) {
  const url = new URL(String(endpoint || 'http://127.0.0.1:11434').trim());
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error('Publication metadata generation requires a local Ollama endpoint.');
  }
  return url.toString().replace(/\/$/u, '');
}

function buildTypePairLabel(types = []) {
  return types.map((type) => titleCaseWord(type)).join('/');
}

function buildTypeHashtags(types = []) {
  return types
    .map((type) => normalizeTagToken(type))
    .filter(Boolean)
    .map((type) => `#${type}type`);
}

const DEFAULT_TITLE_BUILDERS = Object.freeze([
  (typePairLabel) => `${typePairLabel} Type Quiz - Can You Guess?`,
  (typePairLabel) => `Can You Guess This ${typePairLabel} Pokemon?`,
  (typePairLabel) => `${typePairLabel} Pokemon Quiz - Beat the Timer`,
  (typePairLabel) => `Which Pokemon Fits ${typePairLabel}?`,
  (typePairLabel) => `${typePairLabel} Challenge - Name These Pokemon`,
]);

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'poke-quizz-title')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildDefaultTitle(plan) {
  const typePairLabel = buildTypePairLabel(plan?.selection?.type_pair || []);
  if (!typePairLabel) {
    return 'Pokemon Type Quiz - Can You Guess?';
  }
  const seed = String(plan?.seed || '').trim();
  const templateIndex = seed
    ? hashSeed(`${seed}|${typePairLabel}`) % DEFAULT_TITLE_BUILDERS.length
    : 0;
  return DEFAULT_TITLE_BUILDERS[templateIndex](typePairLabel);
}

function buildDefaultDescription(plan) {
  const typePairLabel = buildTypePairLabel(plan?.selection?.type_pair || []);
  const selectedSubjects = plan?.selection?.selected_subjects || [];
  const subjectCount = selectedSubjects.length || Number(plan?.selection?.display_subject_count || 0) || 4;
  return `Think you're a Pokémon master? Take this timed quiz to see how well you know your ${typePairLabel} types! I've got ${subjectCount} tricky ones for you to guess.`;
}

function buildMetadataPrompt(plan) {
  const typePair = plan?.selection?.type_pair || [];
  const typePairLabel = buildTypePairLabel(typePair);
  const selectedSubjects = plan?.selection?.selected_subjects || [];
  const subjectCount = selectedSubjects.length;
  return [
    'Write YouTube Shorts publication metadata as JSON for a Pokemon quiz video.',
    `Type pair: ${typePairLabel}`,
    `Selected Pokemon count: ${subjectCount}`,
    `Selected Pokemon names: ${selectedSubjects.map((subject) => subject.name).join(', ')}`,
    'Return JSON with title, description, and hashtags.',
    'Requirements:',
    '- The title must stay under 70 characters and sound native for YouTube Shorts.',
    '- Do not spoil the exact answer Pokemon names in the title.',
    '- The description should invite a guess without sounding like an ad or generic engagement bait.',
    '- Mention that the video is a timed Pokemon type quiz.',
    '- Hashtags must contain 4 to 6 short tags and include pokemon plus shorts.',
    '- Keep the tone playful and sharp, not childish and not corporate.',
    'Return JSON only.',
  ].join('\n');
}

function parseGeneratedMetadataPayload(responseText) {
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error('Local publication metadata generator returned a non-JSON response.');
  }

  const title = String(payload?.title || '').trim();
  const description = String(payload?.description || '').trim();
  const hashtags = normalizeHashtags(Array.isArray(payload?.hashtags) ? payload.hashtags : []);
  if (!title) {
    throw new Error('Local publication metadata generator returned no title.');
  }
  if (!description) {
    throw new Error('Local publication metadata generator returned no description.');
  }
  if (hashtags.length < 3) {
    throw new Error('Local publication metadata generator returned too few hashtags.');
  }

  return {
    title,
    description,
    hashtags,
  };
}

export function buildPokeQuizzFallbackPublicationMetadata(plan) {
  const typePair = plan?.selection?.type_pair || [];
  const typeHashtags = buildTypeHashtags(typePair);
  return {
    title: buildDefaultTitle(plan),
    description: buildDefaultDescription(plan),
    hashtags: normalizeHashtags([
      'pokemon',
      'pokequizz',
      'whosthatpokemon',
      ...typeHashtags,
      'shorts',
    ]),
    generation_provider: 'template',
    model: 'fallback',
  };
}

export async function resolvePokeQuizzPublicationMetadata({
  plan,
  config,
  channelProfile,
  localModel = true,
  title = '',
  description = '',
  hashtags = [],
}) {
  let metadata = localModel
    ? await generatePokeQuizzPublicationMetadata({
      plan,
      config,
      channelProfile,
    })
    : buildPokeQuizzFallbackPublicationMetadata(plan);

  if (title) {
    metadata = {
      ...(metadata || {}),
      title,
    };
  }
  if (description) {
    metadata = {
      ...(metadata || {}),
      description,
    };
  }
  if (Array.isArray(hashtags) && hashtags.length > 0) {
    metadata = {
      ...(metadata || {}),
      hashtags,
    };
  }

  return metadata;
}

export async function generatePokeQuizzPublicationMetadata({
  plan,
  config,
  channelProfile,
  fetchImpl = globalThis.fetch,
  allowFallback = true,
}) {
  const fallback = buildPokeQuizzFallbackPublicationMetadata(plan);
  const shouldUseLocalModel = (
    channelProfile?.metadata?.title_generation_model === 'local_ollama'
    || channelProfile?.metadata?.description_generation_model === 'local_ollama'
  );
  if (!shouldUseLocalModel) {
    return fallback;
  }
  if (config?.script?.provider !== 'ollama') {
    return fallback;
  }

  try {
    const endpoint = getLocalEndpoint(config.script.endpoint);
    const response = await fetchImpl(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.script.model,
        prompt: buildMetadataPrompt(plan),
        stream: false,
        format: METADATA_RESPONSE_SCHEMA,
        options: {
          seed: 42,
          temperature: 0.2,
          num_ctx: 4096,
          num_predict: 240,
        },
        keep_alive: config.script.keep_alive || '0s',
      }),
    });
    if (!response.ok) {
      throw new Error(`Ollama metadata generation failed with HTTP ${response.status}.`);
    }
    const payload = await response.json();
    const parsed = parseGeneratedMetadataPayload(payload.response);
    return {
      ...parsed,
      title: buildDefaultTitle(plan),
      description: buildDefaultDescription(plan),
      generation_provider: 'ollama',
      model: config.script.model,
    };
  } catch (error) {
    if (!allowFallback) {
      throw error;
    }
    return {
      ...fallback,
      generation_error: error.message,
    };
  }
}
