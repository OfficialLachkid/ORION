const CHANNELS_CONFIG_DIR = 'services/product-video-agent/config/channels';

export const PRODUCT_VIDEO_TEMPLATE_DEFINITIONS = Object.freeze([
  {
    templateKey: 'dual-type-reveal',
    templateId: 'pokemon.dual-type-reveal.v1',
    label: 'Type Combination',
    genreLabel: 'Type Combination',
    legacyConfigSlug: '',
  },
  {
    templateKey: 'find-the-shiny',
    templateId: 'pokemon.find-the-shiny.v1',
    label: 'Find the Shiny',
    genreLabel: 'Find the Shiny',
    legacyConfigSlug: 'find-the-shiny',
  },
  {
    templateKey: 'know-your-shiny',
    templateId: 'pokemon.know-your-shiny.v1',
    label: 'Know Your Shiny',
    genreLabel: 'Know Your Shiny',
    legacyConfigSlug: 'know-your-shiny',
  },
  {
    templateKey: 'stat-clash',
    templateId: 'pokemon.stat-clash.v1',
    label: 'Stat Clash',
    genreLabel: 'Stat Clash',
    legacyConfigSlug: 'stat-clash',
  },
  {
    templateKey: 'tournament',
    templateId: 'pokemon.tournament.v1',
    label: 'Tournament',
    genreLabel: 'Tournament',
    legacyConfigSlug: 'tournament',
  },
  {
    templateKey: 'memory',
    templateId: 'pokemon.memory.v1',
    label: 'Memory',
    genreLabel: 'Memory',
    legacyConfigSlug: 'memory',
  },
  {
    templateKey: 'type-speed-quiz',
    templateId: 'pokemon.type-quiz.v1',
    label: 'Type Speed Quiz',
    genreLabel: 'Type Quiz',
    legacyConfigSlug: 'type-speed-quiz',
  },
  {
    templateKey: 'cry-match',
    templateId: 'pokemon.cry-match.v1',
    label: 'Cry Match',
    genreLabel: 'Cry Match',
    legacyConfigSlug: 'cry-match',
  },
]);

export const PRODUCT_VIDEO_CHANNEL_DEFINITIONS = Object.freeze([
  {
    channelSelector: 'poke-quizz-youtube',
    label: 'Poke Quizz',
    configSlug: 'poke-quizz',
    channelConfigPath: `${CHANNELS_CONFIG_DIR}/poke-quizz-youtube.json`,
  },
  {
    channelSelector: 'trivamon-youtube',
    label: 'TrivaMon',
    configSlug: 'trivamon',
    channelConfigPath: `${CHANNELS_CONFIG_DIR}/trivamon-youtube.json`,
  },
  {
    channelSelector: 'poke-guess-youtube',
    label: 'Poke Guess',
    configSlug: 'poke-guess',
    channelConfigPath: `${CHANNELS_CONFIG_DIR}/poke-guess-youtube.json`,
  },
  {
    channelSelector: 'dexguess-youtube',
    label: 'DexGuess',
    configSlug: 'dexguess',
    channelConfigPath: `${CHANNELS_CONFIG_DIR}/dexguess-youtube.json`,
  },
]);

const TEMPLATE_KEY_ALIASES = Object.freeze({
  showdown: 'tournament',
  'stat-battle': 'stat-clash',
  'type-quiz': 'type-speed-quiz',
});

function normalizeIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTemplateKey(value) {
  const normalized = normalizeIdentifier(value);
  return TEMPLATE_KEY_ALIASES[normalized] || normalized;
}

export function findProductVideoTemplateDefinition(value) {
  const normalized = normalizeTemplateKey(value);
  return PRODUCT_VIDEO_TEMPLATE_DEFINITIONS.find((definition) => (
    definition.templateKey === normalized
    || definition.templateId === normalized
    || normalizeIdentifier(definition.label) === normalized
    || normalizeIdentifier(definition.genreLabel) === normalized
  )) || null;
}

export function resolveProductVideoTemplateId(value) {
  return findProductVideoTemplateDefinition(value)?.templateId || '';
}

