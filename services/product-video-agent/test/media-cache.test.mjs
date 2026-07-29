import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureProductProviderAdapter } from '../src/adapters/fixture-adapter.mjs';
import { archiveVerifiedAsset, archiveVerifiedMedia } from '../src/archive-manager.mjs';
import { loadPipelineConfig } from '../src/config.mjs';
import {
  cleanupVerifiedWorkingMedia,
  restoreArchivedAssetWorkingCopies,
} from '../src/media-cache.mjs';
import { runProductVideoDryRun } from '../src/pipeline.mjs';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const repositoryRoot = resolve(testDirectory, '../../..');

async function createManifest() {
  const config = await loadPipelineConfig(
    'services/product-video-agent/config.example.json',
    repositoryRoot,
  );
  const adapter = new FixtureProductProviderAdapter({ projectRoot: repositoryRoot });
  return runProductVideoDryRun({
    adapter,
    config,
    inputFile: 'services/product-video-agent/fixtures/example-product.json',
    projectRoot: repositoryRoot,
  });
}

test('verified T7 cleanup removes Mac media and restores source footage on demand', async () => {
  const { manifest } = await createManifest();
  const projectRoot = await mkdtemp(join(tmpdir(), 'orion-media-cache-'));
  const cacheDirectory = join(projectRoot, 'data', 'runtime');
  const archiveRoot = join(projectRoot, 'O.R.I.O.N. Video Generation');
  await mkdir(cacheDirectory, { recursive: true });
  await mkdir(archiveRoot);

  const sourcePath = join(cacheDirectory, 'source.mp4');
  const renderPath = join(cacheDirectory, 'render.mp4');
  const sourceContent = 'temporary source footage';
  const renderContent = 'generated test render';
  await writeFile(sourcePath, sourceContent);
  await writeFile(renderPath, renderContent);
  const sourceSha256 = createHash('sha256').update(sourceContent).digest('hex');

  const asset = {
    ...manifest.assets[0],
    local_path: sourcePath,
    content_sha256: sourceSha256,
    approval_status: 'approved',
    download_status: 'downloaded',
    usage_scope: 'internal_editor_test',
    retrieval_method: 'manual_upload',
    rights_status: 'unverified',
    rights_basis: 'unknown',
    rights_evidence: null,
  };
  const assetStorage = await archiveVerifiedAsset({
    asset,
    preferredRoot: archiveRoot,
    relativePath: 'Assets/Temporary Product Footage/source.mp4',
  });
  const renderArchive = await archiveVerifiedMedia({
    sourcePath: renderPath,
    renderJobId: manifest.render_jobs[0].render_job_id,
    preferredRoot: archiveRoot,
    relativePath: 'Archive/Tests/Test Renders/render.mp4',
  });
  const cleanupInput = {
    ...manifest,
    assets: [asset],
    asset_storage_locations: [assetStorage],
    archive_results: [renderArchive],
  };

  const cleaned = await cleanupVerifiedWorkingMedia({
    manifest: cleanupInput,
    projectRoot,
  });

  await assert.rejects(access(sourcePath), { code: 'ENOENT' });
  await assert.rejects(access(renderPath), { code: 'ENOENT' });
  assert.equal(cleaned.manifest.asset_storage_locations[0].source_retained, false);
  assert.equal(cleaned.manifest.archive_results[0].source_retained, false);
  assert.deepEqual(cleaned.report.removed_asset_ids, [asset.asset_id]);
  assert.deepEqual(
    cleaned.report.removed_render_job_ids,
    [manifest.render_jobs[0].render_job_id],
  );

  const restored = await restoreArchivedAssetWorkingCopies({
    manifest: cleaned.manifest,
    projectRoot,
  });

  assert.equal(await readFile(sourcePath, 'utf8'), sourceContent);
  assert.equal(restored.asset_storage_locations[0].source_retained, true);
  await assert.rejects(access(renderPath), { code: 'ENOENT' });
});
