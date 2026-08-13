import { PRODUCT_VIDEO_CHANNEL_OPTIONS } from './product-video-command-parser.mjs';

const VIDEO_ANALYTICS_COMMAND_PATTERN = /^(?:show|post|generate)\s+analytics\s+channel:\s*(.+?)\s+days:\s*(\d+)$/iu;

export const VIDEO_ANALYTICS_CHANNEL_OPTIONS = Object.freeze([
  Object.freeze({
    name: 'All Channels',
    value: 'all',
  }),
  ...PRODUCT_VIDEO_CHANNEL_OPTIONS,
]);

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

export function parseVideoAnalyticsCommand(content) {
  const raw = normalizeWhitespace(content);
  if (!raw) {
    return null;
  }

  const match = VIDEO_ANALYTICS_COMMAND_PATTERN.exec(raw);
  if (!match) {
    return null;
  }

  const channelOption = findOption(VIDEO_ANALYTICS_CHANNEL_OPTIONS, match[1]);
  const windowDays = Number.parseInt(match[2], 10);
  if (!channelOption || !Number.isFinite(windowDays) || windowDays <= 0) {
    return null;
  }

  return {
    channelSelector: channelOption.value,
    channelLabel: channelOption.name,
    windowDays,
  };
}

export function serializeVideoAnalyticsCommand(request = {}) {
  const parsed = parseVideoAnalyticsCommand(
    `post analytics channel: ${request.channelSelector || ''} days: ${request.windowDays || ''}`,
  );
  if (!parsed) {
    return '';
  }

  return `post analytics channel: ${parsed.channelSelector} days: ${parsed.windowDays}`;
}

export function summarizeVideoAnalyticsRequest(request = {}) {
  const channelLabel = normalizeWhitespace(request.channelLabel);
  const windowDays = Number.parseInt(String(request.windowDays || ''), 10);
  if (!channelLabel || !Number.isFinite(windowDays) || windowDays <= 0) {
    return '';
  }

  return `Post ${windowDays}-day analytics digest for ${channelLabel}`;
}
