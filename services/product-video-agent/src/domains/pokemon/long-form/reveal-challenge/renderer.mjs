import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runLocalProcess } from '../../../../process-runner.mjs';
import {
  DEFAULT_FONT_CANDIDATES,
  escapeDrawtextText,
  escapeFilterPath,
  ensureNumber,
  roundTime,
} from '../../templates/dual-type-reveal/render/constants.mjs';
import { resolveFontPath } from '../../templates/dual-type-reveal/render/drawtext-artifacts.mjs';
import { appendPokeballTransitionOverlay } from '../mixed-challenge/checkpoint-overlays.mjs';

function normalizeDuration(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function fontPart(fontPath) {
  return fontPath ? `:fontfile='${escapeFilterPath(fontPath)}'` : '';
}

function appendProgramCard(filters, inputs, {
  index,
  width,
  height,
  fps,
  durationSeconds,
  eyebrow,
  title,
  subtitle,
  accentColor,
  fontPath,
  programCard = {},
}) {
  const duration = Math.max(0.5, durationSeconds);
  const fadeOutStart = Math.max(0, roundTime(duration - 0.45));
  const videoLabel = `cardv${index}`;
  const audioLabel = `carda${index}`;
  const font = fontPart(fontPath);
  if (programCard?.style === 'premium_3d' && programCard?.animate_elements !== false) {
    const cardEnterSeconds = Math.max(0.1, ensureNumber(programCard?.card_enter_seconds, 0.55));
    const elementEnterSeconds = Math.max(
      0.1,
      ensureNumber(programCard?.element_enter_seconds, 0.42),
    );
    const eyebrowDelay = Math.max(0, ensureNumber(programCard?.eyebrow_delay_seconds, 0.18));
    const titleDelay = Math.max(0, ensureNumber(programCard?.title_delay_seconds, 0.34));
    const subtitleDelay = Math.max(0, ensureNumber(programCard?.subtitle_delay_seconds, 0.62));
    const cardWidth = width - 240;
    const cardHeight = height - 310;
    const expressionProgress = (start, seconds) => (
      `min(1\\,max(0\\,(t-${roundTime(start)})/${roundTime(seconds)}))`
    );
    const cardProgress = expressionProgress(0.04, cardEnterSeconds);
    const eyebrowProgress = expressionProgress(eyebrowDelay, elementEnterSeconds);
    const titleProgress = expressionProgress(titleDelay, elementEnterSeconds);
    const subtitleProgress = expressionProgress(subtitleDelay, elementEnterSeconds);
    const operations = [
      'format=rgba',
      'fade=t=in:st=0:d=0.3',
      `drawbox=x='(${width}-(${cardWidth}*${cardProgress}))/2':y='(${height}-(${cardHeight}*${cardProgress}))/2':w='${cardWidth}*${cardProgress}':h='${cardHeight}*${cardProgress}':color=0x020813@0.76:t=fill`,
      `drawbox=x='(${width}-(${cardWidth}*${cardProgress}))/2':y='(${height}-(${cardHeight}*${cardProgress}))/2':w='${cardWidth}*${cardProgress}':h='${cardHeight}*${cardProgress}':color=${accentColor}@0.92:t=5`,
      `drawbox=x='(${width}-(${Math.round(cardWidth * 0.72)}*${eyebrowProgress}))/2':y=245:w='${Math.round(cardWidth * 0.72)}*${eyebrowProgress}':h=5:color=${accentColor}@0.78:t=fill`,
      `drawtext=text='${escapeDrawtextText(eyebrow)}'${font}:fontcolor=${accentColor}:fontsize=46:borderw=3:bordercolor=black:shadowx=3:shadowy=4:shadowcolor=black@0.7:x=(w-text_w)/2:y='285+24*(1-${eyebrowProgress})':alpha='${eyebrowProgress}'`,
    ];
    const depthPx = Math.max(0, Math.round(ensureNumber(programCard?.title_depth_px, 12)));
    const depthSteps = Math.max(1, Math.round(ensureNumber(programCard?.title_depth_steps, 6)));
    const titleAnimation = String(programCard?.title_animation || 'rise_fade').trim().toLowerCase();
    if (titleAnimation === 'letter_wave') {
      const characters = [...String(title || '')];
      const fontSize = 86;
      const characterWidths = characters.map((character) => (
        /\s/u.test(character) ? fontSize * 0.34 : fontSize * 0.67
      ));
      const totalWidth = characterWidths.reduce((sum, value) => sum + value, 0);
      let cursor = (width - totalWidth) / 2;
      characters.forEach((character, characterIndex) => {
        const characterWidth = characterWidths[characterIndex];
        const characterX = cursor + (characterWidth / 2);
        cursor += characterWidth;
        if (/\s/u.test(character)) return;
        const characterDelay = titleDelay + (characterIndex * 0.045);
        const characterProgress = expressionProgress(characterDelay, elementEnterSeconds);
        const wave = `7*sin(2*PI*(t-${roundTime(characterDelay)})/1.4+${roundTime(characterIndex * 0.62)})*${characterProgress}`;
        const escapedCharacter = escapeDrawtextText(character);
        for (let depthStep = Math.min(3, depthSteps); depthStep >= 1; depthStep -= 1) {
          const offset = Number(((depthPx * depthStep) / Math.min(3, depthSteps)).toFixed(3));
          operations.push(
            `drawtext=text='${escapedCharacter}'${font}:fontcolor=0x2B6DA6:fontsize=${fontSize}:borderw=7:bordercolor=0x102A49:x=${roundTime(characterX)}-text_w/2+${offset}:y='425+${offset}+34*(1-${characterProgress})+${wave}':alpha='${characterProgress}'`,
          );
        }
        operations.push(
          `drawtext=text='${escapedCharacter}'${font}:fontcolor=0xF4FBFF:fontsize=${fontSize}:borderw=7:bordercolor=0x173A63:shadowx=7:shadowy=9:shadowcolor=${accentColor}@0.7:x=${roundTime(characterX)}-text_w/2:y='425+34*(1-${characterProgress})+${wave}':alpha='${characterProgress}'`,
        );
      });
    } else {
      for (let depthStep = depthSteps; depthStep >= 1; depthStep -= 1) {
        const offset = Number(((depthPx * depthStep) / depthSteps).toFixed(3));
        operations.push(
          `drawtext=text='${escapeDrawtextText(title)}'${font}:fontcolor=0x2B6DA6:fontsize=86:borderw=7:bordercolor=0x102A49:x=(w-text_w)/2+${offset}:y='425+${offset}+34*(1-${titleProgress})':alpha='${titleProgress}'`,
        );
      }
      operations.push(
        `drawtext=text='${escapeDrawtextText(title)}'${font}:fontcolor=0xF4FBFF:fontsize=86:borderw=7:bordercolor=0x173A63:shadowx=7:shadowy=9:shadowcolor=${accentColor}@0.7:x=(w-text_w)/2:y='425+34*(1-${titleProgress})':alpha='${titleProgress}'`,
      );
    }
    operations.push(
      `drawtext=text='${escapeDrawtextText(subtitle)}'${font}:fontcolor=0xDCEBFF:fontsize=42:borderw=3:bordercolor=black:shadowx=3:shadowy=5:shadowcolor=black@0.65:x=(w-text_w)/2:y='625+28*(1-${subtitleProgress})':alpha='${subtitleProgress}'`,
      `drawbox=x='(${width}-(${Math.round(cardWidth * 0.72)}*${subtitleProgress}))/2':y=714:w='${Math.round(cardWidth * 0.72)}*${subtitleProgress}':h=5:color=${accentColor}@0.78:t=fill`,
      `fade=t=out:st=${fadeOutStart}:d=0.45`,
      'format=yuv420p',
    );
    filters.push(
      `color=c=0x071426:s=${width}x${height}:r=${fps}:d=${duration},${operations.join(',')}[${videoLabel}]`,
    );
  } else {
    filters.push(
      `color=c=0x071426:s=${width}x${height}:r=${fps}:d=${duration},format=rgba,drawbox=x=120:y=155:w=${width - 240}:h=${height - 310}:color=0x020813@0.62:t=fill,drawbox=x=120:y=155:w=${width - 240}:h=${height - 310}:color=${accentColor}@0.9:t=5,drawtext=text='${escapeDrawtextText(eyebrow)}'${font}:fontcolor=${accentColor}:fontsize=46:borderw=3:bordercolor=black:x=(w-text_w)/2:y=285,drawtext=text='${escapeDrawtextText(title)}'${font}:fontcolor=white:fontsize=86:borderw=7:bordercolor=black:shadowx=7:shadowy=9:shadowcolor=${accentColor}@0.7:x=(w-text_w)/2:y=425,drawtext=text='${escapeDrawtextText(subtitle)}'${font}:fontcolor=0xDCEBFF:fontsize=42:borderw=3:bordercolor=black:x=(w-text_w)/2:y=625,fade=t=in:st=0:d=0.35,fade=t=out:st=${fadeOutStart}:d=0.45,format=yuv420p[${videoLabel}]`,
    );
  }
  filters.push(
    `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${duration},asetpts=PTS-STARTPTS[${audioLabel}]`,
  );
  inputs.push(`[${videoLabel}][${audioLabel}]`);
}

function appendMusicFilters(filters, {
  musicSchedule,
  musicInputStartIndex,
  totalDurationSeconds,
  volume,
}) {
  if (!Array.isArray(musicSchedule) || musicSchedule.length === 0) return null;
  const labels = [];
  musicSchedule.forEach((entry, index) => {
    const duration = Math.max(0.1, ensureNumber(entry?.duration_seconds, 0.1));
    const fadeIn = Math.min(duration / 2, Math.max(0, ensureNumber(entry?.fade_in_seconds, 0)));
    const fadeOut = Math.min(duration / 2, Math.max(0, ensureNumber(entry?.fade_out_seconds, 0)));
    const fadeOutStart = Math.max(0, roundTime(duration - fadeOut));
    const delayMs = Math.max(0, Math.round(ensureNumber(entry?.start_seconds, 0) * 1000));
    const label = `music${index}`;
    const fadeInFilter = fadeIn > 0 ? `,afade=t=in:st=0:d=${roundTime(fadeIn)}` : '';
    const fadeOutFilter = fadeOut > 0
      ? `,afade=t=out:st=${fadeOutStart}:d=${roundTime(fadeOut)}`
      : '';
    filters.push(
      `[${musicInputStartIndex + index}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${roundTime(duration)},asetpts=PTS-STARTPTS,volume=${volume}${fadeInFilter}${fadeOutFilter},adelay=${delayMs}|${delayMs}[${label}]`,
    );
    labels.push(label);
  });
  filters.push(
    `${labels.map((label) => `[${label}]`).join('')}amix=inputs=${labels.length}:normalize=0,atrim=duration=${roundTime(totalDurationSeconds)},asetpts=PTS-STARTPTS[musicbed]`,
  );
  return 'musicbed';
}

export function buildRevealChallengeProgramFilter(sectionCount, {
  sections = [],
  template = {},
  fontPath = null,
  musicSchedule = [],
  musicInputStartIndex = sectionCount,
  transitionInputs = [],
} = {}) {
  const count = Math.max(1, Number.parseInt(String(sectionCount), 10) || 1);
  const width = Number(template?.canvas?.width || 1920);
  const height = Number(template?.canvas?.height || 1080);
  const fps = Number(template?.canvas?.fps || 30);
  const introDuration = normalizeDuration(template?.episode?.intro_duration_seconds, 5);
  const outroDuration = normalizeDuration(template?.episode?.outro_duration_seconds, 6);
  const filters = [];
  const programInputs = [];
  const accent = String(template?.presentation?.accent_color || '0xFFD60A');
  appendProgramCard(filters, programInputs, {
    index: 0,
    width,
    height,
    fps,
    durationSeconds: introDuration,
    eyebrow: String(template?.presentation?.intro_eyebrow || 'GET READY TO GUESS'),
    title: String(template?.presentation?.intro_title || 'GUESS THE POKEMON'),
    subtitle: String(template?.presentation?.intro_subtitle || 'PROGRESSIVE + PIXELATED REVEALS'),
    accentColor: accent,
    fontPath,
    programCard: template?.presentation?.program_card,
  });

  let programDurationSeconds = introDuration;
  const transitionSchedule = [];
  for (let index = 0; index < count; index += 1) {
    const transition = transitionInputs[index];
    if (transition?.input_ref != null && template?.layout?.round_transition?.enabled !== false) {
      transitionSchedule.push({ ...transition, cut_seconds: programDurationSeconds });
    }
    const sectionDuration = Math.max(0.1, ensureNumber(sections[index]?.duration_seconds, 0.1));
    // Concat cuts on the real stream duration. Rendered reveal sections can
    // end a few frames early when their last audio or animation cue finishes,
    // which previously moved the background cut ahead of the transition's
    // planned midpoint. Pad and trim both streams to the declared section
    // duration so the Pokeball reaches full coverage exactly on the cut.
    filters.push(
      `[${index}:v]fps=${fps},tpad=stop_mode=clone:stop_duration=${roundTime(sectionDuration)},trim=duration=${roundTime(sectionDuration)},setpts=PTS-STARTPTS[v${index}]`,
    );
    filters.push(
      `[${index}:a]aresample=48000,apad,atrim=duration=${roundTime(sectionDuration)},asetpts=PTS-STARTPTS[a${index}]`,
    );
    programInputs.push(`[v${index}][a${index}]`);
    programDurationSeconds = roundTime(
      programDurationSeconds + sectionDuration,
    );
  }

  appendProgramCard(filters, programInputs, {
    index: 1,
    width,
    height,
    fps,
    durationSeconds: outroDuration,
    eyebrow: String(template?.presentation?.outro_eyebrow || 'REVEAL CHALLENGE COMPLETE'),
    title: String(template?.presentation?.outro_title || 'HOW MANY DID YOU GET?'),
    subtitle: String(template?.presentation?.outro_subtitle || 'SHARE YOUR SCORE IN THE COMMENTS'),
    accentColor: String(template?.presentation?.outro_accent_color || '0x56C7FF'),
    fontPath,
    programCard: template?.presentation?.program_card,
  });

  filters.push(
    `${programInputs.join('')}concat=n=${programInputs.length}:v=1:a=1[programbase][gameaudio]`,
  );
  let currentVideoLabel = 'programbase';
  transitionSchedule.forEach((transition, index) => {
    currentVideoLabel = appendPokeballTransitionOverlay(filters, currentVideoLabel, {
      index,
      inputRef: transition.input_ref,
      cutSeconds: transition.cut_seconds,
      directionMultiplier: transition.direction_multiplier,
      fps,
      durationSeconds: transition.duration_seconds,
      config: template?.layout?.round_transition,
    });
  });
  filters.push(`[${currentVideoLabel}]format=yuv420p[vout]`);

  const totalDuration = roundTime(programDurationSeconds + outroDuration);
  const musicLabel = appendMusicFilters(filters, {
    musicSchedule,
    musicInputStartIndex,
    totalDurationSeconds: totalDuration,
    volume: Math.max(0, ensureNumber(template?.audio?.music_volume, 0.16)),
  });
  if (musicLabel) {
    filters.push(
      `[gameaudio][${musicLabel}]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[aout]`,
    );
  } else {
    filters.push('[gameaudio]anull[aout]');
  }
  return `${filters.join(';\n')}\n`;
}

export async function assembleRevealChallengeVideo({
  sectionPaths,
  sections = [],
  musicSchedule = [],
  transitions = [],
  outputPath,
  template,
  ffmpegExecutable = 'ffmpeg',
  projectRoot,
  runtimeRoot,
  runProcess = runLocalProcess,
}) {
  if (!Array.isArray(sectionPaths) || sectionPaths.length === 0) {
    throw new Error('At least one rendered reveal section is required.');
  }
  const outputAbsolutePath = resolve(projectRoot, outputPath);
  const filterPath = resolve(runtimeRoot, 'reveal-challenge-concat.filters.txt');
  await mkdir(dirname(filterPath), { recursive: true });
  await mkdir(dirname(outputAbsolutePath), { recursive: true });
  const fontPath = await resolveFontPath(DEFAULT_FONT_CANDIDATES);
  const fps = Number(template?.canvas?.fps || 30);
  const extraInputArgs = [];
  let nextInputRef = sectionPaths.length;
  const normalizedMusicSchedule = [];
  for (const entry of musicSchedule) {
    const path = resolve(projectRoot, String(entry?.path || ''));
    try {
      await access(path);
    } catch {
      continue;
    }
    extraInputArgs.push('-i', path);
    normalizedMusicSchedule.push({ ...entry, path, input_ref: nextInputRef });
    nextInputRef += 1;
  }
  const musicInputStartIndex = sectionPaths.length;
  const transitionInputs = [];
  for (const transition of transitions.slice(0, sectionPaths.length)) {
    const path = resolve(projectRoot, String(transition?.path || ''));
    try {
      await access(path);
    } catch {
      transitionInputs.push({ ...transition, input_ref: null });
      continue;
    }
    extraInputArgs.push('-loop', '1', '-framerate', String(fps), '-i', path);
    transitionInputs.push({ ...transition, input_ref: nextInputRef });
    nextInputRef += 1;
  }
  await writeFile(filterPath, buildRevealChallengeProgramFilter(sectionPaths.length, {
    sections,
    template,
    fontPath,
    musicSchedule: normalizedMusicSchedule,
    musicInputStartIndex,
    transitionInputs,
  }), 'utf8');
  await runProcess({
    executable: ffmpegExecutable,
    args: [
      '-y',
      ...sectionPaths.flatMap((sectionPath) => ['-i', sectionPath]),
      ...extraInputArgs,
      '-/filter_complex',
      filterPath,
      '-map',
      '[vout]',
      '-map',
      '[aout]',
      '-r',
      String(fps),
      '-c:v',
      String(template?.renderer?.video_codec || 'libx264'),
      '-preset',
      String(template?.renderer?.preset || 'fast'),
      '-crf',
      String(template?.renderer?.crf ?? 21),
      '-pix_fmt',
      String(template?.renderer?.pixel_format || 'yuv420p'),
      '-c:a',
      String(template?.renderer?.audio_codec || 'aac'),
      '-b:a',
      String(template?.renderer?.audio_bitrate || '192k'),
      '-movflags',
      '+faststart',
      outputAbsolutePath,
    ],
    cwd: projectRoot,
    timeoutMs: 7_200_000,
  });
  await access(outputAbsolutePath);
  return {
    output_path: outputAbsolutePath,
    concat_filter_path: filterPath,
    section_paths: sectionPaths,
  };
}
