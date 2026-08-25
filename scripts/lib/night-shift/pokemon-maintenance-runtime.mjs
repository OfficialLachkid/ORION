import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { resolveVideoTemplateRuntime } from '../../../services/product-video-agent/src/video-template-context.mjs';
import {
  POKE_QUIZZ_REVIEW_TARGET_COUNT,
} from '../../../services/product-video-agent/src/poke-quizz-queue-status.mjs';
import { projectRoot } from '../../../services/lib/runtime-config.mjs';

const CHANNEL_CONFIGS_DIR = resolve(projectRoot, 'services', 'product-video-agent', 'config', 'channels');

function normalizeProjectRelativePath(absolutePath) {
  return relative(projectRoot, absolutePath).replaceAll('\\', '/');
}

function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function parsePositiveNumber(value, fallbackValue) {
  const parsed = Number.parseFloat(String(value || ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
    : [];
}

function normalizeTemplateWeights(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([templateId, weight]) => [
        String(templateId || '').trim(),
        parsePositiveNumber(weight, 1),
      ])
      .filter(([templateId]) => Boolean(templateId)),
  );
}

function normalizeNightShiftSettings(channelConfig = {}) {
  const nightShift = channelConfig?.night_shift && typeof channelConfig.night_shift === 'object'
    ? channelConfig.night_shift
    : {};
  const reviewBacklog = nightShift.review_backlog && typeof nightShift.review_backlog === 'object'
    ? nightShift.review_backlog
    : {};
  const reviewRefresh = nightShift.review_refresh && typeof nightShift.review_refresh === 'object'
    ? nightShift.review_refresh
    : {};
  const publicationAutomation = nightShift.publication_automation && typeof nightShift.publication_automation === 'object'
    ? nightShift.publication_automation
    : {};
  const rawPublicationAutomationMode = String(publicationAutomation.mode || '').trim().toLowerCase();
  const publicationAutomationEnabled = publicationAutomation.enabled === true
    || (
      publicationAutomation.enabled !== false
      && rawPublicationAutomationMode === 'auto'
    );
  return {
    reviewBacklogEnabled: reviewBacklog.enabled === true,
    targetReviewReadyCount: parsePositiveInteger(
      reviewBacklog.target_review_ready_count,
      POKE_QUIZZ_REVIEW_TARGET_COUNT,
    ),
    reviewBacklogMixChannelConfigPaths: normalizeStringArray(
      reviewBacklog.mix_channel_config_paths,
    ),
    reviewBacklogTemplateWeights: normalizeTemplateWeights(
      reviewBacklog.template_weights,
    ),
    reviewRefreshEnabled: reviewRefresh.enabled === true,
    reviewRefreshPendingOnly: reviewRefresh.pending_only !== false,
    publicationAutomationEnabled,
    publicationAutomationMode: publicationAutomationEnabled ? 'auto' : 'manual',
    publicationAutomationMaxScheduledDays: parsePositiveInteger(
      publicationAutomation.max_scheduled_days,
      3,
    ),
  };
}

export async function discoverNightShiftChannelRuntimes() {
  const entries = await readdir(CHANNEL_CONFIGS_DIR, { withFileTypes: true });
  const runtimes = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const absolutePath = resolve(CHANNEL_CONFIGS_DIR, entry.name);
    const rawChannelConfig = JSON.parse(await readFile(absolutePath, 'utf8'));
    const nightShift = normalizeNightShiftSettings(rawChannelConfig);
    if (
      !nightShift.reviewBacklogEnabled
      && !nightShift.reviewRefreshEnabled
      && !nightShift.publicationAutomationEnabled
    ) {
      continue;
    }

    const channelConfigPath = normalizeProjectRelativePath(absolutePath);
    const templateRuntime = await resolveVideoTemplateRuntime({
      projectRoot,
      channelConfigPath,
    });
    runtimes.push({
      ...templateRuntime,
      nightShift,
    });
  }

  return runtimes.sort((left, right) => (
    `${left.channelSelector}:${left.channelConfigPath}`.localeCompare(
      `${right.channelSelector}:${right.channelConfigPath}`,
    )
  ));
}
