import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SupabasePublicationStaging,
} from '../src/supabase-publication-staging.mjs';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('provisionBucket creates the isolated public MP4 bucket', async () => {
  const requests = [];
  const staging = new SupabasePublicationStaging({
    supabaseUrl: 'https://project.supabase.co',
    apiKey: 'secret',
    bucketName: 'orion-publication-staging',
    maxFileBytes: 50_000_000,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      if (options.method === 'GET') return jsonResponse(400, { message: 'Bucket not found' });
      return jsonResponse(200, { name: 'orion-publication-staging' });
    },
  });

  const result = await staging.provisionBucket();

  assert.equal(result.created, true);
  assert.equal(requests[0].url, 'https://project.supabase.co/storage/v1/bucket/orion-publication-staging');
  assert.equal(requests[1].url, 'https://project.supabase.co/storage/v1/bucket');
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    id: 'orion-publication-staging',
    name: 'orion-publication-staging',
    public: true,
    file_size_limit: 50_000_000,
    allowed_mime_types: ['video/mp4'],
  });
});

test('inspectBucket does not hide unrelated Supabase 400 responses', async () => {
  const staging = new SupabasePublicationStaging({
    supabaseUrl: 'https://project.supabase.co',
    apiKey: 'secret',
    fetchImpl: async () => jsonResponse(400, { message: 'Invalid bucket name' }),
  });

  await assert.rejects(() => staging.inspectBucket(), /Invalid bucket name/u);
});

test('stageFile uploads a never-overwritten object and returns its direct public URL', async () => {
  const requests = [];
  const staging = new SupabasePublicationStaging({
    supabaseUrl: 'https://project.supabase.co',
    apiKey: 'secret',
    bucketName: 'orion-publication-staging',
    maxFileBytes: 50_000_000,
    uuidImpl: () => 'random-id',
    statImpl: async () => ({ size: 6_638_795 }),
    createReadStreamImpl: () => new Uint8Array([1, 2, 3]),
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return jsonResponse(200, { Key: 'orion-publication-staging/buffer/publication-1--random-id.mp4' });
    },
  });

  const result = await staging.stageFile({
    publicationId: 'publication-1',
    filePath: '/tmp/video.mp4',
  });

  assert.equal(result.objectPath, 'buffer/publication-1--random-id.mp4');
  assert.equal(result.sizeBytes, 6_638_795);
  assert.equal(
    result.publicUrl,
    'https://project.supabase.co/storage/v1/object/public/orion-publication-staging/buffer/publication-1--random-id.mp4',
  );
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers['x-upsert'], 'false');
  assert.equal(requests[0].options.headers['content-type'], 'video/mp4');
});

test('stageFile fails before upload when the exact MP4 exceeds the configured limit', async () => {
  let fetchCalls = 0;
  const staging = new SupabasePublicationStaging({
    supabaseUrl: 'https://project.supabase.co',
    apiKey: 'secret',
    maxFileBytes: 10,
    statImpl: async () => ({ size: 11 }),
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse(200, {});
    },
  });

  await assert.rejects(
    () => staging.stageFile({ publicationId: 'publication-1', filePath: '/tmp/video.mp4' }),
    /exceeds the staging limit/u,
  );
  assert.equal(fetchCalls, 0);
});

test('cleanupStaleObjects removes only abandoned objects older than the cutoff', async () => {
  const requests = [];
  const staging = new SupabasePublicationStaging({
    supabaseUrl: 'https://project.supabase.co',
    apiKey: 'secret',
    bucketName: 'orion-publication-staging',
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).includes('/object/list/')) {
        return jsonResponse(200, [
          { name: 'old.mp4', created_at: '2026-10-01T00:00:00.000Z' },
          { name: 'protected.mp4', created_at: '2026-10-01T00:00:00.000Z' },
          { name: 'fresh.mp4', created_at: '2026-10-08T00:00:00.000Z' },
        ]);
      }
      return jsonResponse(200, [{ name: 'buffer/publication-1/old.mp4' }]);
    },
  });

  const result = await staging.cleanupStaleObjects({
    prefix: 'buffer',
    olderThan: '2026-10-06T00:00:00.000Z',
    protectedPaths: ['buffer/protected.mp4'],
  });

  assert.deepEqual(result.removedPaths, ['buffer/old.mp4']);
  assert.equal(requests[1].options.method, 'DELETE');
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    prefixes: ['buffer/old.mp4'],
  });
});
