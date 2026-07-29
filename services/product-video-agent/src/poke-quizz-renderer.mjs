import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { runLocalProcess } from './process-runner.mjs';

const DEFAULT_HOOK_TEXT_Y = 150;
const DEFAULT_PROMPT_TEXT_Y = 170;
const DEFAULT_REVEAL_TEXT_Y = 170;
const DEFAULT_TYPE_ICON_Y = 320;
const DEFAULT_TIMER_SIZE = 240;
const DEFAULT_TIMER_MARGIN_TOP = 20;
const DEFAULT_TIMER_NUMBER_SIZE = 112;
const DEFAULT_HOOK_FONT_SIZE = 92;
const DEFAULT_PROMPT_FONT_SIZE = 54;
const DEFAULT_REVEAL_FONT_SIZE = 88;
const DEFAULT_TEXT_BORDER = 6;
const DEFAULT_TEXT_LINE_SPACING = 12;
const DEFAULT_MUSIC_LEAD_SECONDS = 0.6;
const DEFAULT_MUSIC_VOLUME = 0.18;
const DEFAULT_VOICE_VOLUME = 1;
const DEFAULT_COUNTDOWN_VOLUME = 0.72;
const DEFAULT_TIMER_END_VOLUME = 0.9;
const DEFAULT_FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Avenir Next.ttc',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
];

function roundTime(value) {
  return Number(Number(value || 0).toFixed(3));
}

export function escapeDrawtextText(value) {
  return String(value || '')
    .replaceAll('\\', '\\\\')
    .replaceAll(':', '\\:')
    .replaceAll("'", "'\\''")
    .replaceAll('%', '\\%')
    .replaceAll(',', '\\,');
}

