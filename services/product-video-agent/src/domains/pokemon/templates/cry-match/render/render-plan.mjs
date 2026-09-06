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

function buildTimerBarLayout(template, gridLayout = { cells: [] }) {
  const cells = Array.isArray(gridLayout?.cells) ? gridLayout.cells : [];
  const canvasWidth = ensureNumber(template?.canvas?.width, 1080);
  const safeLeft = ensureNumber(template?.canvas?.safe_zone?.left, 120);
  const safeRight = ensureNumber(template?.canvas?.safe_zone?.right, 120);
  const configuredInset = ensureNumber(template?.layout?.timer?.bar_horizontal_inset_px, 56);
  const configuredHeight = ensureNumber(template?.layout?.timer?.bar_height_px, 34);
  const yOffset = ensureNumber(template?.layout?.timer?.bar_y_offset_px, 0);
  const explicitCenterY = Number(template?.layout?.timer?.center_y);
  const hasExplicitCenterY = Number.isFinite(explicitCenterY);
  let centerX = canvasWidth / 2;
  let centerY = (hasExplicitCenterY ? explicitCenterY : 1040) + yOffset;
  let width = canvasWidth - safeLeft - safeRight - (configuredInset * 2);

  if (cells.length > 0) {
    const left = Math.min(...cells.map((cell) => ensureNumber(cell.x, 0)));
    const right = Math.max(...cells.map((cell) => (
      ensureNumber(cell.x, 0) + ensureNumber(cell.width, 0)
    )));
    centerX = left + ((right - left) / 2);
    width = Math.max(280, (right - left) - (configuredInset * 2));

    const rows = Array.from(new Set(cells.map((cell) => ensureNumber(cell.row, 0)))).sort((leftRow, rightRow) => leftRow - rightRow);
    if (!hasExplicitCenterY && rows.length >= 2) {
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
    prompt_y: ensureNumber(template?.layout?.text?.prompt_y, 170),
    prompt_font_size: ensureNumber(template?.layout?.text?.prompt_font_size, 100),
    reveal_y: ensureNumber(template?.layout?.text?.reveal_y, 285),
    reveal_font_size: ensureNumber(template?.layout?.text?.reveal_font_size, 92),
    counter_x: ensureNumber(template?.layout?.text?.counter_x, 72),
    counter_y: ensureNumber(template?.layout?.text?.counter_y, 144),
    counter_font_size: ensureNumber(template?.layout?.text?.counter_font_size, 96),
  };
}

function buildCryMeterLayout(template) {
  const config = template?.layout?.cry_meter || {};
  const equalizer = config.equalizer || {};
  return {
    enabled: config.enabled !== false,
    style: String(config.style || 'equalizer_bars').trim() || 'equalizer_bars',
    center_y: ensureNumber(config.center_y, 420),
    bar_width_px: ensureNumber(config.bar_width_px, 720),
    bar_height_px: ensureNumber(config.bar_height_px, 22),
    bar_horizontal_inset_px: ensureNumber(config.bar_horizontal_inset_px, 180),
    active_color: String(config.active_color || '0xFFFFFF').trim() || '0xFFFFFF',
    inactive_color: String(config.inactive_color || '0x2A2A2A').trim() || '0x2A2A2A',
    outline_color: String(config.outline_color || 'black').trim() || 'black',
    outline_width_px: ensureNumber(config.outline_width_px, 4),
    icon_size_px: ensureNumber(config.icon_size_px, 42),
    pulse_scale_peak: ensureNumber(config.pulse_scale_peak, 1.18),
    pulse_period_seconds: ensureNumber(config.pulse_period_seconds, 0.6),
    fade_in_seconds: ensureNumber(template?.renderer?.cry_meter_fade_in_seconds, 0.35),
    fade_out_seconds: ensureNumber(template?.renderer?.cry_meter_fade_out_seconds, 0.28),
    equalizer: {
      bar_count: ensureNumber(equalizer.bar_count, 24),
      bar_gap_px: ensureNumber(equalizer.bar_gap_px, 6),
      min_bar_height_px: ensureNumber(equalizer.min_bar_height_px, 10),
      max_bar_height_px: ensureNumber(equalizer.max_bar_height_px, 120),
      band_width_px: ensureNumber(equalizer.band_width_px, config.bar_width_px || 720),
      top_color: String(equalizer.top_color || '0xFF3B30').trim() || '0xFF3B30',
      mid_color: String(equalizer.mid_color || 'yellow').trim() || 'yellow',
      bottom_color: String(equalizer.bottom_color || '0x30D158').trim() || '0x30D158',
      background_alpha: ensureNumber(equalizer.background_alpha, 0.28),
      wave_speed: ensureNumber(equalizer.wave_speed, 4.5),
    },
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
  return values;
}

function withCandidateTimings(round, template, sceneStartSeconds, revealVisualDelaySeconds) {
  const activationStartLocal = roundTime(Math.max(
    0,
    ensureNumber(round?.local?.activation_start_seconds, 0),
  ));
  const introInitialDelay = Math.max(
    0,
    ensureNumber(template?.renderer?.candidate_intro_initial_delay_seconds, 0.1),
  );
  const introStaggerSeconds = Math.max(
    0.02,
    ensureNumber(template?.renderer?.candidate_intro_stagger_seconds, 0.16),
  );
  const introDurationSeconds = Math.max(
    0.12,
    ensureNumber(template?.renderer?.candidate_intro_duration_seconds, 0.22),
  );
  const pokeballHoldSeconds = Math.max(
    0.08,
    ensureNumber(template?.renderer?.intro_pokeball_hold_seconds, 0.16),
  );
  const pokeballLeadSeconds = Math.max(
    0,
    ensureNumber(template?.renderer?.intro_pokeball_lead_seconds, 0.18),
  );
  const orderMap = new Map(
    (Array.isArray(round.candidate_reveal_order) ? round.candidate_reveal_order : [])
      .map((candidateIndex, orderIndex) => [candidateIndex, orderIndex]),
  );

  return (Array.isArray(round.candidates) ? round.candidates : []).map((candidate, index) => {
    const revealOrderIndex = orderMap.get(candidate.index) ?? index;
    const pokeballStartLocal = roundTime(
      activationStartLocal + introInitialDelay + (revealOrderIndex * introStaggerSeconds),
    );
    const introStartLocal = roundTime(pokeballStartLocal + pokeballLeadSeconds);
    const introEndLocal = roundTime(introStartLocal + introDurationSeconds);
    const pokeballEndLocal = roundTime(Math.max(
      pokeballStartLocal + 0.08,
      introStartLocal + pokeballHoldSeconds,
    ));
    return {
      ...candidate,
      intro_start_seconds: roundTime(sceneStartSeconds + introStartLocal),
      intro_end_seconds: roundTime(sceneStartSeconds + introEndLocal),
      pokeball_start_seconds: roundTime(sceneStartSeconds + pokeballStartLocal),
      pokeball_end_seconds: roundTime(sceneStartSeconds + pokeballEndLocal),
      reveal_start_seconds: roundTime(sceneStartSeconds + round.local.reveal_start_seconds + revealVisualDelaySeconds),
    };
  });
}

function buildRenderedRounds({ rounds, template, startingSceneStart = 0 }) {
  const transitionDurationSeconds = ensureNumber(
    template?.layout?.rounds?.transition_duration_seconds,
    0.42,
  );
  const revealVisualDelaySeconds = roundTime(Math.max(
    0,
    ensureNumber(template?.reveal?.visual_delay_seconds, DEFAULT_REVEAL_VISUAL_DELAY_SECONDS),
  ));
  let currentSceneStart = roundTime(startingSceneStart);

  return rounds.map((round, index) => {
    const sceneLeadSeconds = roundTime(ensureNumber(round.scene_lead_seconds, 0));
    const countdownDurationSeconds = roundTime(ensureNumber(round.countdown_duration_seconds, 4));
    const revealHoldSeconds = roundTime(ensureNumber(round.reveal_hold_seconds, 1.2));
    const incomingTransitionSeconds = roundTime(index === 0 ? 0 : ensureNumber(
      rounds[index - 1]?.transition_duration_seconds,
      transitionDurationSeconds,
    ));
    const outgoingTransitionSeconds = roundTime(ensureNumber(
      round.transition_duration_seconds,
      index === rounds.length - 1 ? 0 : transitionDurationSeconds,
    ));
    const finalHoldSeconds = roundTime(ensureNumber(round.final_hold_seconds, 0));
    const effectiveSceneLeadSeconds = roundTime(sceneLeadSeconds + incomingTransitionSeconds);
    const promptStartLocal = roundTime(index === 0 ? 0.04 : incomingTransitionSeconds + 0.04);
    const revealStartLocal = roundTime(effectiveSceneLeadSeconds + countdownDurationSeconds);
    const slideStartLocal = roundTime(revealStartLocal + revealHoldSeconds);
    const sceneDurationSeconds = roundTime(
      slideStartLocal + (outgoingTransitionSeconds > 0 ? outgoingTransitionSeconds : finalHoldSeconds),
    );
    const sceneStartSeconds = roundTime(currentSceneStart);
    const sceneEndSeconds = roundTime(sceneStartSeconds + sceneDurationSeconds);

    const renderedRound = {
      ...round,
      base_scene_lead_seconds: sceneLeadSeconds,
      minimum_scene_lead_seconds: roundTime(effectiveSceneLeadSeconds),
      scene_start_seconds: sceneStartSeconds,
      scene_end_seconds: sceneEndSeconds,
      scene_duration_seconds: sceneDurationSeconds,
      activation_start_seconds: roundTime(sceneStartSeconds + incomingTransitionSeconds),
      prompt_start_seconds: roundTime(sceneStartSeconds + promptStartLocal),
      countdown_start_seconds: roundTime(sceneStartSeconds + effectiveSceneLeadSeconds),
      reveal_start_seconds: roundTime(sceneStartSeconds + revealStartLocal),
      reveal_visual_start_seconds: roundTime(sceneStartSeconds + revealStartLocal + revealVisualDelaySeconds),
      slide_start_seconds: roundTime(sceneStartSeconds + slideStartLocal),
      local: {
        activation_start_seconds: incomingTransitionSeconds,
        prompt_start_seconds: promptStartLocal,
        scene_lead_seconds: effectiveSceneLeadSeconds,
        countdown_start_seconds: effectiveSceneLeadSeconds,
        reveal_start_seconds: revealStartLocal,
        reveal_visual_start_seconds: roundTime(revealStartLocal + revealVisualDelaySeconds),
        slide_start_seconds: slideStartLocal,
        scene_duration_seconds: sceneDurationSeconds,
      },
      countdown_numbers: [],
    };
    renderedRound.candidates = withCandidateTimings(
      renderedRound,
      template,
      renderedRound.scene_start_seconds,
      revealVisualDelaySeconds,
    );
    renderedRound.minimum_scene_lead_seconds = roundTime(Math.max(
      sceneLeadSeconds,
      ...renderedRound.candidates.map((candidate) => Math.max(
        candidate.intro_end_seconds,
        candidate.pokeball_end_seconds,
      ) - renderedRound.scene_start_seconds + 0.08),
    ));
    renderedRound.countdown_numbers = buildCountdownMoments(
      renderedRound,
      round.countdown_from,
      round.countdown_to,
    );
    currentSceneStart = roundTime(sceneEndSeconds - outgoingTransitionSeconds);
    return renderedRound;
  });
}

export function buildPokeQuizzRenderPlan({ plan, template, outputPath }) {
  const rounds = Array.isArray(plan?.rounds) ? plan.rounds : [];
  const textLayout = buildTextLayout(template);
  const gridLayout = buildGridLayout(template, plan?.rounds?.[0]?.candidates?.length || 4);
  const timerLayout = buildTimerBarLayout(template, gridLayout);
  const cryMeterLayout = buildCryMeterLayout(template);
  const rendererSettings = {
    candidate_intro_initial_delay_seconds: roundTime(Math.max(
      0,
      ensureNumber(template?.renderer?.candidate_intro_initial_delay_seconds, 0.1),
    )),
    candidate_intro_stagger_seconds: roundTime(Math.max(
      0.02,
      ensureNumber(template?.renderer?.candidate_intro_stagger_seconds, 0.16),
    )),
    candidate_intro_duration_seconds: roundTime(Math.max(
      0.12,
      ensureNumber(template?.renderer?.candidate_intro_duration_seconds, 0.22),
    )),
    candidate_forming_duration_seconds: roundTime(Math.max(
      0.08,
      ensureNumber(template?.renderer?.candidate_forming_duration_seconds, 1),
    )),
    intro_pokeball_hold_seconds: roundTime(Math.max(
      0.08,
      ensureNumber(template?.renderer?.intro_pokeball_hold_seconds, 0.16),
    )),
    intro_pokeball_lead_seconds: roundTime(Math.max(
      0,
      ensureNumber(template?.renderer?.intro_pokeball_lead_seconds, 0.18),
    )),
  };
  const renderedRounds = buildRenderedRounds({
    rounds,
    template,
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
    cry_meter_layout: cryMeterLayout,
    grid_layout: gridLayout,
    renderer: rendererSettings,
    audio_cues: {
      battle_music_start_seconds: roundTime(Math.max(
        0,
        ensureNumber(template?.audio?.battle_intro_music?.start_seconds, 0),
      )),
    },
    narration_cues: renderedRounds.map((round) => ({
      role: `round-${round.round_number}-prompt`,
      start_seconds: round.prompt_start_seconds,
    })),
    rounds: renderedRounds,
    output_path: outputPath,
  };
}

export function applyNarrationDurationsToRenderPlan(renderPlan, narrationDurations = []) {
  const rendererSettings = renderPlan?.renderer || {};
  const adjustedRounds = (Array.isArray(renderPlan?.rounds) ? renderPlan.rounds : []).map((round, index) => {
    const narrationDuration = ensureNumber(narrationDurations[index], 0);
    const expandedLead = roundTime(Math.max(
      ensureNumber(round.base_scene_lead_seconds, round.scene_lead_seconds || 0),
      ensureNumber(round.minimum_scene_lead_seconds, round.scene_lead_seconds || 0),
      narrationDuration > 0 ? narrationDuration + 0.18 : 0,
    ));
    return {
      ...round,
      scene_lead_seconds: expandedLead,
    };
  });

  const renderedRounds = buildRenderedRounds({
    rounds: adjustedRounds,
    template: {
      canvas: renderPlan.canvas,
      layout: {
        rounds: {
          transition_duration_seconds: renderPlan.rounds?.[0]?.transition_duration_seconds ?? 0.42,
        },
      },
      reveal: {
        visual_delay_seconds: renderPlan.rounds?.[0]?.local?.reveal_visual_start_seconds - renderPlan.rounds?.[0]?.local?.reveal_start_seconds,
      },
      renderer: {
        candidate_intro_initial_delay_seconds: ensureNumber(
          rendererSettings.candidate_intro_initial_delay_seconds,
          0.1,
        ),
        candidate_intro_stagger_seconds: ensureNumber(
          rendererSettings.candidate_intro_stagger_seconds,
          0.16,
        ),
        candidate_intro_duration_seconds: ensureNumber(
          rendererSettings.candidate_intro_duration_seconds,
          0.22,
        ),
        candidate_forming_duration_seconds: ensureNumber(
          rendererSettings.candidate_forming_duration_seconds,
          1,
        ),
        intro_pokeball_hold_seconds: ensureNumber(
          rendererSettings.intro_pokeball_hold_seconds,
          0.16,
        ),
        intro_pokeball_lead_seconds: ensureNumber(
          rendererSettings.intro_pokeball_lead_seconds,
          0.18,
        ),
      },
    },
  });

  return {
    ...renderPlan,
    total_duration_seconds: renderedRounds.at(-1)?.scene_end_seconds || renderPlan.total_duration_seconds,
    renderer: {
      ...renderPlan.renderer,
    },
    rounds: renderedRounds,
    narration_cues: renderedRounds.map((round) => ({
      role: `round-${round.round_number}-prompt`,
      start_seconds: round.prompt_start_seconds,
    })),
  };
}
