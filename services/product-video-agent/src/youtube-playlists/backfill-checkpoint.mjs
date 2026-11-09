import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

const CHECKPOINT_SCHEMA_VERSION = 'youtube-playlist-backfill-checkpoint-v1';

function safeAccountKey(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || !/^[a-z0-9_-]+$/u.test(normalized)) {
    throw new Error('Playlist backfill checkpoint requires a safe account key.');
  }
  return normalized;
}

export function resolveYoutubePlaylistBackfillCheckpointPath(runtimeConfig, accountKey) {
  const root = runtimeConfig?.runtimePaths?.tmpDir;
  if (!root) throw new Error('Playlist backfill checkpoint requires runtimePaths.tmpDir.');
  return join(root, 'youtube-playlist-backfill', `${safeAccountKey(accountKey)}.json`);
}

export function readYoutubePlaylistBackfillCheckpoint(path) {
  try {
    const checkpoint = JSON.parse(readFileSync(path, 'utf8'));
    return checkpoint?.schema_version === CHECKPOINT_SCHEMA_VERSION ? checkpoint : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function writeYoutubePlaylistBackfillCheckpoint(path, checkpoint = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const payload = {
    schema_version: CHECKPOINT_SCHEMA_VERSION,
    ...checkpoint,
    updated_at: checkpoint.updated_at || new Date().toISOString(),
  };
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  renameSync(temporaryPath, path);
  return payload;
}
