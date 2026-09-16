import { writeFile } from 'node:fs/promises';
import {
  escapeDrawtextText,
  escapeFilterPath,
} from '../../dual-type-reveal/render/constants.mjs';

const DEFAULT_CHANNEL_NAME = 'Poke Quizz';
const DEFAULT_FADE_SECONDS = 0.45;
const DEFAULT_START_SECONDS = 1.5;
const WATERMARK_BOTTOM_OFFSET_PX = 310;
const WATERMARK_FONT_SIZE = 54;
const WATERMARK_OUTLINE_WIDTH = 6;
const WATERMARK_SHADOW_OFFSET_PX = 7;
const WATERMARK_OPACITY = 0.5;

function finiteNonNegative(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function firstFiniteNonNegative(values, fallback) {
  for (const value of values) {
    const number = finiteNonNegative(value);
    if (number != null) return number;
  }
  return fallback;
}

export function resolvePokemonChannelIdentity(channelProfile = {}) {
  const name = String(channelProfile?.name || DEFAULT_CHANNEL_NAME).trim() || DEFAULT_CHANNEL_NAME;
  const configuredHandle = String(
    channelProfile?.handle
      || channelProfile?.metadata?.youtube_handle
      || channelProfile?.metadata?.channel_handle
      || '',
  ).trim();
  const fallbackHandle = `@${name.replace(/[^a-z0-9]+/giu, '')}`;
  return {
    id: String(channelProfile?.id || '').trim(),
    name,
    account_key: String(channelProfile?.account_key || '').trim(),
    handle: configuredHandle
      ? `@${configuredHandle.replace(/^@+/u, '')}`
      : fallbackHandle,
  };
}

export function resolveWatermarkStartSeconds(renderPlan = {}) {
  const firstRound = Array.isArray(renderPlan?.rounds) ? renderPlan.rounds[0] : null;
  const firstMatch = Array.isArray(renderPlan?.matches) ? renderPlan.matches[0] : null;
  return firstFiniteNonNegative([
    renderPlan?.phases?.hook?.end_seconds,
    renderPlan?.intro_hook?.scene_duration_seconds,
    renderPlan?.intro_hook?.round_start_seconds,
    firstMatch?.hook_visible_until_seconds,
    firstRound?.hook_visible_until_seconds,
    firstRound?.local?.countdown_start_seconds,
    firstRound?.countdown_start_seconds,
    firstRound?.local?.reveal_start_seconds,
    firstRound?.reveal_start_seconds,
  ], DEFAULT_START_SECONDS);
}

function buildTimingPart(startSeconds) {
  const start = Number(startSeconds.toFixed(3));
  const fadeEnd = Number((start + DEFAULT_FADE_SECONDS).toFixed(3));
  return `:alpha='if(lt(t,${start}),0,if(lt(t,${fadeEnd}),((t-${start})/${DEFAULT_FADE_SECONDS})*${WATERMARK_OPACITY},${WATERMARK_OPACITY}))':enable='gte(t,${start})'`;
}

export function applyChannelWatermarkToVisualFilter(visualFilter = {}, {
  plan = {},
  renderPlan = {},
  fontPath = '',
} = {}) {
  const script = String(visualFilter?.script || '');
  if (!script || script.includes('[channelwatermarkbase]')) return visualFilter;

  const outputMarker = '[vout]';
  const outputIndex = script.lastIndexOf(outputMarker);
  if (outputIndex < 0) {
    throw new Error('Pokemon video filter script is missing the shared [vout] output label.');
  }

  const channel = resolvePokemonChannelIdentity(plan?.channel || {});
  const escapedText = escapeDrawtextText(channel.handle);
  const fontPart = fontPath ? `:fontfile='${escapeFilterPath(fontPath)}'` : '';
  const canvasHeight = Math.max(320, Number(renderPlan?.canvas?.height) || 1920);
  const y = Math.round(canvasHeight - WATERMARK_BOTTOM_OFFSET_PX);
  const timingPart = buildTimingPart(resolveWatermarkStartSeconds(renderPlan));
  const baseScript = `${script.slice(0, outputIndex)}[channelwatermarkbase]${script.slice(outputIndex + outputMarker.length)}`
    .trim()
    .replace(/;$/u, '');

  return {
    ...visualFilter,
    script: [
      baseScript,
      `[channelwatermarkbase]drawtext=text='${escapedText}'${fontPart}${timingPart}:fontcolor=black@0.72:fontsize=${WATERMARK_FONT_SIZE}:borderw=${WATERMARK_OUTLINE_WIDTH}:bordercolor=black@0.82:fix_bounds=1:x=(w-text_w)/2+${WATERMARK_SHADOW_OFFSET_PX}:y=${y + WATERMARK_SHADOW_OFFSET_PX}[channelwatermarkshadow]`,
      `[channelwatermarkshadow]drawtext=text='${escapedText}'${fontPart}${timingPart}:fontcolor=0xFFE45C:fontsize=${WATERMARK_FONT_SIZE}:borderw=${WATERMARK_OUTLINE_WIDTH}:bordercolor=0x2446B8:fix_bounds=1:x=(w-text_w)/2:y=${y}[vout]`,
    ].join(';\n') + '\n',
  };
}

export async function writeChannelWatermarkedVisualFilterScript(
  filePath,
  visualFilter,
  options = {},
) {
  const transformed = applyChannelWatermarkToVisualFilter(visualFilter, options);
  await writeFile(filePath, transformed.script, 'utf8');
  return transformed;
}
