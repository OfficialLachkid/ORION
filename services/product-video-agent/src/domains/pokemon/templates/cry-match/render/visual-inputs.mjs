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

  if (plan.assets.overlays?.selected_intro_pokeball_path) {
    inputs.push({
      role: 'intro-pokeball',
      path: plan.assets.overlays.selected_intro_pokeball_path,
      args: buildLoopingVisualInput(
        plan.assets.overlays.selected_intro_pokeball_path,
        renderPlan.total_duration_seconds,
        renderPlan.canvas.fps,
      ),
    });
  }

  if (plan.assets.overlays?.selected_grass_plateau_path) {
    inputs.push({
      role: 'grass-platform',
      path: plan.assets.overlays.selected_grass_plateau_path,
      args: buildLoopingVisualInput(
        plan.assets.overlays.selected_grass_plateau_path,
        renderPlan.total_duration_seconds,
        renderPlan.canvas.fps,
      ),
    });
  }

  renderPlan.rounds.forEach((round) => {
    round.candidates.forEach((candidate) => {
      const spritePath = candidate?.subject?.render_sprite_path
        || candidate?.subject?.sprite_path
        || '';
      inputs.push({
        role: `round-${round.round_number}-candidate-${candidate.index}`,
        path: spritePath,
        args: buildLoopingVisualInput(
          spritePath,
          round.scene_duration_seconds,
          renderPlan.canvas.fps,
        ),
      });
    });
  });

  return inputs;
}
