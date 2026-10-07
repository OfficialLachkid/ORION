#!/usr/bin/env node

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import { SupabasePublicationStore } from '../services/product-video-agent/src/publication-store.mjs';
import {
  TIKTOK_DEFAULT_PRIVACY_LEVEL,
  TIKTOK_DIRECT_POST_APPROVAL_VERSION,
  buildTikTokCaption,
} from '../services/product-video-agent/src/tiktok-publication.mjs';
import {
  hashFileSha256,
  preflightTikTokVideo,
  resolveTikTokRenderPath,
} from '../services/product-video-agent/src/tiktok-publication-executor.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  printWarn,
  projectRoot,
} from './lib/ruflo-wrapper-utils.mjs';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeUsername(value) {
  return normalizeText(value).replace(/^@/u, '').toLowerCase();
}

function createPublicationStore(runtimeConfig) {
  return new SupabasePublicationStore({
    supabaseUrl: runtimeConfig.env.SUPABASE_URL || '',
    apiKey: runtimeConfig.env.SUPABASE_SECRET_KEY
      || runtimeConfig.env.SUPABASE_PUBLISHABLE_KEY
      || '',
  });
}

function resolveStoredTarget(publication = {}) {
  const stored = publication.metadata?.publisher_target;
  if (!stored || typeof stored !== 'object') {
    throw new Error(`TikTok publication ${publication.id || ''} has no stored publisher target.`);
  }
  return {
    platform: 'tiktok_video',
    accountKey: normalizeText(stored.account_key || publication.account_key),
    visibility: normalizeText(stored.visibility || publication.visibility || 'private'),
    tiktok: stored.tiktok && typeof stored.tiktok === 'object' ? stored.tiktok : {},
    metadata: stored.metadata && typeof stored.metadata === 'object' ? stored.metadata : {},
  };
}

function requireDisclosureChoice(options, key) {
  if (!Object.prototype.hasOwnProperty.call(options, key)) {
    throw new Error(`Choose --${key} or --no-${key}; ORION will not infer a disclosure answer.`);
  }
  return getBooleanOption(options, key, false);
}

