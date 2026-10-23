import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  discordRequest,
  findOrCreatePackChannel,
  sendMessageWithFiles,
} from '../../digital-asset-engine/src/discord-review.mjs';

function elapsedLabel(startedAt, now = Date.now()) {
  const elapsedSeconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export async function ensureManualImageGenerationChannel(options) {
  const token = options.runtimeConfig?.env?.DISCORD_BOT_TOKEN;
  const guildId = options.runtimeConfig?.guildId;
  if (!token || !guildId) throw new Error('Discord token and guild are required to create the manual image channel.');
  return findOrCreatePackChannel({
    token,
    guildId,
    categoryName: options.config.discord.categoryName,
    channelName: options.config.discord.channelName,
    topic: 'Authorized on-demand local Flux image generation. Temporary files are retained on failure and cleaned after confirmed Discord delivery.',
    fetchImpl: options.fetchImpl,
  });
}

export async function postManualImageQueuedStatus(options) {
  const request = options.job.request;
  return discordRequest(
    options.runtimeConfig.env.DISCORD_BOT_TOKEN,
    `/channels/${request.channel_id}/messages`,
    {
      method: 'POST',
      fetchImpl: options.fetchImpl,
      body: {
        content: [
          `<@${request.requested_by_discord_id}> your local image request is queued.`,
          `**Job:** \`${options.job.job_id}\``,
          `**Progress:** **0/${request.count ?? '?'}**`,
          `**Aspect ratio:** ${request.aspect_ratio}`,
          request.count === null ? '**Planning:** Ollama will infer the smallest useful image set.' : `**Requested images:** **${request.count}**`,
        ].join('\n'),
        allowed_mentions: { parse: [], users: [request.requested_by_discord_id] },
      },
    },
  );
}

export async function updateManualImageStatus(options) {
  const job = options.job;
  if (!job.status_message_id || !job.request?.channel_id) return null;
  const content = options.content || [
    `<@${job.request.requested_by_discord_id}> ORION is generating your images locally.`,
    `**Job:** \`${job.job_id}\``,
    `**Progress:** **${options.completed || 0}/${options.total ?? '?'}**`,
    `**Elapsed:** ${elapsedLabel(job.started_at || job.queued_at)}`,
    options.current ? `**Current:** ${options.current}` : '',
  ].filter(Boolean).join('\n');
  return discordRequest(
    options.runtimeConfig.env.DISCORD_BOT_TOKEN,
    `/channels/${job.request.channel_id}/messages/${job.status_message_id}`,
    {
      method: 'PATCH',
      fetchImpl: options.fetchImpl,
      body: { content, allowed_mentions: { parse: [] } },
    },
  );
}

function imageContentType(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  throw new Error(`Unsupported generated image type: ${path}.`);
}

export async function deliverManualImages(options) {
  const { job, plan, config, runtimeConfig } = options;
  const files = [];
  for (const output of job.outputs || []) {
    const details = await stat(output.path);
    if (details.size > config.maximumAttachmentBytes) {
      throw new Error(
        `${basename(output.path)} is ${(details.size / 1024 / 1024).toFixed(1)} MB, above the configured Discord attachment limit. The file remains on the T7.`,
      );
    }
    files.push({
      filename: basename(output.path),
      contentType: imageContentType(output.path),
      description: output.label,
      buffer: await readFile(output.path),
    });
  }
  if (files.length !== plan.inferred_count) {
    throw new Error(`Delivery expected ${plan.inferred_count} images but found ${files.length}.`);
  }
  const payload = {
    content: [
      `<@${job.request.requested_by_discord_id}> your **${files.length}** local image${files.length === 1 ? '' : 's'} ${files.length === 1 ? 'is' : 'are'} ready.`,
      `**Job:** \`${job.job_id}\``,
      `**Aspect ratio:** ${plan.aspect_ratio}`,
      `**Generation:** local Flux · **€0 API cost**`,
      plan.transparent_background ? '**Background:** transparent alpha processed from the isolated chroma render' : '',
    ].filter(Boolean).join('\n'),
    allowed_mentions: { parse: [], users: [job.request.requested_by_discord_id] },
  };
  return sendMessageWithFiles(
    runtimeConfig.env.DISCORD_BOT_TOKEN,
    job.request.channel_id,
    payload,
    files,
    {
      messageId: job.status_message_id || undefined,
      fetchImpl: options.fetchImpl,
    },
  );
}
