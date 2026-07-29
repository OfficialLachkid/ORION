import { existsSync } from 'node:fs';

const MAC_FFMPEG_FULL_CANDIDATES = [
  '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',
  '/usr/local/opt/ffmpeg-full/bin/ffmpeg',
];

export function resolveFfmpegExecutable(config, options = {}) {
  const environment = options.environment || process.env;
  if (environment.ORION_FFMPEG_EXECUTABLE) return environment.ORION_FFMPEG_EXECUTABLE;

  const renderConfig = config?.render || config || {};
  if (renderConfig.executable && renderConfig.executable !== 'auto') {
    return renderConfig.executable;
  }

  if ((options.platform || process.platform) === 'darwin') {
    const fileExists = options.existsSync || existsSync;
    const installed = MAC_FFMPEG_FULL_CANDIDATES.find((candidate) => fileExists(candidate));
    if (installed) return installed;
  }

  return 'ffmpeg';
}
