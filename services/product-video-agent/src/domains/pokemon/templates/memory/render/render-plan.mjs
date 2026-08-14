import {
  DEFAULT_REVEAL_VISUAL_DELAY_SECONDS,
  DEFAULT_TIMER_SIZE,
  ensureNumber,
  roundTime,
} from '../../dual-type-reveal/render/constants.mjs';
import {
  buildCountdownMoments,
  buildPhaseSchedule,
} from '../../dual-type-reveal/render/phase-schedule.mjs';

const HP_BAR_TIMER_DISPLAY_MODE = 'hp_bar_depletion';

function buildTimerLayout(template, optionGridLayout = null, timerDisplayMode = '') {
  if (String(timerDisplayMode || '').trim().toLowerCase() === HP_BAR_TIMER_DISPLAY_MODE) {
    const canvasWidth = ensureNumber(template?.canvas?.width, 1080);
    const canvasHeight = ensureNumber(template?.canvas?.height, 1920);
    const safeBottom = ensureNumber(template?.canvas?.safe_zone?.bottom, 260);
    const stageBounds = optionGridLayout?.stage_bounds_px || {};
    const stageLeft = ensureNumber(stageBounds.left, 100);
    const stageWidth = ensureNumber(stageBounds.width, canvasWidth - (stageLeft * 2));
    const stageBottom = ensureNumber(stageBounds.top, 280) + ensureNumber(stageBounds.height, 860);
    const gapTop = ensureNumber(template?.layout?.timer?.hp_bar_top_gap_px, 34);
    const maxHeight = ensureNumber(template?.layout?.timer?.hp_bar_max_height_px, 170);
    const configuredWidth = ensureNumber(
      template?.layout?.timer?.hp_bar_width_px,
      Math.max(720, stageWidth - 20),
    );
    const width = Math.min(canvasWidth - 60, Math.max(640, configuredWidth));
    const height = Math.min(maxHeight, canvasHeight - safeBottom - stageBottom - gapTop);
    const stageCenterX = stageLeft + Math.floor(stageWidth / 2);
    const x = roundTime(Math.max(30, Math.floor(stageCenterX - (width / 2))));
    const y = roundTime(stageBottom + gapTop);
    return {
      mode: HP_BAR_TIMER_DISPLAY_MODE,
      x,
      y,
      width: roundTime(width),
      height: roundTime(Math.max(96, height)),
      number_center_x: null,
      number_center_y: null,
    };
  }

  const size = ensureNumber(template?.layout?.timer?.size_px, DEFAULT_TIMER_SIZE);
  const centerX = ensureNumber(template?.layout?.timer?.center_x, 540);
  const centerY = ensureNumber(template?.layout?.timer?.center_y, 930);
  return {
    mode: 'numeric_with_small_ring',
    x: roundTime(centerX - (size / 2)),
    y: roundTime(centerY - (size / 2)),
    width: roundTime(size),
    height: roundTime(size),
    number_center_x: roundTime(centerX),
    number_center_y: roundTime(centerY),
  };
}

