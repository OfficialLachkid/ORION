import {
  PRODUCT_VIDEO_CHANNEL_DEFINITIONS,
  PRODUCT_VIDEO_LONG_TEMPLATE_DEFINITIONS,
  PRODUCT_VIDEO_SHORT_TEMPLATE_DEFINITIONS,
  PRODUCT_VIDEO_ALL_TEMPLATE_DEFINITIONS,
  findProductVideoTemplateDefinition,
  resolveBaseProductVideoChannelConfigPath,
} from '../../product-video-agent/src/product-video-template-routing.mjs';

const PRODUCT_VIDEO_COMMAND_PATTERN = /^(?:generate|create)\s+video\s+format:\s*(short|long)(?:_form)?\s+template:\s*(.+?)\s+channel:\s*(.+)$/iu;
const LEGACY_PRODUCT_VIDEO_COMMAND_PATTERN = /^(?:generate|create)\s+video\s+template:\s*(.+?)\s+channel:\s*(.+)$/iu;

export const PRODUCT_VIDEO_FORMAT_OPTIONS = Object.freeze([
  Object.freeze({ name: 'Short', value: 'short_form' }),
  Object.freeze({ name: 'Long', value: 'long_form' }),
]);

export const PRODUCT_VIDEO_TEMPLATE_OPTIONS = Object.freeze(
  PRODUCT_VIDEO_ALL_TEMPLATE_DEFINITIONS.map((definition) => Object.freeze({
    name: definition.label,
    value: definition.templateKey,
    templateId: definition.templateId,
  })),
);

function buildTemplateOptions(definitions, contentFormat) {
  return Object.freeze(definitions.map((definition) => Object.freeze({
    name: definition.label,
    value: definition.templateKey,
    templateId: definition.templateId,
    contentFormat,
  })));
}

export const PRODUCT_VIDEO_SHORT_TEMPLATE_OPTIONS = buildTemplateOptions(
  PRODUCT_VIDEO_SHORT_TEMPLATE_DEFINITIONS,
  'short_form',
);

export const PRODUCT_VIDEO_LONG_TEMPLATE_OPTIONS = buildTemplateOptions(
  PRODUCT_VIDEO_LONG_TEMPLATE_DEFINITIONS,
  'long_form',
);

export const PRODUCT_VIDEO_CHANNEL_OPTIONS = Object.freeze(
  PRODUCT_VIDEO_CHANNEL_DEFINITIONS.map((definition) => Object.freeze({
    name: definition.label,
    value: definition.channelSelector,
  })),
);

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function normalizeKey(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function normalizeTemplateOptionValue(value, contentFormat = '') {
  return findProductVideoTemplateDefinition(value, contentFormat)?.templateKey || normalizeKey(value);
}

function normalizeContentFormat(value) {
  const normalized = normalizeKey(value).replaceAll('-', '_');
  if (normalized === 'short' || normalized === 'short_form') return 'short_form';
  if (normalized === 'long' || normalized === 'long_form') return 'long_form';
  return '';
}

function findOption(options, value, normalizer = normalizeKey) {
  const normalizedValue = normalizer(value);
  return options.find((option) => option.value === normalizedValue) || null;
}

export function resolveProductVideoChannelConfigPath(channelSelector) {
  const normalizedChannelSelector = normalizeKey(channelSelector);
  return resolveBaseProductVideoChannelConfigPath(normalizedChannelSelector);
}

export function resolveProductVideoTemplateId(templateKey) {
  return findProductVideoTemplateDefinition(templateKey)?.templateId || '';
}

export function parseProductVideoCommand(content) {
  const raw = normalizeWhitespace(content);
  if (!raw) {
    return null;
  }

  const formatMatch = PRODUCT_VIDEO_COMMAND_PATTERN.exec(raw);
  const legacyMatch = formatMatch ? null : LEGACY_PRODUCT_VIDEO_COMMAND_PATTERN.exec(raw);
  if (!formatMatch && !legacyMatch) {
    return null;
  }

  const contentFormat = formatMatch ? normalizeContentFormat(formatMatch[1]) : 'short_form';
  const templateValue = formatMatch ? formatMatch[2] : legacyMatch[1];
  const channelValue = formatMatch ? formatMatch[3] : legacyMatch[2];
  const templateOptions = contentFormat === 'long_form'
    ? PRODUCT_VIDEO_LONG_TEMPLATE_OPTIONS
    : PRODUCT_VIDEO_SHORT_TEMPLATE_OPTIONS;

  const templateOption = findOption(
    templateOptions,
    templateValue,
    (value) => normalizeTemplateOptionValue(value, contentFormat),
  );
  const channelOption = findOption(PRODUCT_VIDEO_CHANNEL_OPTIONS, channelValue);
  if (!templateOption || !channelOption) {
    return null;
  }

  const channelConfigPath = resolveProductVideoChannelConfigPath(
    channelOption.value,
  );
  const templateId = resolveProductVideoTemplateId(templateOption.value);
  if (!channelConfigPath || !templateId) {
    return null;
  }

  return {
    templateKey: templateOption.value,
    templateLabel: templateOption.name,
    channelSelector: channelOption.value,
    channelLabel: channelOption.name,
    channelConfigPath,
    templateId,
    contentFormat,
    contentFormatLabel: formatMatch ? (contentFormat === 'long_form' ? 'Long' : 'Short') : '',
  };
}

export function serializeProductVideoCommand(request = {}) {
  const requestedContentFormat = normalizeContentFormat(request.contentFormat);
  const contentFormat = requestedContentFormat || 'short_form';
  const parsed = parseProductVideoCommand(
    `generate video format: ${contentFormat} template: ${request.templateKey || ''} channel: ${request.channelSelector || ''}`,
  );
  if (!parsed) {
    return '';
  }

  return requestedContentFormat
    ? `generate video format: ${parsed.contentFormat} template: ${parsed.templateKey} channel: ${parsed.channelSelector}`
    : `generate video template: ${parsed.templateKey} channel: ${parsed.channelSelector}`;
}

export function summarizeProductVideoRequest(request = {}) {
  const templateLabel = normalizeWhitespace(request.templateLabel);
  const channelLabel = normalizeWhitespace(request.channelLabel);
  if (!templateLabel || !channelLabel) {
    return '';
  }

  const formatLabel = normalizeWhitespace(request.contentFormatLabel);
  return `Generate ${formatLabel ? `${formatLabel.toLowerCase()}-form ` : ''}${templateLabel} review for ${channelLabel}`;
}
