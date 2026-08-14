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

function buildTimerLayout(template) {
  const size = ensureNumber(template?.layout?.timer?.size_px, DEFAULT_TIMER_SIZE);
  const centerX = ensureNumber(template?.layout?.timer?.center_x, 540);
  const centerY = ensureNumber(template?.layout?.timer?.center_y, 930);
  return {
    x: roundTime(centerX - (size / 2)),
    y: roundTime(centerY - (size / 2)),
    width: roundTime(size),
    height: roundTime(size),
    number_center_x: roundTime(centerX),
    number_center_y: roundTime(centerY),
  };
}

export function buildPokeQuizzRenderPlan({ plan, template, outputPath }) {
  const schedule = buildPhaseSchedule(plan.timeline);
  const revealPhase = schedule.phases.reveal || { start_seconds: schedule.total_duration_seconds, end_seconds: schedule.total_duration_seconds };
  const questionPhase = schedule.phases.question || { start_seconds: 0, end_seconds: 0 };
  const countdownPhase = schedule.phases.countdown || { start_seconds: questionPhase.end_seconds, end_seconds: questionPhase.end_seconds };
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
    timer_layout: buildTimerLayout(template),
    countdown_numbers: buildCountdownMoments(
      schedule,
      template?.layout?.timer?.countdown_from,
      template?.layout?.timer?.countdown_to,
    ),
    grid: plan.assets.overlays?.sprite_grid || { cells: [] },
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
  return {
    ...renderPlan,
    phases: updatedPhases,
    total_duration_seconds: revealEnd,
    countdown_numbers: buildCountdownMoments(
      {
        phases: updatedPhases,
        total_duration_seconds: revealEnd,
      },
      Number.isFinite(countdownFrom) ? countdownFrom : 3,
      Number.isFinite(countdownTo) ? countdownTo : 0,
    ),
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
