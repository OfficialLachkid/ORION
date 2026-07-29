import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureProductProviderAdapter } from '../src/adapters/fixture-adapter.mjs';
import { RightsGatedAssetAcquisitionPlanner } from '../src/adapters/asset-acquisition-adapter.mjs';
import { canPlanAssetDownload } from '../src/compliance.mjs';
import { loadPipelineConfig } from '../src/config.mjs';
import { FileProductVideoStateStore } from '../src/persistence.mjs';
import { runProductVideoDryRun } from '../src/pipeline.mjs';
import { OutputManifestSchema } from '../src/schemas.mjs';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');
const inputFile = 'services/product-video-agent/fixtures/example-product.json';
const configFile = 'services/product-video-agent/config.example.json';

async function createDryRun(options = {}) {
  const config = await loadPipelineConfig(configFile, projectRoot);
  const adapter = new FixtureProductProviderAdapter({ projectRoot });
  return runProductVideoDryRun({
    adapter,
    config,
    inputFile: options.inputFile || inputFile,
    projectRoot,
    store: options.store || null,
  });
}

test('dry-run manifest is schema-valid and deterministic', async () => {
  const first = await createDryRun();
  const second = await createDryRun();

  assert.deepEqual(first.manifest, second.manifest);
  assert.equal(OutputManifestSchema.parse(first.manifest).mode, 'dry_run');
  assert.equal(first.manifest.product_scores[0].overall_score, 83);
  assert.equal(first.manifest.cost.incurred, 0);
  assert.equal(first.manifest.script_jobs.length, 3);
  assert.ok(first.manifest.script_jobs.every((job) => (
    job.creative_brief.blocked_phrases.includes('in just one second')
      && job.creative_brief.blocked_phrases.includes('100000 RPM')
      && job.creative_brief.editorial_direction.some((direction) => (
        direction.includes('without disposable canned air')
      ))
  )));
  assert.equal(first.manifest.content_strategy.primary, 'short_form');
  assert.equal(first.manifest.content_strategy.long_form.enabled, false);
  assert.equal(first.manifest.publications.length, 9);
  assert.deepEqual(
    [...new Set(first.manifest.publications.map((publication) => publication.platform))].sort(),
    ['instagram_reels', 'tiktok', 'youtube_shorts'],
  );
});

test('real product fixture preserves unknown price and blocks marketplace media', async () => {
  const { manifest } = await createDryRun({
    inputFile: 'services/product-video-agent/fixtures/cyboris-s11-amazon-nl.json',
  });
  const product = manifest.products[0];
  const marketplaceAsset = manifest.assets.find((asset) => (
    asset.source_provider === 'amazon-product-page'
  ));
  const syntheticAsset = manifest.assets.find((asset) => (
    asset.source_provider === 'orion-owned-fixture'
  ));
  const marketplaceCandidate = manifest.media_candidates.find((candidate) => (
    candidate.source_provider === 'amazon-product-page'
  ));
  const syntheticCandidate = manifest.media_candidates.find((candidate) => (
    candidate.source_provider === 'orion-owned-fixture'
  ));

  assert.equal(product.source_product_id, 'B0F1CCLZGT');
  assert.equal(product.current_price, null);
  assert.equal(manifest.product_scores[0].expected_roi.estimated_revenue, 0);
  assert.ok(manifest.product_scores[0].expected_roi.assumptions.some((assumption) => (
    assumption.includes('price was unavailable')
  )));
  assert.ok(manifest.script_jobs.every((job) => (
    job.creative_brief.key_facts.every((fact) => !fact.startsWith('Current price:'))
  )));
  assert.ok(manifest.script_jobs.every((job) => (
    job.creative_brief.blocked_phrases.includes('connect two devices')
  )));
  assert.ok(manifest.script_jobs.every((job) => (
    job.creative_brief.key_facts.includes('The speaker supports stereo playback and has an IPX6 water-resistance rating.')
      && job.creative_brief.key_facts.some((fact) => fact.includes('separates into two speaker units'))
      && job.creative_brief.key_facts.every((fact) => !/20 W|S11-M|CYBORIS/u.test(fact))
  )));
  assert.ok(manifest.gates.blocked_asset_ids.includes(marketplaceAsset.asset_id));
  assert.ok(manifest.gates.eligible_asset_ids.includes(syntheticAsset.asset_id));
  assert.equal(marketplaceCandidate.status, 'reference_only');
  assert.equal(marketplaceCandidate.source_url, null);
  assert.ok(marketplaceCandidate.blockers.includes('source_url_missing'));
  assert.equal(syntheticCandidate.status, 'asset_record_ready');
  assert.ok(manifest.render_jobs.every((job) => job.asset_ids.includes(syntheticAsset.asset_id)));
  assert.ok(manifest.render_jobs.every((job) => !job.asset_ids.includes(marketplaceAsset.asset_id)));
});

