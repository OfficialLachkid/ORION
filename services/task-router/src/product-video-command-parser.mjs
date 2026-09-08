import {
  PRODUCT_VIDEO_CHANNEL_DEFINITIONS,
  PRODUCT_VIDEO_TEMPLATE_DEFINITIONS,
  findProductVideoTemplateDefinition,
  resolveBaseProductVideoChannelConfigPath,
} from '../../product-video-agent/src/product-video-template-routing.mjs';

const PRODUCT_VIDEO_COMMAND_PATTERN = /^(?:generate|create)\s+video\s+template:\s*(.+?)\s+channel:\s*(.+)$/iu;

export const PRODUCT_VIDEO_TEMPLATE_OPTIONS = Object.freeze(
  PRODUCT_VIDEO_TEMPLATE_DEFINITIONS.map((definition) => Object.freeze({
    name: definition.label,
    value: definition.templateKey,
    templateId: definition.templateId,
  })),
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

function normalizeTemplateOptionValue(value) {
  return findProductVideoTemplateDefinition(value)?.templateKey || normalizeKey(value);
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
