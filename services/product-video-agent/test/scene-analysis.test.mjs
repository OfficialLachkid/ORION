import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureProductProviderAdapter } from '../src/adapters/fixture-adapter.mjs';
import { loadPipelineConfig } from '../src/config.mjs';
import { runProductVideoDryRun } from '../src/pipeline.mjs';
import { analyzeManifestVideoScenes } from '../src/scene-analysis.mjs';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');

test('FFmpeg scene analysis records reproducible local video metadata', async () => {
  const config = await loadPipelineConfig(
    'services/product-video-agent/config.example.json',
    projectRoot,
  );
  const adapter = new FixtureProductProviderAdapter({ projectRoot });
  const { manifest } = await runProductVideoDryRun({
    adapter,
    config,
    inputFile: 'services/product-video-agent/fixtures/example-product.json',
    projectRoot,
  });
  const sourceAsset = manifest.assets.find((asset) => asset.local_path);
  const videoAsset = { ...sourceAsset, media_type: 'video' };
  const testManifest = {
    ...manifest,
    assets: manifest.assets.map((asset) => (
      asset.asset_id === sourceAsset.asset_id ? videoAsset : asset
    )),
  };
  let calls = 0;
  const analyzed = await analyzeManifestVideoScenes({
    manifest: testManifest,
    assetId: sourceAsset.asset_id,
    analyzedAt: '2026-07-27T09:00:00.000Z',
    config,
    projectRoot,
    async runProcess() {
      calls += 1;
      if (calls === 1) {
        return {
          stdout: JSON.stringify({
            streams: [{ avg_frame_rate: '30000/1001', width: 642, height: 360 }],
            format: { duration: '27.6956' },
          }),
          stderr: '',
        };
      }
      return {
        stdout: '',
        stderr: 'pts_time:16.751333 other\npts_time:23.724967 other\n',
      };
    },
  });
  const analysis = analyzed.assets.find((asset) => (
    asset.asset_id === sourceAsset.asset_id
  )).video_analysis;

  assert.equal(calls, 2);
  assert.equal(analysis.duration_seconds, 27.696);
  assert.equal(analysis.frame_rate, 29.97);
  assert.deepEqual(analysis.scene_boundaries_seconds, [16.751, 23.725]);
  const analyzedVideoClips = analyzed.render_jobs[0].timeline.filter((clip) => (
    clip.asset_id === sourceAsset.asset_id
  ));
  assert.equal(analyzedVideoClips.length, 4);
  assert.deepEqual(
    analyzedVideoClips.map((clip) => clip.source_start_seconds),
    [0, 8.376, 16.751, 23.725],
  );
});
