import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureProductProviderAdapter } from '../src/adapters/fixture-adapter.mjs';
import { archiveVerifiedAsset, archiveVerifiedMedia } from '../src/archive-manager.mjs';
import { loadPipelineConfig } from '../src/config.mjs';
import {
  setTemporarySourceRetention,
  sweepExpiredTemporarySources,
} from '../src/media-retention.mjs';
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

test('one-hour retention deletes only verified temporary source after a render exists', async () => {
  const { manifest } = await createManifest();
  const root = await mkdtemp(join(tmpdir(), 'orion-retention-'));
  const archiveRoot = join(root, 'O.R.I.O.N. Video Generation');
  await mkdir(archiveRoot);
  const sourcePath = join(root, 'source.mp4');
  const renderPath = join(root, 'render.mp4');
  const sourceContent = 'temporary downloaded product footage';
  await writeFile(sourcePath, sourceContent);
  await writeFile(renderPath, 'permanent generated render');
  const contentSha256 = createHash('sha256').update(sourceContent).digest('hex');
  const asset = {
    ...manifest.assets[0],
    local_path: sourcePath,
    content_sha256: contentSha256,
    approval_status: 'approved',
    download_status: 'downloaded',
    usage_scope: 'internal_editor_test',
    retrieval_method: 'manual_upload',
    rights_status: 'unverified',
    rights_basis: 'unknown',
    rights_evidence: null,
  };
  const sourceArchive = await archiveVerifiedAsset({
    asset,
    preferredRoot: archiveRoot,
    relativePath: 'Assets/Temporary Product Footage/source.mp4',
    now: new Date('2026-07-27T12:00:00.000Z'),
  });
  const renderArchive = await archiveVerifiedMedia({
    sourcePath: renderPath,
    renderJobId: manifest.render_jobs[0].render_job_id,
    preferredRoot: archiveRoot,
    relativePath: 'Archive/Tests/Test Renders/render.mp4',
    now: new Date('2026-07-27T12:00:00.000Z'),
  });
  const retained = setTemporarySourceRetention({
    manifest: {
      ...manifest,
      assets: [asset],
      asset_storage_locations: [{
        ...sourceArchive,
        retention_class: 'temporary_source',
      }],
      archive_results: [renderArchive],
    },
    retentionHours: 1,
    now: '2026-07-27T12:00:00.000Z',
  });

  assert.equal(
    retained.asset_storage_locations[0].delete_after,
    '2026-07-27T13:00:00.000Z',
  );
  const early = await sweepExpiredTemporarySources({
    manifest: retained,
    asOf: '2026-07-27T12:59:59.000Z',
  });
  assert.deepEqual(early.report.deleted_storage_location_ids, []);
  await access(sourceArchive.path);

  const expired = await sweepExpiredTemporarySources({
    manifest: early.manifest,
    asOf: '2026-07-27T13:00:00.000Z',
  });
  await assert.rejects(access(sourceArchive.path), { code: 'ENOENT' });
  await access(renderArchive.destination_path);
  assert.equal(expired.manifest.asset_storage_locations[0].deletion_status, 'deleted');
  assert.equal(expired.manifest.asset_storage_locations[0].source_retained, false);
});
