import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runLocalProcess } from '../../../../process-runner.mjs';
import { buildAnimatedPopSettleExpression } from '../../templates/dual-type-reveal/render/animation-expressions.mjs';
import {
  DEFAULT_FONT_CANDIDATES,
  escapeDrawtextText,
  escapeFilterPath,
  ensureNumber,
  roundTime,
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

function buildPokeballWiggleExpression({
  startSeconds,
  amplitude,
  frequencyHz,
  momentumStrength,
  directionMultiplier,
}) {
  const start = roundTime(startSeconds);
  const normalizedAmplitude = roundTime(Math.max(0, amplitude));
  if (normalizedAmplitude <= 0) return '0';
  const frequencyRadians = roundTime(Math.max(0.1, frequencyHz) * 6.283185307);
  const momentum = roundTime(Math.max(0, momentumStrength));
  const direction = ensureNumber(directionMultiplier, 1) < 0 ? -1 : 1;
  const sine = `sin((t-${start})*${frequencyRadians})`;
  const weighted = momentum > 0
    ? `(${sine})*(1+${momentum}*(1-abs(${sine})))`
    : sine;
  return `if(lt(t,${start}),0,(${weighted})*${roundTime(normalizedAmplitude * direction)})`;
}

function appendTypedText(filters, currentLabel, {
  labelPrefix,
  text,
  fontPart,
  fontColor,
  fontSize,
  borderWidth,
  borderColor,
  shadowX = 0,
  shadowY = 0,
  shadowColor = 'black@0',
  x,
  y,
  startSeconds,
  secondsPerCharacter,
  endSeconds,
}) {
  const value = String(text || '');
  const visibleCharacterIndexes = [...value]
    .map((character, index) => ({ character, index }))
    .filter(({ character }) => character !== ' ')
    .map(({ index }) => index);
  let outputLabel = currentLabel;
  visibleCharacterIndexes.forEach((characterIndex, stageIndex) => {
    const stageStart = Number((startSeconds + (characterIndex * secondsPerCharacter)).toFixed(3));
    const nextCharacterIndex = visibleCharacterIndexes[stageIndex + 1];
    const stageEnd = nextCharacterIndex == null
      ? endSeconds
      : Math.min(endSeconds, Number((startSeconds + (nextCharacterIndex * secondsPerCharacter)).toFixed(3)));
    if (stageStart >= endSeconds || stageEnd <= stageStart) return;
    const nextLabel = `${labelPrefix}${stageIndex}`;
    const prefix = value.slice(0, characterIndex + 1);
    filters.push(
      `[${outputLabel}]drawtext=text='${escapeDrawtextText(prefix)}'${fontPart}:fontcolor=${fontColor}:fontsize=${fontSize}:borderw=${borderWidth}:bordercolor=${borderColor}:shadowx=${shadowX}:shadowy=${shadowY}:shadowcolor=${shadowColor}:x=${x}:y=${y}:enable='between(t,${stageStart},${stageEnd})'[${nextLabel}]`,
    );
    outputLabel = nextLabel;
  });
  return outputLabel;
}

function appendIntroAudio(filters, {
  audioLabel,
  audioInputRef,
  duration,
  fadeOutStart,
  volume,
}) {
  if (audioInputRef == null) {
    filters.push(
      `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${duration},asetpts=PTS-STARTPTS[${audioLabel}]`,
    );
    return;
  }
  filters.push(
    `[${audioInputRef}:a]aresample=48000,atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=${volume},afade=t=in:st=0:d=0.35,afade=t=out:st=${fadeOutStart}:d=0.45[${audioLabel}]`,
  );
}

function appendAnimatedIntroCard(filters, programInputs, {
  width,
  height,
  fps,
  durationSeconds,
  sectionCount,
  fontPath,
  template,
  introPokeballs = [],
  introMusicInputRef = null,
}) {
  const duration = Math.max(0.5, durationSeconds);
  const fadeOutStart = Math.max(0, Number((duration - 0.45).toFixed(3)));
  const fontPart = buildFontPart(fontPath);
  const accentColor = '0xFFD60A';
  const boxX = 120;
  const boxY = 155;
  const boxWidth = width - 240;
  const boxHeight = height - 310;
  filters.push(`color=c=0x071426:s=${width}x${height}:r=${fps}:d=${duration},format=rgba[introbase]`);
  let currentLabel = 'introbase';
  const boxLayers = [
    `drawbox=x=${boxX}:y=${boxY}:w=${boxWidth}:h=${boxHeight}:color=0x020813@0.58:t=fill:enable='gte(t,0.1)'`,
    `drawbox=x=${boxX}:y=${boxY}:w=${boxWidth}:h=5:color=${accentColor}@0.9:t=fill:enable='gte(t,0.22)'`,
    `drawbox=x=${boxX + boxWidth - 5}:y=${boxY}:w=5:h=${boxHeight}:color=${accentColor}@0.9:t=fill:enable='gte(t,0.38)'`,
    `drawbox=x=${boxX}:y=${boxY + boxHeight - 5}:w=${boxWidth}:h=5:color=${accentColor}@0.9:t=fill:enable='gte(t,0.54)'`,
    `drawbox=x=${boxX}:y=${boxY}:w=5:h=${boxHeight}:color=${accentColor}@0.9:t=fill:enable='gte(t,0.7)'`,
  ];
  boxLayers.forEach((filter, index) => {
    const nextLabel = `introbox${index}`;
    filters.push(`[${currentLabel}]${filter}[${nextLabel}]`);
    currentLabel = nextLabel;
  });
  currentLabel = appendTypedText(filters, currentLabel, {
    labelPrefix: 'introeyebrow',
    text: 'GET READY TO PLAY',
    fontPart,
    fontColor: accentColor,
    fontSize: 46,
    borderWidth: 3,
    borderColor: 'black',
    x: '(w-text_w)/2',
    y: 285,
    startSeconds: 0.78,
    secondsPerCharacter: 0.038,
    endSeconds: duration,
  });
  currentLabel = appendTypedText(filters, currentLabel, {
    labelPrefix: 'introtitle',
    text: 'THE ULTIMATE POKEMON CHALLENGE',
    fontPart,
    fontColor: 'white',
    fontSize: 88,
    borderWidth: 7,
    borderColor: 'black',
    shadowX: 7,
    shadowY: 9,
    shadowColor: `${accentColor}@0.7`,
    x: '(w-text_w)/2',
    y: 420,
    startSeconds: 1.45,
    secondsPerCharacter: 0.032,
    endSeconds: duration,
  });
  currentLabel = appendTypedText(filters, currentLabel, {
    labelPrefix: 'introsubtitle',
    text: `${sectionCount} CHALLENGES  |  3 DIFFICULTY LEVELS`,
    fontPart,
    fontColor: '0xDCEBFF',
    fontSize: 42,
    borderWidth: 3,
    borderColor: 'black',
    x: '(w-text_w)/2',
    y: 610,
    startSeconds: 2.55,
    secondsPerCharacter: 0.026,
    endSeconds: duration,
  });

  const pokeballCount = Math.min(
    Math.max(0, Math.round(ensureNumber(template?.episode?.intro_pokeball_count, 4))),
    introPokeballs.length,
  );
  const pokeballSize = Math.max(48, Math.round(ensureNumber(template?.episode?.intro_pokeball_size_px, 126)));
  const pokeballCanvasSize = Math.ceil(pokeballSize * 1.5);
  const pokeballCenterY = ensureNumber(template?.episode?.intro_pokeball_center_y, 835);
  const pokeballGap = Math.round(pokeballSize * 0.62);
  const rowWidth = (pokeballCount * pokeballSize) + (Math.max(0, pokeballCount - 1) * pokeballGap);
  const rowLeft = (width - rowWidth) / 2;
  const appearStart = Math.min(Math.max(0.4, duration - 2.65), duration - 0.8);
  const appearDuration = 0.56;
  const wiggleStart = Number((appearStart + appearDuration).toFixed(3));
  introPokeballs.slice(0, pokeballCount).forEach((pokeball, index) => {
    const centerX = rowLeft + (pokeballSize / 2) + (index * (pokeballSize + pokeballGap));
    const speedMultiplier = Math.max(0.5, Math.min(1.5, ensureNumber(pokeball.speed_multiplier, 1)));
    const frequencyHz = 0.675 * speedMultiplier;
    const rotationExpression = buildPokeballWiggleExpression({
      startSeconds: wiggleStart,
      amplitude: 0.24,
      frequencyHz,
      momentumStrength: 0.45,
      directionMultiplier: pokeball.direction_multiplier,
    });
    const horizontalExpression = buildPokeballWiggleExpression({
      startSeconds: wiggleStart,
      amplitude: 24,
      frequencyHz,
      momentumStrength: 0.45,
      directionMultiplier: pokeball.direction_multiplier,
    });
    const scaleExpression = buildAnimatedPopSettleExpression(
      appearStart,
      appearDuration,
      0.02,
      1.08,
      1,
      't',
    );
    const sourceLabel = `intropokeball${index}`;
    const overlayLabel = `intropokeballv${index}`;
    filters.push(
      `[${pokeball.input_ref}:v]fps=${fps},trim=duration=${duration},setpts=PTS-STARTPTS,scale=w='${pokeballSize}*(${scaleExpression})':h='${pokeballSize}*(${scaleExpression})':eval=frame:force_original_aspect_ratio=decrease,format=rgba,pad=${pokeballCanvasSize}:${pokeballCanvasSize}:(ow-iw)/2:(oh-ih)/2:color=black@0:eval=frame,rotate='${rotationExpression}':ow=iw:oh=ih:c=none,setsar=1[${sourceLabel}]`,
    );
    filters.push(
      `[${currentLabel}][${sourceLabel}]overlay=x='${roundTime(centerX)}-w/2+(${horizontalExpression})':y='${roundTime(pokeballCenterY)}-h/2':enable='between(t,${appearStart},${duration})'[${overlayLabel}]`,
    );
    currentLabel = overlayLabel;
  });
  filters.push(
    `[${currentLabel}]fade=t=in:st=0:d=0.35,fade=t=out:st=${fadeOutStart}:d=0.45,format=yuv420p[cardv0]`,
  );
  appendIntroAudio(filters, {
    audioLabel: 'carda0',
    audioInputRef: introMusicInputRef,
    duration,
    fadeOutStart,
    volume: Math.max(0, ensureNumber(template?.episode?.intro_music_volume, 0.24)),
  });
  programInputs.push('[cardv0][carda0]');
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
  progressTracker = null,
  progressTrackerConfig = {},
}) {
  const duration = Math.max(0.5, durationSeconds);
  const fadeOutStart = Math.max(0, Number((duration - 0.45).toFixed(3)));
  const fontPart = buildFontPart(fontPath);
  const videoLabel = `cardv${index}`;
  const audioLabel = `carda${index}`;
  const trackerFilters = buildProgressTrackerFilters({
    width,
    height,
    durationSeconds: duration,
    tracker: progressTracker,
    config: progressTrackerConfig,
  });
  const trackerFilterPart = trackerFilters.length > 0
    ? `,${trackerFilters.join(',')}`
    : '';
  filters.push(
    `color=c=0x071426:s=${width}x${height}:r=${fps}:d=${duration},format=rgba,drawbox=x=120:y=155:w=${width - 240}:h=${height - 310}:color=0x020813@0.58:t=fill,drawbox=x=120:y=155:w=${width - 240}:h=${height - 310}:color=${accentColor}@0.85:t=5,drawtext=text='${escapeDrawtextText(eyebrow)}'${fontPart}:fontcolor=${accentColor}:fontsize=46:borderw=3:bordercolor=black:x=(w-text_w)/2:y=285,drawtext=text='${escapeDrawtextText(title)}'${fontPart}:fontcolor=white:fontsize=${titleFontSize}:borderw=7:bordercolor=black:shadowx=7:shadowy=9:shadowcolor=${accentColor}@0.7:x=(w-text_w)/2:y=420,drawtext=text='${escapeDrawtextText(subtitle)}'${fontPart}:fontcolor=0xDCEBFF:fontsize=42:borderw=3:bordercolor=black:x=(w-text_w)/2:y=610${trackerFilterPart},fade=t=in:st=0:d=0.35,fade=t=out:st=${fadeOutStart}:d=0.45,format=yuv420p[${videoLabel}]`,
  );
  filters.push(
    `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${duration},asetpts=PTS-STARTPTS[${audioLabel}]`,
  );
  programInputs.push(`[${videoLabel}][${audioLabel}]`);
}

