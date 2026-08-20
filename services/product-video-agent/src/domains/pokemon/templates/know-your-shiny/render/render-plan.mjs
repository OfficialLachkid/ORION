import {
  DEFAULT_REVEAL_VISUAL_DELAY_SECONDS,
  ensureNumber,
  roundTime,
} from '../../dual-type-reveal/render/constants.mjs';

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
  const stageTop = ensureNumber(stageBounds.top, 720);
  const stageWidth = ensureNumber(
    stageBounds.width,
    canvasWidth - stageLeft - ensureNumber(safeZone?.right, 120),
  );
  const stageHeight = ensureNumber(
    stageBounds.height,
    canvasHeight - stageTop - ensureNumber(safeZone?.bottom, 260),
  );
  const baseItemSize = ensureNumber(itemSizePx, 220);
  const minItemSize = ensureNumber(minItemSizePx, 180);
  const columnGap = ensureNumber(columnGapPx, 110);
  const rowGap = ensureNumber(rowGapPx, 140);
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

function buildGridLayout(template, optionCount = 4) {
  const grid = template?.layout?.sprite_grid || {};
  const columns = Math.max(1, ensureNumber(grid.columns, 2));
  const rows = Math.max(1, ensureNumber(grid.rows, Math.ceil(optionCount / columns)));
  const layout = buildCenteredGridLayout({
    canvas: template?.canvas,
    safeZone: template?.canvas?.safe_zone,
    stageBounds: grid.stage_bounds_px,
    rows,
    columns,
    itemSizePx: grid.item_size_px,
    minItemSizePx: grid.min_item_size_px,
    columnGapPx: grid.column_gap_px,
    rowGapPx: grid.row_gap_px,
    spriteScaleMultiplier: grid.sprite_scale_multiplier,
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
    center_y: roundTime(ensureNumber(config.center_y, 980)),
    item_size_px: roundTime(ensureNumber(config.item_size_px, 320)),
    sprite_scale_multiplier: ensureNumber(config.sprite_scale_multiplier, 1),
  };
}

function buildTimerBarLayout(template, gridLayout = { cells: [] }) {
  const cells = Array.isArray(gridLayout?.cells) ? gridLayout.cells : [];
  const canvasWidth = ensureNumber(template?.canvas?.width, 1080);
  const safeLeft = ensureNumber(template?.canvas?.safe_zone?.left, 120);
  const safeRight = ensureNumber(template?.canvas?.safe_zone?.right, 120);
  const configuredInset = ensureNumber(template?.layout?.timer?.bar_horizontal_inset_px, 56);
  const configuredHeight = ensureNumber(template?.layout?.timer?.bar_height_px, 34);
  const yOffset = ensureNumber(template?.layout?.timer?.bar_y_offset_px, 0);
  let centerX = canvasWidth / 2;
  let centerY = ensureNumber(template?.layout?.timer?.center_y, 1040) + yOffset;
  let width = canvasWidth - safeLeft - safeRight - (configuredInset * 2);

  if (cells.length > 0) {
    const left = Math.min(...cells.map((cell) => ensureNumber(cell.x, 0)));
    const right = Math.max(...cells.map((cell) => (
      ensureNumber(cell.x, 0) + ensureNumber(cell.width, 0)
    )));
    centerX = left + ((right - left) / 2);
    width = Math.max(280, (right - left) - (configuredInset * 2));

    const rows = Array.from(new Set(cells.map((cell) => ensureNumber(cell.row, 0)))).sort((leftRow, rightRow) => leftRow - rightRow);
    if (rows.length >= 2) {
      const topRowCells = cells.filter((cell) => ensureNumber(cell.row, 0) === rows[0]);
      const bottomRowCells = cells.filter((cell) => ensureNumber(cell.row, 0) === rows[1]);
      const topRowBottom = Math.max(...topRowCells.map((cell) => ensureNumber(cell.y, 0) + ensureNumber(cell.height, 0)));
      const bottomRowTop = Math.min(...bottomRowCells.map((cell) => ensureNumber(cell.y, 0)));
      centerY = topRowBottom + ((bottomRowTop - topRowBottom) / 2) + yOffset;
    }
  }

  return {
    mode: 'center_shrink_bar',
    x: roundTime(centerX - (width / 2)),
    y: roundTime(centerY - (configuredHeight / 2)),
    width: roundTime(width),
    height: roundTime(configuredHeight),
    center_x: roundTime(centerX),
    center_y: roundTime(centerY),
    number_center_x: null,
    number_center_y: null,
  };
}

function buildTextLayout(template) {
  return {
    hook_y: ensureNumber(template?.layout?.text?.hook_y, 300),
    hook_font_size: ensureNumber(template?.layout?.text?.hook_font_size, 136),
    prompt_y: ensureNumber(template?.layout?.text?.prompt_y, 300),
    prompt_font_size: ensureNumber(template?.layout?.text?.prompt_font_size, 122),
    reveal_y: ensureNumber(template?.layout?.text?.reveal_y, 300),
    reveal_font_size: ensureNumber(template?.layout?.text?.reveal_font_size, 110),
    counter_x: ensureNumber(template?.layout?.text?.counter_x, 72),
    counter_y: ensureNumber(template?.layout?.text?.counter_y, 144),
    counter_font_size: ensureNumber(template?.layout?.text?.counter_font_size, 96),
  };
}

function buildCountdownMoments(round, countdownFrom, countdownTo) {
  const values = [];
  let currentValue = Number.parseInt(String(countdownFrom), 10);
  const target = Number.parseInt(String(countdownTo), 10);
  while (Number.isFinite(currentValue) && currentValue > Math.max(0, target)) {
    const offset = countdownFrom - currentValue;
    const startSeconds = round.countdown_start_seconds + offset;
    values.push({
      value: String(currentValue),
      start_seconds: roundTime(startSeconds),
      end_seconds: roundTime(startSeconds + 1),
    });
    currentValue -= 1;
  }
  values.push({
    value: '0',
    start_seconds: round.reveal_start_seconds,
    end_seconds: roundTime(Math.min(round.scene_end_seconds, round.reveal_visual_start_seconds + 0.34)),
  });
  return values;
}

export function buildPokeQuizzRenderPlan({ plan, template, outputPath }) {
  const rounds = Array.isArray(plan?.rounds) ? plan.rounds : [];
  const textLayout = buildTextLayout(template);
  const gridLayout = buildGridLayout(template, 4);
  const timerLayout = buildTimerBarLayout(template, gridLayout);
  const revealSprite = buildRevealSpriteLayout(template);
  const transitionDurationSeconds = ensureNumber(
    template?.layout?.rounds?.transition_duration_seconds,
    0.42,
  );
  const revealVisualDelaySeconds = roundTime(Math.max(
    0,
    ensureNumber(template?.reveal?.visual_delay_seconds, DEFAULT_REVEAL_VISUAL_DELAY_SECONDS),
  ));
  let currentSceneStart = 0;
  const renderedRounds = rounds.map((round, index) => {
    const sceneLeadSeconds = roundTime(ensureNumber(round.scene_lead_seconds, 0));
    const countdownDurationSeconds = roundTime(ensureNumber(round.countdown_duration_seconds, 3));
    const revealHoldSeconds = roundTime(ensureNumber(round.reveal_hold_seconds, 1.05));
    const outgoingTransitionSeconds = roundTime(ensureNumber(
      round.transition_duration_seconds,
      index === rounds.length - 1 ? 0 : transitionDurationSeconds,
    ));
    const finalHoldSeconds = roundTime(ensureNumber(round.final_hold_seconds, 0));
    const revealStartLocal = roundTime(sceneLeadSeconds + countdownDurationSeconds);
    const slideStartLocal = roundTime(revealStartLocal + revealHoldSeconds);
    const sceneDurationSeconds = roundTime(
      slideStartLocal + (outgoingTransitionSeconds > 0 ? outgoingTransitionSeconds : finalHoldSeconds),
    );
    const sceneStartSeconds = roundTime(currentSceneStart);
    const sceneEndSeconds = roundTime(sceneStartSeconds + sceneDurationSeconds);
    const revealVisualStartSeconds = roundTime(sceneStartSeconds + revealStartLocal + revealVisualDelaySeconds);
    const renderedRound = {
      ...round,
      scene_start_seconds: sceneStartSeconds,
      scene_end_seconds: sceneEndSeconds,
      scene_duration_seconds: sceneDurationSeconds,
      countdown_start_seconds: roundTime(sceneStartSeconds + sceneLeadSeconds),
      reveal_start_seconds: roundTime(sceneStartSeconds + revealStartLocal),
      reveal_visual_start_seconds: revealVisualStartSeconds,
      slide_start_seconds: roundTime(sceneStartSeconds + slideStartLocal),
      local: {
        scene_lead_seconds: sceneLeadSeconds,
        countdown_start_seconds: sceneLeadSeconds,
        reveal_start_seconds: revealStartLocal,
        reveal_visual_start_seconds: roundTime(revealStartLocal + revealVisualDelaySeconds),
        slide_start_seconds: slideStartLocal,
        scene_duration_seconds: sceneDurationSeconds,
      },
      countdown_numbers: [],
      grid_layout: gridLayout,
      reveal_sprite: revealSprite,
    };
    renderedRound.countdown_numbers = buildCountdownMoments(
      renderedRound,
      round.countdown_from,
      round.countdown_to,
    );
    currentSceneStart = roundTime(sceneEndSeconds - outgoingTransitionSeconds);
    return renderedRound;
  });

  return {
    canvas: {
      width: ensureNumber(template?.canvas?.width, 1080),
      height: ensureNumber(template?.canvas?.height, 1920),
      fps: ensureNumber(template?.canvas?.fps, 30),
    },
    total_duration_seconds: renderedRounds.at(-1)?.scene_end_seconds || 0,
    timer_layout: timerLayout,
    text_layout: textLayout,
    grid_layout: gridLayout,
    reveal_sprite: revealSprite,
    audio_cues: {
      hook_start_seconds: 0,
      prompt_start_seconds: renderedRounds[0]?.countdown_start_seconds ?? 0,
      countdown_start_seconds: renderedRounds[0]?.countdown_start_seconds ?? 0,
      timer_end_seconds: renderedRounds[0]?.reveal_start_seconds ?? 0,
      reveal_start_seconds: renderedRounds[0]?.reveal_start_seconds ?? 0,
      reveal_visual_start_seconds: renderedRounds[0]?.reveal_visual_start_seconds ?? 0,
      battle_music_start_seconds: roundTime(Math.max(0, ensureNumber(template?.audio?.battle_intro_music?.start_seconds, 0))),
    },
    hook_text: plan?.narration?.lines?.[0]?.text || '',
    rounds: renderedRounds,
    output_path: outputPath,
  };
}

export function applyNarrationDurationsToRenderPlan(renderPlan) {
  return renderPlan;
}
