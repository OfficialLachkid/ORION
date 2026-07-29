import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureProductProviderAdapter } from '../src/adapters/fixture-adapter.mjs';
import {
  archiveVerifiedAsset,
  archiveVerifiedMedia,
  resolveArchiveRoots,
} from '../src/archive-manager.mjs';
import { archiveManifestAssets } from '../src/asset-archive.mjs';
import { loadPipelineConfig } from '../src/config.mjs';
import { runProductVideoDryRun } from '../src/pipeline.mjs';
import { AssetStorageLocationSchema } from '../src/schemas.mjs';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');

async function createFixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), 'video-archive-'));
  const sourcePath = join(root, 'render.mp4');
  await writeFile(sourcePath, 'verified render fixture');
  return { root, sourcePath };
}

test('archive manager uses a hash-verified Desktop fallback when the SSD is absent', async () => {
  const { root, sourcePath } = await createFixtureRoot();
  const fallbackRoot = join(root, 'Desktop', 'Video Generation Fallback');
  const result = await archiveVerifiedMedia({
    sourcePath,
    relativePath: 'run-1/renders/render.mp4',
    renderJobId: 'render-job-1',
    preferredRoot: join(root, 'missing-ssd'),
    fallbackRoot,
    now: new Date('2026-07-25T12:00:00.000Z'),
  });

  assert.equal(result.location_type, 'mac_desktop_fallback');
  assert.equal(result.status, 'pending_external_ssd');
  assert.equal(result.source_retained, true);
  assert.equal(result.preferred_root_configured, true);
  assert.equal(await readFile(result.destination_path, 'utf8'), 'verified render fixture');
  assert.match(result.content_sha256, /^[a-f0-9]{64}$/u);
});

test('archive manager prefers a writable SSD and reuses an identical verified copy', async () => {
  const { root, sourcePath } = await createFixtureRoot();
  const preferredRoot = join(root, 'mounted-ssd');
  await mkdir(preferredRoot);
  const options = {
    sourcePath,
    relativePath: 'run-2/renders/render.mp4',
    renderJobId: 'render-job-2',
    preferredRoot,
    fallbackRoot: join(root, 'fallback'),
    now: new Date('2026-07-25T12:00:00.000Z'),
  };
  const first = await archiveVerifiedMedia(options);
  const second = await archiveVerifiedMedia(options);

  assert.equal(first.location_type, 'external_ssd_archive');
  assert.equal(first.status, 'archived');
  assert.equal(first.reused_existing_copy, false);
  assert.equal(second.reused_existing_copy, true);
  assert.equal(second.content_sha256, first.content_sha256);
});

test('archive roots default to one visible Desktop fallback directory', () => {
  const roots = resolveArchiveRoots({
    homeDirectory: '/Users/Agent',
    preferredRoot: null,
    fallbackRoot: null,
  });

  assert.equal(roots.preferredRoot, null);
  assert.match(roots.fallbackRoot.replaceAll('\\', '/'), /\/Users\/Agent\/Desktop\/Video Generation Fallback$/u);
});

test('archive manager rejects paths that escape the selected archive root', async () => {
  const { root, sourcePath } = await createFixtureRoot();
  await assert.rejects(
    archiveVerifiedMedia({
      sourcePath,
      relativePath: '../outside.mp4',
      renderJobId: 'render-job-3',
      fallbackRoot: join(root, 'fallback'),
    }),
    /inside the selected archive root/u,
  );
});

test('approved source assets use content-addressed SSD storage metadata', async () => {
  const { root, sourcePath } = await createFixtureRoot();
  const preferredRoot = join(root, 'mounted-ssd');
  await mkdir(preferredRoot);
  const expectedSha256 = '7ebb84c335dd2332aa0d260395f9df1a3cfd1c965dd44348b94a68b8d87ee949';
  const storage = await archiveVerifiedAsset({
    asset: {
      asset_id: 'asset-source-1',
      local_path: sourcePath,
      content_sha256: expectedSha256,
    },
    preferredRoot,
    fallbackRoot: join(root, 'fallback'),
    now: new Date('2026-07-26T12:00:00.000Z'),
  });

  assert.equal(AssetStorageLocationSchema.parse(storage).asset_id, 'asset-source-1');
  assert.equal(storage.location_type, 'external_ssd_archive');
  assert.match(storage.path.replaceAll('\\', '/'), new RegExp(`/assets/${expectedSha256}\\.mp4$`, 'u'));
  assert.equal(await readFile(storage.path, 'utf8'), 'verified render fixture');
});

test('manifest asset archival uses the internal-test SSD namespace', async () => {
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
  const { root, sourcePath } = await createFixtureRoot();
  const preferredRoot = join(root, 'mounted-ssd');
  await mkdir(preferredRoot);
  const contentSha256 = '7ebb84c335dd2332aa0d260395f9df1a3cfd1c965dd44348b94a68b8d87ee949';
  const asset = manifest.assets[0];
  const renderJob = manifest.render_jobs[0];
  const internalManifest = {
    ...manifest,
    assets: [{
      ...asset,
      local_path: sourcePath,
      content_sha256: contentSha256,
      approval_status: 'approved',
      download_status: 'downloaded',
      usage_scope: 'internal_editor_test',
    }],
    render_jobs: [{
      ...renderJob,
      asset_ids: [asset.asset_id],
      excluded_asset_ids: [],
      timeline: [{
        ...renderJob.timeline[0],
        asset_id: asset.asset_id,
      }],
    }],
  };
  const archived = await archiveManifestAssets({
    manifest: internalManifest,
    projectRoot: root,
    config: {
      archive: {
        preferred_root: preferredRoot,
        fallback_root: join(root, 'fallback'),
        device_id: 'test-mac',
      },
    },
    now: new Date('2026-07-26T12:00:00.000Z'),
  });

  assert.equal(archived.asset_storage_locations.length, 1);
  assert.match(
    archived.asset_storage_locations[0].path.replaceAll('\\', '/'),
    /\/Assets\/Temporary Product Footage\/ORION-Cordless-Mini-Air-Duster-7ebb84c3\.mp4$/u,
  );
});
