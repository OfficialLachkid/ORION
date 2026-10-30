import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { probeMediaDurationSeconds } from '../../../../media-duration.mjs';
import { runLocalProcess } from '../../../../process-runner.mjs';
import { synthesizeNarrationTrack } from '../dual-type-reveal/render/narration-synthesis.mjs';

const BUBBLE_COLORS = Object.freeze([
  '#4CC9F0', '#F72585', '#B8F2E6', '#FFD166', '#9B5DE5', '#00F5D4',
  '#FF7B00', '#90BE6D', '#577590', '#F15BB5', '#43AA8B', '#F94144',
]);

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

function estimateSvgTextWidth(text, fontSize) {
  return [...String(text || '')].reduce((width, character) => {
    if (/\s/u.test(character)) return width + (fontSize * 0.36);
    if (/[MW]/u.test(character)) return width + (fontSize * 0.96);
    if (/[A-Z0-9]/u.test(character)) return width + (fontSize * 0.74);
    return width + (fontSize * 0.62);
  }, 0);
}

export function wrapTextInsideFrame({ text, frameWidth, fontSize, sideMargin = 50 }) {
  const words = String(text || '').trim().split(/\s+/u).filter(Boolean);
  const maximumWidth = Math.max(1, Number(frameWidth) - (Number(sideMargin) * 2));
  const lines = [];
  for (const word of words) {
    const candidate = lines.length > 0 ? `${lines.at(-1)} ${word}` : word;
    if (lines.length === 0 || estimateSvgTextWidth(candidate, fontSize) <= maximumWidth) {
      if (lines.length === 0) lines.push(word);
      else lines[lines.length - 1] = candidate;
    } else {
      lines.push(word);
    }
  }
  return {
    lines: lines.length > 0 ? lines : [''],
    maximum_width: maximumWidth,
    estimated_widths: (lines.length > 0 ? lines : [''])
      .map((line) => Math.min(maximumWidth, estimateSvgTextWidth(line, fontSize))),
  };
}

function buildBoundaryAwareTextMarkup({
  text,
  centerX,
  frameWidth,
  fontSize,
  startY,
  lineHeight,
  sideMargin = 50,
  attributes,
}) {
  const wrapped = wrapTextInsideFrame({ text, frameWidth, fontSize, sideMargin });
  const markup = wrapped.lines.map((line, index) => {
    const naturalWidth = estimateSvgTextWidth(line, fontSize);
    const fitAttributes = naturalWidth > wrapped.maximum_width
      ? ` textLength="${wrapped.maximum_width}" lengthAdjust="spacingAndGlyphs"`
      : '';
    return `<text x="${centerX}" y="${startY + (index * lineHeight)}" text-anchor="middle" font-size="${fontSize}"${fitAttributes} ${attributes}>${escapeXml(line)}</text>`;
  });
  return {
    ...wrapped,
    markup,
    end_y: startY + ((wrapped.lines.length - 1) * lineHeight),
  };
}

export function buildBubbleSurvivalTitleMarkup({ centerX, frameWidth }) {
  const title = buildBoundaryAwareTextMarkup({
    text: 'POKEMON BUBBLE SURVIVAL',
    centerX,
    frameWidth,
    fontSize: 30,
    startY: 88,
    lineHeight: 32,
    sideMargin: 50,
    attributes: 'font-family="Arial Black, Arial, sans-serif" font-weight="900" fill="#fff" stroke="#091020" stroke-width="5" paint-order="stroke"',
  });
  return {
    ...title,
    category_y: title.end_y + 31,
  };
}

