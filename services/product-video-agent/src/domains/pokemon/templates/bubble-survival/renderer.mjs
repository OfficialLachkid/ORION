import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { probeMediaDurationSeconds } from '../../../../media-duration.mjs';
import { runLocalProcess } from '../../../../process-runner.mjs';
import { synthesizeNarrationTrack } from '../dual-type-reveal/render/narration-synthesis.mjs';
import {
  expandVisibleSpriteBounds,
  findVisibleSpriteBounds,
} from '../shared/render/sprite-visible-bounds.mjs';
import {
  buildAnimatedBubbleSurvivalTitleMarkup,
  buildBoundaryAwareTextMarkup,
  buildBubbleSurvivalTitleMarkup,
  resolveShowdownTitleAnimationState,
  wrapTextInsideFrame,
} from './title-renderer.mjs';
import {
  buildBubbleSurvivalArenaSvgMarkup,
  createBubbleSurvivalArenaGeometry,
} from './arena-geometry.mjs';

export {
  buildAnimatedBubbleSurvivalTitleMarkup,
  buildBubbleSurvivalTitleMarkup,
  resolveShowdownTitleAnimationState,
  wrapTextInsideFrame,
};

const BUBBLE_COLORS = Object.freeze([
  '#4CC9F0', '#F72585', '#B8F2E6', '#FFD166', '#9B5DE5', '#00F5D4',
  '#FF7B00', '#90BE6D', '#577590', '#F15BB5', '#43AA8B', '#F94144',
]);

const DEFAULT_NEON_PALETTE = Object.freeze([
  '#67DCFF', '#FFD166', '#9B5DE5', '#F72585', '#FF4D5A', '#FF7BCB', '#39E58C',
]);

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value || 'bubble-showdown')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeHexColor(value, fallback = '#67DCFF') {
  const normalized = String(value || '').trim().replace(/^0x/iu, '#');
  return /^#[0-9a-f]{6}$/iu.test(normalized) ? normalized.toUpperCase() : fallback;
}

function mixHexColors(left, right, ratio) {
  const amount = Math.min(1, Math.max(0, Number(ratio) || 0));
  const parse = (value, offset) => Number.parseInt(value.slice(offset, offset + 2), 16);
  const channel = (start, end) => Math.round(start + ((end - start) * amount))
    .toString(16).padStart(2, '0');
  return `#${channel(parse(left, 1), parse(right, 1))}${channel(parse(left, 3), parse(right, 3))}${channel(parse(left, 5), parse(right, 5))}`.toUpperCase();
}

export function resolveBubbleSurvivalNeonTheme({ plan = {}, template = {} } = {}) {
  const animation = template?.presentation?.showdown_title_animation || {};
  const configured = Array.isArray(animation.neon_palette)
    ? animation.neon_palette.map((color) => normalizeHexColor(color, '')).filter(Boolean)
    : [];
  const palette = configured.length > 0 ? configured : DEFAULT_NEON_PALETTE;
  const key = `${plan.seed || ''}|${plan.simulation?.config?.arena_shape || ''}|${plan.presentation?.round_number || ''}`;
  const accent = palette[hashText(key) % palette.length];
  return {
    accent,
    highlight: mixHexColors(accent, '#FFFFFF', 0.68),
    depth: mixHexColors(accent, '#071426', 0.44),
    stroke: mixHexColors(accent, '#020813', 0.7),
    glow: mixHexColors(accent, '#FFFFFF', 0.22),
  };
}

function buildPremiumTitleGradient(theme) {
  return `<linearGradient id="premiumTitleGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="46%" stop-color="${theme.highlight}"/><stop offset="100%" stop-color="${theme.accent}"/></linearGradient>`;
}

function escapeXml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || 'track';
}

function frameFileName(index) {
  return `frame-${String(index).padStart(5, '0')}.png`;
}

export function resolveCountdownVisualState(time, introSeconds, playbackRate = 1) {
  const duration = Math.max(0.001, Number(introSeconds) || 1.5);
  const rate = Math.max(0.1, Number(playbackRate) || 1);
  const scaledPhase = Math.max(0, (Number(time) / duration) * 4 * rate);
  const phaseIndex = Math.min(3, Math.floor(scaledPhase));
  return {
    text: ['3', '2', '1', "LET'S GO!"][phaseIndex],
    phase_index: phaseIndex,
    local_phase: Math.min(1, Math.max(0, scaledPhase - phaseIndex)),
  };
}

function resolveTimelineFrame(plan, videoTime) {
  const introSeconds = Number(plan.video.intro_seconds || 0);
  const simulationTime = Math.max(0, videoTime - introSeconds);
  const frames = plan.simulation.frames || [];
  if (simulationTime <= 0) return frames[0];
  const frameIndex = Math.min(
    frames.length - 1,
    Math.max(0, Math.round(simulationTime * Number(plan.video.frame_fps || 15))),
  );
  return frames[frameIndex] || frames.at(-1);
}

