import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hydratePublication,
  needsFailureAlertHydration,
  needsLifecycleAlertHydration,
  normalizeRuntimePublication,
} from '../src/publication-runtime-snapshot.mjs';

test('normalizeRuntimePublication reconstructs compact operational metadata', () => {
  const publication = normalizeRuntimePublication({
    id: 'publication-1',
    status: 'publishing',
    workflow_state: 'publishing',
    next_status_poll_at: '2026-11-13T12:15:00.000Z',
    source_lifecycle_action_required: true,
    source_instagram_publication_id: 'publication-reel-1',
    instagram_media_id: 'instagram-media-1',
    source_lifecycle_alert_status: 'pending',
    publication_failure_alert_required: false,
    instagram_auto_comment: { status: 'pending' },
  });

  assert.equal(publication._metadata_complete, false);
  assert.equal(publication.metadata.workflow_state, 'publishing');
  assert.equal(publication.metadata.next_status_poll_at, '2026-11-13T12:15:00.000Z');
  assert.equal(publication.metadata.source_lifecycle_action_required, true);
  assert.equal(publication.metadata.source_instagram_publication_id, 'publication-reel-1');
  assert.equal(publication.metadata.instagram_media_id, 'instagram-media-1');
  assert.deepEqual(publication.metadata.instagram_auto_comment, { status: 'pending' });
  assert.equal(needsLifecycleAlertHydration(publication), true);
  assert.equal(needsFailureAlertHydration(publication), false);
});

test('hydratePublication fetches only compact candidates and preserves complete rows', async () => {
  const fetchedIds = [];
  const store = {
    async fetchPublicationById(id) {
      fetchedIds.push(id);
      return { id, metadata: { workflow_state: 'scheduled', complete: true } };
    },
  };
  const compact = normalizeRuntimePublication({
    id: 'publication-compact',
    workflow_state: 'scheduled',
  });
  const complete = { id: 'publication-complete', metadata: { workflow_state: 'scheduled' } };

  assert.equal((await hydratePublication(store, compact)).metadata.complete, true);
  assert.equal(await hydratePublication(store, complete), complete);
  assert.deepEqual(fetchedIds, ['publication-compact']);
});

test('normalizeRuntimePublication reconstructs an Instagram comment candidate status', () => {
  const publication = normalizeRuntimePublication({
    id: 'publication-instagram-comment',
    status: 'published',
    workflow_state: 'published',
    instagram_auto_comment_status: 'uncertain',
  });

  assert.deepEqual(publication.metadata.instagram_auto_comment, { status: 'uncertain' });
});
