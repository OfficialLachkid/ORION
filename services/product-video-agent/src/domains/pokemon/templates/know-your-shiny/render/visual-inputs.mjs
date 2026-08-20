import { extname } from 'node:path';

function buildLoopingVisualInput(path, durationSeconds, fps) {
  const extension = extname(path || '').toLowerCase();
  if (['.mp4', '.mov', '.webm'].includes(extension)) {
    return ['-stream_loop', '-1', '-t', String(durationSeconds), '-i', path];
  }
  if (extension === '.gif') {
    return ['-ignore_loop', '0', '-t', String(durationSeconds), '-i', path];
  }
  return ['-loop', '1', '-framerate', String(fps), '-t', String(durationSeconds), '-i', path];
}

export function buildVisualInputs(plan, renderPlan) {
  const inputs = [];
  inputs.push({
    role: 'background',
    path: plan.assets.background.selected_path,
    args: buildLoopingVisualInput(
      plan.assets.background.selected_path,
      renderPlan.total_duration_seconds,
      renderPlan.canvas.fps,
    ),
  });

  if (plan.assets.overlays.selected_timer_countdown_path || plan.assets.overlays.selected_timer_path) {
    const timerPath = plan.assets.overlays.selected_timer_countdown_path || plan.assets.overlays.selected_timer_path;
    inputs.push({
      role: 'timer-countdown',
      path: timerPath,
      args: ['-ignore_loop', '1', '-i', timerPath],
    });
  }

  if (plan.assets.overlays.selected_timer_alarm_path) {
    inputs.push({
      role: 'timer-alarm',
      path: plan.assets.overlays.selected_timer_alarm_path,
      args: ['-ignore_loop', '1', '-i', plan.assets.overlays.selected_timer_alarm_path],
    });
  }

  renderPlan.rounds.forEach((round) => {
    const spritePath = round.subject.render_sprite_path || round.subject.shiny_sprite_path || round.subject.sprite_path;
    inputs.push({
      role: `round-${round.round_number}-sprite`,
      path: spritePath,
      args: buildLoopingVisualInput(
        spritePath,
        round.scene_duration_seconds,
        renderPlan.canvas.fps,
      ),
    });
  });

  return inputs;
}
