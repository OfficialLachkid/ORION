import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadQueuedPublications,
  loadRuntimePublications,
  runVideoPublicationScheduler,
} from '../scripts/run-video-publication-scheduler.mjs';
import { normalizePublicationChannelProfile } from '../src/publication-channels.mjs';

const activeChannelProfile = normalizePublicationChannelProfile({
  id: 'video-channel-poke-quizz-youtube',
  name: 'Poke Quizz',
  niche: 'pokemon_quiz',
  content_lane: 'poke-quizz',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  timezone: 'Europe/Amsterdam',
  schedule_slots: [
    { hour: 8, minute: 0 },
    { hour: 12, minute: 0 },
    { hour: 14, minute: 0 },
  ],
  workflow: {
    preview_visibility: 'unlisted',
    publish_visibility: 'public',
    require_preview_approval: true,
    require_publish_approval: true,
    delete_preview_on_reject: true,
  },
  youtube: {
    channel_id: 'UC-POKE-QUIZZ',
    default_category_id: '24',
    oauth_client_secret_path: 'config/youtube/client-secret.json',
    oauth_refresh_token_env: 'YOUTUBE_POKE_QUIZZ_REFRESH_TOKEN',
  },
});

const pausedChannelProfile = {
  ...activeChannelProfile,
  id: 'video-channel-paused-youtube',
  account_key: 'paused-youtube',
  name: 'Paused Channel',
  status: 'paused',
};

const secondActiveChannelProfile = normalizePublicationChannelProfile({
  ...activeChannelProfile,
  id: 'video-channel-dexguess-youtube',
  name: 'DexGuess',
  account_key: 'dexguess-youtube',
  youtube: {
    ...activeChannelProfile.youtube,
    channel_id: 'UC-DEXGUESS',
    oauth_refresh_token_env: 'YOUTUBE_DEXGUESS_REFRESH_TOKEN',
  },
});

const previewPending = {
  id: 'pub-preview',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  status: 'approved',
  title: 'Preview Pending',
  metadata: {
    workflow_state: 'preview_upload_pending',
  },
  created_at: '2026-07-31T08:00:00.000Z',
};

const previewApproved = {
  id: 'pub-approved',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  status: 'approved',
  title: 'Preview Approved',
  external_id: 'yt-123',
  metadata: {
    workflow_state: 'preview_approved',
  },
  created_at: '2026-07-31T08:10:00.000Z',
};

test('loadQueuedPublications excludes terminal rows and only selects queue fields', async () => {
  let requestedUrl = '';
  const rows = await loadQueuedPublications({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SECRET_KEY: 'service-key',
  }, {
    fetchJson: async (url) => {
      requestedUrl = String(url);
      return [];
    },
  });

  const url = new URL(requestedUrl);
  assert.deepEqual(rows, []);
  assert.equal(url.searchParams.get('status'), 'not.in.(published,withdrawn,deleted,failed,blocked)');
  assert.match(url.searchParams.get('select'), /workflow_state:metadata->>workflow_state/u);
  assert.match(url.searchParams.get('select'), /description/u);
  assert.equal(url.searchParams.get('select').includes('*'), false);
});

test('loadRuntimePublications uses compact metadata aliases and preserves reconciliation states', async () => {
  const requestedUrls = [];
  const rows = await loadRuntimePublications({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SECRET_KEY: 'service-key',
  }, {
    channelProfiles: [activeChannelProfile, secondActiveChannelProfile],
    cachePath: '',
    fetchJson: async (url) => {
      requestedUrls.push(String(url));
      return [];
    },
  });

  assert.deepEqual(rows, []);
  assert.equal(requestedUrls.length, 2);
  const urls = requestedUrls.map((url) => new URL(url));
  const activeUrl = urls.find((url) => url.searchParams.get('status')?.startsWith('not.in.'));
  const reconciliationUrl = urls.find((url) => url.searchParams.get('status')?.startsWith('in.'));
  assert.equal(activeUrl.searchParams.get('status'), 'not.in.(published,withdrawn,deleted,failed,blocked)');
  assert.equal(reconciliationUrl.searchParams.get('status'), 'in.(published,withdrawn)');
  assert.equal(activeUrl.searchParams.get('platform'), 'in.(youtube_shorts)');
  assert.equal(
    activeUrl.searchParams.get('account_key'),
    'in.(poke-quizz-youtube,dexguess-youtube)',
  );
  assert.equal(activeUrl.searchParams.get('limit'), '1000');
  assert.equal(activeUrl.searchParams.get('offset'), '0');
  assert.match(activeUrl.searchParams.get('select'), /workflow_state:metadata->>workflow_state/u);
  assert.match(
    reconciliationUrl.searchParams.get('select'),
    /youtube_auto_comment_status:metadata->youtube_auto_comment->>status/u,
  );
  assert.equal(activeUrl.searchParams.get('select').includes('metadata,'), false);
});

