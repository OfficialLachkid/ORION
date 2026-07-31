import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { runLocalProcess } from './process-runner.mjs';

const DEFAULT_HOOK_TEXT_Y = 150;
const DEFAULT_PROMPT_TEXT_Y = 170;
const DEFAULT_REVEAL_TEXT_Y = 170;
const DEFAULT_TYPE_ICON_Y = 320;
const DEFAULT_TIMER_SIZE = 300;
const DEFAULT_TIMER_SCALE_MULTIPLIER = 1.5;
const DEFAULT_TIMER_NUMBER_SIZE = 112;
const DEFAULT_HOOK_FONT_SIZE = 138;
const DEFAULT_PROMPT_FONT_SIZE = 81;
const DEFAULT_REVEAL_FONT_SIZE = 132;
const DEFAULT_TEXT_BORDER = 6;
const DEFAULT_TEXT_LINE_SPACING = 12;
const DEFAULT_MUSIC_LEAD_SECONDS = 0.6;
const DEFAULT_MUSIC_VOLUME = 0.18;
const DEFAULT_VOICE_VOLUME = 1;
const DEFAULT_COUNTDOWN_VOLUME = 0.72;
const DEFAULT_TIMER_END_VOLUME = 0.9;
const DEFAULT_REVEAL_TRANSITION_SECONDS = 0.42;
const DEFAULT_REVEAL_VISUAL_DELAY_SECONDS = 0.5;
const DEFAULT_REVEALED_SPRITE_SCALE_MULTIPLIER = 1.2;
const DEFAULT_POKEBALL_SCALE_MULTIPLIER = 1.2;
const DEFAULT_TYPE_ICON_HOOK_SCALE_MULTIPLIER = 1.55;
const DEFAULT_TYPE_ICON_HOOK_Y = 620;
const DEFAULT_TYPE_ICON_SETTLE_SECONDS = 0.18;
const DEFAULT_TYPE_ICON_POP_IN_SECONDS = 0.2;
const DEFAULT_TYPE_ICON_BACKDROP_SCALE_MULTIPLIER = 0.82;
const DEFAULT_TYPE_ICON_BACKDROP_ALPHA = 255;
const DEFAULT_TYPE_ICON_OUTLINE_SCALE_MULTIPLIER = 1.035;
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
    .replaceAll("'", "\\'")
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

function buildAnimatedLerpExpression({ fromValue, toValue, holdUntilSeconds, transitionDurationSeconds }) {
  const start = roundTime(holdUntilSeconds);
  const duration = roundTime(Math.max(0.12, transitionDurationSeconds));
  const end = roundTime(start + duration);
  const progress = `min(max((t-${start})/${duration},0),1)`;
  return `if(lt(t,${start}),${fromValue},if(lt(t,${end}),${fromValue}+((${toValue}-${fromValue})*${progress}),${toValue}))`;
}

function buildAnimatedPopMultiplierExpression(startSeconds, durationSeconds = DEFAULT_TYPE_ICON_POP_IN_SECONDS) {
  const start = roundTime(startSeconds);
  const duration = roundTime(Math.max(0.16, durationSeconds));
  const peak = roundTime(start + (duration * 0.6));
  const end = roundTime(start + duration);
  return `if(lt(t,${start}),0.56,if(lt(t,${peak}),0.56+((t-${start})/${roundTime(peak - start)})*0.60,if(lt(t,${end}),1.16-((t-${peak})/${roundTime(end - peak)})*0.16,1)))`;
}

function buildAnimatedLiftExpression(startSeconds, durationSeconds = DEFAULT_TYPE_ICON_POP_IN_SECONDS, distancePx = 30) {
  const start = roundTime(startSeconds);
  const duration = roundTime(Math.max(0.16, durationSeconds));
  const end = roundTime(start + duration);
  return `if(lt(t,${start}),${distancePx},if(lt(t,${end}),${distancePx}*(1-((t-${start})/${duration})),0))`;
}

