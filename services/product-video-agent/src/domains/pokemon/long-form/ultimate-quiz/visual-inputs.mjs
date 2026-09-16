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
  const sprites = renderPlan.rounds.map((round) => ({
    role: `round-${round.round_number}-sprite`,
    path: String(round?.subject?.sprite_path || '').trim(),
    args: buildLoopingInputArgs(
      String(round?.subject?.sprite_path || '').trim(),
      Number(round.end_seconds) - Number(round.start_seconds),
      renderPlan.canvas.fps,
    ),
  }));
  return [...backgrounds, ...sprites];
}
