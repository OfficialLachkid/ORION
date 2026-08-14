import { extname } from 'node:path';

function buildLoopingInputArgs({ mediaPath, totalDuration, fps }) {
  const normalizedExt = extname(String(mediaPath || '')).toLowerCase();
  const isVideo = ['.mp4', '.mov', '.webm'].includes(normalizedExt);
  const isGif = normalizedExt === '.gif';
  if (isVideo) {
    return ['-stream_loop', '-1', '-t', String(totalDuration), '-i', mediaPath];
  }
  if (isGif) {
    return ['-ignore_loop', '0', '-t', String(totalDuration), '-i', mediaPath];
  }
  return ['-loop', '1', '-framerate', String(fps), '-t', String(totalDuration), '-i', mediaPath];
}

export function buildVisualInputs(plan, renderPlan) {
  const inputs = [];
  const totalDuration = renderPlan.total_duration_seconds;
  const fps = renderPlan.canvas.fps;

  inputs.push({
    role: 'background',
    path: plan.assets.background.selected_path,
    args: buildLoopingInputArgs({
      mediaPath: plan.assets.background.selected_path,
      totalDuration,
      fps,
    }),
  });

  if (plan.assets.overlays.selected_timer_countdown_path || plan.assets.overlays.selected_timer_path) {
    inputs.push({
      role: 'timer-countdown',
      path: plan.assets.overlays.selected_timer_countdown_path || plan.assets.overlays.selected_timer_path,
      args: ['-ignore_loop', '1', '-i', plan.assets.overlays.selected_timer_countdown_path || plan.assets.overlays.selected_timer_path],
    });
  }

  if (plan.assets.overlays.selected_timer_alarm_path) {
    inputs.push({
      role: 'timer-alarm',
      path: plan.assets.overlays.selected_timer_alarm_path,
      args: ['-ignore_loop', '1', '-i', plan.assets.overlays.selected_timer_alarm_path],
    });
  }

  if (plan.assets.overlays.selected_hidden_placeholder_path) {
    inputs.push({
      role: 'hidden-placeholder',
      path: plan.assets.overlays.selected_hidden_placeholder_path,
      args: buildLoopingInputArgs({
        mediaPath: plan.assets.overlays.selected_hidden_placeholder_path,
        totalDuration,
        fps,
      }),
    });
  }

  for (let index = 0; index < (plan.assets.pokemon || []).length; index += 1) {
    const pokemon = plan.assets.pokemon[index];
    const spritePath = pokemon.render_sprite_path || pokemon.sprite_path;
    inputs.push({
      role: `display-sprite-${index}`,
      path: spritePath,
      args: ['-loop', '1', '-framerate', String(fps), '-t', String(totalDuration), '-i', spritePath],
    });
  }

  return inputs;
}