function buildCenteredGridLayout({
  canvas,
  safeZone,
  stageBounds = {},
  rows,
  columns,
  itemSizePx,
  minItemSizePx,
  columnGapPx,
  rowGapPx,
  spriteScaleMultiplier,
}) {
  const canvasWidth = ensureNumber(canvas?.width, 1080);
  const canvasHeight = ensureNumber(canvas?.height, 1920);
  const stageLeft = ensureNumber(stageBounds.left, ensureNumber(safeZone?.left, 120));
  const stageTop = ensureNumber(stageBounds.top, 840);
  const stageWidth = ensureNumber(
    stageBounds.width,
    canvasWidth - stageLeft - ensureNumber(safeZone?.right, 120),
  );
  const stageHeight = ensureNumber(
    stageBounds.height,
    canvasHeight - stageTop - ensureNumber(safeZone?.bottom, 260),
  );
  const baseItemSize = ensureNumber(itemSizePx, 196);
  const minItemSize = ensureNumber(minItemSizePx, 168);
  const columnGap = ensureNumber(columnGapPx, 120);
  const rowGap = ensureNumber(rowGapPx, 96);
  const fitWidth = Math.floor((stageWidth - ((columns - 1) * columnGap)) / columns);
  const fitHeight = Math.floor((stageHeight - ((rows - 1) * rowGap)) / rows);
  const itemSize = Math.max(minItemSize, Math.min(baseItemSize, fitWidth, fitHeight));
  const gridWidth = (columns * itemSize) + ((columns - 1) * columnGap);
  const gridHeight = (rows * itemSize) + ((rows - 1) * rowGap);
  const originX = stageLeft + Math.max(0, Math.floor((stageWidth - gridWidth) / 2));
  const originY = stageTop + Math.max(0, Math.floor((stageHeight - gridHeight) / 2));
  const cells = [];

  for (let index = 0; index < rows * columns; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const x = originX + (column * (itemSize + columnGap));
    const y = originY + (row * (itemSize + rowGap));
    cells.push({
      index,
      row,
      column,
      x,
      y,
      width: itemSize,
      height: itemSize,
      center_x: x + Math.floor(itemSize / 2),
      center_y: y + Math.floor(itemSize / 2),
    });
  }

  return {
    rows,
    columns,
    item_size_px: itemSize,
    column_gap_px: columnGap,
    row_gap_px: rowGap,
    sprite_scale_multiplier: ensureNumber(spriteScaleMultiplier, 1),
    stage_bounds_px: {
      left: stageLeft,
      top: stageTop,
      width: stageWidth,
      height: stageHeight,
    },
    cells,
  };
}

function buildOptionGridLayout(template, optionCount = 4) {
  const optionGrid = template?.layout?.option_grid || {};
  const columns = Math.max(1, ensureNumber(optionGrid.columns, 2));
  const rows = Math.max(1, ensureNumber(optionGrid.rows, Math.ceil(optionCount / columns)));
  const layout = buildCenteredGridLayout({
    canvas: template?.canvas,
    safeZone: template?.canvas?.safe_zone,
    stageBounds: optionGrid.stage_bounds_px,
    rows,
    columns,
    itemSizePx: optionGrid.item_size_px,
    minItemSizePx: optionGrid.min_item_size_px,
    columnGapPx: optionGrid.column_gap_px,
    rowGapPx: optionGrid.row_gap_px,
    spriteScaleMultiplier: optionGrid.sprite_scale_multiplier,
  });
  return {
    ...layout,
    cells: layout.cells.slice(0, optionCount),
  };
}

function buildRevealSpriteLayout(template) {
  const config = template?.layout?.reveal_sprite || {};
  return {
    center_x: roundTime(ensureNumber(config.center_x, ensureNumber(template?.canvas?.width, 1080) / 2)),
    center_y: roundTime(ensureNumber(config.center_y, 920)),
    item_size_px: roundTime(ensureNumber(config.item_size_px, 320)),
    sprite_scale_multiplier: ensureNumber(config.sprite_scale_multiplier, 1),
  };
}

