import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runLocalProcess } from '../../../../process-runner.mjs';
import {
  DEFAULT_FONT_CANDIDATES,
  escapeDrawtextText,
  escapeFilterPath,
} from '../../templates/dual-type-reveal/render/constants.mjs';
import { resolveFontPath } from '../../templates/dual-type-reveal/render/drawtext-artifacts.mjs';

export function buildMixedChallengeConcatFilter(sectionCount) {
  const count = Math.max(1, Number.parseInt(String(sectionCount), 10) || 1);
  const filters = [];
  const concatInputs = [];
  for (let index = 0; index < count; index += 1) {
    filters.push(`[${index}:v]setpts=PTS-STARTPTS[v${index}]`);
    filters.push(`[${index}:a]aresample=48000,asetpts=PTS-STARTPTS[a${index}]`);
    concatInputs.push(`[v${index}][a${index}]`);
  }
  filters.push(`${concatInputs.join('')}concat=n=${count}:v=1:a=1[vout][aout]`);
  return `${filters.join(';\n')}\n`;
}

function normalizeDuration(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveDifficulty(section, index, sectionCount) {
  if (section?.difficulty?.label) {
    return {
      key: String(section.difficulty.key || `level-${index + 1}`),
      label: String(section.difficulty.label),
      accent_color: String(section.difficulty.accent_color || '0xFFD60A'),
    };
  }
  const groupSize = Math.max(1, Math.ceil(sectionCount / 3));
  const levels = [
    { key: 'easy', label: 'EASY ROUND', accent_color: '0x45D483' },
    { key: 'medium', label: 'MEDIUM ROUND', accent_color: '0xFFD60A' },
    { key: 'hard', label: 'HARD ROUND', accent_color: '0xFF5B62' },
  ];
  return levels[Math.min(levels.length - 1, Math.floor(index / groupSize))];
}

function buildFontPart(fontPath) {
  return fontPath ? `:fontfile='${escapeFilterPath(fontPath)}'` : '';
}

function appendProgramCard(filters, programInputs, {
  index,
  width,
  height,
  fps,
  durationSeconds,
  eyebrow,
  title,
  subtitle,
  accentColor,
  titleFontSize = 108,
  fontPath,
}) {
  const duration = Math.max(0.5, durationSeconds);
  const fadeOutStart = Math.max(0, Number((duration - 0.45).toFixed(3)));
  const fontPart = buildFontPart(fontPath);
  const videoLabel = `cardv${index}`;
  const audioLabel = `carda${index}`;
  filters.push(
    `color=c=0x071426:s=${width}x${height}:r=${fps}:d=${duration},format=rgba,drawbox=x=120:y=155:w=${width - 240}:h=${height - 310}:color=0x020813@0.58:t=fill,drawbox=x=120:y=155:w=${width - 240}:h=${height - 310}:color=${accentColor}@0.85:t=5,drawtext=text='${escapeDrawtextText(eyebrow)}'${fontPart}:fontcolor=${accentColor}:fontsize=46:borderw=3:bordercolor=black:x=(w-text_w)/2:y=285,drawtext=text='${escapeDrawtextText(title)}'${fontPart}:fontcolor=white:fontsize=${titleFontSize}:borderw=7:bordercolor=black:shadowx=7:shadowy=9:shadowcolor=${accentColor}@0.7:x=(w-text_w)/2:y=420,drawtext=text='${escapeDrawtextText(subtitle)}'${fontPart}:fontcolor=0xDCEBFF:fontsize=42:borderw=3:bordercolor=black:x=(w-text_w)/2:y=610,fade=t=in:st=0:d=0.35,fade=t=out:st=${fadeOutStart}:d=0.45,format=yuv420p[${videoLabel}]`,
  );
  filters.push(
    `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${duration},asetpts=PTS-STARTPTS[${audioLabel}]`,
  );
  programInputs.push(`[${videoLabel}][${audioLabel}]`);
}

export function buildMixedChallengeProgramFilter(sectionCount, {
  sections = [],
  template = {},
  fontPath = null,
} = {}) {
  const count = Math.max(1, Number.parseInt(String(sectionCount), 10) || 1);
  const width = Number(template?.canvas?.width || 1920);
  const height = Number(template?.canvas?.height || 1080);
  const fps = Number(template?.canvas?.fps || 30);
  const introDuration = normalizeDuration(template?.episode?.intro_duration_seconds, 6);
  const chapterDuration = normalizeDuration(template?.episode?.chapter_intro_duration_seconds, 3.5);
  const outroDuration = normalizeDuration(template?.episode?.outro_duration_seconds, 7);
  const filters = [];
  const programInputs = [];
  const fontPart = buildFontPart(fontPath);
  const normalizedSections = Array.from({ length: count }, (_, index) => ({
    ...(sections[index] || {}),
    difficulty: resolveDifficulty(sections[index], index, count),
  }));

  appendProgramCard(filters, programInputs, {
    index: 0,
    width,
    height,
    fps,
    durationSeconds: introDuration,
    eyebrow: 'GET READY TO PLAY',
    title: 'THE ULTIMATE POKEMON CHALLENGE',
    subtitle: `${count} CHALLENGES  |  3 DIFFICULTY LEVELS`,
    accentColor: '0xFFD60A',
    titleFontSize: 88,
    fontPath,
  });

  let cardIndex = 1;
  let previousDifficultyKey = null;
  normalizedSections.forEach((section, index) => {
    const difficulty = section.difficulty;
    if (difficulty.key !== previousDifficultyKey) {
      const remainingInDifficulty = normalizedSections
        .slice(index)
        .findIndex((candidate) => candidate.difficulty.key !== difficulty.key);
      const endIndex = remainingInDifficulty < 0 ? count : index + remainingInDifficulty;
      appendProgramCard(filters, programInputs, {
        index: cardIndex,
        width,
        height,
        fps,
        durationSeconds: chapterDuration,
        eyebrow: 'CURRENT DIFFICULTY',
        title: difficulty.label,
        subtitle: `CHALLENGES ${index + 1}-${endIndex} OF ${count}`,
        accentColor: difficulty.accent_color,
        fontPath,
      });
      cardIndex += 1;
      previousDifficultyKey = difficulty.key;
    }

    const label = `${difficulty.label}  |  ${index + 1} / ${count}`;
    filters.push(
      `[${index}:v]setpts=PTS-STARTPTS,drawtext=text='${escapeDrawtextText(label)}'${fontPart}:fontcolor=${difficulty.accent_color}:fontsize=44:borderw=4:bordercolor=black:box=1:boxcolor=black@0.5:boxborderw=14:x=52:y=42[v${index}]`,
    );
    filters.push(`[${index}:a]aresample=48000,asetpts=PTS-STARTPTS[a${index}]`);
    programInputs.push(`[v${index}][a${index}]`);
  });

  appendProgramCard(filters, programInputs, {
    index: cardIndex,
    width,
    height,
    fps,
    durationSeconds: outroDuration,
    eyebrow: 'CHALLENGE COMPLETE',
    title: 'HOW DID YOU DO?',
    subtitle: 'SHARE YOUR SCORE AND TEAM IN THE COMMENTS',
    accentColor: '0x56C7FF',
    fontPath,
  });

  filters.push(`${programInputs.join('')}concat=n=${programInputs.length}:v=1:a=1[vout][aout]`);
  return `${filters.join(';\n')}\n`;
}

export async function assembleMixedChallengeVideo({
  sectionPaths,
  sections = [],
  outputPath,
  template,
  ffmpegExecutable = 'ffmpeg',
  projectRoot,
  runtimeRoot,
  runProcess = runLocalProcess,
}) {
  if (!Array.isArray(sectionPaths) || sectionPaths.length === 0) {
    throw new Error('At least one rendered landscape section is required.');
  }
  const outputAbsolutePath = resolve(projectRoot, outputPath);
  const filterPath = resolve(runtimeRoot, 'mixed-challenge-concat.filters.txt');
  await mkdir(dirname(filterPath), { recursive: true });
  await mkdir(dirname(outputAbsolutePath), { recursive: true });
  const fontPath = await resolveFontPath(DEFAULT_FONT_CANDIDATES);
  await writeFile(filterPath, buildMixedChallengeProgramFilter(sectionPaths.length, {
    sections,
    template,
    fontPath,
  }), 'utf8');
  await runProcess({
    executable: ffmpegExecutable,
    args: [
      '-y',
      ...sectionPaths.flatMap((sectionPath) => ['-i', sectionPath]),
      '-/filter_complex',
      filterPath,
      '-map',
      '[vout]',
      '-map',
      '[aout]',
      '-r',
      String(template?.canvas?.fps || 30),
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