test('unverified Amazon video is excluded from render plans', async () => {
  const { manifest } = await createDryRun();
  const amazonVideo = manifest.assets.find((asset) => asset.source_provider === 'amazon-product-page');

  assert.ok(amazonVideo);
  assert.equal(canPlanAssetDownload(amazonVideo), false);
  assert.ok(manifest.gates.blocked_asset_ids.includes(amazonVideo.asset_id));
  const downloadPlan = manifest.asset_acquisition_plans.find((plan) => plan.asset_id === amazonVideo.asset_id);
  assert.equal(downloadPlan.status, 'blocked');
  assert.equal(downloadPlan.execution_plan.execute, false);
  assert.equal(manifest.gates.render_ready, false);
  assert.equal(manifest.gates.publish_ready, false);
  assert.ok(manifest.render_jobs.every((job) => !job.asset_ids.includes(amazonVideo.asset_id)));
  assert.ok(manifest.render_jobs.every((job) => job.excluded_asset_ids.includes(amazonVideo.asset_id)));
});

const liveBrowserFixturePath = resolve(
  projectRoot,
  'data/runtime/product-video-agent/internal-tests/B0FMX5NGY9/amazon-merchant-video.mp4',
);

test('permitted-browser merchant footage is watermarked and internal-test only', {
  skip: !existsSync(liveBrowserFixturePath),
}, async () => {
  const config = await loadPipelineConfig(configFile, projectRoot);
  const adapter = new FixtureProductProviderAdapter({ projectRoot });
  const { manifest } = await runProductVideoDryRun({
    adapter,
    config: {
      ...config,
      render: { ...config.render, purpose: 'internal_editor_test' },
    },
    inputFile: 'services/product-video-agent/fixtures/vantrue-t150-amazon-nl-internal-test.json',
    projectRoot,
    store: null,
  });
  const asset = manifest.assets[0];

  assert.equal(asset.retrieval_method, 'permitted_browser');
  assert.equal(asset.rights_status, 'unverified');
  const assetApproval = manifest.workflow_approvals.find((approval) => (
    approval.stage === 'asset' && approval.subject_id === asset.asset_id
  ));
  assert.equal(assetApproval.state, 'approved');
  assert.match(assetApproval.decision_reason, /internal editor testing only/u);
  assert.ok(manifest.gates.eligible_asset_ids.includes(asset.asset_id));
  assert.ok(manifest.render_jobs.every((job) => job.render_purpose === 'internal_editor_test'));
  assert.ok(manifest.render_jobs.every((job) => job.watermark_required));
  assert.ok(manifest.render_jobs.every((job) => !job.publication_eligible));
  assert.ok(manifest.publications.every((publication) => publication.status === 'blocked'));
  assert.equal(manifest.gates.publish_ready, false);
});

test('local planners create no-execution Ollama, TTS, and FFmpeg payloads', async () => {
  const { manifest } = await createDryRun();

  assert.ok(manifest.script_jobs.every((job) => job.model_plan.execute === false));
  assert.ok(manifest.voice_over_jobs.every((job) => job.execution_plan.execute === false));
  assert.ok(manifest.render_jobs.every((job) => job.execution_plan.execute === false));
  assert.ok(manifest.publication_approvals.every((approval) => approval.state === 'pending'));
});

test('asset download becomes plannable only with verified rights and approval', async () => {
  const { manifest } = await createDryRun();
  const sourceAsset = manifest.assets[0];
  const approvedAsset = {
    ...sourceAsset,
    retrieval_method: 'permitted_download',
    rights_status: 'verified',
    rights_basis: 'merchant_permission',
    rights_evidence: 'Contract reference ORION-RIGHTS-001 permits affiliate-video reuse.',
    approval_status: 'approved',
    download_status: 'planned',
    usage_scope: 'publication',
  };
  const planner = new RightsGatedAssetAcquisitionPlanner();
  const plan = planner.createPlan(approvedAsset, manifest.run_at);

  assert.equal(canPlanAssetDownload(approvedAsset), true);
  assert.equal(plan.status, 'planned');
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.execution_plan.execute, false);
});

test('file state store round-trips a validated manifest', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'orion-product-video-'));
  const store = new FileProductVideoStateStore({
    projectRoot: outputRoot,
    outputDirectory: 'runs',
  });
  const result = await createDryRun({ store });
  const loaded = await store.loadRun(result.manifest.run_id);

  assert.deepEqual(loaded, result.manifest);
  assert.match(result.persistence.manifestPath, /manifest\.json$/u);
});

test('file state store rejects output paths outside its project root', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'orion-product-video-safe-'));
  const store = new FileProductVideoStateStore({
    projectRoot: outputRoot,
    outputDirectory: '../outside',
  });

  assert.throws(
    () => store.resolveManifestPath('run-safe'),
    /inside the project root/u,
  );
});