export function buildPokeQuizzRenderPlan({ plan, template, outputPath }) {
  const schedule = buildPhaseSchedule(plan.timeline);
  const revealPhase = schedule.phases.reveal || { start_seconds: schedule.total_duration_seconds, end_seconds: schedule.total_duration_seconds };
  const questionPhase = schedule.phases.question || { start_seconds: 0, end_seconds: 0 };
  const countdownPhase = schedule.phases.countdown || { start_seconds: questionPhase.end_seconds, end_seconds: questionPhase.end_seconds };
  const optionGridLayout = buildOptionGridLayout(template, plan.question?.options?.length || 4);
  const timerLayout = buildTimerLayout(
    template,
    optionGridLayout,
    plan.assets.overlays?.timer_display_mode,
  );
  const configuredBattleMusicStartSeconds = roundTime(
    Math.max(0, ensureNumber(template?.audio?.battle_intro_music?.start_seconds, 0)),
  );
  const revealVisualDelay = roundTime(
    Math.max(0, ensureNumber(template?.renderer?.reveal_visual_delay_seconds, DEFAULT_REVEAL_VISUAL_DELAY_SECONDS)),
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
    timer_layout: timerLayout,
    countdown_numbers: timerLayout.mode === HP_BAR_TIMER_DISPLAY_MODE
      ? []
      : buildCountdownMoments(
        schedule,
        template?.layout?.timer?.countdown_from,
        template?.layout?.timer?.countdown_to,
      ),
    grid: plan.assets.overlays?.sprite_grid || { cells: [] },
    option_grid: optionGridLayout,
    reveal_sprite: buildRevealSpriteLayout(template),
    audio_cues: {
      hook_start_seconds: schedule.phases.hook?.start_seconds ?? 0,
      question_start_seconds: questionPhase.start_seconds,
      countdown_start_seconds: countdownPhase.start_seconds,
      timer_end_seconds: revealPhase.start_seconds,
      reveal_start_seconds: revealPhase.start_seconds,
      reveal_visual_start_seconds: revealVisualStart,
      battle_music_start_seconds: roundTime(
        Math.min(schedule.total_duration_seconds, configuredBattleMusicStartSeconds),
      ),
    },
    text: {
      hook: plan.timeline.find((entry) => entry.phase === 'hook')?.on_screen_text || '',
      question: plan.question?.question_text || plan.timeline.find((entry) => entry.phase === 'question')?.on_screen_text || '',
      reveal: plan.timeline.find((entry) => entry.phase === 'reveal')?.spoken_text || '',
    },
    question: plan.question || { options: [] },
    output_path: outputPath,
  };
}

export function applyNarrationDurationsToRenderPlan(renderPlan, narrationDurations = {}) {
  const questionPhase = renderPlan?.phases?.question;
  const countdownPhase = renderPlan?.phases?.countdown;
  const revealPhase = renderPlan?.phases?.reveal;
  const questionDurationSeconds = ensureNumber(narrationDurations.question_seconds, 0);
  if (questionDurationSeconds <= 0 || !questionPhase || !countdownPhase || !revealPhase) {
    return renderPlan;
  }

  const questionDuration = roundTime(Math.max(questionPhase.duration_seconds, questionDurationSeconds));
  const questionEnd = roundTime(questionPhase.start_seconds + questionDuration);
  const countdownStart = questionEnd;
  const countdownEnd = roundTime(countdownStart + countdownPhase.duration_seconds);
  const revealStart = countdownEnd;
  const revealEnd = roundTime(revealStart + revealPhase.duration_seconds);
  const revealVisualDelay = roundTime(Math.max(
    0,
    ensureNumber(renderPlan.audio_cues?.reveal_visual_start_seconds, revealPhase.start_seconds) - revealPhase.start_seconds,
  ));
  const updatedPhases = {
    ...renderPlan.phases,
    question: {
      ...questionPhase,
      duration_seconds: questionDuration,
      end_seconds: questionEnd,
    },
    countdown: {
      ...countdownPhase,
      start_seconds: countdownStart,
      end_seconds: countdownEnd,
    },
    reveal: {
      ...revealPhase,
      start_seconds: revealStart,
      end_seconds: revealEnd,
    },
  };
  const countdownFrom = Number.parseInt(renderPlan.countdown_numbers?.[0]?.value ?? '3', 10);
  const countdownTo = Number.parseInt(renderPlan.countdown_numbers?.at(-1)?.value ?? '0', 10);
  const countdownNumbers = String(renderPlan?.timer_layout?.mode || '').trim().toLowerCase() === HP_BAR_TIMER_DISPLAY_MODE
    ? []
    : buildCountdownMoments(
      {
        phases: updatedPhases,
        total_duration_seconds: revealEnd,
      },
      Number.isFinite(countdownFrom) ? countdownFrom : 3,
      Number.isFinite(countdownTo) ? countdownTo : 0,
    );
  return {
    ...renderPlan,
    phases: updatedPhases,
    total_duration_seconds: revealEnd,
    countdown_numbers: countdownNumbers,
    audio_cues: {
      ...renderPlan.audio_cues,
      question_start_seconds: updatedPhases.question.start_seconds,
      countdown_start_seconds: countdownStart,
      timer_end_seconds: revealStart,
      reveal_start_seconds: revealStart,
      reveal_visual_start_seconds: roundTime(Math.min(revealEnd, revealStart + revealVisualDelay)),
    },
  };
}
