import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTAGRAM_REEL_PLATFORM,
  TIKTOK_VIDEO_PLATFORM,
  buildAdditionalPlatformPublicationRows,
  listEnabledAdditionalPublicationTargets,
  reconcileAdditionalPlatformPublicationLifecycles,
  upsertAdditionalPlatformPublicationTargets,
} from '../src/social-publication-targets.mjs';

const sourceChannelProfile = {
  id: 'video-channel-poke-quizz-youtube',
  name: 'Poke Quizz',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  metadata: {
    publisher: {
      targets: [
        {
          platform: 'youtube_shorts',
          account_key: 'poke-quizz-youtube',
          enabled: true,
        },
        {
          platform: 'tiktok',
          account_key: 'poke-quizz-tiktok',
          enabled: true,
          schedule_mode: 'orion',
          visibility: 'private',
          tiktok: {
            access_token_env: 'TIKTOK_POKE_QUIZZ_ACCESS_TOKEN',
            expected_username: 'pokequizz7',
            privacy_level: 'SELF_ONLY',
            comments_enabled: false,
            duet_enabled: false,
            stitch_enabled: false,
            is_aigc: true,
          },
        },
        {
          platform: 'tiktok_video',
          account_key: 'disabled-tiktok',
          enabled: false,
        },
      ],
    },
  },
};

const sourcePublication = {
  id: 'publication-source-youtube',
  video_id: 'video-source',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  title: 'Guess the Pokemon!',
  description: 'A short quiz.',
  hashtags: ['#pokemon', '#shorts'],
  preview_url: 'https://youtube.com/shorts/preview',
  external_id: 'yt-preview',
  metadata: {
    workflow_state: 'scheduled',
    template_id: 'pokemon.memory.v1',
    render_path: 'data/runtime/product-video-agent/poke-quizz/source.mp4',
    review_task_id: 'TASK-REVIEW',
    review_thread_id: 'review-thread',
    review_message_id: 'review-message',
  },
};

const videoRow = {
  id: 'video-source',
  title: 'Video row fallback title',
  render: {
    output_path: 'data/runtime/product-video-agent/poke-quizz/fallback.mp4',
  },
};

test('listEnabledAdditionalPublicationTargets returns enabled non-source platform targets only', () => {
  const targets = listEnabledAdditionalPublicationTargets(sourceChannelProfile);

  assert.equal(targets.length, 1);
  assert.equal(targets[0].platform, TIKTOK_VIDEO_PLATFORM);
  assert.equal(targets[0].accountKey, 'poke-quizz-tiktok');
  assert.equal(targets[0].tiktok.access_token_env, 'TIKTOK_POKE_QUIZZ_ACCESS_TOKEN');
  assert.equal(targets[0].deliveryProvider, 'tiktok_direct');
});

test('Buffer targets retain provider and channel identity in publication metadata', () => {
  const profile = structuredClone(sourceChannelProfile);
  profile.metadata.publisher.targets[1] = {
    platform: 'tiktok_video',
    account_key: 'poke-quizz-tiktok',
    enabled: true,
    schedule_mode: 'orion',
    delivery_provider: 'buffer',
    buffer: {
      organization_id: 'organization-1',
      channel_id: 'channel-1',
      expected_service: 'tiktok',
      expected_username: 'pokequizz7',
    },
  };

  const [target] = listEnabledAdditionalPublicationTargets(profile);
  const [row] = buildAdditionalPlatformPublicationRows({
    sourcePublication,
    videoRow,
    sourceChannelProfile: profile,
    scheduledFor: '2026-09-08T10:00:00.000Z',
  });

  assert.equal(target.deliveryProvider, 'buffer');
  assert.equal(target.buffer.channel_id, 'channel-1');
  assert.equal(row.metadata.publisher_target.delivery_provider, 'buffer');
  assert.equal(row.metadata.publisher_target.buffer.organization_id, 'organization-1');
});

