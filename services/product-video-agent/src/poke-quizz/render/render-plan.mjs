import {
  DEFAULT_REVEAL_TRANSITION_SECONDS,
  DEFAULT_REVEAL_VISUAL_DELAY_SECONDS,
  DEFAULT_TYPE_ICON_SETTLE_SECONDS,
  ensureNumber,
  roundTime,
} from './constants.mjs';
import { buildCountdownMoments, buildPhaseSchedule } from './phase-schedule.mjs';
import { buildTimerLayout } from './timer-layout.mjs';
import {
  buildHookTypeIconLayout,
  buildTypeIconLayout,
  normalizeGridLayout,
} from './type-layout.mjs';

export function buildPokeQuizzRenderPlan({ plan, template, outputPath }) {
  const schedule = buildPhaseSchedule(plan.timeline);
  const typeIconLayout = buildTypeIconLayout(template, plan.assets.type_icons.length);
  const typeIconIntroLayout = buildHookTypeIconLayout(template, plan.assets.type_icons.length);
  const gridLayout = normalizeGridLayout(plan.assets.overlays?.pokeball_grid || null, template);
  const timerLayout = buildTimerLayout(template, gridLayout);
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