export function resolveDefeatedBubbleScale({
  bubble,
  simulationTime,
  popScale = 1.2,
  popSeconds = 0.1,
  shrinkSeconds = 0.577,
}) {
  if (!bubble?.is_defeated) return 1;
  if (bubble.defeated_at == null || !Number.isFinite(Number(bubble.defeated_at))) return 0;
  const elapsed = Math.max(0, Number(simulationTime) - Number(bubble.defeated_at));
  const maximumScale = Math.max(1, Number(popScale) || 1.2);
  const popDuration = Math.max(0.01, Number(popSeconds) || 0.1);
  if (elapsed < popDuration) {
    return 1 + ((maximumScale - 1) * (elapsed / popDuration));
  }
  const shrinkDuration = Math.max(0.05, Number(shrinkSeconds) || 0.577);
  const shrinkElapsed = elapsed - popDuration;
  const remainingScaleRatio = 1 - (shrinkElapsed / shrinkDuration);
  return remainingScaleRatio <= 1e-9 ? 0 : maximumScale * remainingScaleRatio;
}

export function resolveAnimatedRoundNumber({ videoTime, introSeconds, roundNumber }) {
  const target = Math.max(1, Math.round(Number(roundNumber) || 1));
  if (target === 1) return 1;
  const duration = Math.max(0.2, Math.min(Number(introSeconds) * 0.7, target * 0.085));
  const progress = Math.min(1, Math.max(0, Number(videoTime) / duration));
  const eased = 1 - ((1 - progress) ** 3);
  return Math.min(target, 1 + Math.floor(eased * target));
}

export function resolveDefeatedRosterEntries({ plan, template, videoTime }) {
  const config = template?.presentation?.defeated_roster || {};
  if (config.enabled !== true) return [];
  const introSeconds = Number(plan.video.intro_seconds || 0);
  const simulationTime = Math.max(0, Number(videoTime) - introSeconds);
  const popSeconds = Number(plan.simulation.config.defeat_pop_seconds ?? 0.1);
  const shrinkSeconds = Math.max(0.05, Number(plan.simulation.config.defeat_shrink_seconds ?? 0.577));
  const centerX = Number(plan.simulation.config.center_x);
  const centerY = Number(plan.simulation.config.center_y);
  const arenaRadius = Number(plan.simulation.config.arena_radius);
  const size = Math.max(24, Number(config.sprite_size ?? 70));
  const horizontalGap = Math.max(12, Number(config.horizontal_gap ?? 92));
  const columnOffset = arenaRadius + horizontalGap;
  const verticalGap = Math.max(size + 4, Number(config.vertical_gap ?? 92));
  const events = (Array.isArray(plan.simulation.events) ? plan.simulation.events : [])
    .filter((event) => event?.type === 'eliminated' && Number.isFinite(Number(event.time)))
    .sort((left, right) => Number(left.time) - Number(right.time));
  return events.flatMap((event, index) => {
    const enterStart = Number(event.time) + popSeconds + shrinkSeconds;
    const elapsed = simulationTime - enterStart;
    if (elapsed < 0) return [];
    const progress = Math.min(1, elapsed / shrinkSeconds);
    const scale = Math.sin((progress * Math.PI) / 2);
    const sideIndex = Math.floor(index / 2);
    const side = index % 2 === 0 ? -1 : 1;
    const slotsPerSide = Math.ceil(events.length / 2);
    const y = centerY + ((sideIndex - ((slotsPerSide - 1) / 2)) * verticalGap);
    const subjectIndex = plan.selection.selected_subjects.findIndex(
      (subject) => subject.id === event.bubble_id,
    );
    return [{
      subject_id: event.bubble_id,
      subject_index: subjectIndex,
      x: centerX + (side * columnOffset),
      y,
      size,
      scale,
    }];
  });
}

