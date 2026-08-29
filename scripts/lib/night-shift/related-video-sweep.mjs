import { collectChildError, parseTrailingJsonArray } from './process-utils.mjs';

const DEFAULT_PUBLICATION_CHANNELS_PATH = 'services/product-video-agent/publication-channels.example.json';
const DEFAULT_SWEEP_TIMEOUT_MS = 45 * 60 * 1000;

// Run --refresh-related-videos --include-published for a single channel.
// Guarded to only touch rows whose apply_status !== 'applied' (via the
// script's own isPublishedBackfillNeeded filter), so a full pass is a
// cheap no-op on channels where everything is already covered. Rolls
// the per-row outcomes into a compact status summary the night-shift
// digest can surface without dumping the whole JSON payload.
export function runNightShiftRelatedVideoRefresh({
  profile,
  asOf,
  runNodeScript,
  channelsPath = DEFAULT_PUBLICATION_CHANNELS_PATH,
  timeoutMs = DEFAULT_SWEEP_TIMEOUT_MS,
} = {}) {
  const child = runNodeScript(
    'services/product-video-agent/scripts/execute-youtube-publication.mjs',
    [
      '--channel', profile.account_key,
      '--channels', channelsPath,
      '--refresh-related-videos',
      '--include-published',
      '--as-of', asOf,
    ],
    { timeoutMs },
  );
  const parsed = Array.isArray(parseTrailingJsonArray(child.stdout))
    ? parseTrailingJsonArray(child.stdout)
    : [];
  const errors = [];
  const stderrOut = collectChildError(child);
  if (stderrOut) errors.push(`related-video refresh error for ${profile.account_key}: ${stderrOut}`);
  return {
    status: errors.length > 0 && parsed.length === 0 ? 'failed' : 'completed',
    exitCode: child.status ?? 0,
    total: parsed.length,
    applied: parsed.filter((r) => r?.related_video_apply_status === 'applied').length,
    manualActionRequired: parsed.filter((r) => r?.related_video_apply_status === 'manual_action_required').length,
    skippedQuota: parsed.filter((r) => r?.related_video_apply_status === 'skipped_quota').length,
    featureUnavailable: parsed.filter((r) => r?.related_video_apply_status === 'feature_unavailable').length,
    errors,
  };
}