test('Instagram targets normalize as independent plug-and-play account destinations', () => {
  const profile = structuredClone(sourceChannelProfile);
  profile.metadata.publisher.targets.push({
    platform: 'instagram_reels',
    account_key: 'poke-quizz-instagram',
    enabled: true,
    schedule_mode: 'orion',
    instagram: {
      user_id: 'ig-user-1',
      expected_username: 'pokequizz',
      access_token_env: 'INSTAGRAM_POKE_QUIZZ_ACCESS_TOKEN',
      share_to_feed: true,
    },
  });

  const target = listEnabledAdditionalPublicationTargets(profile)
    .find((item) => item.platform === INSTAGRAM_REEL_PLATFORM);
  const row = buildAdditionalPlatformPublicationRows({
    sourcePublication,
    videoRow,
    sourceChannelProfile: profile,
    scheduledFor: '2026-09-08T10:00:00.000Z',
  }).find((item) => item.platform === INSTAGRAM_REEL_PLATFORM);

  assert.equal(target.deliveryProvider, 'instagram_graph');
  assert.equal(target.instagram.user_id, 'ig-user-1');
  assert.equal(row.account_key, 'poke-quizz-instagram');
  assert.equal(row.scheduled_for, '2026-09-08T10:00:00.000Z');
  assert.equal(row.metadata.publisher_target.instagram.access_token_env, 'INSTAGRAM_POKE_QUIZZ_ACCESS_TOKEN');
});

test('buildAdditionalPlatformPublicationRows creates a scheduled TikTok publication row from a YouTube source', () => {
  const [row] = buildAdditionalPlatformPublicationRows({
    sourcePublication,
    videoRow,
    sourceChannelProfile,
    scheduledFor: '2026-09-08T10:00:00.000Z',
    asOf: '2026-09-07T12:00:00.000Z',
  });

  assert.equal(row.platform, TIKTOK_VIDEO_PLATFORM);
  assert.equal(row.account_key, 'poke-quizz-tiktok');
  assert.equal(row.video_id, 'video-source');
  assert.equal(row.status, 'scheduled');
  assert.equal(row.scheduled_for, '2026-09-08T10:00:00.000Z');
  assert.equal(row.metadata.workflow_state, 'scheduled');
  assert.equal(row.metadata.source_publication_id, 'publication-source-youtube');
  assert.equal(row.metadata.source_external_id, 'yt-preview');
  assert.equal(row.metadata.render_path, 'data/runtime/product-video-agent/poke-quizz/source.mp4');
  assert.equal(row.metadata.publisher_target.tiktok.privacy_level, 'SELF_ONLY');
});

test('additional targets inherit each channel-assigned source slot without a platform schedule copy', () => {
  const firstSlot = '2026-09-08T06:00:00.000Z';
  const changedChannelSlot = '2026-09-08T16:30:00.000Z';
  const [firstRow] = buildAdditionalPlatformPublicationRows({
    sourcePublication,
    videoRow,
    sourceChannelProfile,
    scheduledFor: firstSlot,
  });
  const [changedRow] = buildAdditionalPlatformPublicationRows({
    sourcePublication,
    videoRow,
    sourceChannelProfile,
    scheduledFor: changedChannelSlot,
  });

  assert.equal(firstRow.scheduled_for, firstSlot);
  assert.equal(firstRow.metadata.source_scheduled_for, firstSlot);
  assert.equal(changedRow.scheduled_for, changedChannelSlot);
  assert.equal(changedRow.metadata.source_scheduled_for, changedChannelSlot);
});

test('upsertAdditionalPlatformPublicationTargets is a no-op when no target is enabled', async () => {
  const results = await upsertAdditionalPlatformPublicationTargets({
    store: {},
    sourcePublication,
    videoRow,
    sourceChannelProfile: {
      ...sourceChannelProfile,
      metadata: {
        publisher: {
          targets: [],
        },
      },
    },
    scheduledFor: '2026-09-08T10:00:00.000Z',
  });

  assert.deepEqual(results, []);
});

