import { extname } from 'node:path';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm']);

function buildLoopingInputArgs(filePath, duration, fps) {
  const extension = extname(filePath).toLowerCase();
  if (VIDEO_EXTENSIONS.has(extension)) {
    return ['-stream_loop', '-1', '-t', String(duration), '-i', filePath];
  }
  if (extension === '.gif') {
    return ['-ignore_loop', '0', '-t', String(duration), '-i', filePath];
  }
  return ['-loop', '1', '-framerate', String(fps), '-t', String(duration), '-i', filePath];
}

export function buildUltimateQuizVisualInputs(plan, renderPlan) {
  const backgrounds = renderPlan.chapters.map((chapter, index) => ({
    role: `background-${index}`,
    path: String(chapter?.background?.path || chapter?.background || '').trim(),
    args: buildLoopingInputArgs(
      String(chapter?.background?.path || chapter?.background || '').trim(),
      renderPlan.total_duration_seconds,
      renderPlan.canvas.fps,
    ),
  }));
  const roundInputs = renderPlan.rounds.flatMap((round) => {
    const duration = Number(round.end_seconds) - Number(round.start_seconds);
    if (round.mode === 'type_clue' && round.type_board) {
      const typeIcons = (round.type_board.type_icons || []).map((icon, index) => ({
        role: `round-${round.round_number}-type-${index}`,
        path: String(icon.local_path || '').trim(),
        args: buildLoopingInputArgs(
          String(icon.local_path || '').trim(),
          duration,
          renderPlan.canvas.fps,
        ),
      }));
      const pokeballPath = String(round.type_board.pokeball_path || '').trim();
      const pokeball = {
        role: `round-${round.round_number}-pokeball`,
        path: pokeballPath,
        args: buildLoopingInputArgs(pokeballPath, duration, renderPlan.canvas.fps),
      };
      const boardSprites = (round.type_board.subjects || []).map((subject, index) => {
        const spritePath = String(
          subject.render_sprite_path || subject.animated_sprite_path || subject.sprite_path || '',
        ).trim();
        return {
          role: `round-${round.round_number}-board-${index}`,
          path: spritePath,
          args: buildLoopingInputArgs(spritePath, duration, renderPlan.canvas.fps),
        };
      });
      return [...typeIcons, pokeball, ...boardSprites];
    }

    const spritePath = String(
      round?.subject?.render_sprite_path
      || round?.subject?.animated_sprite_path
      || round?.subject?.sprite_path
      || '',
    ).trim();
    return [{
      role: `round-${round.round_number}-sprite`,
      path: spritePath,
      args: buildLoopingInputArgs(spritePath, duration, renderPlan.canvas.fps),
    }];
  });
  return [...backgrounds, ...roundInputs];
}
