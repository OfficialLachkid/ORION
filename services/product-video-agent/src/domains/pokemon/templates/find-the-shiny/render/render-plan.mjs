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

function buildTimerLayout(template, gridLayout = null) {
  const canvasWidth = ensureNumber(template?.canvas?.width, 1080);
  const safeTop = ensureNumber(template?.canvas?.safe_zone?.top, 160);
  const gridTop = ensureNumber(gridLayout?.stage_bounds_px?.top, 680);
  const promptY = ensureNumber(template?.layout?.text?.prompt_y, 290);
  const timerZoneTop = Math.max(safeTop + 180, promptY + 110);
  const timerZoneBottom = Math.max(timerZoneTop + 180, gridTop - 32);
  const timerZoneHeight = Math.max(180, timerZoneBottom - timerZoneTop);
  const size = Math.min(DEFAULT_TIMER_SIZE, timerZoneHeight);
  const left = Math.max(24, Math.floor((canvasWidth - size) / 2));
  const top = timerZoneTop + Math.max(0, Math.floor((timerZoneHeight - size) / 2));
  return {
    x: left,
    y: top,
    width: size,
    height: size,
    number_center_x: left + Math.floor(size / 2),
    number_center_y: top + Math.floor(size / 2),
  };
}

export function buildPokeQuizzRenderPlan({ plan, template, outputPath }) {
  const schedule = buildPhaseSchedule(plan.timeline);
  const gridLayout = plan.assets.overlays?.sprite_grid || { cells: [] };
  const timerLayout = buildTimerLayout(template, gridLayout);
  const countdownPhase = schedule.phases.countdown || { start_seconds: 0, end_seconds: 0 };
  const revealPhase = schedule.phases.reveal || { start_seconds: schedule.total_duration_seconds, end_seconds: schedule.total_duration_seconds };
  const configuredBattleMusicStartSeconds = roundTime(
    Math.max(0, ensureNumber(template?.audio?.battle_intro_music?.start_seconds, 0)),
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
    timer_layout: timerLayout,
    countdown_numbers: buildCountdownMoments(
      schedule,
      template?.layout?.timer?.countdown_from,
      template?.layout?.timer?.countdown_to,
    ),
    transitions: {
      shiny_pop_seconds: 0.32,
    },
    grid: gridLayout,
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
  const promptPhase = renderPlan?.phases?.type_prompt;
  const countdownPhase = renderPlan?.phases?.countdown;
  const revealPhase = renderPlan?.phases?.reveal;
  const promptDurationSeconds = ensureNumber(narrationDurations.prompt_seconds, 0);
  if (promptDurationSeconds <= 0 || !promptPhase || !countdownPhase || !revealPhase) {
    return renderPlan;
  }

  const promptDuration = roundTime(Math.max(promptPhase.duration_seconds, promptDurationSeconds));
  const promptEnd = roundTime(promptPhase.start_seconds + promptDuration);
  const countdownStart = promptEnd;
  const countdownEnd = roundTime(countdownStart + countdownPhase.duration_seconds);
  const revealStart = countdownEnd;
  const revealEnd = roundTime(revealStart + revealPhase.duration_seconds);
  const revealVisualDelay = roundTime(Math.max(
    0,
    ensureNumber(renderPlan.audio_cues?.reveal_visual_start_seconds, revealPhase.start_seconds) - revealPhase.start_seconds,
  ));
  const updatedPhases = {
    ...renderPlan.phases,
    type_prompt: {
      ...promptPhase,
      duration_seconds: promptDuration,
      end_seconds: promptEnd,
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
  const countdownFrom = Number.parseInt(renderPlan.countdown_numbers?.[0]?.value ?? '5', 10);
  const countdownTo = Number.parseInt(renderPlan.countdown_numbers?.at(-1)?.value ?? '0', 10);
  return {
    ...renderPlan,
    phases: updatedPhases,
    total_duration_seconds: revealEnd,
    countdown_numbers: buildCountdownMoments(
      {
        phases: updatedPhases,
        total_duration_seconds: revealEnd,
      },
      Number.isFinite(countdownFrom) ? countdownFrom : 5,
      Number.isFinite(countdownTo) ? countdownTo : 0,
    ),
    audio_cues: {
      ...renderPlan.audio_cues,
      prompt_end_seconds: promptEnd,
      countdown_start_seconds: countdownStart,
      timer_end_seconds: revealStart,
      reveal_start_seconds: revealStart,
      reveal_visual_start_seconds: roundTime(Math.min(revealEnd, revealStart + revealVisualDelay)),
    },
  };
}