function buildProgressTrackerFilters({
  width,
  height,
  durationSeconds,
  tracker,
  config = {},
}) {
  if (config?.enabled === false || !tracker) return [];
  const totalCount = Math.max(0, Number.parseInt(String(tracker.total_count), 10) || 0);
  if (totalCount === 0) return [];
  const completedCount = Math.min(
    totalCount,
    Math.max(0, Number.parseInt(String(tracker.completed_count), 10) || 0),
  );
  const markerSize = Math.max(12, Math.round(ensureNumber(config.marker_size_px, 42)));
  const markerGap = Math.max(0, Math.round(ensureNumber(config.marker_gap_px, 16)));
  const borderWidth = Math.max(1, Math.round(ensureNumber(config.border_width_px, 3)));
  const rowWidth = (totalCount * markerSize) + (Math.max(0, totalCount - 1) * markerGap);
  const requestedLeft = Math.round(ensureNumber(config.left_px, 160));
  const left = Math.max(0, Math.min(width - rowWidth, requestedLeft));
  const bottom = Math.max(0, Math.round(ensureNumber(config.bottom_px, 160)));
  const top = Math.max(0, Math.min(height - markerSize, height - bottom - markerSize));
  const fillStart = Math.max(0, ensureNumber(config.fill_start_seconds, 0.55));
  const fillStagger = Math.max(0, ensureNumber(config.fill_stagger_seconds, 0.16));
  const markerColors = Array.isArray(tracker.marker_colors) ? tracker.marker_colors : [];
  const filters = [];
  for (let markerIndex = 0; markerIndex < totalCount; markerIndex += 1) {
    const markerX = left + (markerIndex * (markerSize + markerGap));
    filters.push(
      `drawbox=x=${markerX}:y=${top}:w=${markerSize}:h=${markerSize}:color=0x0A1726@0.82:t=fill`,
    );
    if (markerIndex < completedCount) {
      const fillAt = Math.min(
        Math.max(0, durationSeconds - 0.5),
        fillStart + (markerIndex * fillStagger),
      );
      const markerColor = String(markerColors[markerIndex] || '0x56C7FF');
      filters.push(
        `drawbox=x=${markerX}:y=${top}:w=${markerSize}:h=${markerSize}:color=${markerColor}@0.96:t=fill:enable='gte(t,${roundTime(fillAt)})'`,
      );
    }
    filters.push(
      `drawbox=x=${markerX}:y=${top}:w=${markerSize}:h=${markerSize}:color=white@0.92:t=${borderWidth}`,
    );
  }
  return filters;
}

