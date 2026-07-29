import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureProductProviderAdapter } from '../src/adapters/fixture-adapter.mjs';
import { loadPipelineConfig } from '../src/config.mjs';
import { SupabaseProductVideoStateStore } from '../src/persistence.mjs';
import { runProductVideoDryRun } from '../src/pipeline.mjs';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');

async function createManifest() {
  const config = await loadPipelineConfig(
    'services/product-video-agent/config.example.json',
    projectRoot,
  );
  const adapter = new FixtureProductProviderAdapter({ projectRoot });
  const { manifest } = await runProductVideoDryRun({
    adapter,
    config,
    inputFile: 'services/product-video-agent/fixtures/cyboris-s11-amazon-nl.json',
    projectRoot,
    store: null,
  });
  return manifest;
}

function createFakeSupabase() {
  const tables = new Map();
  const calls = [];

  return {
    calls,
    tables,
    async fetch(url, options) {
      const parsedUrl = new URL(url);
      const table = parsedUrl.pathname.split('/').at(-1);
      calls.push({
        table,
        method: options.method,
        authorization: options.headers.Authorization,
      });

      if (options.method === 'POST') {
        const rows = JSON.parse(options.body);
        const stored = tables.get(table) || new Map();
        for (const row of rows) stored.set(row.id, row);
        tables.set(table, stored);
        return new Response(null, { status: 204 });
      }

      const rows = [...(tables.get(table)?.values() || [])];
      const id = parsedUrl.searchParams.get('id')?.replace(/^eq\./u, '');
      const videoId = parsedUrl.searchParams.get('video_id')?.replace(/^eq\./u, '');
      const filtered = rows.filter((row) => (
        (!id || row.id === id) && (!videoId || row.video_id === videoId)
      ));
      return Response.json(filtered);
    },
  };
}

test('Supabase state store writes compact tables in foreign-key order and round-trips state', async () => {
  const manifest = await createManifest();
  const supabase = createFakeSupabase();
  const store = new SupabaseProductVideoStateStore({
    supabaseUrl: 'https://example.supabase.co',
    apiKey: 'backend-secret',
    fetch: supabase.fetch,
  });

  const saved = await store.saveRun(manifest);
  const loaded = await store.loadRun(manifest.run_id);

  assert.deepEqual(
    supabase.calls.slice(0, 4).map(({ table, method }) => `${method}:${table}`),
    [
      'POST:video_channels',
      'POST:videos',
      'POST:video_assets',
      'POST:video_publications',
    ],
  );
  assert.ok(supabase.calls.every((call) => call.authorization === 'Bearer backend-secret'));
  assert.deepEqual(saved.tables, {
    video_channels: 1,
    videos: 1,
    video_assets: manifest.assets.length,
    video_publications: manifest.publications.length,
    video_analytics: 0,
  });
  assert.equal(loaded.run_id, manifest.run_id);
  assert.deepEqual(loaded.products, manifest.products);
  assert.deepEqual(loaded.assets, manifest.assets);
  assert.deepEqual(loaded.publications, manifest.publications);

  const videoRow = supabase.tables.get('videos').get(manifest.run_id);
  assert.equal(videoRow.content_lane, 'product-discovery');
  assert.equal(videoRow.channel_id, 'video-channel-product-discovery');
  assert.ok(!JSON.stringify(videoRow).includes('backend-secret'));
});

test('Supabase state store fails closed without backend credentials', async () => {
  const manifest = await createManifest();
  const store = new SupabaseProductVideoStateStore({
    supabaseUrl: 'https://example.supabase.co',
    apiKey: '',
  });

  await assert.rejects(
    store.saveRun(manifest),
    /requires a backend URL and secret key/u,
  );
});

test('Supabase stores platform deliveries only for the selected approved script', async () => {
  const manifest = await createManifest();
  const selectedJob = manifest.script_jobs[0];
  const selectedManifest = {
    ...manifest,
    script_variants: [{
      script_variant_id: 'script-variant-selected',
      product_id: selectedJob.product_id,
      angle: selectedJob.angle,
      target_duration_seconds: selectedJob.target_duration_seconds,
      hook: 'Dust hides where a cloth cannot reach.',
      body: 'A focused air stream clears narrow desk gaps.',
      call_to_action: 'The reusable tool is ready for the next dusty corner.',
      affiliate_disclosure: selectedJob.creative_brief.disclosure,
      spoken_text: 'Dust hides where a cloth cannot reach. A focused air stream clears narrow desk gaps. The reusable tool is ready for the next dusty corner.',
      generation_provider: 'fixture-local',
      model: 'fixture-model',
      status: 'approved',
      approval_status: 'approved',
      created_at: manifest.run_at,
    }],
  };
  const supabase = createFakeSupabase();
  const store = new SupabaseProductVideoStateStore({
    supabaseUrl: 'https://example.supabase.co',
    apiKey: 'backend-secret',
    fetch: supabase.fetch,
  });

  const saved = await store.saveRun(selectedManifest);
  const storedPublications = [...supabase.tables.get('video_publications').values()];

  assert.equal(saved.tables.video_publications, manifest.content_strategy.platforms.length);
  assert.ok(storedPublications.every((row) => (
    row.metadata.script_job_id === selectedJob.script_job_id
  )));
});
