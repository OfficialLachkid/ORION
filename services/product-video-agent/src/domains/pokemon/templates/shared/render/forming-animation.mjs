import { ensureNumber, roundTime } from '../../dual-type-reveal/render/constants.mjs';

export function buildFormingSpriteFilterChain({
  startSeconds,
  durationSeconds = 1,
} = {}) {
  const start = roundTime(Math.max(0, ensureNumber(startSeconds, 0)));
  const duration = roundTime(Math.max(0.08, ensureNumber(durationSeconds, 1)));
  return `fade=t=in:st=${start}:d=${duration}:color=white:alpha=0`;
}