test('upsertAdditionalPlatformPublicationTargets stores enabled additional target rows', async () => {
  const upsertedRows = [];
  const results = await upsertAdditionalPlatformPublicationTargets({
    store: {
      async upsertPublication(row) {
        upsertedRows.push(row);
        return row;
      },
    },
    sourcePublication,
    videoRow,
    sourceChannelProfile,
    scheduledFor: '2026-09-08T10:00:00.000Z',
    projectRoot: '/workspace',
    statImpl: async () => ({ size: 4000 }),
    hashFileImpl: async () => 'a'.repeat(64),
    approval: {
      approvedAt: '2026-09-07T12:00:00.000Z',
      approvedBy: 'Lachkid',
      approvedById: 'operator-1',
      reviewTaskId: 'TASK-REVIEW',
      tiktokDirectPost: {
        accountKey: 'poke-quizz-tiktok',
        creatorUsername: 'pokequizz7',
        caption: 'Guess the Pokemon!\n\n#pokemon #shorts',
        privacyLevel: 'SELF_ONLY',
        allowComment: false,
        allowDuet: false,
        allowStitch: false,
        brandContentToggle: false,
        brandOrganicToggle: false,
        isAigc: true,
        videoCoverTimestampMs: 1000,
      },
    },
  });

  assert.equal(upsertedRows.length, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].platform, TIKTOK_VIDEO_PLATFORM);
  assert.equal(results[0].workflow_state, 'scheduled');
  assert.equal(upsertedRows[0].metadata.tiktok_direct_post_approval.approved, true);
  assert.equal(
    upsertedRows[0].metadata.tiktok_direct_post_approval.delivery_provider,
    'tiktok_direct',
  );
  assert.equal(upsertedRows[0].metadata.tiktok_direct_post_approval.creator_username, 'pokequizz7');
  assert.equal(upsertedRows[0].metadata.tiktok_direct_post_approval.allow_comment, false);
  assert.equal(upsertedRows[0].metadata.tiktok_direct_post_approval.video_sha256, 'a'.repeat(64));
});

test('shared approval binds a Buffer delivery to its exact organization and channel', async () => {
  const profile = structuredClone(sourceChannelProfile);
  profile.metadata.publisher.targets[1] = {
    platform: 'tiktok_video',
    account_key: 'poke-quizz-tiktok',
    enabled: true,
    delivery_provider: 'buffer',
    buffer: {
      organization_id: 'organization-1',
      channel_id: 'channel-1',
      expected_service: 'tiktok',
      expected_username: 'pokequizz7',
    },
  };
  let storedRow;

  await upsertAdditionalPlatformPublicationTargets({
    store: {
      async upsertPublication(row) {
        storedRow = row;
        return row;
      },
    },
    sourcePublication,
    videoRow,
    sourceChannelProfile: profile,
    scheduledFor: '2026-09-08T10:00:00.000Z',
    projectRoot: '/workspace',
    statImpl: async () => ({ size: 4000 }),
    hashFileImpl: async () => 'a'.repeat(64),
    approval: {
      approvedAt: '2026-09-07T12:00:00.000Z',
      approvedBy: 'Lachkid',
      reviewTaskId: 'TASK-REVIEW',
      tiktokDirectPost: {
        accountKey: 'poke-quizz-tiktok',
        creatorUsername: 'pokequizz7',
        caption: 'Guess the Pokemon!',
        privacyLevel: 'PUBLIC',
        isAigc: false,
      },
    },
  });

  const approval = storedRow.metadata.tiktok_direct_post_approval;
  assert.equal(approval.delivery_provider, 'buffer');
  assert.equal(approval.buffer_organization_id, 'organization-1');
  assert.equal(approval.buffer_channel_id, 'channel-1');
});

