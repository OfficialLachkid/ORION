import { access } from 'node:fs/promises';
export { probeMediaDurationSeconds } from '../../../../../media-duration.mjs';

export async function verifyReadableFiles(paths) {
  for (const filePath of paths) {
    await access(filePath);
  }
}
