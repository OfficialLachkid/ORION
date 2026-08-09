import { extname } from 'node:path';

export function buildVisualInputs(plan, renderPlan) {
  const inputs = [];
  const totalDuration = renderPlan.total_duration_seconds;
  const backgroundPath = plan.assets.background.selected_path;
  const backgroundExt = extname(backgroundPath || '').toLowerCase();
  const backgroundIsVideo = ['.mp4', '.mov', '.webm'].includes(backgroundExt);
  const backgroundIsGif = backgroundExt === '.gif';
  inputs.push({
    role: 'background',
    path: backgroundPath,
    args: backgroundIsVideo
      ? ['-stream_loop', '-1', '-t', String(totalDuration), '-i', backgroundPath]
      : backgroundIsGif
        ? ['-ignore_loop', '0', '-t', String(totalDuration), '-i', backgroundPath]
        : ['-loop', '1', '-framerate', String(renderPlan.canvas.fps), '-t', String(totalDuration), '-i', backgroundPath],
  });

  inputs.push({
    role: 'timer-countdown',
    path: plan.assets.overlays.selected_timer_countdown_path || plan.assets.overlays.selected_timer_path,
    args: ['-ignore_loop', '1', '-i', plan.assets.overlays.selected_timer_countdown_path || plan.assets.overlays.selected_timer_path],
  });

  if (plan.assets.overlays.selected_timer_alarm_path) {
    inputs.push({
      role: 'timer-alarm',
      path: plan.assets.overlays.selected_timer_alarm_path,
      args: ['-ignore_loop', '1', '-i', plan.assets.overlays.selected_timer_alarm_path],
    });
  }

  const selectedPokemon = plan.assets.pokemon?.[0] || {};
  inputs.push({
    role: 'normal-sprite',
    path: selectedPokemon.sprite_path,
    args: ['-loop', '1', '-framerate', String(renderPlan.canvas.fps), '-t', String(totalDuration), '-i', selectedPokemon.sprite_path],
  });
  inputs.push({
    role: 'shiny-sprite',
    path: selectedPokemon.shiny_sprite_path || selectedPokemon.reveal_sprite_path || selectedPokemon.sprite_path,
    args: ['-loop', '1', '-framerate', String(renderPlan.canvas.fps), '-t', String(Math.max(0.5, renderPlan.phases.reveal?.duration_seconds || 0)), '-i', selectedPokemon.shiny_sprite_path || selectedPokemon.reveal_sprite_path || selectedPokemon.sprite_path],
  });

  if (plan.assets.overlays?.selected_shiny_sparkle_path) {
    inputs.push({
      role: 'shiny-sparkle',
      path: plan.assets.overlays.selected_shiny_sparkle_path,
      args: ['-ignore_loop', '1', '-i', plan.assets.overlays.selected_shiny_sparkle_path],
    });
  }

  return inputs;
}