function normalizeDrawtextText(value) {
  return String(value || '').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function escapeFilterPath(filePath) {
  return String(filePath || '')
    .replaceAll('\\', '/')
    .replaceAll(':', '\\:')
    .replaceAll("'", "\\'");
}

function ensureNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function safeFilterLabel(prefix, index) {
  return `${prefix}${index}`;
}

export function estimateWrapCharacterLimit(template, fontSize) {
  const canvasWidth = ensureNumber(template?.canvas?.width, 1080);
  const safeZone = template?.canvas?.safe_zone || {};
  const maxTextWidth = canvasWidth - ensureNumber(safeZone.left, 100) - ensureNumber(safeZone.right, 100);
  return Math.max(12, Math.floor(maxTextWidth / Math.max(1, ensureNumber(fontSize, 60) * 0.56)));
}

export function wrapTextBlock(value, { maxCharactersPerLine, maxLines = 2 }) {
  const sourceText = normalizeDrawtextText(value).trim();
  if (!sourceText) {
    return {
      wrapped_text: '',
      lines: [],
    };
  }

  const normalizedMaxCharacters = Math.max(8, Math.floor(ensureNumber(maxCharactersPerLine, 24)));
  const tokens = sourceText.split(/\s+/u).filter(Boolean);
  const lines = [];
  let currentLine = '';

  for (const token of tokens) {
    const nextLine = currentLine ? `${currentLine} ${token}` : token;
    if (!currentLine || nextLine.length <= normalizedMaxCharacters) {
      currentLine = nextLine;
      continue;
    }
    lines.push(currentLine);
    currentLine = token;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  if (lines.length > maxLines) {
    const preservedLines = lines.slice(0, Math.max(0, maxLines - 1));
    const lastLine = lines.slice(Math.max(0, maxLines - 1)).join(' ');
    lines.length = 0;
    lines.push(...preservedLines, lastLine);
  }

  return {
    wrapped_text: lines.join('\n'),
    lines,
  };
}

function computeTextBlockY(baseY, lineCount, fontSize, template) {
  const safeTop = ensureNumber(template?.canvas?.safe_zone?.top, 160);
  if (lineCount <= 1) return baseY;
  const lineHeight = ensureNumber(fontSize, 60) + DEFAULT_TEXT_LINE_SPACING;
  return Math.max(safeTop - 10, Math.floor(baseY - (((lineCount - 1) * lineHeight) / 2)));
}

function buildAnimatedTextAlphaExpression(startSeconds, endSeconds) {
  const start = roundTime(startSeconds);
  const end = roundTime(endSeconds);
  const fadeInDuration = roundTime(Math.min(0.24, Math.max(0.14, (end - start) * 0.16)));
  const fadeOutDuration = roundTime(Math.min(0.18, Math.max(0.12, (end - start) * 0.12)));
  const fadeInEnd = roundTime(start + fadeInDuration);
  const fadeOutStart = roundTime(Math.max(start + fadeInDuration, end - fadeOutDuration));
  return `if(lt(t,${start}),0,if(lt(t,${fadeInEnd}),(t-${start})/${fadeInDuration},if(lt(t,${fadeOutStart}),1,if(lt(t,${end}),(${end}-t)/${fadeOutDuration},0))))`;
}

function buildAnimatedTextYExpression(baseY, startSeconds) {
  const start = roundTime(startSeconds);
  const settleEnd = roundTime(start + 0.32);
  return `${baseY}+if(lt(t,${settleEnd}),(1-((t-${start})/0.32))*18*sin((t-${start})*20),0)`;
}

function buildTextLineArtifacts(text, { template, fontSize, maxLines, baseY }) {
  const wrapped = wrapTextBlock(text, {
    maxCharactersPerLine: estimateWrapCharacterLimit(template, fontSize),
    maxLines,
  });
  const lineHeight = fontSize + DEFAULT_TEXT_LINE_SPACING;
  const blockY = computeTextBlockY(baseY, wrapped.lines.length, fontSize, template);
  return {
    line_height: lineHeight,
    lines: wrapped.lines.map((lineText, index) => ({
      text: lineText,
      y: blockY + (index * lineHeight),
    })),
  };
}

export function formatEnableBetween(startSeconds, endSeconds) {
  return `between(t,${startSeconds},${endSeconds})`;
}

export function buildPhaseSchedule(timeline = []) {
  const phases = {};
  let currentStart = 0;
  for (const entry of timeline) {
    const duration = ensureNumber(entry.duration_seconds, 0);
    phases[entry.phase] = {
      phase: entry.phase,
      start_seconds: roundTime(currentStart),
      duration_seconds: roundTime(duration),
      end_seconds: roundTime(currentStart + duration),
    };
    currentStart += duration;
  }
  return {
    phases,
    total_duration_seconds: roundTime(currentStart),
  };
}

export function buildTypeIconLayout(template, count = 2) {
  const canvasWidth = ensureNumber(template?.canvas?.width, 1080);
  const spacing = ensureNumber(template?.layout?.type_icons?.spacing_px, 28);
  const iconSize = ensureNumber(template?.layout?.type_icons?.icon_size_px, 168);
  const totalWidth = (count * iconSize) + (Math.max(0, count - 1) * spacing);
  const startX = Math.floor((canvasWidth - totalWidth) / 2);
  return Array.from({ length: count }, (_, index) => ({
    x: startX + (index * (iconSize + spacing)),
    y: DEFAULT_TYPE_ICON_Y,
    width: iconSize,
    height: iconSize,
  }));
}

export function buildTimerLayout(template) {
  const safeZone = template?.canvas?.safe_zone || {};
  const safeTop = ensureNumber(safeZone.top, 160);
  const safeLeft = ensureNumber(safeZone.left, 100);
  const size = DEFAULT_TIMER_SIZE;
  return {
    x: safeLeft,
    y: safeTop + DEFAULT_TIMER_MARGIN_TOP,
    width: size,
    height: size,
    number_center_x: safeLeft + Math.floor(size / 2),
    number_center_y: safeTop + DEFAULT_TIMER_MARGIN_TOP + Math.floor(size / 2),
  };
}

export function buildCountdownMoments(schedule, countdownFrom, countdownTo = 0) {
  const countdownPhase = schedule.phases.countdown;
  if (!countdownPhase) return [];
  const values = [];
  let current = ensureNumber(countdownFrom, 5);
  const target = ensureNumber(countdownTo, 0);
  const direction = current >= target ? -1 : 1;
  let offset = 0;
  while ((direction === -1 && current >= target) || (direction === 1 && current <= target)) {
    const start = countdownPhase.start_seconds + offset;
    const isLast = current === target;
    values.push({
      value: String(current),
      start_seconds: roundTime(start),
      end_seconds: roundTime(isLast ? countdownPhase.end_seconds + 0.35 : start + 1),
    });
    current += direction;
    offset += 1;
  }
  return values;
}

export function buildPokeQuizzRenderPlan({ plan, template, outputPath }) {
  const schedule = buildPhaseSchedule(plan.timeline);
  const typeIconLayout = buildTypeIconLayout(template, plan.assets.type_icons.length);
  const timerLayout = buildTimerLayout(template);
  const countdownPhase = schedule.phases.countdown || { start_seconds: 0, end_seconds: 0 };
  const revealPhase = schedule.phases.reveal || { start_seconds: schedule.total_duration_seconds, end_seconds: schedule.total_duration_seconds };
  return {
    canvas: {
      width: ensureNumber(template?.canvas?.width, 1080),
      height: ensureNumber(template?.canvas?.height, 1920),
      fps: ensureNumber(template?.canvas?.fps, 30),
    },
    phases: schedule.phases,
    total_duration_seconds: schedule.total_duration_seconds,
    type_icon_layout: typeIconLayout,
    timer_layout: timerLayout,
    countdown_numbers: buildCountdownMoments(
      schedule,
      template?.layout?.timer?.countdown_from,
      template?.layout?.timer?.countdown_to,
    ),
    grid: plan.assets.overlays?.pokeball_grid || { cells: [], item_count: 0, columns: 0, rows: 0 },
    audio_cues: {
      hook_start_seconds: schedule.phases.hook?.start_seconds ?? 0,
      prompt_start_seconds: schedule.phases.type_prompt?.start_seconds ?? 0,
      countdown_start_seconds: countdownPhase.start_seconds,
      timer_end_seconds: revealPhase.start_seconds,
      reveal_start_seconds: revealPhase.start_seconds,
      battle_music_start_seconds: roundTime(Math.max(0, revealPhase.start_seconds - DEFAULT_MUSIC_LEAD_SECONDS)),
    },
    text: {
      hook: plan.timeline.find((entry) => entry.phase === 'hook')?.on_screen_text || '',
      prompt: plan.timeline.find((entry) => entry.phase === 'type_prompt')?.on_screen_text || '',
      reveal: plan.timeline.find((entry) => entry.phase === 'reveal')?.spoken_text || '',
    },
    output_path: outputPath,
  };
}

function buildVisualInputs(plan, renderPlan) {
  const inputs = [];
  const totalDuration = renderPlan.total_duration_seconds;
  const backgroundPath = plan.assets.background.selected_path;
  const backgroundExt = extname(backgroundPath || '').toLowerCase();
  const backgroundIsVideo = ['.mp4', '.mov', '.webm'].includes(backgroundExt);
  const backgroundIsGif = backgroundExt === '.gif';
  inputs.push({
    role: 'background',
    path: backgroundPath,
    args: backgroundIsVideo
      ? ['-stream_loop', '-1', '-t', String(totalDuration), '-i', backgroundPath]
      : backgroundIsGif
        ? ['-ignore_loop', '0', '-t', String(totalDuration), '-i', backgroundPath]
        : ['-loop', '1', '-framerate', String(renderPlan.canvas.fps), '-t', String(totalDuration), '-i', backgroundPath],
  });

  for (const typeIcon of plan.assets.type_icons) {
    inputs.push({
      role: `type-icon-${typeIcon.type}`,
      path: typeIcon.local_path,
      args: ['-loop', '1', '-framerate', String(renderPlan.canvas.fps), '-t', String(totalDuration), '-i', typeIcon.local_path],
    });
  }

  inputs.push({
    role: 'timer',
    path: plan.assets.overlays.selected_timer_path,
    args: ['-stream_loop', '-1', '-ignore_loop', '0', '-t', String(totalDuration), '-i', plan.assets.overlays.selected_timer_path],
  });

  inputs.push({
    role: 'pokeball-grid',
    path: plan.assets.overlays.selected_primary_pokeball_overlay_path,
    args: ['-stream_loop', '-1', '-ignore_loop', '0', '-t', String(totalDuration), '-i', plan.assets.overlays.selected_primary_pokeball_overlay_path],
  });

  for (const pokemon of plan.assets.pokemon) {
    inputs.push({
      role: `pokemon-${pokemon.national_dex_number}`,
      path: pokemon.sprite_path,
      args: ['-loop', '1', '-framerate', String(renderPlan.canvas.fps), '-t', String(Math.max(0.5, renderPlan.phases.reveal?.duration_seconds || 0)), '-i', pokemon.sprite_path],
    });
  }

  return inputs;
}

function buildVisualFilterScript(plan, template, renderPlan, inputRefs, fontPath, textArtifacts) {
  const filters = [];
  const { width, height, fps } = renderPlan.canvas;
  const countdownDuration = Math.max(0.5, ensureNumber(renderPlan.phases.countdown?.duration_seconds, 0));
  const countdownStart = ensureNumber(renderPlan.phases.countdown?.start_seconds, 0);
  filters.push(`[${inputRefs.background}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1[v0]`);

  for (let index = 0; index < plan.assets.type_icons.length; index += 1) {
    const iconLabel = safeFilterLabel('type', index);
    const position = renderPlan.type_icon_layout[index];
    filters.push(`[${inputRefs.typeIcons[index]}:v]scale=${position.width}:${position.height}:force_original_aspect_ratio=decrease,setsar=1[${iconLabel}]`);
    filters.push(
      `[v${index}][${iconLabel}]overlay=${position.x}:${position.y}:enable='${formatEnableBetween(renderPlan.phases.type_prompt.start_seconds, renderPlan.total_duration_seconds)}'[v${index + 1}]`,
    );
  }

  let currentVideoLabel = `v${plan.assets.type_icons.length}`;

  const gridItemSize = ensureNumber(renderPlan.grid.item_size_px, 180);
  const pokeballSplitLabels = renderPlan.grid.cells.map((_, index) => safeFilterLabel('pb', index));
  if (pokeballSplitLabels.length > 0) {
    filters.push(`[${inputRefs.timer}:v]fps=${fps},trim=duration=${countdownDuration},setpts=PTS-STARTPTS+${countdownStart}/TB,scale=${renderPlan.timer_layout.width}:${renderPlan.timer_layout.height}:force_original_aspect_ratio=decrease,format=rgba,colorkey=0xFFFFFF:0.22:0.1,setsar=1[timer]`);
    filters.push(`[${inputRefs.pokeball}:v]fps=${fps},trim=duration=${countdownDuration},setpts=PTS-STARTPTS+${countdownStart}/TB,scale=${gridItemSize}:${gridItemSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[pokeballbase]`);
    filters.push(`[pokeballbase]split=${pokeballSplitLabels.length}${pokeballSplitLabels.map((label) => `[${label}]`).join('')}`);
    for (let index = 0; index < renderPlan.grid.cells.length; index += 1) {
      const cell = renderPlan.grid.cells[index];
      const nextVideoLabel = safeFilterLabel('vg', index);
      filters.push(
        `[${currentVideoLabel}][${pokeballSplitLabels[index]}]overlay=${cell.x}:${cell.y}:enable='${formatEnableBetween(renderPlan.phases.countdown.start_seconds, renderPlan.phases.reveal.start_seconds)}'[${nextVideoLabel}]`,
      );
      currentVideoLabel = nextVideoLabel;
    }
    const timerVideoLabel = `${currentVideoLabel}t`;
    filters.push(
      `[${currentVideoLabel}][timer]overlay=${renderPlan.timer_layout.x}:${renderPlan.timer_layout.y}:enable='${formatEnableBetween(renderPlan.phases.countdown.start_seconds, renderPlan.phases.reveal.start_seconds)}'[${timerVideoLabel}]`,
    );
    currentVideoLabel = timerVideoLabel;
  }

  const spriteLabels = [];
  for (let index = 0; index < plan.assets.pokemon.length; index += 1) {
    const spriteLabel = safeFilterLabel('sprite', index);
    spriteLabels.push(spriteLabel);
    filters.push(
      `[${inputRefs.pokemon[index]}:v]scale=${gridItemSize}:${gridItemSize}:force_original_aspect_ratio=decrease,setsar=1[${spriteLabel}]`,
    );
  }

  for (let index = 0; index < renderPlan.grid.cells.length && index < spriteLabels.length; index += 1) {
    const cell = renderPlan.grid.cells[index];
    const nextVideoLabel = safeFilterLabel('vr', index);
    filters.push(
      `[${currentVideoLabel}][${spriteLabels[index]}]overlay=${cell.x}:${cell.y}:enable='${formatEnableBetween(renderPlan.phases.reveal.start_seconds, renderPlan.total_duration_seconds)}'[${nextVideoLabel}]`,
    );
    currentVideoLabel = nextVideoLabel;
  }

  const drawtextParts = [];
  const fontPart = fontPath ? `:fontfile='${escapeFilterPath(fontPath)}'` : '';
  for (const line of textArtifacts.hook.lines) {
    drawtextParts.push(
      `drawtext=text='${escapeDrawtextText(line.text)}'${fontPart}:fontcolor=white:fontsize=${DEFAULT_HOOK_FONT_SIZE}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(line.y, renderPlan.phases.hook.start_seconds)}':alpha='${buildAnimatedTextAlphaExpression(renderPlan.phases.hook.start_seconds, renderPlan.phases.hook.end_seconds)}':enable='${formatEnableBetween(renderPlan.phases.hook.start_seconds, renderPlan.phases.hook.end_seconds)}'`,
    );
  }
  for (const line of textArtifacts.prompt.lines) {
    drawtextParts.push(
      `drawtext=text='${escapeDrawtextText(line.text)}'${fontPart}:fontcolor=white:fontsize=${DEFAULT_PROMPT_FONT_SIZE}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(line.y, renderPlan.phases.type_prompt.start_seconds)}':alpha='${buildAnimatedTextAlphaExpression(renderPlan.phases.type_prompt.start_seconds, renderPlan.phases.reveal.start_seconds)}':enable='${formatEnableBetween(renderPlan.phases.type_prompt.start_seconds, renderPlan.phases.reveal.start_seconds)}'`,
    );
  }
  for (const line of textArtifacts.reveal.lines) {
    drawtextParts.push(
      `drawtext=text='${escapeDrawtextText(line.text)}'${fontPart}:fontcolor=white:fontsize=${DEFAULT_REVEAL_FONT_SIZE}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(line.y, renderPlan.phases.reveal.start_seconds)}':alpha='${buildAnimatedTextAlphaExpression(renderPlan.phases.reveal.start_seconds, renderPlan.total_duration_seconds)}':enable='${formatEnableBetween(renderPlan.phases.reveal.start_seconds, renderPlan.total_duration_seconds)}'`,
    );
  }
  for (const countdown of renderPlan.countdown_numbers) {
    drawtextParts.push(
      `drawtext=text='${escapeDrawtextText(countdown.value)}'${fontPart}:fontcolor=white:fontsize=${DEFAULT_TIMER_NUMBER_SIZE}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:x=${renderPlan.timer_layout.number_center_x}-text_w/2:y=${renderPlan.timer_layout.number_center_y}-text_h/2:enable='${formatEnableBetween(countdown.start_seconds, countdown.end_seconds)}'`,
    );
  }

  filters.push(`[${currentVideoLabel}]${drawtextParts.join(',')}[vout]`);

  return {
    script: `${filters.join(';\n')}\n`,
    outputLabel: 'vout',
  };
}

function buildAudioInputs(assets) {
  return assets.flatMap((asset) => ['-i', asset]);
}

function buildTextArtifacts({ renderPlan, template }) {
  return {
    hook: buildTextLineArtifacts(renderPlan.text.hook, {
      template,
      fontSize: DEFAULT_HOOK_FONT_SIZE,
      maxLines: 2,
      baseY: DEFAULT_HOOK_TEXT_Y,
    }),
    prompt: buildTextLineArtifacts(renderPlan.text.prompt, {
      template,
      fontSize: DEFAULT_PROMPT_FONT_SIZE,
      maxLines: 2,
      baseY: DEFAULT_PROMPT_TEXT_Y,
    }),
    reveal: buildTextLineArtifacts(renderPlan.text.reveal, {
      template,
      fontSize: DEFAULT_REVEAL_FONT_SIZE,
      maxLines: 2,
      baseY: DEFAULT_REVEAL_TEXT_Y,
    }),
  };
}

export function buildAudioFilterScript({ narrationPaths, musicPath, countdownPath, timerEndPath, renderPlan }) {
  const filters = [];
  const mixLabels = [];

  narrationPaths.forEach((path, index) => {
    const cueKey = index === 0 ? 'hook_start_seconds' : index === 1 ? 'prompt_start_seconds' : 'reveal_start_seconds';
    const delayMs = Math.max(0, Math.round((renderPlan.audio_cues[cueKey] || 0) * 1000));
    const label = `n${index}`;
    filters.push(`[${index}:a]adelay=${delayMs}|${delayMs},volume=${DEFAULT_VOICE_VOLUME}[${label}]`);
    mixLabels.push(label);
  });

  let inputIndex = narrationPaths.length;
  if (musicPath) {
    const delayMs = Math.max(0, Math.round(renderPlan.audio_cues.battle_music_start_seconds * 1000));
    const musicDuration = Math.max(0.5, renderPlan.total_duration_seconds - renderPlan.audio_cues.battle_music_start_seconds);
    filters.push(
      `[${inputIndex}:a]atrim=0:${musicDuration},afade=t=in:st=0:d=0.15,afade=t=out:st=${Math.max(0, musicDuration - 0.6)}:d=0.6,adelay=${delayMs}|${delayMs},volume=${DEFAULT_MUSIC_VOLUME}[music]`,
    );
    mixLabels.push('music');
    inputIndex += 1;
  }

  if (countdownPath) {
    filters.push(`[${inputIndex}:a]asplit=5[c0][c1][c2][c3][c4]`);
    for (let tickIndex = 0; tickIndex < 5; tickIndex += 1) {
      const delayMs = Math.max(0, Math.round((renderPlan.audio_cues.countdown_start_seconds + tickIndex) * 1000));
      const remainingWindowSeconds = renderPlan.audio_cues.timer_end_seconds - (renderPlan.audio_cues.countdown_start_seconds + tickIndex);
      const clipDurationSeconds = Math.max(0.12, Math.min(0.95, remainingWindowSeconds - 0.03));
      const label = `cd${tickIndex}`;
      filters.push(`[c${tickIndex}]atrim=0:${clipDurationSeconds},adelay=${delayMs}|${delayMs},volume=${DEFAULT_COUNTDOWN_VOLUME}[${label}]`);
      mixLabels.push(label);
    }
    inputIndex += 1;
  }

  if (timerEndPath) {
    const delayMs = Math.max(0, Math.round(renderPlan.audio_cues.timer_end_seconds * 1000));
    filters.push(`[${inputIndex}:a]adelay=${delayMs}|${delayMs},volume=${DEFAULT_TIMER_END_VOLUME}[timerend]`);
    mixLabels.push('timerend');
  }

  filters.push(`${mixLabels.map((label) => `[${label}]`).join('')}amix=inputs=${mixLabels.length}:normalize=0,alimiter=limit=0.95[aout]`);
  return `${filters.join(';\n')}\n`;
}

async function verifyReadableFiles(paths) {
  for (const filePath of paths) {
    await access(filePath);
  }
}

async function resolveFontPath(fontCandidates = DEFAULT_FONT_CANDIDATES) {
  for (const filePath of fontCandidates) {
    try {
      await access(filePath);
      return filePath;
    } catch {
      // Continue until a readable font is found.
    }
  }
  return null;
}

async function synthesizeNarrationTrack({ pythonExecutable, scriptPath, cacheDir, profile, outputPath, text, cwd }) {
  await mkdir(dirname(outputPath), { recursive: true });
  await runLocalProcess({
    executable: pythonExecutable,
    args: [
      scriptPath,
      '--model',
      profile.runtime_model || 'hexgrad/Kokoro-82M',
      '--voice',
      profile.voice,
      '--output-file',
      outputPath,
      '--cache-dir',
      cacheDir,
      '--speed',
      String(profile.synthesis?.speed ?? 1),
      '--prosody-mode',
      profile.synthesis?.prosody_mode || 'full_context',
      '--sentence-pause-ms',
      String(profile.synthesis?.sentence_pause_ms ?? 0),
    ],
    cwd,
    input: text,
    timeoutMs: 300_000,
  });
  return outputPath;
}

export async function renderPokeQuizzVideo({
  plan,
  template,
  outputPath,
  projectRoot,
  ffmpegExecutable,
  kokoro,
  runtimeRoot,
  fontCandidates = DEFAULT_FONT_CANDIDATES,
}) {
  const renderPlan = buildPokeQuizzRenderPlan({ plan, template, outputPath });
  const outputAbsolutePath = resolve(projectRoot, outputPath);
  const audioMixPath = resolve(runtimeRoot, `${slugify(plan.selection.type_pair.join('-'))}-${slugify(plan.seed)}-audio.m4a`);
  const filterScriptPath = resolve(runtimeRoot, `${slugify(plan.selection.type_pair.join('-'))}-${slugify(plan.seed)}-video.filters.txt`);
  const audioFilterScriptPath = resolve(runtimeRoot, `${slugify(plan.selection.type_pair.join('-'))}-${slugify(plan.seed)}-audio.filters.txt`);
  const narrationRoot = resolve(runtimeRoot, 'narration');
  const narrationPaths = await Promise.all(plan.narration.lines.map((line, index) => (
    synthesizeNarrationTrack({
      pythonExecutable: kokoro.pythonExecutable,
      scriptPath: kokoro.scriptPath,
      cacheDir: kokoro.cacheDir,
      profile: kokoro.profile,
      outputPath: resolve(narrationRoot, `${String(index + 1).padStart(2, '0')}-${slugify(line.role)}.wav`),
      text: line.text,
      cwd: projectRoot,
    })
  )));

  const musicPath = plan.assets.audio.selected_battle_intro_music_path || null;
  const countdownPath = plan.assets.audio.selected_sound_effects?.countdown_tick || null;
  const timerEndPath = plan.assets.audio.selected_sound_effects?.timer_end || null;
  await verifyReadableFiles([
    ...narrationPaths,
    ...(musicPath ? [musicPath] : []),
    ...(countdownPath ? [countdownPath] : []),
    ...(timerEndPath ? [timerEndPath] : []),
  ]);

  await mkdir(dirname(audioMixPath), { recursive: true });
  const audioFilterScript = buildAudioFilterScript({
    narrationPaths,
    musicPath,
    countdownPath,
    timerEndPath,
    renderPlan,
  });
  await writeFile(audioFilterScriptPath, audioFilterScript, 'utf8');
  await runLocalProcess({
    executable: ffmpegExecutable,
    args: [
      '-y',
      ...buildAudioInputs([
        ...narrationPaths,
        ...(musicPath ? [musicPath] : []),
        ...(countdownPath ? [countdownPath] : []),
        ...(timerEndPath ? [timerEndPath] : []),
      ]),
      '-/filter_complex',
      audioFilterScriptPath,
      '-map',
      '[aout]',
      '-t',
      String(renderPlan.total_duration_seconds),
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      audioMixPath,
    ],
    cwd: projectRoot,
    timeoutMs: 300_000,
  });

  const visualInputs = buildVisualInputs(plan, renderPlan);
  await verifyReadableFiles(visualInputs.map((input) => input.path));
  const inputRefs = {
    background: 0,
    typeIcons: plan.assets.type_icons.map((_, index) => index + 1),
    timer: plan.assets.type_icons.length + 1,
    pokeball: plan.assets.type_icons.length + 2,
    pokemon: plan.assets.pokemon.map((_, index) => plan.assets.type_icons.length + 3 + index),
  };
  const fontPath = await resolveFontPath(fontCandidates);
  const textArtifacts = buildTextArtifacts({ renderPlan, template });
  const visualFilter = buildVisualFilterScript(plan, template, renderPlan, inputRefs, fontPath, textArtifacts);
  await writeFile(filterScriptPath, visualFilter.script, 'utf8');

  await mkdir(dirname(outputAbsolutePath), { recursive: true });
  await runLocalProcess({
    executable: ffmpegExecutable,
    args: [
      '-y',
      ...visualInputs.flatMap((input) => input.args),
      '-i',
      audioMixPath,
      '-/filter_complex',
      filterScriptPath,
      '-map',
      '[vout]',
      '-map',
      `${visualInputs.length}:a:0`,
      '-r',
      String(renderPlan.canvas.fps),
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
      '-movflags',
      '+faststart',
      outputAbsolutePath,
    ],
    cwd: projectRoot,
    timeoutMs: 600_000,
  });

  await access(outputAbsolutePath);
  return {
    output_path: outputAbsolutePath,
    audio_mix_path: audioMixPath,
    audio_filter_script_path: audioFilterScriptPath,
    video_filter_script_path: filterScriptPath,
    narration_paths: narrationPaths,
    render_plan: renderPlan,
  };
}

export async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}
