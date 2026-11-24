import assert from 'node:assert/strict';
import test from 'node:test';

import { SupabasePublicationStore } from '../src/publication-store.mjs';
import { SOCIAL_RUNTIME_CANDIDATE_SELECT } from '../src/publication-runtime-snapshot.mjs';

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('social publication candidates use bounded server filters and deduplicate rows', async () => {
  const requestedUrls = [];
  const store = new SupabasePublicationStore({
    supabaseUrl: 'https://example.supabase.co',
    apiKey: 'service-role-test-key',
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      requestedUrls.push(url);
      if (url.searchParams.get('status') === 'not.in.(published,withdrawn,deleted,failed,blocked)') {
        return jsonResponse([{ id: 'active-1', scheduled_for: '2026-11-24T08:00:00.000Z' }]);
      }
      if (url.searchParams.get('external_id') === 'not.is.null') {
        return jsonResponse([{ id: 'delivered-1', scheduled_for: '2026-11-23T08:00:00.000Z' }]);
      }
      if (url.searchParams.get('metadata->publication_failure_alert_required') === 'eq.true') {
        return jsonResponse([{ id: 'delivered-1', scheduled_for: '2026-11-23T08:00:00.000Z' }]);
      }
      if (url.searchParams.get('metadata->source_lifecycle_action_required') === 'eq.true') {
        return jsonResponse([{ id: 'lifecycle-1', scheduled_for: null }]);
      }
      if (url.searchParams.get('metadata->instagram_auto_comment->>status')) {
        return jsonResponse([{ id: 'comment-1', scheduled_for: '2026-11-22T08:00:00.000Z' }]);
      }
      return jsonResponse([]);
    },
  });

  const rows = await store.fetchSocialPublicationCandidates({
    platform: 'instagram_reels',
    accountKey: 'poke-quizzz-instagram',
    select: SOCIAL_RUNTIME_CANDIDATE_SELECT,
    includePublishedComments: true,
  });

  assert.equal(requestedUrls.length, 5);
  assert.deepEqual(rows.map((row) => row.id), [
    'lifecycle-1',
    'comment-1',
    'delivered-1',
    'active-1',
  ]);
  for (const url of requestedUrls) {
    assert.equal(url.searchParams.get('platform'), 'eq.instagram_reels');
    assert.equal(url.searchParams.get('account_key'), 'eq.poke-quizzz-instagram');
    assert.equal(url.searchParams.get('select'), SOCIAL_RUNTIME_CANDIDATE_SELECT);
  }
  const deliveredUrl = requestedUrls.find((url) => url.searchParams.get('external_id'));
  assert.equal(deliveredUrl.searchParams.get('metadata->>source_publication_id'), 'not.is.null');
});