function buildBubbleSurvivalTextLayer({
  plan,
  template,
  videoTime,
  includeWinnerOverlay = true,
}) {
  const width = Number(plan.video.frame_width);
  const height = Number(plan.video.frame_height);
  const introSeconds = Number(plan.video.intro_seconds);
  const winnerStart = introSeconds
    + Number(plan.simulation.duration_seconds)
    + Number(plan.video.winner_delay_seconds || 0);
  const centerX = Number(plan.simulation.config.center_x);
  const centerY = Number(plan.simulation.config.center_y);
  const winnerMode = videoTime >= winnerStart;
  const introMode = videoTime < introSeconds;
  const winner = plan.selection.selected_subjects.find((subject) => subject.id === plan.winner.id);
  const theme = resolveBubbleSurvivalNeonTheme({ plan, template });

  let overlayMarkup = '';
  if (introMode) {
    const countdown = resolveCountdownVisualState(
      videoTime,
      introSeconds,
      plan.video.visual_countdown_playback_rate,
    );
    const scale = 1 + (Math.sin(countdown.local_phase * Math.PI) * 0.18);
    const baseFontSize = countdown.text.length > 2 ? 54 : 82;
    const countdownText = escapeXml(countdown.text);
    overlayMarkup = [
      `<rect width="${width}" height="${height}" fill="#02040a" fill-opacity="0.18"/>`,
      `<text x="${centerX}" y="${centerY + (14 * scale)}" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="${baseFontSize * scale}" font-weight="900" fill="none" stroke="#8ea7e8" stroke-width="${16 * scale}" opacity="0.16">${countdownText}</text>`,
      `<text x="${centerX}" y="${centerY + (14 * scale)}" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="${baseFontSize * scale}" font-weight="900" fill="#fff" stroke="#121b33" stroke-width="${7 * scale}" paint-order="stroke">${countdownText}</text>`,
    ].join('');
  } else if (winnerMode && winner && includeWinnerOverlay) {
    const winnerName = buildBoundaryAwareTextMarkup({
      text: winner.name.toUpperCase(),
      centerX,
      frameWidth: width,
      fontSize: 38,
      startY: centerY + 145,
      lineHeight: 42,
      sideMargin: 50,
      attributes: 'font-family="Arial Black, Arial, sans-serif" font-weight="900" fill="#fff" stroke="#11182a" stroke-width="6" paint-order="stroke"',
    });
    overlayMarkup = [
      `<rect width="${width}" height="${height}" fill="#02040a" fill-opacity="0.78"/>`,
      `<circle cx="${centerX}" cy="${centerY - 25}" r="142" fill="none" stroke="#FFD166" stroke-width="14" opacity="0.18"/>`,
      `<circle cx="${centerX}" cy="${centerY - 25}" r="135" fill="#0b1b31" stroke="#FFD166" stroke-width="6"/>`,
      `<text x="${centerX}" y="${centerY - 178}" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="34" font-weight="900" fill="#FFD166" stroke="#241900" stroke-width="5" paint-order="stroke">WINNER</text>`,
      ...winnerName.markup,
    ].join('');
  }

  const titlePresentation = template?.presentation?.title || {};
  const titleAnimation = template?.presentation?.showdown_title_animation || {};
  const title = titleAnimation.enabled === true
    ? buildAnimatedBubbleSurvivalTitleMarkup({
        centerX,
        frameWidth: width,
        videoTime,
        animation: titleAnimation,
        fontSize: Number(titlePresentation.font_size ?? 30),
        startY: Number(titlePresentation.y ?? 88),
        sideMargin: Number(titlePresentation.side_margin ?? 50),
        colors: {
          depth: theme.depth,
          stroke: theme.stroke,
          face_stroke: mixHexColors(theme.accent, '#020813', 0.62),
        },
      })
    : buildBubbleSurvivalTitleMarkup({ centerX, frameWidth: width });
  const roundIntroMarkup = introMode && plan?.presentation?.round_label
    ? (() => {
        const config = template?.presentation?.round_label || {};
        const fontSize = Number(config.font_size ?? 44);
        const categoryFontSize = Number(config.category_font_size ?? 28);
        const roundY = centerY - 132;
        const categoryY = centerY + 126;
        const backgroundWidth = Number(config.background_width ?? 360);
        const backgroundHeight = Number(config.background_height ?? 64);
        const categoryBackgroundWidth = Number(config.category_background_width ?? 350);
        const categoryBackgroundHeight = Number(config.category_background_height ?? 44);
        const targetRoundNumber = Number(plan.presentation.round_number || 0);
        const roundTotal = Number(plan.presentation.round_total || 0);
        const visibleRoundNumber = resolveAnimatedRoundNumber({
          videoTime,
          introSeconds,
          roundNumber: targetRoundNumber,
        });
        const roundLabel = targetRoundNumber > 0 && roundTotal > 0
          ? `ROUND ${visibleRoundNumber} / ${roundTotal}`
          : plan.presentation.round_label;
        return [
          `<rect x="${centerX - (backgroundWidth / 2)}" y="${roundY - (fontSize * 0.9)}" width="${backgroundWidth}" height="${backgroundHeight}" rx="14" fill="#020813" fill-opacity="0.88" stroke="${theme.accent}" stroke-width="2.5"/>`,
          `<text x="${centerX}" y="${roundY}" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="${fontSize}" font-weight="900" fill="#F4FBFF" stroke="${theme.stroke}" stroke-width="6" paint-order="stroke">${escapeXml(roundLabel)}</text>`,
          `<rect x="${centerX - (categoryBackgroundWidth / 2)}" y="${categoryY - (categoryFontSize * 0.9)}" width="${categoryBackgroundWidth}" height="${categoryBackgroundHeight}" rx="11" fill="#020813" fill-opacity="0.84" stroke="#FFD166" stroke-width="2"/>`,
          `<text x="${centerX}" y="${categoryY}" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="${categoryFontSize}" font-weight="900" fill="#FFD166" stroke="#704400" stroke-width="4" paint-order="stroke">${escapeXml(plan.presentation.category_label || '')}</text>`,
        ].join('');
      })()
    : '';

  return {
    markup: [...title.markup, overlayMarkup, roundIntroMarkup].join(''),
    winnerMode,
  };
}

