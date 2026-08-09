import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runLocalProcess } from '../../../../../process-runner.mjs';
import { roundTime } from './constants.mjs';

export async function verifyReadableFiles(paths) {
  for (const filePath of paths) {
    await access(filePath);
  }
}

function resolveFfprobeExecutable(ffmpegExecutable) {
  const normalized = String(ffmpegExecutable || 'ffmpeg');
  const executableName = normalized.toLowerCase().endsWith('.exe') ? 'ffprobe.exe' : 'ffprobe';
  return resolve(dirname(normalized), executableName);
}

export async function probeMediaDurationSeconds({ ffmpegExecutable, mediaPath, cwd }) {
  try {
    const { stdout } = await runLocalProcess({
      executable: resolveFfprobeExecutable(ffmpegExecutable),
      args: [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'json',
        mediaPath,
      ],
      cwd,
      timeoutMs: 60_000,
    });
    const duration = Number(JSON.parse(stdout || '{}')?.format?.duration);
    return Number.isFinite(duration) && duration > 0 ? roundTime(duration) : null;
  } catch {
    return null;
  }
}
