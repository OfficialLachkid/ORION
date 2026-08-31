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

  if (plan.assets.overlays?.selected_disappear_path) {
    inputs.push({
      role: 'battle-disappear',
      path: plan.assets.overlays.selected_disappear_path,
      args: buildLoopingVisualInput(
        plan.assets.overlays.selected_disappear_path,
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

  if (plan.assets.overlays?.selected_versus_path) {
    inputs.push({
      role: 'versus',
      path: plan.assets.overlays.selected_versus_path,
      args: buildLoopingVisualInput(
        plan.assets.overlays.selected_versus_path,
        renderPlan.total_duration_seconds,
        renderPlan.canvas.fps,
      ),
    });
  }

  (plan.tournament?.participants || []).forEach((participant, index) => {
    const spritePath = participant.render_sprite_path || participant.sprite_path;
    inputs.push({
      role: `participant-${index}`,
      path: spritePath,
      args: buildLoopingVisualInput(
        spritePath,
        renderPlan.total_duration_seconds,
        renderPlan.canvas.fps,
      ),
    });
  });

  return inputs;
}