test('loadRuntimePublications paginates beyond the Supabase response cap', async () => {
  const requestedOffsets = [];
  const rows = await loadRuntimePublications({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SECRET_KEY: 'service-key',
  }, {
    channelProfiles: [activeChannelProfile],
    cachePath: '',
    fetchJson: async (url) => {
      const parsedUrl = new URL(url);
      const offset = Number(parsedUrl.searchParams.get('offset'));
      const status = parsedUrl.searchParams.get('status');
      requestedOffsets.push(`${status}:${offset}`);
      if (status === 'in.(published,withdrawn)') return [];
      return offset === 0
        ? Array.from({ length: 1000 }, (_, index) => ({ id: `pub-${index}` }))
        : [{ id: 'pub-1000' }];
    },
  });

  assert.deepEqual(requestedOffsets, [
    'not.in.(published,withdrawn,deleted,failed,blocked):0',
    'in.(published,withdrawn):0',
    'not.in.(published,withdrawn,deleted,failed,blocked):1000',
  ]);
  assert.equal(rows.length, 1001);
});

test('loadRuntimePublications incrementally refreshes its rebuildable historical cache', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orion-runtime-cache-test-'));
  const cachePath = join(directory, 'publication-runtime-cache.json');
  const requests = [];
  let pass = 1;
  const fetchJson = async (url) => {
    const parsedUrl = new URL(url);
    const status = parsedUrl.searchParams.get('status') || '';
    const updatedAfter = parsedUrl.searchParams.get('updated_at') || '';
    requests.push({ pass, status, updatedAfter });
    if (status.startsWith('not.in.')) {
      return [{ id: 'active-1', status: 'approved', updated_at: '2026-10-29T09:00:00.000Z' }];
    }
    if (pass === 1) {
      return [{ id: 'historical-1', status: 'published', updated_at: '2026-10-29T08:00:00.000Z' }];
    }
    return [{ id: 'historical-1', status: 'withdrawn', updated_at: '2026-10-29T09:55:00.000Z' }];
  };

  try {
    const first = await loadRuntimePublications({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SECRET_KEY: 'service-key',
    }, {
      channelProfiles: [activeChannelProfile],
      cachePath,
      asOf: '2026-10-29T09:00:00.000Z',
      fetchJson,
    });
    pass = 2;
    const second = await loadRuntimePublications({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SECRET_KEY: 'service-key',
    }, {
      channelProfiles: [activeChannelProfile],
      cachePath,
      asOf: '2026-10-29T10:00:00.000Z',
      fetchJson,
    });

    assert.deepEqual(first.map((row) => row.status).sort(), ['approved', 'published']);
    assert.deepEqual(second.map((row) => row.status).sort(), ['approved', 'withdrawn']);
    const incrementalRequest = requests.find((request) => request.pass === 2 && !request.status);
    assert.equal(incrementalRequest.updatedAfter, 'gte.2026-10-29T08:55:00.000Z');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('runVideoPublicationScheduler executes preview uploads and schedule updates for active channels', async () => {
  const executionCalls = [];
  const socialExecutionCalls = [];
  const result = await runVideoPublicationScheduler({
    channels: 'services/product-video-agent/publication-channels.example.json',
    'as-of': '2026-08-01T10:01:00.000Z',
  }, {
    runtimeConfig: { env: {} },
    loadPublicationChannelProfiles: async () => [activeChannelProfile, pausedChannelProfile],
    loadQueuedPublications: async () => [previewPending, previewApproved],
    executePublicationPhase: async ({ channelSelector, scheduleApproved }) => {
      executionCalls.push({ channelSelector, scheduleApproved });
      return scheduleApproved
        ? [{ publication_id: 'pub-approved', action: 'schedule_update' }]
        : [{ publication_id: 'pub-preview', action: 'preview_upload' }];
    },
    executeSocialPublicationPhase: async ({ asOf }) => {
      socialExecutionCalls.push({ asOf });
      return [{ publication_id: 'pub-tiktok', action: 'tiktok_publish_due' }];
    },
  });

  assert.deepEqual(executionCalls, [
    { channelSelector: 'poke-quizz-youtube', scheduleApproved: true },
    { channelSelector: 'poke-quizz-youtube', scheduleApproved: false },
  ]);
  assert.equal(result.queue_plan.channels.length, 1);
  assert.equal(result.execution_results.length, 1);
  assert.deepEqual(result.execution_results[0].preview_upload_results, [
    { publication_id: 'pub-preview', action: 'preview_upload' },
  ]);
  assert.deepEqual(result.execution_results[0].schedule_update_results, [
    { publication_id: 'pub-approved', action: 'schedule_update' },
  ]);
  assert.deepEqual(socialExecutionCalls, [
    { asOf: '2026-08-01T10:01:00.000Z' },
  ]);
  assert.deepEqual(result.social_publication_results, [
    { publication_id: 'pub-tiktok', action: 'tiktok_publish_due' },
  ]);
});

test('runVideoPublicationScheduler reuses one publication snapshot and always cleans it up', async () => {
  const snapshotPaths = [];
  let cleanupCount = 0;
  await runVideoPublicationScheduler({
    channels: 'services/product-video-agent/publication-channels.example.json',
    'as-of': '2026-08-01T10:01:00.000Z',
  }, {
    runtimeConfig: { env: {} },
    loadPublicationChannelProfiles: async () => [activeChannelProfile],
    loadQueuedPublications: async () => [previewPending, previewApproved],
    createPublicationSnapshot: async () => ({
      path: '/tmp/orion-publications-test/snapshot.json',
      cleanup: async () => {
        cleanupCount += 1;
      },
    }),
    executePublicationPhase: async ({ publicationSnapshotPath }) => {
      snapshotPaths.push(publicationSnapshotPath);
      return [];
    },
    executeSocialPublicationPhase: async () => [],
  });

  assert.deepEqual(snapshotPaths, [
    '/tmp/orion-publications-test/snapshot.json',
    '/tmp/orion-publications-test/snapshot.json',
  ]);
  assert.equal(cleanupCount, 1);
});

test('runVideoPublicationScheduler skips execution in plan-only mode', async () => {
  let executionCallCount = 0;
  let socialExecutionCallCount = 0;
  const result = await runVideoPublicationScheduler({
    channels: 'services/product-video-agent/publication-channels.example.json',
    'as-of': '2026-08-01T10:01:00.000Z',
    'plan-only': true,
  }, {
    runtimeConfig: { env: {} },
    loadPublicationChannelProfiles: async () => [activeChannelProfile],
    loadQueuedPublications: async () => [previewPending, previewApproved],
    executePublicationPhase: async () => {
      executionCallCount += 1;
      return [];
    },
    executeSocialPublicationPhase: async () => {
      socialExecutionCallCount += 1;
      return [];
    },
  });

  assert.equal(executionCallCount, 0);
  assert.equal(socialExecutionCallCount, 0);
  assert.deepEqual(result.execution_results, []);
  assert.deepEqual(result.social_publication_results, []);
  assert.equal(result.queue_plan.channels[0].scheduled_publish_queue.length, 1);
});

test('runVideoPublicationScheduler isolates each channel and phase while reconciling all channels first', async () => {
  const executionCalls = [];
  const result = await runVideoPublicationScheduler({
    channels: 'services/product-video-agent/publication-channels.example.json',
    'as-of': '2026-08-01T10:01:00.000Z',
  }, {
    runtimeConfig: { env: {} },
    loadPublicationChannelProfiles: async () => [activeChannelProfile, secondActiveChannelProfile],
    loadQueuedPublications: async () => [previewPending, previewApproved],
    executePublicationPhase: async ({ channelSelector, scheduleApproved, reconcileOnly }) => {
      executionCalls.push({ channelSelector, scheduleApproved, reconcileOnly });
      if (channelSelector === 'poke-quizz-youtube' && scheduleApproved) {
        throw new Error('schedule failed');
      }
      if (channelSelector === 'dexguess-youtube' && !scheduleApproved) {
        throw new Error('preview failed');
      }
      return [{ channelSelector, scheduleApproved }];
    },
    executeSocialPublicationPhase: async () => [],
  });

  assert.deepEqual(executionCalls, [
    { channelSelector: 'poke-quizz-youtube', scheduleApproved: true, reconcileOnly: false },
    { channelSelector: 'dexguess-youtube', scheduleApproved: true, reconcileOnly: false },
    { channelSelector: 'poke-quizz-youtube', scheduleApproved: false, reconcileOnly: false },
    { channelSelector: 'dexguess-youtube', scheduleApproved: false, reconcileOnly: false },
  ]);
  assert.equal(result.execution_results[0].schedule_update_error, 'schedule failed');
  assert.equal(result.execution_results[0].preview_upload_results.length, 1);
  assert.equal(result.execution_results[1].schedule_update_results.length, 1);
  assert.equal(result.execution_results[1].preview_upload_error, 'preview failed');
  assert.deepEqual(result.execution_errors.map(({ channel, phase }) => ({ channel, phase })), [
    { channel: 'poke-quizz-youtube', phase: 'schedule_reconciliation' },
    { channel: 'dexguess-youtube', phase: 'preview_upload' },
  ]);
});

test('runVideoPublicationScheduler reconciliation-only mode skips previews and reconciles social delivery', async () => {
  const executionCalls = [];
  let socialExecutionCallCount = 0;
  const result = await runVideoPublicationScheduler({
    channels: 'services/product-video-agent/publication-channels.example.json',
    'as-of': '2026-08-01T10:05:00.000Z',
    'reconcile-only': true,
  }, {
    runtimeConfig: { env: {} },
    loadPublicationChannelProfiles: async () => [activeChannelProfile],
    loadQueuedPublications: async () => [previewPending, previewApproved],
    executePublicationPhase: async (phase) => {
      executionCalls.push(phase);
      return [{ action: 'reconcile_published' }];
    },
    executeSocialPublicationPhase: async ({ asOf }) => {
      socialExecutionCallCount += 1;
      return [{ action: 'instagram_published', asOf }];
    },
  });

  assert.equal(executionCalls.length, 1);
  assert.equal(executionCalls[0].scheduleApproved, false);
  assert.equal(executionCalls[0].reconcileOnly, true);
  assert.deepEqual(result.execution_results[0].preview_upload_results, []);
  assert.deepEqual(result.execution_results[0].schedule_update_results, [
    { action: 'reconcile_published' },
  ]);
  assert.equal(socialExecutionCallCount, 1);
  assert.deepEqual(result.social_publication_results, [{
    action: 'instagram_published',
    asOf: '2026-08-01T10:05:00.000Z',
  }]);
  assert.deepEqual(result.execution_errors, []);
});

test('runVideoPublicationScheduler reports social failures without discarding YouTube results', async () => {
  const result = await runVideoPublicationScheduler({
    channels: 'services/product-video-agent/publication-channels.example.json',
    'as-of': '2026-08-01T10:05:00.000Z',
  }, {
    runtimeConfig: { env: {} },
    loadPublicationChannelProfiles: async () => [activeChannelProfile],
    loadQueuedPublications: async () => [previewPending, previewApproved],
    executePublicationPhase: async () => [],
    executeSocialPublicationPhase: async () => {
      throw new Error('TikTok is unavailable');
    },
  });

  assert.equal(result.execution_results.length, 1);
  assert.deepEqual(result.social_publication_results, []);
  assert.deepEqual(result.execution_errors, [{
    channel: 'social',
    phase: 'social_publication',
    error: 'TikTok is unavailable',
  }]);
});