export function buildTikTokDirectPostApproval({
  publication,
  target,
  renderPath,
  videoSizeBytes,
  videoSha256,
  creatorUsername,
  caption,
  privacyLevel,
  allowComment,
  allowDuet,
  allowStitch,
  brandContentToggle,
  brandOrganicToggle,
  isAigc,
  approvedAt,
  approvedBy = 'local_operator',
}) {
  return {
    version: TIKTOK_DIRECT_POST_APPROVAL_VERSION,
    approved: true,
    approved_at: approvedAt,
    approved_by: approvedBy,
    publication_id: publication.id,
    video_id: publication.video_id,
    account_key: target.accountKey,
    creator_username: normalizeUsername(creatorUsername),
    render_path: renderPath,
    video_size_bytes: Number(videoSizeBytes),
    video_sha256: videoSha256,
    caption: String(caption ?? ''),
    privacy_level: normalizeText(privacyLevel),
    allow_comment: Boolean(allowComment),
    allow_duet: Boolean(allowDuet),
    allow_stitch: Boolean(allowStitch),
    brand_content_toggle: Boolean(brandContentToggle),
    brand_organic_toggle: Boolean(brandOrganicToggle),
    is_aigc: Boolean(isAigc),
  };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: npm run product-video:approve-tiktok-post -- --publication <id> --aigc|--no-aigc [options]',
      '',
      'Runs a non-publishing TikTok preflight and prints the exact Direct Post choices.',
      'Add --confirm only after reviewing that output to save per-publication approval.',
      '',
      'Options:',
      '  --publication <id>       Required video_publications row id.',
      '  --creator <username>     Expected creator; defaults to target expected_username.',
      '  --caption <text>         Exact caption; defaults to the generated publication caption.',
      '  --privacy <level>        Defaults to SELF_ONLY.',
      '  --allow-comments         Opt in to comments. Default: disabled.',
      '  --allow-duet             Opt in to Duet. Default: disabled.',
      '  --allow-stitch           Opt in to Stitch. Default: disabled.',
      '  --brand-content          Mark paid branded content.',
      '  --brand-organic          Mark promotion of your own brand.',
      '  --aigc / --no-aigc      Required AI-generated-content disclosure choice.',
      '  --approved-by <label>    Audit label. Default: local_operator.',
      '  --confirm                Save approval; never uploads content.',
    ]);
    return;
  }

  const publicationId = getStringOption(options, 'publication', '');
  if (!publicationId) throw new Error('The --publication option is required.');

  const runtimeConfig = loadRuntimeConfig();
  const store = createPublicationStore(runtimeConfig);
  const publication = await store.fetchPublicationById(publicationId);
  if (!publication) throw new Error(`Publication ${publicationId} was not found.`);
  if (normalizeText(publication.platform) !== 'tiktok_video') {
    throw new Error(`Publication ${publicationId} is not a TikTok delivery row.`);
  }
  const videoRow = publication.video_id
    ? await store.fetchVideoById(publication.video_id)
    : null;
  const target = resolveStoredTarget(publication);
  const creatorUsername = normalizeUsername(
    getStringOption(options, 'creator', target.tiktok.expected_username || ''),
  );
  if (!creatorUsername) {
    throw new Error('Set target.tiktok.expected_username or pass --creator <username>.');
  }

  const renderPath = resolveTikTokRenderPath(publication, videoRow, projectRoot);
  const fileStats = await stat(renderPath);
  const videoSha256 = await hashFileSha256(renderPath);
  const caption = getStringOption(options, 'caption', buildTikTokCaption(publication, target));
  const approval = buildTikTokDirectPostApproval({
    publication,
    target,
    renderPath,
    videoSizeBytes: fileStats.size,
    videoSha256,
    creatorUsername,
    caption,
    privacyLevel: getStringOption(options, 'privacy', TIKTOK_DEFAULT_PRIVACY_LEVEL),
    allowComment: getBooleanOption(options, 'allow-comments', false),
    allowDuet: getBooleanOption(options, 'allow-duet', false),
    allowStitch: getBooleanOption(options, 'allow-stitch', false),
    brandContentToggle: getBooleanOption(options, 'brand-content', false),
    brandOrganicToggle: getBooleanOption(options, 'brand-organic', false),
    isAigc: requireDisclosureChoice(options, 'aigc'),
    approvedAt: new Date().toISOString(),
    approvedBy: getStringOption(options, 'approved-by', 'local_operator'),
  });
  const candidatePublication = {
    ...publication,
    metadata: {
      ...(publication.metadata || {}),
      tiktok_direct_post_approval: approval,
    },
  };
  const preflight = await preflightTikTokVideo({
    publication: candidatePublication,
    videoRow,
    target,
    runtimeEnv: runtimeConfig.env,
    projectRoot,
  });

  process.stdout.write(`${JSON.stringify({
    publication_id: publication.id,
    account_key: target.accountKey,
    creator_username: preflight.creatorUsername,
    creator_nickname: preflight.creatorNickname,
    caption: preflight.request.post_info.title,
    privacy_level: preflight.request.post_info.privacy_level,
    comments_enabled: !preflight.request.post_info.disable_comment,
    duet_enabled: !preflight.request.post_info.disable_duet,
    stitch_enabled: !preflight.request.post_info.disable_stitch,
    brand_content_toggle: preflight.request.post_info.brand_content_toggle,
    brand_organic_toggle: preflight.request.post_info.brand_organic_toggle,
    is_aigc: preflight.request.post_info.is_aigc,
    video_duration_seconds: preflight.videoDurationSeconds,
    creator_duration_limit_seconds: preflight.maxVideoPostDurationSeconds,
    render_path: preflight.renderPath,
    video_size_bytes: preflight.videoSizeBytes,
  }, null, 2)}\n`);

  if (!getBooleanOption(options, 'confirm', false)) {
    printWarn('Preflight passed. No approval was saved; review the values and rerun with --confirm.');
    return;
  }

  const existingState = normalizeText(publication.metadata?.workflow_state).toLowerCase();
  const restoreScheduled = publication.status === 'blocked' && existingState === 'approval_required';
  await store.updatePublication(publication.id, {
    ...(restoreScheduled ? { status: 'scheduled' } : {}),
    metadata: {
      ...(publication.metadata || {}),
      ...(restoreScheduled ? { workflow_state: 'scheduled' } : {}),
      tiktok_direct_post_approval: approval,
    },
  });
  printInfo('TikTok Direct Post approval saved. No upload was made.');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`[error] ${error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}
