import { dirname, extname, resolve } from 'node:path';
import { runLocalProcess } from '../../../process-runner.mjs';

const VIDEO_EXTENSIONS = new Set(['.gif', '.mp4', '.mov', '.webm']);

export function resolveFfprobeExecutable(ffmpegExecutable = 'ffmpeg') {
  const normalized = String(ffmpegExecutable || 'ffmpeg');
  const executableName = normalized.toLowerCase().endsWith('.exe') ? 'ffprobe.exe' : 'ffprobe';
  return resolve(dirname(normalized), executableName);
}

export async function probeVisualMedia({
  filePath,
  ffmpegExecutable = 'ffmpeg',
  cwd,
  runProcess = runLocalProcess,
}) {
  try {
    const result = await runProcess({
      executable: resolveFfprobeExecutable(ffmpegExecutable),
      args: [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height,duration:format=duration',
        '-of',
        'json',
        filePath,
      ],
      cwd,
      timeoutMs: 60_000,
    });
    const payload = JSON.parse(result.stdout || '{}');
    const stream = Array.isArray(payload?.streams) ? payload.streams[0] : null;
    const width = Number(stream?.width || 0);
    const height = Number(stream?.height || 0);
    const durationSeconds = Number(stream?.duration || payload?.format?.duration || 0);
    if (width <= 0 || height <= 0) return null;
    return {
      path: filePath,
      width,
      height,
      aspect_ratio: Number((width / height).toFixed(4)),
      orientation: width > height ? 'landscape' : width < height ? 'portrait' : 'square',
      duration_seconds: Number.isFinite(durationSeconds) && durationSeconds > 0
        ? Number(durationSeconds.toFixed(3))
        : null,
      media_type: VIDEO_EXTENSIONS.has(extname(filePath).toLowerCase()) ? 'motion' : 'image',
    };
  } catch {
    return null;
  }
}

export async function buildLandscapeBackgroundCatalog({
  filePaths = [],
  ffmpegExecutable = 'ffmpeg',
  cwd,
  minimumWidth = 1280,
  minimumHeight = 720,
  minimumAspectRatio = 1.4,
  runProcess = runLocalProcess,
}) {
  const catalog = [];
  for (const filePath of [...new Set(filePaths)].sort((left, right) => left.localeCompare(right))) {
    const media = await probeVisualMedia({ filePath, ffmpegExecutable, cwd, runProcess });
    if (media) catalog.push(media);
  }
  const eligible = catalog.filter((media) => (
    media.orientation === 'landscape'
    && media.width >= minimumWidth
    && media.height >= minimumHeight
    && media.aspect_ratio >= minimumAspectRatio
  ));
  return {
    scanned_at: new Date().toISOString(),
    requirements: {
      minimum_width: minimumWidth,
      minimum_height: minimumHeight,
      minimum_aspect_ratio: minimumAspectRatio,
    },
    catalog,
    eligible,
  };
}