function resolveRevealSpriteHoldSize({ gridItemSize, itemCount, configuredMultiplier }) {
  const desiredSize = gridItemSize * Math.max(1, configuredMultiplier);
  if (itemCount <= 2) return roundTime(desiredSize);
  if (itemCount <= 4) return roundTime(Math.min(desiredSize, gridItemSize * 1.38));
  if (itemCount <= 6) return roundTime(Math.min(desiredSize, gridItemSize * 1.26));
  return roundTime(Math.min(desiredSize, gridItemSize * 1.14));
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

export function buildHookTypeIconLayout(template, count = 2) {
  const canvasWidth = ensureNumber(template?.canvas?.width, 1080);
  const baseSpacing = ensureNumber(template?.layout?.type_icons?.spacing_px, 28);
  const iconSize = Math.round(
    ensureNumber(template?.layout?.type_icons?.icon_size_px, 168) * DEFAULT_TYPE_ICON_HOOK_SCALE_MULTIPLIER,
  );
  const spacing = Math.max(60, Math.round(baseSpacing * 1.35));
  const totalWidth = (count * iconSize) + (Math.max(0, count - 1) * spacing);
  const startX = Math.floor((canvasWidth - totalWidth) / 2);
  return Array.from({ length: count }, (_, index) => ({
    x: startX + (index * (iconSize + spacing)),
    y: DEFAULT_TYPE_ICON_HOOK_Y,
    width: iconSize,
    height: iconSize,
  }));
}

export function buildTimerLayout(template, gridLayout = null) {
  const canvasWidth = ensureNumber(template?.canvas?.width, 1080);
  const safeZone = template?.canvas?.safe_zone || {};
  const safeTop = ensureNumber(safeZone.top, 160);
  const gridStage = gridLayout?.stage_bounds_px || template?.layout?.pokeball_grid?.stage_bounds_px || {};
  const gridTop = ensureNumber(gridStage.top, safeTop + 560);
  const typeIconBottom = DEFAULT_TYPE_ICON_Y + ensureNumber(template?.layout?.type_icons?.icon_size_px, 168);
  const gridCellTop = Array.isArray(gridLayout?.cells) && gridLayout.cells.length > 0
    ? Math.min(...gridLayout.cells.map((cell) => ensureNumber(cell?.y, gridTop)))
    : gridTop;
  const gridVisualTop = gridCellTop > (typeIconBottom + 40) ? gridCellTop : gridTop;
  const gridItemSize = ensureNumber(
    gridLayout?.item_size_px,
    ensureNumber(template?.layout?.pokeball_grid?.item_size_px, 240),
  );
  const size = Math.round(Math.max(DEFAULT_TIMER_SIZE, gridItemSize * 1.22) * DEFAULT_TIMER_SCALE_MULTIPLIER);
  const gapCenterY = Math.floor((typeIconBottom + gridVisualTop) / 2);
  const left = Math.max(24, Math.floor((canvasWidth - size) / 2));
  const top = Math.max(safeTop + 110, gapCenterY - Math.floor(size / 2));
  return {
    x: left,
    y: top,
    width: size,
    height: size,
    number_center_x: left + Math.floor(size / 2),
    number_center_y: top + Math.floor(size / 2),
  };
}

function buildCountdownNumberScaleMultiplierExpression(startSeconds, endSeconds) {
  const start = roundTime(startSeconds);
  const end = roundTime(endSeconds);
  const duration = roundTime(Math.max(0.18, end - start));
  const popDuration = roundTime(Math.min(0.24, Math.max(0.16, duration * 0.28)));
  const peak = roundTime(start + (popDuration * 0.58));
  const settle = roundTime(start + popDuration);
  const outroDuration = roundTime(Math.min(0.18, Math.max(0.12, duration * 0.2)));
  const outroStart = roundTime(Math.max(settle, end - outroDuration));
  return `if(lt(t,${start}),0.78,if(lt(t,${peak}),0.78+((t-${start})/${roundTime(peak - start)})*0.44,if(lt(t,${settle}),1.22-((t-${peak})/${roundTime(settle - peak)})*0.22,if(lt(t,${outroStart}),1,if(lt(t,${end}),1-((t-${outroStart})/${outroDuration})*0.1,0.9)))))`;
}

function buildCountdownNumberAlphaExpression(startSeconds, endSeconds) {
  const start = roundTime(startSeconds);
  const end = roundTime(endSeconds);
  const duration = roundTime(Math.max(0.18, end - start));
  const fadeInDuration = roundTime(Math.min(0.16, Math.max(0.08, duration * 0.18)));
  const fadeOutDuration = roundTime(Math.min(0.12, Math.max(0.08, duration * 0.14)));
  const fadeInEnd = roundTime(start + fadeInDuration);
  const fadeOutStart = roundTime(Math.max(fadeInEnd, end - fadeOutDuration));
  return `if(lt(t,${start}),0,if(lt(t,${fadeInEnd}),(t-${start})/${fadeInDuration},if(lt(t,${fadeOutStart}),1,if(lt(t,${end}),(${end}-t)/${fadeOutDuration},0))))`;
}

function buildCountdownNumberYExpression(baseY, startSeconds, endSeconds) {
  const start = roundTime(startSeconds);
  const end = roundTime(endSeconds);
  const duration = roundTime(Math.max(0.18, end - start));
  const introDuration = roundTime(Math.min(0.22, Math.max(0.14, duration * 0.24)));
  const outroDuration = roundTime(Math.min(0.18, Math.max(0.1, duration * 0.18)));
  const introEnd = roundTime(start + introDuration);
  const outroStart = roundTime(Math.max(introEnd, end - outroDuration));
  return `${baseY}+if(lt(t,${introEnd}),(${introEnd}-t)/${introDuration}*20,if(lt(t,${outroStart}),sin((t-${start})*14)*2,-((t-${outroStart})/${outroDuration})*12))`;
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
  const typeIconIntroLayout = buildHookTypeIconLayout(template, plan.assets.type_icons.length);
  const timerLayout = buildTimerLayout(template, plan.assets.overlays?.pokeball_grid || null);
  const countdownPhase = schedule.phases.countdown || { start_seconds: 0, end_seconds: 0 };
  const revealPhase = schedule.phases.reveal || { start_seconds: schedule.total_duration_seconds, end_seconds: schedule.total_duration_seconds };
  const configuredBattleMusicStartSeconds = roundTime(
    Math.max(0, ensureNumber(template?.audio?.battle_intro_music?.start_seconds, 0)),
  );
  const revealTransitionDuration = roundTime(
    Math.min(
      0.52,
      Math.max(0.36, ensureNumber(revealPhase.duration_seconds, 2.4) * 0.18),
    ),
  );
  const typeIconSettleDuration = roundTime(
    Math.min(
      0.3,
      Math.max(
        DEFAULT_TYPE_ICON_SETTLE_SECONDS,
        ensureNumber(schedule.phases.type_prompt?.duration_seconds, 1.6) * 0.16,
      ),
    ),
  );
  const revealVisualDelay = roundTime(
    Math.max(
      0,
      ensureNumber(template?.reveal?.visual_delay_seconds, DEFAULT_REVEAL_VISUAL_DELAY_SECONDS),
    ),
  );
  const revealVisualStart = roundTime(
    Math.min(schedule.total_duration_seconds, revealPhase.start_seconds + revealVisualDelay),
  );
  return {
    canvas: {
      width: ensureNumber(template?.canvas?.width, 1080),
      height: ensureNumber(template?.canvas?.height, 1920),
      fps: ensureNumber(template?.canvas?.fps, 30),
    },
    phases: schedule.phases,
    total_duration_seconds: schedule.total_duration_seconds,
    type_icon_layout: typeIconLayout,
    type_icon_intro_layout: typeIconIntroLayout,
    timer_layout: timerLayout,
    countdown_numbers: buildCountdownMoments(
      schedule,
      template?.layout?.timer?.countdown_from,
      template?.layout?.timer?.countdown_to,
    ),
    transitions: {
      reveal_cross_scale_seconds: revealTransitionDuration || DEFAULT_REVEAL_TRANSITION_SECONDS,
      type_icon_settle_seconds: typeIconSettleDuration || DEFAULT_TYPE_ICON_SETTLE_SECONDS,
    },
    grid: plan.assets.overlays?.pokeball_grid || { cells: [], item_count: 0, columns: 0, rows: 0 },
    audio_cues: {
      hook_start_seconds: schedule.phases.hook?.start_seconds ?? 0,
      prompt_start_seconds: schedule.phases.type_prompt?.start_seconds ?? 0,
      countdown_start_seconds: countdownPhase.start_seconds,
      prompt_end_seconds: countdownPhase.start_seconds,
      timer_end_seconds: revealPhase.start_seconds,
      reveal_start_seconds: revealPhase.start_seconds,
      reveal_visual_start_seconds: revealVisualStart,
      battle_music_start_seconds: roundTime(
        Math.min(schedule.total_duration_seconds, configuredBattleMusicStartSeconds),
      ),
    },
    text: {
      hook: plan.timeline.find((entry) => entry.phase === 'hook')?.on_screen_text || '',
      prompt: plan.timeline.find((entry) => entry.phase === 'type_prompt')?.on_screen_text || '',
      reveal: plan.timeline.find((entry) => entry.phase === 'reveal')?.spoken_text || '',
    },
    output_path: outputPath,
  };
}

export function applyNarrationDurationsToRenderPlan(renderPlan, narrationDurations = {}) {
  const promptDurationSeconds = ensureNumber(narrationDurations.prompt_seconds, 0);
  if (promptDurationSeconds <= 0) {
    return renderPlan;
  }

  return {
    ...renderPlan,
    audio_cues: {
      ...renderPlan.audio_cues,
      prompt_end_seconds: roundTime(
        Math.min(
          renderPlan.audio_cues.timer_end_seconds,
          Math.max(
            ensureNumber(renderPlan.audio_cues.prompt_end_seconds, renderPlan.audio_cues.countdown_start_seconds),
            renderPlan.audio_cues.prompt_start_seconds + promptDurationSeconds,
          ),
        ),
      ),
    },
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
    role: 'timer-countdown',
    path: plan.assets.overlays.selected_timer_countdown_path || plan.assets.overlays.selected_timer_path,
    args: ['-ignore_loop', '1', '-i', plan.assets.overlays.selected_timer_countdown_path || plan.assets.overlays.selected_timer_path],
  });

  if (plan.assets.overlays.selected_timer_alarm_path) {
    inputs.push({
      role: 'timer-alarm',
      path: plan.assets.overlays.selected_timer_alarm_path,
      args: ['-ignore_loop', '1', '-i', plan.assets.overlays.selected_timer_alarm_path],
    });
  }

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
  const revealVisualStart = ensureNumber(
    renderPlan.audio_cues?.reveal_visual_start_seconds,
    ensureNumber(renderPlan.phases.reveal?.start_seconds, 0),
  );
  const revealTransitionDuration = ensureNumber(
    renderPlan.transitions?.reveal_cross_scale_seconds,
    DEFAULT_REVEAL_TRANSITION_SECONDS,
  );
  const revealTransitionEnd = roundTime(
    Math.min(renderPlan.total_duration_seconds, revealVisualStart + revealTransitionDuration),
  );
  filters.push(`[${inputRefs.background}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1[v0]`);

  for (let index = 0; index < plan.assets.type_icons.length; index += 1) {
    const iconLabel = safeFilterLabel('type', index);
    const iconOutlineLabel = safeFilterLabel('typeoutline', index);
    const iconBackdropBaseLabel = safeFilterLabel('typebgbase', index);
    const iconBackdropLabel = safeFilterLabel('typebg', index);
    const iconBackdropVideoLabel = safeFilterLabel('vtbg', index);
    const iconOutlineVideoLabel = safeFilterLabel('vtol', index);
    const position = renderPlan.type_icon_layout[index];
    const introPosition = renderPlan.type_icon_intro_layout[index] || position;
    const settleDuration = ensureNumber(
      renderPlan.transitions?.type_icon_settle_seconds,
      DEFAULT_TYPE_ICON_SETTLE_SECONDS,
    );
    const hookStart = ensureNumber(renderPlan.phases.hook?.start_seconds, 0);
    const iconSettleStart = ensureNumber(renderPlan.phases.type_prompt?.start_seconds, 0);
    const baseSizeExpression = buildAnimatedLerpExpression({
      fromValue: introPosition.width,
      toValue: position.width,
      holdUntilSeconds: iconSettleStart,
      transitionDurationSeconds: settleDuration,
    });
    const introPopMultiplierExpression = buildAnimatedPopMultiplierExpression(hookStart);
    const finalCenterX = position.x + Math.floor(position.width / 2);
    const finalCenterY = position.y + Math.floor(position.height / 2);
    const introCenterX = introPosition.x + Math.floor(introPosition.width / 2);
    const introCenterY = introPosition.y + Math.floor(introPosition.height / 2);
    const iconCenterXExpression = buildAnimatedLerpExpression({
      fromValue: introCenterX,
      toValue: finalCenterX,
      holdUntilSeconds: iconSettleStart,
      transitionDurationSeconds: settleDuration,
    });
    const iconCenterYExpression = buildAnimatedLerpExpression({
      fromValue: introCenterY,
      toValue: finalCenterY,
      holdUntilSeconds: iconSettleStart,
      transitionDurationSeconds: settleDuration,
    });
    const introLiftExpression = buildAnimatedLiftExpression(hookStart);
    const iconScaleExpression = `(${baseSizeExpression})*(${introPopMultiplierExpression})`;
    const iconBackdropScaleExpression = `(${iconScaleExpression})*${DEFAULT_TYPE_ICON_BACKDROP_SCALE_MULTIPLIER}`;
    const iconOutlineScaleExpression = `(${iconScaleExpression})*${DEFAULT_TYPE_ICON_OUTLINE_SCALE_MULTIPLIER}`;
    filters.push(
      `color=c=white:s=640x640,format=rgba,geq=r='255':g='255':b='255':a='if(lte(((X-W/2)*(X-W/2))+((Y-H/2)*(Y-H/2)),((W/2)-10)*((W/2)-10)),${DEFAULT_TYPE_ICON_BACKDROP_ALPHA},0)'[${iconBackdropBaseLabel}]`,
    );
    filters.push(
      `[${iconBackdropBaseLabel}]scale=w='${iconBackdropScaleExpression}':h='${iconBackdropScaleExpression}':eval=frame,setsar=1[${iconBackdropLabel}]`,
    );
    filters.push(
      `[${inputRefs.typeIcons[index]}:v]scale=w='${iconOutlineScaleExpression}':h='${iconOutlineScaleExpression}':eval=frame:force_original_aspect_ratio=decrease,format=rgba,lutrgb=r='0':g='0':b='0',setsar=1[${iconOutlineLabel}]`,
    );
    filters.push(
      `[${inputRefs.typeIcons[index]}:v]scale=w='${iconScaleExpression}':h='${iconScaleExpression}':eval=frame:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${iconLabel}]`,
    );
    filters.push(
      `[v${index}][${iconBackdropLabel}]overlay=x='${iconCenterXExpression}-w/2':y='${iconCenterYExpression}-h/2-${introLiftExpression}':enable='${formatEnableBetween(renderPlan.phases.hook.start_seconds, renderPlan.total_duration_seconds)}'[${iconBackdropVideoLabel}]`,
    );
    filters.push(
      `[${iconBackdropVideoLabel}][${iconOutlineLabel}]overlay=x='${iconCenterXExpression}-w/2':y='${iconCenterYExpression}-h/2-${introLiftExpression}':enable='${formatEnableBetween(renderPlan.phases.hook.start_seconds, renderPlan.total_duration_seconds)}'[${iconOutlineVideoLabel}]`,
    );
    filters.push(
      `[${iconOutlineVideoLabel}][${iconLabel}]overlay=x='${iconCenterXExpression}-w/2':y='${iconCenterYExpression}-h/2-${introLiftExpression}':enable='${formatEnableBetween(renderPlan.phases.hook.start_seconds, renderPlan.total_duration_seconds)}'[v${index + 1}]`,
    );
  }

  let currentVideoLabel = `v${plan.assets.type_icons.length}`;

  const gridItemSize = ensureNumber(renderPlan.grid.item_size_px, 180);
  const pokeballSize = roundTime(
    gridItemSize * Math.max(
      1,
      ensureNumber(template?.layout?.pokeball_grid?.overlay_scale_multiplier, DEFAULT_POKEBALL_SCALE_MULTIPLIER),
    ),
  );
  const spriteHoldSize = resolveRevealSpriteHoldSize({
    gridItemSize,
    itemCount: renderPlan.grid.item_count || renderPlan.grid.cells.length,
    configuredMultiplier: ensureNumber(
      template?.layout?.silhouettes?.reveal_scale_multiplier,
      DEFAULT_REVEALED_SPRITE_SCALE_MULTIPLIER,
    ),
  });
  const pokeballStaticLabels = renderPlan.grid.cells.map((_, index) => safeFilterLabel('pbs', index));
  const pokeballTransitionLabels = renderPlan.grid.cells.map((_, index) => safeFilterLabel('pbt', index));
  const timerSourceDuration = Math.max(
    0.12,
    ensureNumber(
      plan.assets.overlays?.selected_timer_countdown_duration_seconds,
      plan.assets.overlays?.selected_timer_duration_seconds ?? countdownDuration,
    ),
  );
  const timerSetpts = timerSourceDuration > 0
    ? `(PTS-STARTPTS)*${roundTime(countdownDuration / timerSourceDuration)}+${countdownStart}/TB`
    : `PTS-STARTPTS+${countdownStart}/TB`;
  if (pokeballStaticLabels.length > 0) {
    filters.push(`[${inputRefs.timerCountdown}:v]fps=${fps},trim=duration=${timerSourceDuration},setpts=${timerSetpts},scale=${renderPlan.timer_layout.width}:${renderPlan.timer_layout.height}:force_original_aspect_ratio=decrease,format=rgba,colorkey=0xFFFFFF:0.22:0.1,setsar=1[timercountdown]`);
    filters.push(`[${inputRefs.pokeball}:v]fps=${fps},trim=duration=${countdownDuration},setpts=PTS-STARTPTS+${countdownStart}/TB,scale=${pokeballSize}:${pokeballSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[pokeballbase]`);
    const pokeballSplitLabels = [...pokeballStaticLabels, ...pokeballTransitionLabels];
    filters.push(`[pokeballbase]split=${pokeballSplitLabels.length}${pokeballSplitLabels.map((label) => `[${label}]`).join('')}`);
    for (let index = 0; index < renderPlan.grid.cells.length; index += 1) {
      const cell = renderPlan.grid.cells[index];
      const nextVideoLabel = safeFilterLabel('vg', index);
      filters.push(
        `[${currentVideoLabel}][${pokeballStaticLabels[index]}]overlay=${cell.center_x}-w/2:${cell.center_y}-h/2:enable='${formatEnableBetween(renderPlan.phases.countdown.start_seconds, revealVisualStart)}'[${nextVideoLabel}]`,
      );
      currentVideoLabel = nextVideoLabel;
    }
    const timerVideoLabel = `${currentVideoLabel}t`;
    filters.push(
      `[${currentVideoLabel}][timercountdown]overlay=${renderPlan.timer_layout.x}:${renderPlan.timer_layout.y}:enable='${formatEnableBetween(renderPlan.phases.countdown.start_seconds, renderPlan.phases.reveal.start_seconds)}'[${timerVideoLabel}]`,
    );
    currentVideoLabel = timerVideoLabel;
  }

  const timerAlarmDuration = ensureNumber(plan.assets.overlays?.selected_timer_alarm_duration_seconds, 0);
  if (inputRefs.timerAlarm != null && timerAlarmDuration > 0) {
    const timerAlarmLabel = 'timeralarm';
    const timerAlarmStart = renderPlan.phases.reveal.start_seconds;
    filters.push(
      `[${inputRefs.timerAlarm}:v]fps=${fps},trim=duration=${timerAlarmDuration},setpts=PTS-STARTPTS+${timerAlarmStart}/TB,scale=${renderPlan.timer_layout.width}:${renderPlan.timer_layout.height}:force_original_aspect_ratio=decrease,format=rgba,colorkey=0xFFFFFF:0.22:0.1,setsar=1[${timerAlarmLabel}]`,
    );
    const timerAlarmVideoLabel = `${currentVideoLabel}a`;
    filters.push(
      `[${currentVideoLabel}][${timerAlarmLabel}]overlay=${renderPlan.timer_layout.x}:${renderPlan.timer_layout.y}:enable='${formatEnableBetween(timerAlarmStart, renderPlan.total_duration_seconds)}'[${timerAlarmVideoLabel}]`,
    );
    currentVideoLabel = timerAlarmVideoLabel;
  }

  const spriteHoldLabels = [];
  const spriteTransitionLabels = [];
  for (let index = 0; index < plan.assets.pokemon.length; index += 1) {
    const spriteSourceLabel = safeFilterLabel('spritebase', index);
    const spriteHoldSourceLabel = safeFilterLabel('spriteholdbase', index);
    const spriteHoldLabel = safeFilterLabel('spritehold', index);
    const spriteTransitionLabel = safeFilterLabel('spritetransition', index);
    spriteHoldLabels.push(spriteHoldLabel);
    spriteTransitionLabels.push(spriteTransitionLabel);
    filters.push(
      `[${inputRefs.pokemon[index]}:v]fps=${fps},trim=duration=${Math.max(0.5, ensureNumber(renderPlan.phases.reveal?.duration_seconds, 0))},setpts=PTS-STARTPTS+${revealVisualStart}/TB,split=2[${spriteSourceLabel}][${spriteHoldSourceLabel}]`,
    );
    filters.push(
      `[${spriteHoldSourceLabel}]scale=${spriteHoldSize}:${spriteHoldSize}:force_original_aspect_ratio=decrease,setsar=1[${spriteHoldLabel}]`,
    );
    const progressExpression = `min(max((t-${revealVisualStart})/${revealTransitionDuration},0),1)`;
    const pokeballScaleFactor = `if(lt(${progressExpression},0.16),1+(${progressExpression}/0.16)*0.28,max(0.03,1.28-(((${progressExpression}-0.16)/0.84)*1.28)))`;
    const spriteScaleFactor = `max(0.03,if(lt(${progressExpression},0.22),0.06+(${progressExpression}/0.22)*0.34,0.40+(((${progressExpression}-0.22)/0.78)*0.80)))`;
    const pokeballScaleExpression = `max(6,${pokeballSize}*(${pokeballScaleFactor}))`;
    const spriteScaleExpression = `max(6,${spriteHoldSize}*(${spriteScaleFactor}))`;
    filters.push(
      `[${pokeballTransitionLabels[index]}]scale=w='${pokeballScaleExpression}':h='${pokeballScaleExpression}':eval=frame,setsar=1[${safeFilterLabel('pokeballpop', index)}]`,
    );
    filters.push(
      `[${spriteSourceLabel}]scale=w='${spriteScaleExpression}':h='${spriteScaleExpression}':eval=frame,setsar=1[${spriteTransitionLabel}]`,
    );
  }

  for (let index = 0; index < renderPlan.grid.cells.length && index < spriteTransitionLabels.length; index += 1) {
    const cell = renderPlan.grid.cells[index];
    const pokeballTransitionLabel = safeFilterLabel('pokeballpop', index);
    const withPokeballTransitionLabel = safeFilterLabel('vxp', index);
    const withSpriteTransitionLabel = safeFilterLabel('vxs', index);
    const progressExpression = `min(max((t-${revealVisualStart})/${revealTransitionDuration},0),1)`;
    const pokeballBounceExpression = `if(lt(${progressExpression},0.24),(${progressExpression}/0.24)*26,max(0,26-(((${progressExpression}-0.24)/0.76)*26)))`;
    filters.push(
      `[${currentVideoLabel}][${pokeballTransitionLabel}]overlay=x='${cell.center_x}-w/2':y='${cell.center_y}-h/2-${pokeballBounceExpression}':enable='${formatEnableBetween(revealVisualStart, revealTransitionEnd)}'[${withPokeballTransitionLabel}]`,
    );
    filters.push(
      `[${withPokeballTransitionLabel}][${spriteTransitionLabels[index]}]overlay=${cell.center_x}-w/2:${cell.center_y}-h/2:enable='${formatEnableBetween(revealVisualStart, revealTransitionEnd)}'[${withSpriteTransitionLabel}]`,
    );
    currentVideoLabel = withSpriteTransitionLabel;
  }

  for (let index = 0; index < renderPlan.grid.cells.length && index < spriteHoldLabels.length; index += 1) {
    const cell = renderPlan.grid.cells[index];
    const nextVideoLabel = safeFilterLabel('vr', index);
    filters.push(
      `[${currentVideoLabel}][${spriteHoldLabels[index]}]overlay=${cell.center_x}-w/2:${cell.center_y}-h/2:enable='${formatEnableBetween(revealTransitionEnd, renderPlan.total_duration_seconds)}'[${nextVideoLabel}]`,
      );
    currentVideoLabel = nextVideoLabel;
  }

  const drawtextParts = [];
  const fontPart = fontPath ? `:fontfile='${escapeFilterPath(fontPath)}'` : '';
  const promptTextEndSeconds = ensureNumber(
    renderPlan.audio_cues?.prompt_end_seconds,
    renderPlan.phases.countdown?.start_seconds ?? renderPlan.phases.reveal.start_seconds,
  );
  for (const line of textArtifacts.hook.lines) {
    drawtextParts.push(
      `drawtext=textfile='${escapeFilterPath(line.file_path)}'${fontPart}:fontcolor=white:fontsize=${DEFAULT_HOOK_FONT_SIZE}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(line.y, renderPlan.phases.hook.start_seconds)}':alpha='${buildAnimatedTextAlphaExpression(renderPlan.phases.hook.start_seconds, renderPlan.phases.hook.end_seconds)}':enable='${formatEnableBetween(renderPlan.phases.hook.start_seconds, renderPlan.phases.hook.end_seconds)}'`,
    );
  }
  for (const line of textArtifacts.prompt.lines) {
    drawtextParts.push(
      `drawtext=textfile='${escapeFilterPath(line.file_path)}'${fontPart}:fontcolor=white:fontsize=${DEFAULT_PROMPT_FONT_SIZE}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(line.y, renderPlan.phases.type_prompt.start_seconds)}':alpha='${buildAnimatedTextAlphaExpression(renderPlan.phases.type_prompt.start_seconds, promptTextEndSeconds)}':enable='${formatEnableBetween(renderPlan.phases.type_prompt.start_seconds, promptTextEndSeconds)}'`,
    );
  }
  for (const line of textArtifacts.reveal.lines) {
    drawtextParts.push(
      `drawtext=textfile='${escapeFilterPath(line.file_path)}'${fontPart}:fontcolor=white:fontsize=${DEFAULT_REVEAL_FONT_SIZE}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(line.y, renderPlan.phases.reveal.start_seconds)}':alpha='${buildAnimatedTextAlphaExpression(renderPlan.phases.reveal.start_seconds, renderPlan.total_duration_seconds)}':enable='${formatEnableBetween(renderPlan.phases.reveal.start_seconds, renderPlan.total_duration_seconds)}'`,
    );
  }
  for (const countdown of renderPlan.countdown_numbers) {
    const scaleMultiplierExpression = buildCountdownNumberScaleMultiplierExpression(
      countdown.start_seconds,
      countdown.end_seconds,
    );
    drawtextParts.push(
      `drawtext=text='${escapeDrawtextText(countdown.value)}'${fontPart}:fontcolor=white:fontsize='${DEFAULT_TIMER_NUMBER_SIZE}*(${scaleMultiplierExpression})':borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:x=${renderPlan.timer_layout.number_center_x}-text_w/2:y='${buildCountdownNumberYExpression(renderPlan.timer_layout.number_center_y, countdown.start_seconds, countdown.end_seconds)}-text_h/2':alpha='${buildCountdownNumberAlphaExpression(countdown.start_seconds, countdown.end_seconds)}':enable='${formatEnableBetween(countdown.start_seconds, countdown.end_seconds)}'`,
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
      maxLines: 3,
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

async function writeDrawtextArtifacts({ runtimeRoot, plan, textArtifacts }) {
  const drawtextRoot = resolve(runtimeRoot, 'drawtext');
  await mkdir(drawtextRoot, { recursive: true });

  const writeRoleLines = async (role, lines) => Promise.all(lines.map(async (line, index) => {
    const filePath = resolve(drawtextRoot, `${slugify(plan.seed)}-${role}-${String(index + 1).padStart(2, '0')}.txt`);
    await writeFile(filePath, `${line.text}\n`, 'utf8');
    return {
      ...line,
      file_path: filePath,
    };
  }));

  return {
    hook: {
      ...textArtifacts.hook,
      lines: await writeRoleLines('hook', textArtifacts.hook.lines),
    },
    prompt: {
      ...textArtifacts.prompt,
      lines: await writeRoleLines('prompt', textArtifacts.prompt.lines),
    },
    reveal: {
      ...textArtifacts.reveal,
      lines: await writeRoleLines('reveal', textArtifacts.reveal.lines),
    },
  };
}

export function buildAudioFilterScript({
  narrationPaths,
  musicPath,
  countdownPath,
  timerEndPath,
  renderPlan,
  mediaDurations = {},
}) {
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
    const countdownDurationSeconds = Math.max(
      0,
      renderPlan.audio_cues.timer_end_seconds - renderPlan.audio_cues.countdown_start_seconds,
    );
    const countdownAssetDurationSeconds = ensureNumber(mediaDurations.countdown_audio_duration_seconds, 0);
    const countdownDelayMs = Math.max(0, Math.round(renderPlan.audio_cues.countdown_start_seconds * 1000));
    if (countdownAssetDurationSeconds > 1.5) {
      const atempo = roundTime(countdownAssetDurationSeconds / Math.max(0.1, countdownDurationSeconds));
      filters.push(
        `[${inputIndex}:a]atrim=0:${countdownAssetDurationSeconds},atempo=${atempo},atrim=0:${countdownDurationSeconds},afade=t=out:st=${Math.max(0, countdownDurationSeconds - 0.08)}:d=0.08,adelay=${countdownDelayMs}|${countdownDelayMs},volume=${DEFAULT_COUNTDOWN_VOLUME}[countdown]`,
      );
      mixLabels.push('countdown');
    } else {
      filters.push(`[${inputIndex}:a]asplit=5[c0][c1][c2][c3][c4]`);
      for (let tickIndex = 0; tickIndex < 5; tickIndex += 1) {
        const delayMs = Math.max(0, Math.round((renderPlan.audio_cues.countdown_start_seconds + tickIndex) * 1000));
        const remainingWindowSeconds = renderPlan.audio_cues.timer_end_seconds - (renderPlan.audio_cues.countdown_start_seconds + tickIndex);
        const clipDurationSeconds = Math.max(0.12, Math.min(0.95, remainingWindowSeconds - 0.03));
        const label = `cd${tickIndex}`;
        filters.push(`[c${tickIndex}]atrim=0:${clipDurationSeconds},adelay=${delayMs}|${delayMs},volume=${DEFAULT_COUNTDOWN_VOLUME}[${label}]`);
        mixLabels.push(label);
      }
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

function resolveFfprobeExecutable(ffmpegExecutable) {
  const normalized = String(ffmpegExecutable || 'ffmpeg');
  const executableName = normalized.toLowerCase().endsWith('.exe') ? 'ffprobe.exe' : 'ffprobe';
  return resolve(dirname(normalized), executableName);
}

async function probeMediaDurationSeconds({ ffmpegExecutable, mediaPath, cwd }) {
  try {
    const { stdout } = await runLocalProcess({
      executable: resolveFfprobeExecutable(ffmpegExecutable),
      args: [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'json',
        mediaPath,
      ],
      cwd,
      timeoutMs: 60_000,
    });
    const duration = Number(JSON.parse(stdout || '{}')?.format?.duration);
    return Number.isFinite(duration) && duration > 0 ? roundTime(duration) : null;
  } catch {
    return null;
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
  let renderPlan = buildPokeQuizzRenderPlan({ plan, template, outputPath });
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
  const [narrationDurations, timerCountdownDurationSeconds, timerAlarmDurationSeconds, countdownDurationSeconds] = await Promise.all([
    Promise.all(narrationPaths.map((narrationPath) => (
      probeMediaDurationSeconds({
        ffmpegExecutable,
        mediaPath: narrationPath,
        cwd: projectRoot,
      })
    ))),
    probeMediaDurationSeconds({
      ffmpegExecutable,
      mediaPath: plan.assets.overlays.selected_timer_countdown_path || plan.assets.overlays.selected_timer_path,
      cwd: projectRoot,
    }),
    plan.assets.overlays.selected_timer_alarm_path
      ? probeMediaDurationSeconds({
        ffmpegExecutable,
        mediaPath: plan.assets.overlays.selected_timer_alarm_path,
        cwd: projectRoot,
      })
      : Promise.resolve(null),
    countdownPath
      ? probeMediaDurationSeconds({
        ffmpegExecutable,
        mediaPath: countdownPath,
        cwd: projectRoot,
      })
      : Promise.resolve(null),
  ]);
  renderPlan = applyNarrationDurationsToRenderPlan(renderPlan, {
    prompt_seconds: narrationDurations[1],
  });
  if (timerCountdownDurationSeconds) {
    plan.assets.overlays.selected_timer_duration_seconds = timerCountdownDurationSeconds;
    plan.assets.overlays.selected_timer_countdown_duration_seconds = timerCountdownDurationSeconds;
  }
  if (timerAlarmDurationSeconds) {
    plan.assets.overlays.selected_timer_alarm_duration_seconds = timerAlarmDurationSeconds;
  }
  const audioFilterScript = buildAudioFilterScript({
    narrationPaths,
    musicPath,
    countdownPath,
    timerEndPath,
    renderPlan,
    mediaDurations: {
      countdown_audio_duration_seconds: countdownDurationSeconds,
    },
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
  const inputRoleIndex = new Map(visualInputs.map((input, index) => [input.role, index]));
  const inputRefs = {
    background: inputRoleIndex.get('background'),
    typeIcons: plan.assets.type_icons.map((typeIcon) => inputRoleIndex.get(`type-icon-${typeIcon.type}`)),
    timerCountdown: inputRoleIndex.get('timer-countdown'),
    timerAlarm: inputRoleIndex.has('timer-alarm') ? inputRoleIndex.get('timer-alarm') : null,
    pokeball: inputRoleIndex.get('pokeball-grid'),
    pokemon: plan.assets.pokemon.map((pokemon) => inputRoleIndex.get(`pokemon-${pokemon.national_dex_number}`)),
  };
  const fontPath = await resolveFontPath(fontCandidates);
  const textArtifacts = await writeDrawtextArtifacts({
    runtimeRoot,
    plan,
    textArtifacts: buildTextArtifacts({ renderPlan, template }),
  });
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
