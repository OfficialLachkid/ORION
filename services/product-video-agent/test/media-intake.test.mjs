import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ProductPageMediaIntakeAdapter,
  normalizeProductPageMediaCandidate,
  promoteMediaCandidateToAsset,
} from '../src/adapters/product-page-media-intake-adapter.mjs';
import {
  evaluateAssetGates,
  evaluateInternalEditorTestAssetGates,
} from '../src/compliance.mjs';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');
const source = {
  provider: 'manual-research',
  source_url: 'https://www.amazon.nl/dp/B0F1CCLZGT',
  retrieved_at: '2026-07-26T12:00:00.000Z',
  retrieval_method: 'manual',
};
const context = { productId: 'product-example', source };

test('page observation without a direct media URL stays a non-downloadable candidate', () => {
  const candidate = normalizeProductPageMediaCandidate({
    media_type: 'video',
    source_provider: 'amazon-product-page',
    label: 'No listing video observed',
    usage_notes: ['Observation only.'],
  }, context);

  assert.equal(candidate.status, 'reference_only');
  assert.ok(candidate.blockers.includes('source_url_missing'));
  assert.ok(candidate.blockers.includes('rights_status=unverified'));
  assert.equal(promoteMediaCandidateToAsset(candidate), null);
});

test('unverified marketplace media is recorded but remains blocked from acquisition', async () => {
  const adapter = new ProductPageMediaIntakeAdapter();
  const [candidate] = adapter.normalize([{
    media_type: 'image',
    source_provider: 'amazon-product-page',
    source_url: 'https://images.example.invalid/product.jpg',
    retrieval_method: 'reference_only',
  }], context);
  const [asset] = adapter.promote([candidate]);
  const gates = await evaluateAssetGates([asset], projectRoot);

  assert.equal(candidate.status, 'reference_only');
  assert.equal(asset.download_status, 'blocked');
  assert.equal(gates.eligible.length, 0);
  assert.ok(gates.blocked[0].reasons.includes('rights_status=unverified'));
});

test('approved owned media candidate promotes into the existing renderer asset contract', async () => {
  const candidate = normalizeProductPageMediaCandidate({
    media_type: 'image',
    source_provider: 'orion-owned-fixture',
    source_page_url: 'https://fixtures.orion.local/product-video-agent',
    source_url: 'https://fixtures.orion.local/owned-cyboris-s11-card.ppm',
    observation_method: 'fixture',
    retrieval_method: 'fixture',
    local_path: 'services/product-video-agent/fixtures/owned-cyboris-s11-card.ppm',
    content_sha256: '1988af722581304fd6da98a7cd22c223089a2c82adb9e3fced7cad53139460f2',
    rights_status: 'verified',
    rights_basis: 'owned',
    rights_evidence: 'Repository-owned test fixture.',
    approval_status: 'approved',
    usage_scope: 'publication',
  }, context);
  const asset = promoteMediaCandidateToAsset(candidate);
  const gates = await evaluateAssetGates([asset], projectRoot);

  assert.equal(candidate.status, 'asset_record_ready');
  assert.equal(asset.download_status, 'downloaded');
  assert.deepEqual(gates.eligible.map((item) => item.asset_id), [asset.asset_id]);
});

test('manually supplied marketplace visual can only enter the internal editor-test gate', async () => {
  const candidate = normalizeProductPageMediaCandidate({
    media_type: 'image',
    source_provider: 'amazon-product-page',
    source_url: 'https://www.amazon.nl/dp/B0F1CCLZGT',
    retrieval_method: 'manual_upload',
    local_path: 'services/product-video-agent/fixtures/owned-cyboris-s11-card.ppm',
    content_sha256: '1988af722581304fd6da98a7cd22c223089a2c82adb9e3fced7cad53139460f2',
    rights_status: 'unverified',
    rights_basis: 'unknown',
    approval_status: 'approved',
    usage_scope: 'internal_editor_test',
  }, context);
  const asset = promoteMediaCandidateToAsset(candidate);
  const internalGates = await evaluateInternalEditorTestAssetGates([asset], projectRoot);
  const publicationGates = await evaluateAssetGates([asset], projectRoot);

  assert.equal(candidate.status, 'asset_record_ready');
  assert.equal(internalGates.eligible.length, 1);
  assert.equal(publicationGates.eligible.length, 0);
  assert.ok(publicationGates.blocked[0].reasons.includes('usage_scope=internal_editor_test'));
});

test('permitted browser media can enter only the internal editor-test gate', async () => {
  const candidate = normalizeProductPageMediaCandidate({
    media_type: 'image',
    source_provider: 'merchant-product-page',
    source_url: 'https://media.example.invalid/product.jpg',
    observation_method: 'permitted_browser',
    retrieval_method: 'permitted_browser',
    local_path: 'services/product-video-agent/fixtures/owned-cyboris-s11-card.ppm',
    content_sha256: '1988af722581304fd6da98a7cd22c223089a2c82adb9e3fced7cad53139460f2',
    rights_status: 'unverified',
    rights_basis: 'unknown',
    approval_status: 'approved',
    usage_scope: 'internal_editor_test',
  }, context);
  const asset = promoteMediaCandidateToAsset(candidate);
  const internalGates = await evaluateInternalEditorTestAssetGates([asset], projectRoot);
  const publicationGates = await evaluateAssetGates([asset], projectRoot);

  assert.equal(candidate.status, 'asset_record_ready');
  assert.equal(internalGates.eligible.length, 1);
  assert.equal(publicationGates.eligible.length, 0);
});
