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

  const hpBarTimerPath = plan.assets.overlays.selected_timer_hp_bar_path || null;
  if (hpBarTimerPath) {
    const hpBarExt = extname(hpBarTimerPath).toLowerCase();
    const hpBarIsVideo = ['.mp4', '.mov', '.webm'].includes(hpBarExt);
    inputs.push({
      role: 'timer-hp-bar',
      path: hpBarTimerPath,
      args: hpBarIsVideo
        ? ['-stream_loop', '-1', '-t', String(totalDuration), '-i', hpBarTimerPath]
        : ['-loop', '1', '-framerate', String(renderPlan.canvas.fps), '-t', String(totalDuration), '-i', hpBarTimerPath],
    });
    if (plan.assets.overlays.selected_timer_hp_bar_frame_path) {
      inputs.push({
        role: 'timer-hp-bar-frame',
        path: plan.assets.overlays.selected_timer_hp_bar_frame_path,
        args: [
          '-loop',
          '1',
          '-framerate',
          String(renderPlan.canvas.fps),
          '-t',
          String(totalDuration),
          '-i',
          plan.assets.overlays.selected_timer_hp_bar_frame_path,
        ],
      });
    }
  } else {
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
  }

  inputs.push({
    role: 'pokeball-grid',
    path: plan.assets.overlays.selected_primary_pokeball_overlay_path,
    args: [
      '-stream_loop',
      '-1',
      '-ignore_loop',
      '0',
      '-t',
      String(totalDuration),
      '-i',
      plan.assets.overlays.selected_primary_pokeball_overlay_path,
    ],
  });

  const revealDuration = String(Math.max(0.5, renderPlan.phases.reveal?.duration_seconds || 0));
  const pokemonAssets = [...(Array.isArray(plan.assets.pokemon) ? plan.assets.pokemon : [])]
    .sort((left, right) => Number(left?.cell_index || 0) - Number(right?.cell_index || 0));
  for (const [fallbackIndex, pokemon] of pokemonAssets.entries()) {
    const cellIndex = Number.isInteger(Number(pokemon?.cell_index))
      ? Number(pokemon.cell_index)
      : fallbackIndex;
    const spritePath = pokemon?.is_shiny_reveal
      ? pokemon.shiny_sprite_path || pokemon.reveal_sprite_path || pokemon.sprite_path
      : pokemon.render_sprite_path || pokemon.sprite_path;
    inputs.push({
      role: `cell-${cellIndex}-sprite`,
      path: spritePath,
      args: [
        '-loop',
        '1',
        '-framerate',
        String(renderPlan.canvas.fps),
        '-t',
        revealDuration,
        '-i',
        spritePath,
      ],
    });
  }

  if (plan.assets.overlays?.selected_shiny_sparkle_path) {
    inputs.push({
      role: 'shiny-sparkle',
      path: plan.assets.overlays.selected_shiny_sparkle_path,
      args: ['-ignore_loop', '1', '-i', plan.assets.overlays.selected_shiny_sparkle_path],
    });
  }

  return inputs;
}
