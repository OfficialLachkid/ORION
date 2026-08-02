import { buildNoticeDiscordPayload } from '../../discord-bot/src/message-formatting.mjs';
import {
  editDiscordChannelMessage,
  sendDiscordChannelMessage,
} from '../../../scripts/lib/discord-post.mjs';
import {
  DEFAULT_GENRE_LABEL,
  formatTypePairLabel,
} from './poke-quizz-publication-review.mjs';

const STATUS_COLORS = Object.freeze({
  started: 0x99AAB5,
  running: 0xFEE75C,
  retrying: 0xE67E22,
  failed: 0xED4245,
});

function buildYoutubeChannelUrl(channelProfile = {}) {
  const channelId = String(channelProfile?.youtube?.channel_id || '').trim();
  return channelId ? `https://www.youtube.com/channel/${channelId}` : '';
}

function formatMarkdownLink(label, url) {
  const text = String(label || '').trim();
  const href = String(url || '').trim();
  if (!text) {
    return href;
  }
  if (!href) {
    return text;
  }
  return `[${text}](${href})`;
}

function formatElapsedMinutes(elapsedMs) {
  const minutes = elapsedMs / 60000;
  if (minutes < 1) {
    return '<1 min';
  }
  return `${Math.floor(minutes)} min`;
}

function createField(name, value, inline = true) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  return { name, value: text, inline };
}

function buildProgressPayload({
  status,
  channelProfile,
  typePair,
  elapsedMs,
  title = '',
  description = '',
  errorMessage = '',
  attemptLabel = '',
}) {
  const channelName = String(channelProfile?.name || '').trim();
  const channelUrl = buildYoutubeChannelUrl(channelProfile);
  const statusTitle = status === 'failed'
    ? 'Poke Quizz Video Gen - Failed'
    : status === 'retrying'
      ? 'Poke Quizz Video Gen - Retrying'
    : status === 'running'
      ? 'Poke Quizz Video Gen - Running'
      : 'Poke Quizz Video Gen - Started';
  const statusDescription = status === 'failed'
    ? `Video generation stopped: ${errorMessage || 'unknown error'}.`
    : status === 'retrying'
      ? `Render attempt failed, retrying automatically. ${errorMessage || 'Transient render issue detected.'}`
    : status === 'running'
      ? 'Rendering is in progress. This message updates while the preview is being assembled.'
      : 'Video generation has started. This message will update until the review card is ready.';

  return buildNoticeDiscordPayload({
    title: statusTitle,
    description: statusDescription,
    color: STATUS_COLORS[status] || STATUS_COLORS.started,
    footerText: 'ORION video gen',
    fields: [
      createField('Genre', DEFAULT_GENRE_LABEL, true),
      createField(
        'Channel',
        channelName || channelUrl
          ? formatMarkdownLink(channelName || channelUrl, channelUrl)
          : '',
        true
      ),
      createField('Type Pair', formatTypePairLabel(typePair || []), true),
      createField('Busy Time', formatElapsedMinutes(elapsedMs), true),
      createField('Attempt', attemptLabel, true),
      createField('Title', title, false),
      createField('Description', description, false),
    ].filter(Boolean),
  });
}

async function patchProgressMessage(runtimeConfig, message, payload) {
  if (!message?.messageId) {
    return null;
  }

  const result = await editDiscordChannelMessage(
    runtimeConfig,
    message.channelId,
    message.messageId,
    payload,
  );
  return result.posted ? result : null;
}

export async function postPokeQuizzGenerationStarted(runtimeConfig, reviewThreadId, context = {}) {
  const payload = buildProgressPayload({
    status: 'started',
    channelProfile: context.channelProfile,
    typePair: context.typePair,
    elapsedMs: 0,
    title: context.title,
    description: context.description,
  });
  const posted = await sendDiscordChannelMessage(runtimeConfig, reviewThreadId, payload);
  if (!posted.posted) {
    return null;
  }
  return {
    channelId: reviewThreadId,
    messageId: posted.messageId,
  };
}

export function beginPokeQuizzGenerationProgress(runtimeConfig, message, context = {}) {
  if (!message?.messageId) {
    return {
      stop: () => {},
      getElapsedMinutes: () => 0,
      getElapsedMs: () => 0,
    };
  }

  const startedAtMs = Date.now();
  const update = async () => {
    try {
      await patchProgressMessage(runtimeConfig, message, buildProgressPayload({
        status: 'running',
        channelProfile: context.channelProfile,
        typePair: context.typePair,
        elapsedMs: Date.now() - startedAtMs,
        title: context.title,
        description: context.description,
      }));
    } catch {
      // Progress ticks are best-effort only.
    }
  };

  update();
  const timer = setInterval(update, 60000);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return {
    stop: () => clearInterval(timer),
    getElapsedMinutes: () => (Date.now() - startedAtMs) / 60000,
    getElapsedMs: () => Date.now() - startedAtMs,
  };
}

export async function markPokeQuizzGenerationFailed(runtimeConfig, message, context = {}, error) {
  if (!message?.messageId) {
    return null;
  }

  return patchProgressMessage(runtimeConfig, message, buildProgressPayload({
    status: 'failed',
    channelProfile: context.channelProfile,
    typePair: context.typePair,
    elapsedMs: Number(context.elapsedMs) || 0,
    title: context.title,
    description: context.description,
    errorMessage: error?.message || '',
    attemptLabel: context.attemptLabel || '',
  }));
}

export async function markPokeQuizzGenerationRetry(runtimeConfig, message, context = {}, error) {
  if (!message?.messageId) {
    return null;
  }

  return patchProgressMessage(runtimeConfig, message, buildProgressPayload({
    status: 'retrying',
    channelProfile: context.channelProfile,
    typePair: context.typePair,
    elapsedMs: Number(context.elapsedMs) || 0,
    title: context.title,
    description: context.description,
    errorMessage: error?.message || '',
    attemptLabel: context.attemptLabel || '',
  }));
}
