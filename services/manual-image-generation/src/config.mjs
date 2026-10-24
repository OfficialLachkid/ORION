import { access, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export function resolveManualImageGenerationConfig(runtimeConfig, options = {}) {
  const env = runtimeConfig?.env || {};
  const permanentAssetRoot = String(env.DIGITAL_ASSET_ARCHIVE_ROOT || '').trim();
  if (!permanentAssetRoot && !options.archiveRoot) {
    throw new Error('DIGITAL_ASSET_ARCHIVE_ROOT is required for T7-backed manual image generation.');
  }
  const archiveRoot = resolve(
    options.archiveRoot
      || String(env.MANUAL_IMAGE_GENERATION_ROOT || '').trim()
      || resolve(permanentAssetRoot, '..', 'O.R.I.O.N. Manual Image Jobs'),
  );
  return {
    archiveRoot,
    permanentAssetRoot: permanentAssetRoot ? resolve(permanentAssetRoot) : '',
    maximumCount: positiveInteger(env.MANUAL_IMAGE_MAX_COUNT, 8, 8),
    maximumQueueDepth: positiveInteger(env.MANUAL_IMAGE_MAX_QUEUE_DEPTH, 12, 50),
    maximumAttachmentBytes: positiveInteger(env.MANUAL_IMAGE_MAX_ATTACHMENT_BYTES, 8 * 1024 * 1024, 25 * 1024 * 1024),
    abandonedTtlHours: positiveInteger(env.MANUAL_IMAGE_ABANDONED_TTL_HOURS, 168, 24 * 90),
    cleanupIntervalHours: positiveInteger(env.MANUAL_IMAGE_CLEANUP_INTERVAL_HOURS, 6, 24 * 7),
    maximumDeliveryAttempts: positiveInteger(env.MANUAL_IMAGE_MAX_DELIVERY_ATTEMPTS, 3, 10),
    planner: {
      endpoint: env.OLLAMA_URL || 'http://127.0.0.1:11434',
      model: env.MANUAL_IMAGE_PLANNER_MODEL || env.DIGITAL_ASSET_THEME_MODEL || 'llama3.1:8b',
      timeoutMs: positiveInteger(env.MANUAL_IMAGE_PLANNER_TIMEOUT_MS, 180_000, 30 * 60 * 1000),
    },
    generation: {
      endpoint: env.OLLAMA_URL || 'http://127.0.0.1:11434',
      model: env.MANUAL_IMAGE_MODEL || env.DIGITAL_ASSET_IMAGE_MODEL || 'x/flux2-klein:4b-fp8',
      timeoutMs: positiveInteger(env.MANUAL_IMAGE_GENERATION_TIMEOUT_MS, 1_200_000, 60 * 60 * 1000),
      negativePrompt: env.MANUAL_IMAGE_NEGATIVE_PROMPT
        || 'low quality, blurry, duplicate subject, accidental text, watermark, logo, cropped subject',
    },
    discord: {
      categoryName: env.MANUAL_IMAGE_DISCORD_CATEGORY || 'DIGITAL ASSETS',
      channelName: env.MANUAL_IMAGE_DISCORD_CHANNEL || 'manual-image-generation',
    },
  };
}

export async function ensureManualImageStorage(config) {
  if (config.permanentAssetRoot) {
    try {
      await access(config.permanentAssetRoot);
    } catch {
      throw new Error(`The digital-asset T7 root is unavailable: ${config.permanentAssetRoot}.`);
    }
  } else {
    try {
      await access(dirname(config.archiveRoot));
    } catch {
      throw new Error(`The parent storage volume is unavailable: ${dirname(config.archiveRoot)}.`);
    }
  }
  await mkdir(resolve(config.archiveRoot, 'jobs'), { recursive: true });
  return config.archiveRoot;
}