export function renderArenaForegroundSvg({ plan, template, videoTime }) {
  const width = Number(plan.video.frame_width);
  const height = Number(plan.video.frame_height);
  const textLayer = buildBubbleSurvivalTextLayer({
    plan,
    template,
    videoTime,
    includeWinnerOverlay: false,
  });
  const theme = resolveBubbleSurvivalNeonTheme({ plan, template });
  return Buffer.from([
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<defs>${buildPremiumTitleGradient(theme)}</defs>`,
    textLayer.markup,
    '</svg>',
  ].join(''));
}

export function renderArenaSvg({ plan, template, videoTime }) {
  const width = Number(plan.video.frame_width);
  const height = Number(plan.video.frame_height);
  const introSeconds = Number(plan.video.intro_seconds);
  const simulationTime = Math.max(0, videoTime - introSeconds);
  const state = resolveTimelineFrame(plan, videoTime);
  const subjects = plan.selection.selected_subjects;
  const subjectById = new Map(subjects.map((subject, index) => [subject.id, { ...subject, index }]));
  const bubbleById = new Map((state?.bubbles || []).map((bubble) => [bubble.id, bubble]));
  const arenaGeometry = createBubbleSurvivalArenaGeometry(plan.simulation.config);
  const bubbleRadius = Number(plan.simulation.config.bubble_radius);
  const defeatPopScale = Number(plan.simulation.config.defeat_pop_scale ?? 1.2);
  const defeatPopSeconds = Number(plan.simulation.config.defeat_pop_seconds ?? 0.1);
  const defeatShrinkSeconds = Number(plan.simulation.config.defeat_shrink_seconds ?? 0.577);
  const theme = resolveBubbleSurvivalNeonTheme({ plan, template });
  const rosterEntries = resolveDefeatedRosterEntries({ plan, template, videoTime });
  const rosterMarkup = rosterEntries.map((entry) => {
    const color = BUBBLE_COLORS[Math.max(0, entry.subject_index) % BUBBLE_COLORS.length];
    const radius = (entry.size * 0.54) * entry.scale;
    return [
      `<circle cx="${entry.x}" cy="${entry.y}" r="${radius + (4 * entry.scale)}" fill="none" stroke="${color}" stroke-width="${7 * entry.scale}" opacity="0.16"/>`,
      `<circle cx="${entry.x}" cy="${entry.y}" r="${radius}" fill="#07111f" fill-opacity="0.92" stroke="${color}" stroke-width="${3 * entry.scale}"/>`,
    ].join('');
  }).join('');
  const tailMarkup = (state?.tails || []).map((tail) => {
    const bubble = bubbleById.get(tail.owner_id);
    const subject = subjectById.get(tail.owner_id);
    if (!bubble || !subject) return '';
    const color = BUBBLE_COLORS[subject.index % BUBBLE_COLORS.length];
    return `<line x1="${tail.anchor_x}" y1="${tail.anchor_y}" x2="${bubble.x}" y2="${bubble.y}" stroke="${color}" stroke-width="2.4" stroke-linecap="round" opacity="0.72"/>`;
  }).join('');

  const bubbleMarkup = (state?.bubbles || []).map((bubble) => {
    const subject = subjectById.get(bubble.id);
    if (!subject) return '';
    const color = BUBBLE_COLORS[subject.index % BUBBLE_COLORS.length];
    const renderScale = resolveDefeatedBubbleScale({
      bubble,
      simulationTime,
      popScale: defeatPopScale,
      popSeconds: defeatPopSeconds,
      shrinkSeconds: defeatShrinkSeconds,
    });
    // Avoid librsvg corruption once the sprite becomes a sub-pixel-scale despawn remnant.
    if (renderScale <= 0.2) return '';
    const renderRadius = bubbleRadius * renderScale;
    return [
      '<g>',
      bubble.is_defeated
        ? ''
        : `<circle cx="${bubble.x}" cy="${bubble.y}" r="${renderRadius + (3 * renderScale)}" fill="none" stroke="${color}" stroke-width="${8 * renderScale}" opacity="0.18"/>`,
      `<circle cx="${bubble.x}" cy="${bubble.y}" r="${renderRadius}" fill="#07111f" fill-opacity="0.94" stroke="${color}" stroke-width="${3 * renderScale}"/>`,
      '</g>',
    ].join('');
  }).join('');

  const textLayer = buildBubbleSurvivalTextLayer({ plan, template, videoTime });
  return Buffer.from([
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<defs>',
    '<radialGradient id="bg" cx="50%" cy="42%" r="75%"><stop offset="0%" stop-color="#13233d"/><stop offset="58%" stop-color="#050914"/><stop offset="100%" stop-color="#010204"/></radialGradient>',
    buildPremiumTitleGradient(theme),
    '</defs>',
    `<rect width="${width}" height="${height}" fill="url(#bg)"/>`,
    '<g opacity="0.18">',
    ...Array.from({ length: 22 }, (_, index) => `<circle cx="${(index * 97) % width}" cy="${(index * 173) % height}" r="${1 + (index % 3)}" fill="#8edcff"/>`),
    '</g>',
    ...buildBubbleSurvivalArenaSvgMarkup(arenaGeometry, { stroke: theme.accent }),
    rosterMarkup,
    tailMarkup,
    bubbleMarkup,
    textLayer.markup,
    '</svg>',
  ].join(''));
}

async function mapWithConcurrency(values, concurrency, iteratee) {
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      await iteratee(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
}

export async function cropSpriteToVisibleAlphaBounds(source, cropPadding = 4) {
  const decoded = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bounds = findVisibleSpriteBounds(decoded.data, decoded.info);
  const crop = expandVisibleSpriteBounds(bounds, cropPadding);
  if (!crop) return source;
  return sharp(source)
    .ensureAlpha()
    .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
    .png()
    .toBuffer();
}

async function loadSpriteBuffers(subjects) {
  const entries = await Promise.all(subjects.map(async (subject) => {
    const bytes = await readFile(subject.sprite_path);
    return [subject.id, await cropSpriteToVisibleAlphaBounds(bytes)];
  }));
  return new Map(entries);
}

export async function resizeSprite({ subjectId, size, spriteBuffers, resizedSpriteCache }) {
  const roundedSize = Math.max(1, Math.round(size));
  const cacheKey = `${subjectId}:${roundedSize}`;
  if (!resizedSpriteCache.has(cacheKey)) {
    const source = spriteBuffers.get(subjectId);
    if (!source) throw new Error(`Missing Bubble Survival sprite buffer for ${subjectId}.`);
    resizedSpriteCache.set(cacheKey, sharp(source)
      .ensureAlpha()
      .resize(roundedSize, roundedSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .raw()
      .toBuffer({ resolveWithObject: true }));
  }
  const resized = await resizedSpriteCache.get(cacheKey);
  return {
    input: resized.data,
    size: roundedSize,
    width: resized.info.width,
    height: resized.info.height,
    channels: resized.info.channels,
  };
}

export function alphaBlendRgba({
  destination,
  destinationWidth,
  destinationHeight,
  source,
  sourceWidth,
  sourceHeight,
  left,
  top,
}) {
  const offsetX = Number(left);
  const offsetY = Number(top);
  const startX = Math.max(0, Math.floor(offsetX));
  const startY = Math.max(0, Math.floor(offsetY));
  const endX = Math.min(destinationWidth, Math.ceil(offsetX + sourceWidth));
  const endY = Math.min(destinationHeight, Math.ceil(offsetY + sourceHeight));
  for (let destinationY = startY; destinationY < endY; destinationY += 1) {
    const sourceY = destinationY - offsetY;
    const sourceY0 = Math.floor(sourceY);
    const fractionY = sourceY - sourceY0;
    for (let destinationX = startX; destinationX < endX; destinationX += 1) {
      const sourceX = destinationX - offsetX;
      const sourceX0 = Math.floor(sourceX);
      const fractionX = sourceX - sourceX0;
      const samples = [
        [sourceX0, sourceY0, (1 - fractionX) * (1 - fractionY)],
        [sourceX0 + 1, sourceY0, fractionX * (1 - fractionY)],
        [sourceX0, sourceY0 + 1, (1 - fractionX) * fractionY],
        [sourceX0 + 1, sourceY0 + 1, fractionX * fractionY],
      ];
      let sourceAlpha = 0;
      const sourcePremultiplied = [0, 0, 0];
      for (const [sampleX, sampleY, weight] of samples) {
        if (weight <= 0
          || sampleX < 0 || sampleX >= sourceWidth
          || sampleY < 0 || sampleY >= sourceHeight) continue;
        const sourceOffset = ((sampleY * sourceWidth) + sampleX) * 4;
        const sampleAlpha = source[sourceOffset + 3] / 255;
        sourceAlpha += sampleAlpha * weight;
        for (let channel = 0; channel < 3; channel += 1) {
          sourcePremultiplied[channel] += (source[sourceOffset + channel] / 255)
            * sampleAlpha * weight;
        }
      }
      if (sourceAlpha <= 0) continue;
      const destinationOffset = ((destinationY * destinationWidth) + destinationX) * 4;
      const destinationAlpha = destination[destinationOffset + 3] / 255;
      const outputAlpha = sourceAlpha + (destinationAlpha * (1 - sourceAlpha));
      for (let channel = 0; channel < 3; channel += 1) {
        const destinationPremultiplied = (destination[destinationOffset + channel] / 255)
          * destinationAlpha;
        destination[destinationOffset + channel] = Math.round((
          (sourcePremultiplied[channel]
            + (destinationPremultiplied * (1 - sourceAlpha))) / outputAlpha
        ) * 255);
      }
      destination[destinationOffset + 3] = Math.round(outputAlpha * 255);
    }
  }
}

async function buildSpriteComposites({
  plan,
  template,
  videoTime,
  spriteBuffers,
  resizedSpriteCache,
}) {
  const introSeconds = Number(plan.video.intro_seconds);
  const simulationSeconds = Number(plan.simulation.duration_seconds);
  const winnerStart = introSeconds
    + simulationSeconds
    + Number(plan.video.winner_delay_seconds || 0);
  const centerX = Number(plan.simulation.config.center_x);
  const centerY = Number(plan.simulation.config.center_y);
  if (videoTime >= winnerStart) {
    const sprite = await resizeSprite({
      subjectId: plan.winner.id,
      size: 190,
      spriteBuffers,
      resizedSpriteCache,
    });
    return [{
      input: sprite.input,
      width: sprite.width,
      height: sprite.height,
      left: centerX - (sprite.size / 2),
      top: centerY - 120,
    }];
  }

  const state = resolveTimelineFrame(plan, videoTime);
  const simulationTime = Math.max(0, videoTime - introSeconds);
  const bubbleRadius = Number(plan.simulation.config.bubble_radius);
  const composites = [];
  for (const bubble of state?.bubbles || []) {
    const renderScale = resolveDefeatedBubbleScale({
      bubble,
      simulationTime,
      popScale: Number(plan.simulation.config.defeat_pop_scale ?? 1.2),
      popSeconds: Number(plan.simulation.config.defeat_pop_seconds ?? 0.1),
      shrinkSeconds: Number(plan.simulation.config.defeat_shrink_seconds ?? 0.577),
    });
    if (renderScale <= 0.2) continue;
    const sprite = await resizeSprite({
      subjectId: bubble.id,
      size: bubbleRadius * 1.55 * renderScale,
      spriteBuffers,
      resizedSpriteCache,
    });
    composites.push({
      input: sprite.input,
      width: sprite.width,
      height: sprite.height,
      left: bubble.x - (sprite.size / 2),
      top: bubble.y - (sprite.size / 2),
    });
  }
  const rosterEntries = resolveDefeatedRosterEntries({ plan, template, videoTime });
  for (const entry of rosterEntries) {
    if (entry.scale <= 0.01) continue;
    const sprite = await resizeSprite({
      subjectId: entry.subject_id,
      size: entry.size * entry.scale,
      spriteBuffers,
      resizedSpriteCache,
    });
    composites.push({
      input: sprite.input,
      width: sprite.width,
      height: sprite.height,
      left: entry.x - (sprite.size / 2),
      top: entry.y - (sprite.size / 2),
    });
  }
  return composites;
}

async function renderFrames({ plan, template, framesRoot }) {
  await rm(framesRoot, { recursive: true, force: true });
  await mkdir(framesRoot, { recursive: true });
  const durationSeconds = Number((Number(plan.video.intro_seconds)
    + Number(plan.simulation.duration_seconds)
    + Number(plan.video.winner_delay_seconds || 0)
    + Number(plan.video.winner_seconds)).toFixed(3));
  const frameFps = Number(plan.video.frame_fps);
  const frameCount = Math.ceil(durationSeconds * frameFps);
  const spriteBuffers = await loadSpriteBuffers(plan.selection.selected_subjects);
  const resizedSpriteCache = new Map();
  const indexes = Array.from({ length: frameCount }, (_, index) => index);
  const previousConcurrency = sharp.concurrency();
  const previousCache = sharp.cache();
  sharp.concurrency(1);
  sharp.cache(false);
  try {
    // librsvg can corrupt unrelated SVG tiles when sprite frames are rasterized concurrently.
    await mapWithConcurrency(indexes, 1, async (index) => {
      const svg = renderArenaSvg({
        plan,
        template,
        videoTime: index / frameFps,
      });
      const videoTime = index / frameFps;
      const spriteComposites = await buildSpriteComposites({
        plan,
        template,
        videoTime,
        spriteBuffers,
        resizedSpriteCache,
      });
      const baseFrame = await sharp(svg, { sequentialRead: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (const sprite of spriteComposites) {
        alphaBlendRgba({
          destination: baseFrame.data,
          destinationWidth: baseFrame.info.width,
          destinationHeight: baseFrame.info.height,
          source: sprite.input,
          sourceWidth: sprite.width,
          sourceHeight: sprite.height,
          left: sprite.left,
          top: sprite.top,
        });
      }
      const foregroundSvg = renderArenaForegroundSvg({ plan, template, videoTime });
      const foreground = await sharp(foregroundSvg, { sequentialRead: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      alphaBlendRgba({
        destination: baseFrame.data,
        destinationWidth: baseFrame.info.width,
        destinationHeight: baseFrame.info.height,
        source: foreground.data,
        sourceWidth: foreground.info.width,
        sourceHeight: foreground.info.height,
        left: 0,
        top: 0,
      });
      await sharp(baseFrame.data, {
        raw: {
          width: baseFrame.info.width,
          height: baseFrame.info.height,
          channels: baseFrame.info.channels,
        },
      })
        .png({ compressionLevel: 4 })
        .toFile(resolve(framesRoot, frameFileName(index)));
    });
  } finally {
    sharp.concurrency(previousConcurrency);
    sharp.cache(previousCache);
  }
  return { durationSeconds, frameCount };
}

export function buildBubbleSurvivalFfmpegArgs({
  plan,
  framesRoot,
  narrationPath,
  outputPath,
  durationSeconds,
}) {
  const countdownPlaybackRate = Math.min(2, Math.max(0.5, Number(plan.video.countdown_playback_rate || 1)));
  const winnerRevealSeconds = Number(plan.video.intro_seconds)
    + Number(plan.simulation.duration_seconds)
    + Number(plan.video.winner_delay_seconds || 0);
  const winnerDelayMs = Math.round(winnerRevealSeconds * 1000);
  const winnerSeconds = Number(plan.video.winner_seconds || 0);
  const musicVolume = Number(plan.audio?.music_volume ?? 0.12);
  const winnerDingVolume = Number(plan.audio?.winner_ding_volume ?? 0.36);
  const winnerCryPath = String(plan.assets?.winner_cry_path || '').trim();
  const winnerCryVolume = Number(plan.audio?.winner_cry_volume ?? 0.12);
  const winnerCryDelaySeconds = Math.max(0, Number(plan.audio?.winner_cry_delay_seconds ?? 0.18));
  const winnerCryDelayMs = Math.round((winnerRevealSeconds + winnerCryDelaySeconds) * 1000);
  const defeatSoundVolume = Number(plan.audio?.defeat_sound_volume ?? 0.165);
  const defeatEvents = (Array.isArray(plan.simulation?.events) ? plan.simulation.events : [])
    .filter((event) => event?.type === 'eliminated' && Number.isFinite(Number(event.time)))
    .sort((left, right) => Number(left.time) - Number(right.time));
  const defeatInputs = defeatEvents.flatMap(() => [
    '-i', plan.assets.defeat_sound_path,
  ]);
  const defeatInputStartIndex = winnerCryPath ? 5 : 4;
  const defeatFilters = defeatEvents.map((event, index) => {
    const delayMs = Math.round((Number(plan.video.intro_seconds) + Number(event.time)) * 1000);
    return `[${index + defeatInputStartIndex}:a]atrim=0:2,asetpts=N/SR/TB,adelay=${delayMs}|${delayMs},volume=${defeatSoundVolume}[defeat_${index}]`;
  });
  const winnerCryFilter = winnerCryPath
    ? `[4:a]silenceremove=start_periods=1:start_duration=0.02:start_threshold=-50dB,adelay=${winnerCryDelayMs}|${winnerCryDelayMs},volume=${winnerCryVolume}[winnercry]`
    : '';
  const baseMixLabels = winnerCryPath
    ? '[music][voice][winner][winnercry]'
    : '[music][voice][winner]';
  const baseAudioFilter = `${baseMixLabels}amix=inputs=${winnerCryPath ? 4 : 3}:duration=first:dropout_transition=0`;
  const audioMixFilter = defeatEvents.length > 0
    ? `${baseAudioFilter}[base];[base]${defeatEvents.map((_event, index) => `[defeat_${index}]`).join('')}amix=inputs=${defeatEvents.length + 1}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[audio]`
    : `${baseAudioFilter}[audio]`;
  const args = [
    '-y',
    '-framerate', String(plan.video.frame_fps),
    '-i', resolve(framesRoot, 'frame-%05d.png'),
    '-i', plan.assets.music_path,
    '-i', narrationPath,
    '-i', plan.assets.winner_ding_path,
    ...(winnerCryPath ? ['-i', winnerCryPath] : []),
    ...defeatInputs,
    '-filter_complex', [
      `[1:a]atrim=0:${durationSeconds.toFixed(3)},asetpts=N/SR/TB,volume=${musicVolume},afade=t=out:st=${winnerRevealSeconds.toFixed(3)}:d=${winnerSeconds.toFixed(3)}[music]`,
      `[2:a]atempo=${countdownPlaybackRate},atrim=0:${Number(plan.video.intro_seconds).toFixed(3)},asetpts=N/SR/TB,volume=1.0[voice]`,
      `[3:a]atrim=0:3,asetpts=N/SR/TB,adelay=${winnerDelayMs}|${winnerDelayMs},volume=${winnerDingVolume}[winner]`,
      ...(winnerCryFilter ? [winnerCryFilter] : []),
      ...defeatFilters,
      audioMixFilter,
    ].join(';'),
    '-map', '0:v:0',
    '-map', '[audio]',
    '-vf', `scale=${plan.video.output_width}:${plan.video.output_height}:flags=lanczos`,
    '-r', String(plan.video.output_fps),
    '-t', durationSeconds.toFixed(3),
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outputPath,
  ];
  return args;
}

export function buildPokeQuizzRenderPlan({ plan }) {
  const durationSeconds = Number((Number(plan.video.intro_seconds)
    + Number(plan.simulation.duration_seconds)
    + Number(plan.video.winner_delay_seconds || 0)
    + Number(plan.video.winner_seconds)).toFixed(3));
  return {
    template_id: plan.template_id,
    duration_seconds: durationSeconds,
    winner: plan.winner,
    frame_count: Math.ceil(durationSeconds * Number(plan.video.frame_fps)),
  };
}

export async function renderPokeQuizzVideo({
  plan,
  template,
  outputPath,
  projectRoot,
  ffmpegExecutable,
  kokoro,
  runtimeRoot,
}) {
  const resolvedOutputPath = resolve(outputPath);
  const runRoot = resolve(runtimeRoot, `bubble-survival-${slugify(plan.seed)}`);
  const framesRoot = resolve(runRoot, 'frames');
  const narrationPath = resolve(runRoot, 'narration', 'countdown.wav');
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await synthesizeNarrationTrack({
    pythonExecutable: kokoro.pythonExecutable,
    scriptPath: kokoro.scriptPath,
    cacheDir: kokoro.cacheDir,
    profile: kokoro.profile,
    outputPath: narrationPath,
    text: plan.narration.lines[0].text,
    cwd: projectRoot,
  });
  const narrationDuration = await probeMediaDurationSeconds({
    ffmpegExecutable,
    mediaPath: narrationPath,
    cwd: projectRoot,
  });
  if (!narrationDuration) {
    throw new Error('Bubble Survival countdown narration could not be probed.');
  }
  const requiredMusicDuration = buildPokeQuizzRenderPlan({ plan }).duration_seconds;
  const musicDuration = await probeMediaDurationSeconds({
    ffmpegExecutable,
    mediaPath: plan.assets.music_path,
    cwd: projectRoot,
  });
  if (!musicDuration || musicDuration + 0.001 < requiredMusicDuration) {
    throw new Error(
      `Bubble Survival music must be at least ${requiredMusicDuration.toFixed(3)} seconds long; selected track is ${musicDuration || 0} seconds.`,
    );
  }
  const { durationSeconds, frameCount } = await renderFrames({ plan, template, framesRoot });
  await runLocalProcess({
    executable: ffmpegExecutable,
    args: buildBubbleSurvivalFfmpegArgs({
      plan,
      framesRoot,
      narrationPath,
      outputPath: resolvedOutputPath,
      durationSeconds,
    }),
    cwd: projectRoot,
    timeoutMs: 900_000,
  });
  const outputStat = await stat(resolvedOutputPath);
  if (outputStat.size < 1024) {
    throw new Error(`Bubble Survival output is unexpectedly small (${outputStat.size} bytes).`);
  }
  return {
    output_path: resolvedOutputPath,
    duration_seconds: durationSeconds,
    frame_count: frameCount,
    narration_paths: [narrationPath],
    music_duration_seconds: musicDuration,
    winner: plan.winner,
  };
}
