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
]);

const PRODUCT_VIDEO_CHANNEL_CONFIG_PATHS = Object.freeze({
  'poke-quizz-youtube': Object.freeze({
    'dual-type-reveal': 'services/product-video-agent/config/channels/poke-quizz-youtube.json',
    'find-the-shiny': 'services/product-video-agent/config/channels/poke-quizz-find-the-shiny-youtube.json',
    'type-speed-quiz': 'services/product-video-agent/config/channels/poke-quizz-type-speed-quiz-youtube.json',
  }),
  'trivamon-youtube': Object.freeze({
    'dual-type-reveal': 'services/product-video-agent/config/channels/trivamon-youtube.json',
    'find-the-shiny': 'services/product-video-agent/config/channels/trivamon-find-the-shiny-youtube.json',
    'type-speed-quiz': 'services/product-video-agent/config/channels/trivamon-type-speed-quiz-youtube.json',
  }),
});

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function normalizeKey(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function findOption(options, value) {
  const normalizedValue = normalizeKey(value);
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

  const templateOption = findOption(PRODUCT_VIDEO_TEMPLATE_OPTIONS, match[1]);
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
