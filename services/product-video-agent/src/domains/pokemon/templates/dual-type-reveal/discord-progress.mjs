import { buildNoticeDiscordPayload } from '../../../../../../discord-bot/src/message-formatting.mjs';
import {
  editDiscordChannelMessage,
  sendDiscordChannelMessage,
} from '../../../../../../../scripts/lib/discord-post.mjs';
import {
  DEFAULT_GENERATION_PROGRESS_PRESENTATION,
  DEFAULT_GENRE_LABEL,
} from '../../../../video-template-context.mjs';
import { formatTypePairLabel } from './publication-review.mjs';

const STATUS_COLORS = Object.freeze({
  started: 0x99AAB5,
  running: 0xFEE75C,
  retrying: 0xE67E22,
  failed: 0xED4245,
});

function normalizeGenerationProgressPresentation(presentation = {}) {
  return {
    ...DEFAULT_GENERATION_PROGRESS_PRESENTATION,
    ...(presentation && typeof presentation === 'object' ? presentation : {}),
    field_labels: {
      ...DEFAULT_GENERATION_PROGRESS_PRESENTATION.field_labels,
      ...(presentation?.field_labels && typeof presentation.field_labels === 'object' ? presentation.field_labels : {}),
    },
    status_titles: {
      ...DEFAULT_GENERATION_PROGRESS_PRESENTATION.status_titles,
      ...(presentation?.status_titles && typeof presentation.status_titles === 'object' ? presentation.status_titles : {}),
    },
    status_descriptions: {
      ...DEFAULT_GENERATION_PROGRESS_PRESENTATION.status_descriptions,
      ...(presentation?.status_descriptions && typeof presentation.status_descriptions === 'object' ? presentation.status_descriptions : {}),
    },
  };
}

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
  genreLabel = DEFAULT_GENRE_LABEL,
  presentation = DEFAULT_GENERATION_PROGRESS_PRESENTATION,
}) {
  const effectivePresentation = normalizeGenerationProgressPresentation(presentation);
  const channelName = String(channelProfile?.name || '').trim();
  const channelUrl = buildYoutubeChannelUrl(channelProfile);
  const statusTitle = effectivePresentation.status_titles[status]
    || effectivePresentation.status_titles.started;
  const statusDescription = status === 'failed'
    ? (errorMessage
      ? `Video generation stopped: ${errorMessage}.`
      : effectivePresentation.status_descriptions.failed_fallback)
    : status === 'retrying'
      ? (errorMessage
        ? `Render attempt failed, retrying automatically. ${errorMessage}`
        : effectivePresentation.status_descriptions.retrying_fallback)
      : status === 'running'
      ? effectivePresentation.status_descriptions.running
      : effectivePresentation.status_descriptions.started;

  return buildNoticeDiscordPayload({
    title: statusTitle,
    description: statusDescription,
    color: STATUS_COLORS[status] || STATUS_COLORS.started,
    footerText: effectivePresentation.footer_text,
    fields: [
      createField(effectivePresentation.field_labels.genre, genreLabel || DEFAULT_GENRE_LABEL, true),
      createField(
        effectivePresentation.field_labels.channel,
        channelName || channelUrl
          ? formatMarkdownLink(channelName || channelUrl, channelUrl)
          : '',
        true
      ),
      createField(effectivePresentation.field_labels.type_pair, formatTypePairLabel(typePair || []), true),
      createField(effectivePresentation.field_labels.busy_time, formatElapsedMinutes(elapsedMs), true),
      createField(effectivePresentation.field_labels.attempt, attemptLabel, true),
      createField(effectivePresentation.field_labels.title, title, false),
      createField(effectivePresentation.field_labels.description, description, false),
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
    genreLabel: context.genreLabel,
    presentation: context.presentation,
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
        genreLabel: context.genreLabel,
        presentation: context.presentation,
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
    genreLabel: context.genreLabel,
    presentation: context.presentation,
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
    genreLabel: context.genreLabel,
    presentation: context.presentation,
  }));
}