export function resolveProductVideoTemplateKey(value) {
  return findProductVideoTemplateDefinition(value)?.templateKey || '';
}

export function resolveBaseProductVideoChannelConfigPath(channelSelector) {
  const normalized = normalizeIdentifier(channelSelector);
  return PRODUCT_VIDEO_CHANNEL_DEFINITIONS.find((definition) => (
    definition.channelSelector === normalized
  ))?.channelConfigPath || '';
}

export function resolveProductVideoChannelSelectorFromConfigPath(channelConfigPath) {
  const normalizedPath = normalizeIdentifier(channelConfigPath).replace(/\\/g, '/');
  return PRODUCT_VIDEO_CHANNEL_DEFINITIONS.find((definition) => (
    normalizedPath.endsWith(definition.channelConfigPath.toLowerCase())
  ))?.channelSelector || '';
}

export function resolveLegacyProductVideoChannelConfigAlias(channelConfigPath) {
  const normalizedPath = normalizeIdentifier(channelConfigPath).replace(/\\/g, '/');
  if (!normalizedPath) {
    return null;
  }

  for (const channelDefinition of PRODUCT_VIDEO_CHANNEL_DEFINITIONS) {
    for (const templateDefinition of PRODUCT_VIDEO_TEMPLATE_DEFINITIONS) {
      if (!templateDefinition.legacyConfigSlug) {
        continue;
      }

      const legacyPath = `${CHANNELS_CONFIG_DIR}/${channelDefinition.configSlug}-${templateDefinition.legacyConfigSlug}-youtube.json`;
      if (!normalizedPath.endsWith(legacyPath.toLowerCase())) {
        continue;
      }

      return {
        channelSelector: channelDefinition.channelSelector,
        channelConfigPath: channelDefinition.channelConfigPath,
        templateId: templateDefinition.templateId,
        templateKey: templateDefinition.templateKey,
      };
    }
  }

  return null;
}

function normalizeBooleanLike(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function normalizePositiveNumber(value, fallback = 1) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
}

function normalizeChannelTemplateEntry(templateId, rawEntry = {}) {
  const definition = findProductVideoTemplateDefinition(templateId);
  const entry = rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry)
    ? rawEntry
    : {};
  const nightShiftValue = entry.night_shift;
  const nightShiftEnabled = nightShiftValue && typeof nightShiftValue === 'object'
    ? normalizeBooleanLike(nightShiftValue.enabled, false)
    : normalizeBooleanLike(nightShiftValue, false);
  const nightShiftWeight = nightShiftValue && typeof nightShiftValue === 'object'
    ? nightShiftValue.weight
    : undefined;

  return {
    templateId,
    templateKey: String(entry.template_key || definition?.templateKey || '').trim(),
    enabled: entry.enabled !== false,
    manualGenerate: entry.manual_generate !== false,
    nightShift: nightShiftEnabled,
    weight: normalizePositiveNumber(entry.weight ?? nightShiftWeight, 1),
    genreLabel: String(entry.genre_label || entry.review?.genre_label || definition?.genreLabel || '').trim(),
    review: entry.review && typeof entry.review === 'object' && !Array.isArray(entry.review)
      ? entry.review
      : {},
    raw: entry,
  };
}

export function normalizeChannelTemplateEntries(channelConfig = {}) {
  const rawTemplates = channelConfig?.templates && typeof channelConfig.templates === 'object'
    ? channelConfig.templates
    : {};
  return Object.entries(rawTemplates)
    .map(([templateId, entry]) => normalizeChannelTemplateEntry(String(templateId || '').trim(), entry))
    .filter((entry) => entry.templateId);
}

export function findChannelTemplateEntry(channelConfig = {}, templateId = '') {
  const normalizedTemplateId = String(templateId || '').trim();
  if (!normalizedTemplateId) {
    return null;
  }
  return normalizeChannelTemplateEntries(channelConfig)
    .find((entry) => entry.templateId === normalizedTemplateId) || null;
}
