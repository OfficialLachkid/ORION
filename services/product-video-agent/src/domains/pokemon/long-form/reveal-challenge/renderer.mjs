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
}) {
  const duration = Math.max(0.5, durationSeconds);
  const fadeOutStart = Math.max(0, roundTime(duration - 0.45));
  const videoLabel = `cardv${index}`;
  const audioLabel = `carda${index}`;
  const font = fontPart(fontPath);
  filters.push(
    `color=c=0x071426:s=${width}x${height}:r=${fps}:d=${duration},format=rgba,drawbox=x=120:y=155:w=${width - 240}:h=${height - 310}:color=0x020813@0.62:t=fill,drawbox=x=120:y=155:w=${width - 240}:h=${height - 310}:color=${accentColor}@0.9:t=5,drawtext=text='${escapeDrawtextText(eyebrow)}'${font}:fontcolor=${accentColor}:fontsize=46:borderw=3:bordercolor=black:x=(w-text_w)/2:y=285,drawtext=text='${escapeDrawtextText(title)}'${font}:fontcolor=white:fontsize=86:borderw=7:bordercolor=black:shadowx=7:shadowy=9:shadowcolor=${accentColor}@0.7:x=(w-text_w)/2:y=425,drawtext=text='${escapeDrawtextText(subtitle)}'${font}:fontcolor=0xDCEBFF:fontsize=42:borderw=3:bordercolor=black:x=(w-text_w)/2:y=625,fade=t=in:st=0:d=0.35,fade=t=out:st=${fadeOutStart}:d=0.45,format=yuv420p[${videoLabel}]`,
  );
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