test('shared approval binds an Instagram delivery to the exact account and MP4', async () => {
  const profile = structuredClone(sourceChannelProfile);
  profile.metadata.publisher.targets = [{
    platform: 'instagram_reel',
    account_key: 'poke-quizz-instagram',
    enabled: true,
    schedule_mode: 'orion',
    instagram: {
      user_id: 'ig-user-1',
      expected_username: 'pokequizz',
      access_token_env: 'INSTAGRAM_POKE_QUIZZ_ACCESS_TOKEN',
      share_to_feed: true,
    },
  }];
  let storedRow;

  await upsertAdditionalPlatformPublicationTargets({
    store: {
      async upsertPublication(row) {
        storedRow = row;
        return row;
      },
    },
    sourcePublication,
    videoRow,
    sourceChannelProfile: profile,
    scheduledFor: '2026-09-08T10:00:00.000Z',
    projectRoot: '/workspace',
    statImpl: async () => ({ size: 4000 }),
    hashFileImpl: async () => 'b'.repeat(64),
    approval: {
      approvedAt: '2026-09-07T12:00:00.000Z',
      approvedBy: 'Lachkid',
      approvedById: 'operator-1',
      reviewTaskId: 'TASK-REVIEW',
      instagramReels: [{
        accountKey: 'poke-quizz-instagram',
        instagramUserId: 'ig-user-1',
        creatorUsername: 'pokequizz',
        caption: 'Guess the Pokemon! #pokemon',
        shareToFeed: true,
      }],
    },
  });

  const approval = storedRow.metadata.instagram_reel_approval;
  assert.equal(approval.approved, true);
  assert.equal(approval.instagram_user_id, 'ig-user-1');
  assert.equal(approval.creator_username, 'pokequizz');
  assert.equal(approval.video_sha256, 'b'.repeat(64));
  assert.equal(approval.share_to_feed, true);
});

test('upsertAdditionalPlatformPublicationTargets preserves an existing delivery row', async () => {
  const [existing] = buildAdditionalPlatformPublicationRows({
    sourcePublication,
    videoRow,
    sourceChannelProfile,
    scheduledFor: '2026-09-08T10:00:00.000Z',
  });
  existing.status = 'publishing';
  existing.external_id = 'publish-123';
  existing.metadata.workflow_state = 'publishing';
  let upsertCalls = 0;

  const results = await upsertAdditionalPlatformPublicationTargets({
    store: {
      async fetchPublicationById() {
        return existing;
      },
      async upsertPublication() {
        upsertCalls += 1;
      },
    },
    sourcePublication,
    videoRow,
    sourceChannelProfile,
    scheduledFor: '2026-09-09T10:00:00.000Z',
  });

  assert.equal(upsertCalls, 0);
  assert.equal(results[0].preserved, true);
  assert.equal(results[0].workflow_state, 'publishing');
});

test('lifecycle reconciliation copies a changed source schedule to a pending child', async () => {
  const [child] = buildAdditionalPlatformPublicationRows({
    sourcePublication,
    videoRow,
    sourceChannelProfile,
    scheduledFor: '2026-09-08T10:00:00.000Z',
  });
  const source = {
    ...sourcePublication,
    status: 'scheduled',
    scheduled_for: '2026-09-09T14:30:00.000Z',
    metadata: { ...sourcePublication.metadata, workflow_state: 'scheduled' },
  };
  let storedPatch = null;
  const reconciliation = await reconcileAdditionalPlatformPublicationLifecycles({
    store: {
      async fetchPublicationById() { return source; },
      async updatePublication(_id, patch) {
        storedPatch = patch;
        return { ...child, ...patch };
      },
    },
    publications: [child],
    asOf: '2026-09-08T12:00:00.000Z',
  });

  assert.equal(storedPatch.scheduled_for, source.scheduled_for);
  assert.equal(storedPatch.metadata.source_lifecycle_reason, 'source_schedule_changed');
  assert.equal(reconciliation.publications[0].scheduled_for, source.scheduled_for);
  assert.equal(reconciliation.results[0].action, 'source_schedule_synchronized');
});

test('lifecycle reconciliation withdraws an unstarted child when its source is revised', async () => {
  const [child] = buildAdditionalPlatformPublicationRows({
    sourcePublication,
    videoRow,
    sourceChannelProfile,
    scheduledFor: '2026-09-08T10:00:00.000Z',
  });
  const source = {
    ...sourcePublication,
    status: 'deleted',
    scheduled_for: null,
    metadata: { ...sourcePublication.metadata, workflow_state: 'revision_requested' },
  };
  let storedPatch = null;
  const reconciliation = await reconcileAdditionalPlatformPublicationLifecycles({
    store: {
      async fetchPublicationById() { return source; },
      async updatePublication(_id, patch) {
        storedPatch = patch;
        return { ...child, ...patch };
      },
    },
    publications: [child],
    asOf: '2026-09-08T12:00:00.000Z',
  });

  assert.equal(storedPatch.status, 'withdrawn');
  assert.equal(storedPatch.scheduled_for, null);
  assert.equal(storedPatch.metadata.source_workflow_state, 'revision_requested');
  assert.equal(reconciliation.results[0].action, 'source_lifecycle_withdrawn');
});

