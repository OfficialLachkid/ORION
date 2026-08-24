import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePublicationChannelProfile } from '../../../services/product-video-agent/src/publication-channels.mjs';
import {
  planNightShiftAutoPublicationAutomation,
  runVideoQueueMaintenance,
  selectNextReviewBacklogRuntime,
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

test('review backlog runtime selection breaks equal-count ties away from the most recently generated template', () => {
  const runtimes = [
    { templateId: 'pokemon.dual-type-reveal.v1', channelConfigPath: 'dual.json' },
    { templateId: 'pokemon.find-the-shiny.v1', channelConfigPath: 'shiny.json' },
    { templateId: 'pokemon.memory.v1', channelConfigPath: 'memory.json' },
  ];
  const publications = [
    {
      id: 'dual-recent',
      created_at: '2026-08-21T00:34:37.173973+00:00',
      metadata: {
        workflow_state: 'preview_uploaded',
        template_id: 'pokemon.dual-type-reveal.v1',
      },
    },
    {
      id: 'shiny-older',
      created_at: '2026-08-20T19:54:59.775074+00:00',
      metadata: {
        workflow_state: 'scheduled',
        template_id: 'pokemon.find-the-shiny.v1',
      },
    },
    {
      id: 'memory-oldest',
      created_at: '2026-08-20T19:43:00.664472+00:00',
      metadata: {
        workflow_state: 'scheduled',
        template_id: 'pokemon.memory.v1',
      },
    },
  ];

  const selectedRuntime = selectNextReviewBacklogRuntime(runtimes, publications);
  assert.equal(selectedRuntime?.templateId, 'pokemon.memory.v1');
});

test('review backlog runtime selection counts legacy dual-type template ids against the current runtime id', () => {
  const runtimes = [
    { templateId: 'pokemon.dual-type-reveal.v1', channelConfigPath: 'dual.json' },
    { templateId: 'pokemon.find-the-shiny.v1', channelConfigPath: 'shiny.json' },
  ];
  const publications = [
    {
      id: 'dual-legacy',
      created_at: '2026-08-21T00:34:37.173973+00:00',
      metadata: {
        workflow_state: 'preview_uploaded',
        template_id: 'pokemon.dual-type-reveal-v1',
      },
    },
  ];

  const selectedRuntime = selectNextReviewBacklogRuntime(runtimes, publications);
  assert.equal(selectedRuntime?.templateId, 'pokemon.find-the-shiny.v1');
});

test('review backlog runtime selection avoids repeating the most recently generated template when an alternative exists', () => {
  const runtimes = [
    { templateId: 'pokemon.dual-type-reveal.v1', channelConfigPath: 'dual.json' },
    { templateId: 'pokemon.find-the-shiny.v1', channelConfigPath: 'shiny.json' },
    { templateId: 'pokemon.memory.v1', channelConfigPath: 'memory.json' },
  ];
  const publications = [
    {
      id: 'dual-most-recent',
      created_at: '2026-08-21T09:00:00.000Z',
      metadata: {
        workflow_state: 'preview_uploaded',
        template_id: 'pokemon.dual-type-reveal-v1',
      },
    },
    {
      id: 'memory-older',
      created_at: '2026-08-21T08:00:00.000Z',
      metadata: {
        workflow_state: 'preview_uploaded',
        template_id: 'pokemon.memory.v1',
      },
    },
    {
      id: 'shiny-oldest',
      created_at: '2026-08-21T07:00:00.000Z',
      metadata: {
        workflow_state: 'preview_uploaded',
        template_id: 'pokemon.find-the-shiny.v1',
      },
    },
    {
      id: 'memory-second',
      created_at: '2026-08-20T07:00:00.000Z',
      metadata: {
        workflow_state: 'scheduled',
        template_id: 'pokemon.memory.v1',
      },
    },
    {
      id: 'shiny-second',
      created_at: '2026-08-20T06:00:00.000Z',
      metadata: {
        workflow_state: 'scheduled',
        template_id: 'pokemon.find-the-shiny.v1',
      },
    },
  ];

  const selectedRuntime = selectNextReviewBacklogRuntime(runtimes, publications);
  assert.equal(selectedRuntime?.templateId, 'pokemon.find-the-shiny.v1');
});

test('review backlog runtime selection prefers higher-weight non-dual templates when loads are equal', () => {
  const runtimes = [
    { templateId: 'pokemon.dual-type-reveal.v1', channelConfigPath: 'dual.json' },
    { templateId: 'pokemon.find-the-shiny.v1', channelConfigPath: 'shiny.json' },
    { templateId: 'pokemon.memory.v1', channelConfigPath: 'memory.json' },
  ];

  const selectedRuntime = selectNextReviewBacklogRuntime(
    runtimes,
    [],
    {
      templateWeights: {
        'pokemon.dual-type-reveal.v1': 1,
        'pokemon.find-the-shiny.v1': 2,
        'pokemon.memory.v1': 2,
      },
    },
  );

  assert.equal(selectedRuntime?.templateId, 'pokemon.memory.v1');
});

test('review backlog runtime selection avoids an in-run repeat even before publications refresh', () => {
  const runtimes = [
    { templateId: 'pokemon.dual-type-reveal.v1', channelConfigPath: 'dual.json' },
    { templateId: 'pokemon.find-the-shiny.v1', channelConfigPath: 'shiny.json' },
    { templateId: 'pokemon.memory.v1', channelConfigPath: 'memory.json' },
  ];

  const selectedRuntime = selectNextReviewBacklogRuntime(
    runtimes,
    [],
    {
      templateWeights: {
        'pokemon.dual-type-reveal.v1': 1,
        'pokemon.find-the-shiny.v1': 2,
        'pokemon.memory.v1': 2,
      },
      recentTemplateIds: ['pokemon.memory.v1'],
    },
  );

  assert.equal(selectedRuntime?.templateId, 'pokemon.find-the-shiny.v1');
});
