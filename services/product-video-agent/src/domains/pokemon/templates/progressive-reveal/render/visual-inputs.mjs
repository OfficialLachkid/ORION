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
  const inputs = [{
    role: 'background',
    path: plan.assets.background.selected_path,
    args: buildLoopingVisualInput(
      plan.assets.background.selected_path,
      renderPlan.total_duration_seconds,
      renderPlan.canvas.fps,
    ),
  }];

  renderPlan.rounds.forEach((round) => {
    const spritePath = round.subject.render_sprite_path || round.subject.sprite_path;
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