export function buildMixedChallengeProgramFilter(sectionCount, {
  sections = [],
  template = {},
  fontPath = null,
  programAssets = {},
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

  appendAnimatedIntroCard(filters, programInputs, {
    width,
    height,
    fps,
    durationSeconds: introDuration,
    sectionCount: count,
    fontPath,
    template,
    introPokeballs: programAssets.intro_pokeballs || [],
    introMusicInputRef: programAssets.intro_music_input_ref,
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
        progressTracker: {
          total_count: count,
          completed_count: index,
          marker_colors: normalizedSections.map((candidate) => candidate.difficulty.accent_color),
        },
        progressTrackerConfig: template?.layout?.progress_tracker,
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
  programAssets = {},
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
  const fps = Number(template?.canvas?.fps || 30);
  const introDuration = normalizeDuration(template?.episode?.intro_duration_seconds, 6);
  const requestedPokeballs = Array.isArray(programAssets?.intro_pokeballs)
    ? programAssets.intro_pokeballs.slice(0, Math.max(
        0,
        Math.round(ensureNumber(template?.episode?.intro_pokeball_count, 4)),
      ))
    : [];
  const introPokeballs = [];
  const extraInputArgs = [];
  let nextInputRef = sectionPaths.length;
  for (const pokeball of requestedPokeballs) {
    const requestedPokeballPath = String(pokeball?.path || '').trim();
    if (!requestedPokeballPath) continue;
    const pokeballPath = resolve(projectRoot, requestedPokeballPath);
    try {
      await access(pokeballPath);
    } catch {
      continue;
    }
    extraInputArgs.push(
      '-loop',
      '1',
      '-framerate',
      String(fps),
      '-t',
      String(introDuration),
      '-i',
      pokeballPath,
    );
    introPokeballs.push({
      ...pokeball,
      input_ref: nextInputRef,
    });
    nextInputRef += 1;
  }
  let introMusicInputRef = null;
  const requestedMusicPath = String(programAssets?.intro_music_path || '').trim();
  if (requestedMusicPath) {
    const introMusicPath = resolve(projectRoot, requestedMusicPath);
    try {
      await access(introMusicPath);
      extraInputArgs.push(
        '-stream_loop',
        '-1',
        '-t',
        String(introDuration),
        '-i',
        introMusicPath,
      );
      introMusicInputRef = nextInputRef;
    } catch {
      introMusicInputRef = null;
    }
  }
  await writeFile(filterPath, buildMixedChallengeProgramFilter(sectionPaths.length, {
    sections,
    template,
    fontPath,
    programAssets: {
      intro_pokeballs: introPokeballs,
      intro_music_input_ref: introMusicInputRef,
    },
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
