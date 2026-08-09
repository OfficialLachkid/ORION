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

  for (const typeIcon of plan.assets.type_icons) {
    inputs.push({
      role: `type-icon-${typeIcon.type}`,
      path: typeIcon.local_path,
      args: ['-loop', '1', '-framerate', String(renderPlan.canvas.fps), '-t', String(totalDuration), '-i', typeIcon.local_path],
    });
  }

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

  inputs.push({
    role: 'pokeball-grid',
    path: plan.assets.overlays.selected_primary_pokeball_overlay_path,
    args: ['-stream_loop', '-1', '-ignore_loop', '0', '-t', String(totalDuration), '-i', plan.assets.overlays.selected_primary_pokeball_overlay_path],
  });

  for (const pokemon of plan.assets.pokemon) {
    const revealSpritePath = pokemon.reveal_sprite_path || pokemon.sprite_path;
    inputs.push({
      role: `pokemon-${pokemon.pokedex_id || pokemon.national_dex_number}`,
      path: revealSpritePath,
      args: ['-loop', '1', '-framerate', String(renderPlan.canvas.fps), '-t', String(Math.max(0.5, renderPlan.phases.reveal?.duration_seconds || 0)), '-i', revealSpritePath],
    });
  }

  if (plan.shiny_reveal?.active && plan.assets.overlays?.selected_shiny_sparkle_path) {
    inputs.push({
      role: 'shiny-sparkle',
      path: plan.assets.overlays.selected_shiny_sparkle_path,
      args: ['-ignore_loop', '1', '-i', plan.assets.overlays.selected_shiny_sparkle_path],
    });
  }

  return inputs;
}
