import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePublicationChannelProfile } from '../../../services/product-video-agent/src/publication-channels.mjs';
import {
  planNightShiftAutoPublicationAutomation,
  runVideoQueueMaintenance,
} from './pokemon-maintenance.mjs';

const channelProfile = normalizePublicationChannelProfile({
  id: 'video-channel-dexguess-youtube',
  name: 'DexGuess',
  niche: 'pokemon_quiz',
  content_lane: 'poke-quizz',
  platform: 'youtube_shorts',
  account_key: 'dexguess-youtube',
  timezone: 'UTC',
  schedule_slots: [
    { hour: 8, minute: 0 },
  ],
  workflow: {
    preview_visibility: 'unlisted',
    publish_visibility: 'public',
    require_preview_approval: true,
    require_publish_approval: true,
    delete_preview_on_reject: true,
  },
  youtube: {
    channel_id: 'UC-DEXGUESS',
    default_category_id: '24',
    oauth_client_secret_path: 'config/youtube/client-secret.json',
    oauth_refresh_token_env: 'YOUTUBE_DEXGUESS_REFRESH_TOKEN',
  },
});

const committedScheduled = {
  id: 'pub-scheduled-live',
  platform: 'youtube_shorts',
  account_key: 'dexguess-youtube',
  status: 'scheduled',
  external_id: 'yt-scheduled-live',
  scheduled_for: '2026-08-13T08:00:00.000Z',
  metadata: {
    workflow_state: 'scheduled',
  },
  created_at: '2026-08-10T08:00:00.000Z',
};

const previewApproved = {
  id: 'pub-preview-approved',
  platform: 'youtube_shorts',
  account_key: 'dexguess-youtube',
  status: 'approved',
  external_id: 'yt-preview-approved',
  metadata: {
    workflow_state: 'preview_approved',
  },
  created_at: '2026-08-12T08:00:00.000Z',
};

const previewUploadedOldest = {
  id: 'pub-preview-uploaded-oldest',
  platform: 'youtube_shorts',
  account_key: 'dexguess-youtube',
  status: 'approved',
  external_id: 'yt-preview-uploaded-oldest',
  preview_url: 'https://youtube.com/shorts/oldest',
  metadata: {
    workflow_state: 'preview_uploaded',
  },
  created_at: '2026-08-09T08:00:00.000Z',
};

const previewUploadedNewest = {
  id: 'pub-preview-uploaded-newest',
  platform: 'youtube_shorts',
  account_key: 'dexguess-youtube',
  status: 'approved',
  external_id: 'yt-preview-uploaded-newest',
  preview_url: 'https://youtube.com/shorts/newest',
  metadata: {
    workflow_state: 'preview_uploaded',
  },
  created_at: '2026-08-11T08:00:00.000Z',
};

test('auto publication planning selects only the oldest preview uploads needed to fill the 3-day horizon', () => {
  const plan = planNightShiftAutoPublicationAutomation({
    publications: [
      committedScheduled,
      previewApproved,
      previewUploadedOldest,
      previewUploadedNewest,
    ],
    channelProfile,
    asOf: '2026-08-13T06:00:00.000Z',
    maxScheduledDays: 3,
  });

  assert.deepEqual(plan.availableSlots, [
    '2026-08-13T08:00:00.000Z',
    '2026-08-14T08:00:00.000Z',
    '2026-08-15T08:00:00.000Z',
  ]);
  assert.equal(plan.scheduledQueue.length, 2);
  assert.equal(plan.headroom, 1);
  assert.deepEqual(
    plan.approvalCandidates.map((publication) => publication.id),
    ['pub-preview-uploaded-oldest'],
  );
});

test('night shift queue maintenance auto-approves DexGuess previews within the configured horizon only', async () => {
  const runProjectNodeScriptCalls = [];
  const autoPublishCalls = [];
  const runtime = {
    channelSelector: 'dexguess-youtube',
    nightShift: {
      publicationAutomationEnabled: true,
      publicationAutomationMode: 'auto',
      publicationAutomationMaxScheduledDays: 3,
    },
  };
  const publicationStore = {
    async fetchPublicationsByChannel() {
      return [
        committedScheduled,
        previewApproved,
        previewUploadedOldest,
        previewUploadedNewest,
      ];
    },
  };

  const summary = await runVideoQueueMaintenance(
    '2026-08-13T06:00:00.000Z',
    {
      runtimeConfig: { env: {} },
      loadPublicationChannelProfiles: async () => [channelProfile],
      discoverNightShiftChannelRuntimes: async () => [runtime],
      runProjectNodeScript: (scriptPath, args) => {
        runProjectNodeScriptCalls.push({ scriptPath, args });
        return {
          status: 0,
          stdout: '[]',
          stderr: '',
        };
      },
      publicationStore,
      executeProductVideoAction: async (action, task) => {
        autoPublishCalls.push({ action, task });
        return {
          report: {
            workflowState: 'scheduled',
            scheduledFor: '2026-08-14T08:00:00.000Z',
          },
        };
      },
    },
  );

  assert.equal(runProjectNodeScriptCalls.length, 1);
  assert.equal(runProjectNodeScriptCalls[0].args.includes('--max-scheduled-days'), true);
  assert.equal(
    runProjectNodeScriptCalls[0].args[runProjectNodeScriptCalls[0].args.indexOf('--max-scheduled-days') + 1],
    '3',
  );
  assert.equal(autoPublishCalls.length, 1);
  assert.equal(autoPublishCalls[0].action, 'poke_quizz_publish_preview');
  assert.equal(
    autoPublishCalls[0].task.poke_quizz_publication_review.publicationId,
    'pub-preview-uploaded-oldest',
  );
  assert.equal(summary.autoApproved, 1);
  assert.equal(summary.autoScheduled, 1);
});
