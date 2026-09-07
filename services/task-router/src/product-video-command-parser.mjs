const PRODUCT_VIDEO_COMMAND_PATTERN = /^(?:generate|create)\s+video\s+template:\s*(.+?)\s+channel:\s*(.+)$/iu;

export const PRODUCT_VIDEO_TEMPLATE_OPTIONS = Object.freeze([
  Object.freeze({
    name: 'Type Combination',
    value: 'dual-type-reveal',
  }),
  Object.freeze({
    name: 'Find the Shiny',
    value: 'find-the-shiny',
  }),
  Object.freeze({
    name: 'Know Your Shiny',
    value: 'know-your-shiny',
  }),
  Object.freeze({
    name: 'Stat Clash',
    value: 'stat-clash',
  }),
  Object.freeze({
    name: 'Tournament',
    value: 'tournament',
  }),
  Object.freeze({
    name: 'Memory',
    value: 'memory',
  }),
  Object.freeze({
    name: 'Type Speed Quiz',
    value: 'type-speed-quiz',
  }),
]);

export const PRODUCT_VIDEO_CHANNEL_OPTIONS = Object.freeze([
  Object.freeze({
    name: 'Poke Quizz',
    value: 'poke-quizz-youtube',
  }),
  Object.freeze({
    name: 'TrivaMon',
    value: 'trivamon-youtube',
  }),
  Object.freeze({
    name: 'Poke Guess',
    value: 'poke-guess-youtube',
  }),
  Object.freeze({
    name: 'DexGuess',
    value: 'dexguess-youtube',
  }),
]);

const PRODUCT_VIDEO_CHANNEL_CONFIG_PATHS = Object.freeze({
  'poke-quizz-youtube': Object.freeze({
    'dual-type-reveal': 'services/product-video-agent/config/channels/poke-quizz-youtube.json',
    'find-the-shiny': 'services/product-video-agent/config/channels/poke-quizz-find-the-shiny-youtube.json',
    'know-your-shiny': 'services/product-video-agent/config/channels/poke-quizz-know-your-shiny-youtube.json',
    'stat-clash': 'services/product-video-agent/config/channels/poke-quizz-stat-clash-youtube.json',
    tournament: 'services/product-video-agent/config/channels/poke-quizz-tournament-youtube.json',
    memory: 'services/product-video-agent/config/channels/poke-quizz-memory-youtube.json',
    'type-speed-quiz': 'services/product-video-agent/config/channels/poke-quizz-type-speed-quiz-youtube.json',
  }),
  'trivamon-youtube': Object.freeze({
    'dual-type-reveal': 'services/product-video-agent/config/channels/trivamon-youtube.json',
    'find-the-shiny': 'services/product-video-agent/config/channels/trivamon-find-the-shiny-youtube.json',
    'know-your-shiny': 'services/product-video-agent/config/channels/trivamon-know-your-shiny-youtube.json',
    'stat-clash': 'services/product-video-agent/config/channels/trivamon-stat-clash-youtube.json',
    tournament: 'services/product-video-agent/config/channels/trivamon-tournament-youtube.json',
    memory: 'services/product-video-agent/config/channels/trivamon-memory-youtube.json',
    'type-speed-quiz': 'services/product-video-agent/config/channels/trivamon-type-speed-quiz-youtube.json',
  }),
  'poke-guess-youtube': Object.freeze({
    'dual-type-reveal': 'services/product-video-agent/config/channels/poke-guess-youtube.json',
    'find-the-shiny': 'services/product-video-agent/config/channels/poke-guess-find-the-shiny-youtube.json',
    'know-your-shiny': 'services/product-video-agent/config/channels/poke-guess-know-your-shiny-youtube.json',
    'stat-clash': 'services/product-video-agent/config/channels/poke-guess-stat-clash-youtube.json',
    tournament: 'services/product-video-agent/config/channels/poke-guess-tournament-youtube.json',
    memory: 'services/product-video-agent/config/channels/poke-guess-memory-youtube.json',
    'type-speed-quiz': 'services/product-video-agent/config/channels/poke-guess-type-speed-quiz-youtube.json',
  }),
  'dexguess-youtube': Object.freeze({
    'dual-type-reveal': 'services/product-video-agent/config/channels/dexguess-youtube.json',
    'find-the-shiny': 'services/product-video-agent/config/channels/dexguess-find-the-shiny-youtube.json',
    'know-your-shiny': 'services/product-video-agent/config/channels/dexguess-know-your-shiny-youtube.json',
    'stat-clash': 'services/product-video-agent/config/channels/dexguess-stat-clash-youtube.json',
    tournament: 'services/product-video-agent/config/channels/dexguess-tournament-youtube.json',
    memory: 'services/product-video-agent/config/channels/dexguess-memory-youtube.json',
    'type-speed-quiz': 'services/product-video-agent/config/channels/dexguess-type-speed-quiz-youtube.json',
  }),
});

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function normalizeKey(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function normalizeTemplateOptionValue(value) {
  const normalized = normalizeKey(value);
  if (normalized === 'showdown') {
    return 'tournament';
  }
  if (normalized === 'stat-battle') {
    return 'stat-clash';
  }
  return normalized;
}

function findOption(options, value, normalizer = normalizeKey) {
  const normalizedValue = normalizer(value);
  return options.find((option) => option.value === normalizedValue) || null;
}

export function resolveProductVideoChannelConfigPath(channelSelector, templateKey) {
  const normalizedChannelSelector = normalizeKey(channelSelector);
  const normalizedTemplateKey = normalizeKey(templateKey);
  return PRODUCT_VIDEO_CHANNEL_CONFIG_PATHS[normalizedChannelSelector]?.[normalizedTemplateKey] || '';
}

export function parseProductVideoCommand(content) {
  const raw = normalizeWhitespace(content);
  if (!raw) {
    return null;
  }

  const match = PRODUCT_VIDEO_COMMAND_PATTERN.exec(raw);
  if (!match) {
    return null;
  }

  const templateOption = findOption(
    PRODUCT_VIDEO_TEMPLATE_OPTIONS,
    match[1],
    normalizeTemplateOptionValue,
  );
  const channelOption = findOption(PRODUCT_VIDEO_CHANNEL_OPTIONS, match[2]);
  if (!templateOption || !channelOption) {
    return null;
  }

  const channelConfigPath = resolveProductVideoChannelConfigPath(
    channelOption.value,
    templateOption.value,
  );
  if (!channelConfigPath) {
    return null;
  }

  return {
    templateKey: templateOption.value,
    templateLabel: templateOption.name,
    channelSelector: channelOption.value,
    channelLabel: channelOption.name,
    channelConfigPath,
  };
}

export function serializeProductVideoCommand(request = {}) {
  const parsed = parseProductVideoCommand(
    `generate video template: ${request.templateKey || ''} channel: ${request.channelSelector || ''}`,
  );
  if (!parsed) {
    return '';
  }

  return `generate video template: ${parsed.templateKey} channel: ${parsed.channelSelector}`;
}

export function summarizeProductVideoRequest(request = {}) {
  const templateLabel = normalizeWhitespace(request.templateLabel);
  const channelLabel = normalizeWhitespace(request.channelLabel);
  if (!templateLabel || !channelLabel) {
    return '';
  }

  return `Generate ${templateLabel} review for ${channelLabel}`;
}
