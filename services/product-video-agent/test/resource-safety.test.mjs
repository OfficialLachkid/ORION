import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPipelineConfig } from '../src/config.mjs';
import { withLocalMediaJobLock } from '../src/media-job-lock.mjs';
import { inspectProductVideoResourceAvailability } from '../src/resource-preflight.mjs';
import { resolveFfmpegExecutable } from '../src/runtime-executables.mjs';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');

test('O.R.I.O.N. media lock prevents overlapping local video jobs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orion-media-lock-'));
  await withLocalMediaJobLock({ projectRoot: root }, async () => {
    await assert.rejects(
      withLocalMediaJobLock({ projectRoot: root }, async () => {}),
      /Another O.R.I.O.N. media job/u,
    );
  });
  await withLocalMediaJobLock({ projectRoot: root }, async () => {});
});

test('FFmpeg resolver selects keg-only ffmpeg-full on Apple Silicon', () => {
  const executable = resolveFfmpegExecutable({ executable: 'auto' }, {
    platform: 'darwin',
    environment: {},
    existsSync(candidate) {
      return candidate === '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
    },
  });
  assert.equal(executable, '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg');
});

test('resource preflight stops when Ollama already has a model loaded', async () => {
  const config = await loadPipelineConfig(
    'services/product-video-agent/config.example.json',
    projectRoot,
  );
  const report = await inspectProductVideoResourceAvailability(config, {
    checkedAt: '2026-07-20T12:00:00.000Z',
    async fetchImpl(url) {
      assert.equal(url, 'http://127.0.0.1:11434/api/ps');
      return { ok: true, async json() { return { models: [{ name: 'llama3.1:8b' }] }; } };
    },
  });

  assert.equal(report.status, 'deferred');
  assert.ok(report.reasons.includes('ollama_models_loaded=llama3.1:8b'));
});
