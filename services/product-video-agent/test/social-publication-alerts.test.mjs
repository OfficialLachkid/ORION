import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSocialPublicationLifecycleAlertPayload,
  deliverSocialPublicationLifecycleAlerts,
  resolveSocialPublicationLifecycleAction,
} from '../src/social-publication-alerts.mjs';

function buildPublication(overrides = {}) {
  return {
    id: 'publication-target-tiktok',
    video_id: 'video-1',
    platform: 'tiktok_video',
    account_key: 'poke-quizz-tiktok',
    status: 'publishing',
    external_id: 'publish-123',
    public_url: 'https://www.tiktok.com/@pokequizz7/video/7420000000000000001',
    metadata: {
      workflow_state: 'publishing',
      source_publication_id: 'publication-source-youtube',
      source_workflow_state: 'deleted',
      source_review_thread_id: 'review-thread-1',
      source_lifecycle_action_required: true,
      source_lifecycle_reason: 'source_deleted_after_delivery_started',
      source_lifecycle_alert_status: 'pending',
      publisher_target: {
        tiktok: { expected_username: 'pokequizz7' },
      },
    },
    ...overrides,
  };
}

function createStore(initialPublication) {
  let current = structuredClone(initialPublication);
  const updates = [];
  return {
    updates,
    current() { return structuredClone(current); },
    async fetchPublicationById(id) {
      return id === current.id ? structuredClone(current) : null;
    },
    async updatePublication(id, patch) {
      assert.equal(id, current.id);
      current = {
        ...current,
        ...patch,
        metadata: patch.metadata || current.metadata,
      };
      updates.push(structuredClone(patch));
      return structuredClone(current);
    },
  };
}

test('lifecycle alert payload identifies the remote post and required manual action', () => {
  const payload = buildSocialPublicationLifecycleAlertPayload(buildPublication());
  const embed = payload.embeds[0];

  assert.equal(embed.title, 'TikTok manual removal check required');
  assert.match(embed.description, /cannot safely claim that the remote post was removed/u);
  assert.equal(embed.color, 0xED4245);
  assert.equal(embed.fields.find((field) => field.name === 'Account').value, '@pokequizz7');
  assert.match(embed.fields.find((field) => field.name === 'Post').value, /tiktok\.com/u);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
});

test('lifecycle alert delivery posts once and persists Discord audit fields', async () => {
  const publication = buildPublication();
  const store = createStore(publication);
  const sent = [];
  const first = await deliverSocialPublicationLifecycleAlerts({
    store,
    publications: [publication],
    runtimeConfig: { env: { DISCORD_BOT_TOKEN: 'token' } },
    asOf: '2026-10-08T08:00:00.000Z',
    sendDiscordMessage: async (_config, channelId, payload) => {
      sent.push({ channelId, payload });
      return { posted: true, channelId, messageId: 'alert-message-1' };
    },
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].channelId, 'review-thread-1');
  assert.equal(store.current().metadata.source_lifecycle_alert_status, 'sent');
  assert.equal(store.current().metadata.source_lifecycle_alert_message_id, 'alert-message-1');
  assert.equal(first.results[0].action, 'source_lifecycle_alert_sent');

  let repeatedSends = 0;
  const second = await deliverSocialPublicationLifecycleAlerts({
    store,
    publications: first.publications,
    runtimeConfig: { env: { DISCORD_BOT_TOKEN: 'token' } },
    asOf: '2026-10-08T12:00:00.000Z',
    sendDiscordMessage: async () => {
      repeatedSends += 1;
      return { posted: true };
    },
  });
  assert.equal(repeatedSends, 0);
  assert.deepEqual(second.results, []);
});

test('failed lifecycle alert remains pending for a later retry', async () => {
  const publication = buildPublication();
  const store = createStore(publication);
  const delivery = await deliverSocialPublicationLifecycleAlerts({
    store,
    publications: [publication],
    runtimeConfig: { env: {} },
    asOf: '2026-10-08T08:00:00.000Z',
    sendDiscordMessage: async () => ({ posted: false, reason: 'no_token' }),
  });

  assert.equal(store.current().metadata.source_lifecycle_alert_status, 'pending');
  assert.equal(store.current().metadata.source_lifecycle_alert_error, 'no_token');
  assert.equal(delivery.results[0].action, 'source_lifecycle_alert_pending');
  assert.equal(delivery.publications[0].metadata.source_lifecycle_action_required, true);
});

test('dry-run reports a lifecycle alert without posting or mutating storage', async () => {
  const publication = buildPublication();
  const store = createStore(publication);
  let sendCalls = 0;
  const delivery = await deliverSocialPublicationLifecycleAlerts({
    store,
    publications: [publication],
    runtimeConfig: { env: {} },
    dryRun: true,
    sendDiscordMessage: async () => {
      sendCalls += 1;
      return { posted: true };
    },
  });

  assert.equal(sendCalls, 0);
  assert.equal(store.updates.length, 0);
  assert.equal(delivery.results[0].action, 'source_lifecycle_alert_due');
});

test('manual lifecycle resolution clears the action and records the outcome', async () => {
  const store = createStore(buildPublication({ status: 'published' }));
  const result = await resolveSocialPublicationLifecycleAction({
    store,
    publicationId: 'publication-target-tiktok',
    resolution: 'made_private',
    note: 'Confirmed in TikTok app.',
    resolvedBy: 'Valentijn',
    asOf: '2026-10-08T09:00:00.000Z',
  });

  assert.equal(result.action, 'source_lifecycle_manual_action_resolved');
  assert.equal(result.resolution, 'made_private');
  assert.equal(store.current().metadata.source_lifecycle_action_required, false);
  assert.equal(store.current().metadata.source_lifecycle_alert_status, 'resolved');
  assert.equal(store.current().metadata.source_lifecycle_resolution_note, 'Confirmed in TikTok app.');
  assert.equal(store.current().metadata.source_lifecycle_resolved_by, 'Valentijn');
});

test('manual lifecycle resolution rejects unsupported outcomes', async () => {
  const store = createStore(buildPublication());
  await assert.rejects(
    resolveSocialPublicationLifecycleAction({
      store,
      publicationId: 'publication-target-tiktok',
      resolution: 'probably_deleted',
    }),
    /must be one of/u,
  );
});