function renderArenaSvg({ plan, template, videoTime, spriteDataUris }) {
  const width = Number(plan.video.frame_width);
  const height = Number(plan.video.frame_height);
  const introSeconds = Number(plan.video.intro_seconds);
  const simulationSeconds = Number(plan.simulation.duration_seconds);
  const winnerDelaySeconds = Number(plan.video.winner_delay_seconds || 0);
  const winnerStart = introSeconds + simulationSeconds + winnerDelaySeconds;
  const simulationTime = Math.max(0, videoTime - introSeconds);
  const state = resolveTimelineFrame(plan, videoTime);
  const subjects = plan.selection.selected_subjects;
  const subjectById = new Map(subjects.map((subject, index) => [subject.id, { ...subject, index }]));
  const bubbleById = new Map((state?.bubbles || []).map((bubble) => [bubble.id, bubble]));
  const centerX = Number(plan.simulation.config.center_x);
  const centerY = Number(plan.simulation.config.center_y);
  const arenaRadius = Number(plan.simulation.config.arena_radius);
  const bubbleRadius = Number(plan.simulation.config.bubble_radius);
  const defeatPopScale = Number(plan.simulation.config.defeat_pop_scale ?? 1.2);
  const defeatPopSeconds = Number(plan.simulation.config.defeat_pop_seconds ?? 0.1);
  const defeatShrinkSeconds = Number(plan.simulation.config.defeat_shrink_seconds ?? 0.577);
  const winnerMode = videoTime >= winnerStart;
  const introMode = videoTime < introSeconds;
  const winner = subjectById.get(plan.winner.id);

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
    const imageSize = bubbleRadius * 1.55 * renderScale;
    const counterOffset = bubbleRadius * 0.63 * renderScale;
    const counterX = bubble.x + counterOffset;
    const counterY = bubble.y - counterOffset;
    return [
      '<g>',
      bubble.is_defeated
        ? ''
        : `<circle cx="${bubble.x}" cy="${bubble.y}" r="${renderRadius + (3 * renderScale)}" fill="none" stroke="${color}" stroke-width="${8 * renderScale}" opacity="0.18"/>`,
      `<circle cx="${bubble.x}" cy="${bubble.y}" r="${renderRadius}" fill="#07111f" fill-opacity="0.94" stroke="${color}" stroke-width="${3 * renderScale}"/>`,
      `<image href="${spriteDataUris.get(subject.id)}" x="${bubble.x - (imageSize / 2)}" y="${bubble.y - (imageSize / 2)}" width="${imageSize}" height="${imageSize}" preserveAspectRatio="xMidYMid meet"/>`,
      `<circle cx="${counterX}" cy="${counterY}" r="${7 * renderScale}" fill="#06101c" stroke="${color}" stroke-width="${1.5 * renderScale}"/>`,
      `<text x="${counterX}" y="${counterY + (3 * renderScale)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${7 * renderScale}" font-weight="700" fill="#fff">${bubble.tail_count}</text>`,
      '</g>',
    ].join('');
  }).join('');

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
  } else if (winnerMode && winner) {
    const imageSize = 190;
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
      `<image href="${spriteDataUris.get(winner.id)}" x="${centerX - (imageSize / 2)}" y="${centerY - 120}" width="${imageSize}" height="${imageSize}" preserveAspectRatio="xMidYMid meet"/>`,
      `<text x="${centerX}" y="${centerY - 178}" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="34" font-weight="900" fill="#FFD166" stroke="#241900" stroke-width="5" paint-order="stroke">WINNER</text>`,
      ...winnerName.markup,
    ].join('');
  }

  const categoryLabel = escapeXml(String(plan.selection.category || '').replaceAll('-', ' ').toUpperCase());
  const title = buildBubbleSurvivalTitleMarkup({ centerX, frameWidth: width });
  return Buffer.from([
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<defs>',
    '<radialGradient id="bg" cx="50%" cy="42%" r="75%"><stop offset="0%" stop-color="#13233d"/><stop offset="58%" stop-color="#050914"/><stop offset="100%" stop-color="#010204"/></radialGradient>',
    '</defs>',
    `<rect width="${width}" height="${height}" fill="url(#bg)"/>`,
    '<g opacity="0.18">',
    ...Array.from({ length: 22 }, (_, index) => `<circle cx="${(index * 97) % width}" cy="${(index * 173) % height}" r="${1 + (index % 3)}" fill="#8edcff"/>`),
    '</g>',
    ...title.markup,
    `<text x="${centerX}" y="${title.category_y}" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#76ddff">${categoryLabel}</text>`,
    `<circle cx="${centerX}" cy="${centerY}" r="${arenaRadius + 5}" fill="#03101b" fill-opacity="0.36" stroke="#11263f" stroke-width="8"/>`,
    `<circle cx="${centerX}" cy="${centerY}" r="${arenaRadius + 2}" fill="none" stroke="#67dcff" stroke-width="11" opacity="0.16"/>`,
    `<circle cx="${centerX}" cy="${centerY}" r="${arenaRadius}" fill="none" stroke="#67dcff" stroke-width="3"/>`,
    tailMarkup,
    bubbleMarkup,
    `<text x="${centerX}" y="${height - 75}" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#b7c9dc">CROSS A RIVAL'S TAIL TO CUT IT</text>`,
    overlayMarkup,
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

async function loadSpriteDataUris(subjects) {
  const entries = await Promise.all(subjects.map(async (subject) => {
    const bytes = await readFile(subject.sprite_path);
    return [subject.id, `data:image/png;base64,${bytes.toString('base64')}`];
  }));
  return new Map(entries);
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
  const spriteDataUris = await loadSpriteDataUris(plan.selection.selected_subjects);
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
        spriteDataUris,
      });
      await sharp(svg, { sequentialRead: true })
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
  const winnerDingVolume = Number(plan.audio?.winner_ding_volume ?? 0.9);
  const defeatSoundVolume = Number(plan.audio?.defeat_sound_volume ?? 0.55);
  const defeatEvents = (Array.isArray(plan.simulation?.events) ? plan.simulation.events : [])
    .filter((event) => event?.type === 'eliminated' && Number.isFinite(Number(event.time)))
    .sort((left, right) => Number(left.time) - Number(right.time));
  const defeatInputs = defeatEvents.flatMap(() => [
    '-i', plan.assets.defeat_sound_path,
  ]);
  const defeatFilters = defeatEvents.map((event, index) => {
    const delayMs = Math.round((Number(plan.video.intro_seconds) + Number(event.time)) * 1000);
    return `[${index + 4}:a]atrim=0:2,asetpts=N/SR/TB,adelay=${delayMs}|${delayMs},volume=${defeatSoundVolume}[defeat_${index}]`;
  });
  const baseAudioFilter = '[music][voice][winner]amix=inputs=3:duration=first:dropout_transition=0';
  const audioMixFilter = defeatEvents.length > 0
    ? `${baseAudioFilter}[base];[base]${defeatEvents.map((_event, index) => `[defeat_${index}]`).join('')}amix=inputs=${defeatEvents.length + 1}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[audio]`
    : `${baseAudioFilter}[audio]`;
  const args = [
    '-y',
    '-framerate', String(plan.video.frame_fps),
    '-i', resolve(framesRoot, 'frame-%05d.png'),
    '-stream_loop', '-1',
    '-i', plan.assets.music_path,
    '-i', narrationPath,
    '-i', plan.assets.winner_ding_path,
    ...defeatInputs,
    '-filter_complex', [
      `[1:a]atrim=0:${durationSeconds.toFixed(3)},asetpts=N/SR/TB,volume=${musicVolume},afade=t=out:st=${winnerRevealSeconds.toFixed(3)}:d=${winnerSeconds.toFixed(3)}[music]`,
      `[2:a]atempo=${countdownPlaybackRate},atrim=0:${Number(plan.video.intro_seconds).toFixed(3)},asetpts=N/SR/TB,volume=1.0[voice]`,
      `[3:a]atrim=0:3,asetpts=N/SR/TB,adelay=${winnerDelayMs}|${winnerDelayMs},volume=${winnerDingVolume}[winner]`,
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
    winner: plan.winner,
  };
}