test('lifecycle reconciliation requests manual action after platform delivery started', async () => {
  const [child] = buildAdditionalPlatformPublicationRows({
    sourcePublication,
    videoRow,
    sourceChannelProfile,
    scheduledFor: '2026-09-08T10:00:00.000Z',
  });
  child.status = 'publishing';
  child.external_id = 'publish-123';
  child.metadata.workflow_state = 'publishing';
  const source = {
    ...sourcePublication,
    status: 'deleted',
    metadata: { ...sourcePublication.metadata, workflow_state: 'deleted' },
  };
  let storedPatch = null;
  const reconciliation = await reconcileAdditionalPlatformPublicationLifecycles({
    store: {
      async fetchPublicationById() { return source; },
      async updatePublication(_id, patch) {
        storedPatch = patch;
        return { ...child, metadata: patch.metadata };
      },
    },
    publications: [child],
    asOf: '2026-09-08T12:00:00.000Z',
  });

  assert.equal(storedPatch.status, undefined);
  assert.equal(storedPatch.metadata.source_lifecycle_action_required, true);
  assert.equal(storedPatch.metadata.source_lifecycle_alert_status, 'pending');
  assert.equal(storedPatch.metadata.source_lifecycle_alert_requested_at, '2026-09-08T12:00:00.000Z');
  assert.equal(reconciliation.results[0].action, 'source_lifecycle_manual_action_required');
});

test('lifecycle reconciliation leaves an already withdrawn unstarted child unchanged', async () => {
  const [child] = buildAdditionalPlatformPublicationRows({
    sourcePublication,
    videoRow,
    sourceChannelProfile,
    scheduledFor: '2026-09-08T10:00:00.000Z',
  });
  child.status = 'withdrawn';
  child.scheduled_for = null;
  child.metadata.workflow_state = 'withdrawn';
  const source = {
    ...sourcePublication,
    status: 'deleted',
    scheduled_for: null,
    metadata: { ...sourcePublication.metadata, workflow_state: 'revision_requested' },
  };
  let updateCalls = 0;
  const reconciliation = await reconcileAdditionalPlatformPublicationLifecycles({
    store: {
      async fetchPublicationById() { return source; },
      async updatePublication() {
        updateCalls += 1;
        return child;
      },
    },
    publications: [child],
    asOf: '2026-09-08T12:05:00.000Z',
  });

  assert.equal(updateCalls, 0);
  assert.deepEqual(reconciliation.results, []);
  assert.equal(reconciliation.publications[0].status, 'withdrawn');
});

test('lifecycle reconciliation does not reopen a resolved post-start action', async () => {
  const [child] = buildAdditionalPlatformPublicationRows({
    sourcePublication,
    videoRow,
    sourceChannelProfile,
    scheduledFor: '2026-09-08T10:00:00.000Z',
  });
  child.status = 'published';
  child.external_id = 'publish-123';
  child.metadata = {
    ...child.metadata,
    workflow_state: 'published',
    source_lifecycle_action_required: false,
    source_lifecycle_resolution: 'made_private',
    source_lifecycle_resolved_at: '2026-09-08T12:03:00.000Z',
  };
  const source = {
    ...sourcePublication,
    status: 'deleted',
    metadata: { ...sourcePublication.metadata, workflow_state: 'deleted' },
  };
  let updateCalls = 0;
  const reconciliation = await reconcileAdditionalPlatformPublicationLifecycles({
    store: {
      async fetchPublicationById() { return source; },
      async updatePublication() {
        updateCalls += 1;
        return child;
      },
    },
    publications: [child],
    asOf: '2026-09-08T12:05:00.000Z',
  });

  assert.equal(updateCalls, 0);
  assert.deepEqual(reconciliation.results, []);
});
