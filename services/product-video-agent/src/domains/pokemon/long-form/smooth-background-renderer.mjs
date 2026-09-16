import { access, mkdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { runLocalProcess } from '../../../process-runner.mjs';
import { buildLongFormBackgroundPreparationFilter } from './background-motion.mjs';

const MOTION_EXTENSIONS = new Set(['.gif', '.mp4', '.mov', '.webm']);

function buildInputArgs(sourcePath, durationSeconds, fps) {
  const extension = extname(sourcePath).toLowerCase();
  if (extension === '.gif') {
    return ['-ignore_loop', '0', '-t', String(durationSeconds), '-i', sourcePath];
  }
  if (MOTION_EXTENSIONS.has(extension)) {
    return ['-stream_loop', '-1', '-t', String(durationSeconds), '-i', sourcePath];
  }
  return ['-loop', '1', '-framerate', String(fps), '-t', String(durationSeconds), '-i', sourcePath];
}

export async function renderSmoothLandscapeBackground({
  sourcePath,
  outputPath,
  durationSeconds,
  template,
  sectionIndex = 0,
  ffmpegExecutable = 'ffmpeg',
  projectRoot,
  runProcess = runLocalProcess,
}) {
  const width = Number(template?.canvas?.width || 1920);
  const height = Number(template?.canvas?.height || 1080);
  const fps = Number(template?.canvas?.fps || 30);
  const safeDuration = Math.max(1, Number(durationSeconds || 1));
  const outputAbsolutePath = resolve(projectRoot, outputPath);
  const backgroundTemplate = {
    layout: {
      background: {
        blur_sigma: Number(template?.layout?.background?.blur_sigma ?? 6),
        motion: {
          enabled: true,
          zoom_scale: Number(template?.layout?.background?.motion?.zoom_scale || 1.3),
        },
      },
    },
  };
  const filter = buildLongFormBackgroundPreparationFilter({
    inputRef: 0,
    width,
    height,
    fps,
    blurSigma: backgroundTemplate.layout.background.blur_sigma,
    template: backgroundTemplate,
    chapterIndex: sectionIndex,
    startSeconds: 0,
    endSeconds: safeDuration,
  });
  await mkdir(dirname(outputAbsolutePath), { recursive: true });
  await runProcess({
    executable: ffmpegExecutable,
    args: [
      '-y',
      ...buildInputArgs(sourcePath, safeDuration, fps),
      '-filter_complex',
      `${filter}[vout]`,
      '-map',
      '[vout]',
      '-an',
      '-r',
      String(fps),
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '21',
      '-pix_fmt',
      'yuv420p',
      '-t',
      String(safeDuration),
      '-movflags',
      '+faststart',
      outputAbsolutePath,
    ],
    cwd: projectRoot,
    timeoutMs: 1_800_000,
  });
  await access(outputAbsolutePath);
  return outputAbsolutePath;
}
