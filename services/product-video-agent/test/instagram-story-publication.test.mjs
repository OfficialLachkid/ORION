import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  INSTAGRAM_STORY_PLATFORM,
  INSTAGRAM_STORY_POLICY_AUTO_PUBLISH,
  INSTAGRAM_STORY_POLICY_DISABLED,
  buildInstagramStoryPublicationRow,
  resolveInstagramStoryPolicy,
  upsertInstagramStoryPublicationTarget,
} from '../src/instagram-story-publication.mjs';
import { upsertAdditionalPlatformPublicationTargets } from '../src/social-publication-targets.mjs';

const reelPublication = {
  id: 'publication-instagram-reel-1',
  video_id: 'video-1',
  platform: 'instagram_reels',
  account_key: 'poke-quizz-instagram',
  status: 'scheduled',
  title: 'Guess the Pokemon!',
  description: 'A new challenge.',
  hashtags: ['#pokemon'],
  metadata: {
    workflow_state: 'scheduled',
    render_path: '/workspace/video.mp4',
    publisher_target: {
      platform: 'instagram_reels',
      account_key: 'poke-quizz-instagram',
      enabled: true,
      schedule_mode: 'orion',
      instagram: {
        user_id: 'ig-user-1',
        expected_username: 'pokequizz',
        access_token_env: 'INSTAGRAM_POKE_QUIZZ_ACCESS_TOKEN',
        story: {
          enabled: true,
          template_key: 'video_promotion',
          recipe_version: 'story-recipe.v1',
          delay_seconds: 120,
        },
      },
    },
  },
};

test('Instagram Story policy is disabled unless an account explicitly opts in', () => {
  const policy = resolveInstagramStoryPolicy({ instagram: {} });

  assert.equal(policy.policy, INSTAGRAM_STORY_POLICY_DISABLED);
  assert.equal(policy.enabled, false);
  assert.equal(buildInstagramStoryPublicationRow({
    sourcePublication: reelPublication,
    target: { instagram: {} },
  }), null);
});

test('Instagram Story policy rejects unknown publication authorization modes', () => {
  assert.throws(
    () => resolveInstagramStoryPolicy({ instagram: { story: { policy: 'sometimes' } } }),
    /Unsupported Instagram Story publication policy/u,
  );
});

test('Poke Quizz is the only enabled Story canary in the channel registry', async () => {
  const registry = JSON.parse(await readFile(new URL(
    '../publication-channels.example.json',
    import.meta.url,
  ), 'utf8'));
  const instagramTargets = registry.channels.flatMap((channel) => (
    channel.metadata?.publisher?.targets || []
  )).filter((configuredTarget) => configuredTarget.platform === 'instagram_reels');
  const enabledStories = instagramTargets.filter((configuredTarget) => (
    configuredTarget.instagram?.story?.enabled === true
  ));

  assert.equal(enabledStories.length, 1);
  assert.equal(enabledStories[0].account_key, 'poke-quizzz-instagram');
});

test('account-enabled Story planning creates a deterministic waiting child row', () => {
  const first = buildInstagramStoryPublicationRow({
    sourcePublication: reelPublication,
    target: reelPublication.metadata.publisher_target,
    asOf: '2026-11-16T12:00:00.000Z',
  });
  const second = buildInstagramStoryPublicationRow({
    sourcePublication: reelPublication,
    target: reelPublication.metadata.publisher_target,
    asOf: '2026-11-16T12:05:00.000Z',
  });

  assert.equal(first.id, second.id);
  assert.equal(first.platform, INSTAGRAM_STORY_PLATFORM);
  assert.equal(first.status, 'queued');
  assert.equal(first.metadata.workflow_state, 'waiting_source_publication');
  assert.equal(first.metadata.source_instagram_publication_id, reelPublication.id);
  assert.equal(first.metadata.instagram_story.policy, INSTAGRAM_STORY_POLICY_AUTO_PUBLISH);
  assert.equal(first.metadata.instagram_story.authorization, 'account_policy');
  assert.equal(first.metadata.instagram_story.delay_seconds, 120);
  assert.ok([
    'current',
    'branded_fullscreen',
    'framed_card',
    'minimal',
    'hybrid',
  ].includes(first.metadata.instagram_story.variant_key));
  assert.equal(first.metadata.instagram_story.variant_set_version, 'instagram-story-variants.v1');
  assert.equal(first.metadata.instagram_story.enabled_variant_keys.length, 5);
});

test('auto-publish Story planning records explicit account-policy authorization', () => {
  const target = structuredClone(reelPublication.metadata.publisher_target);
  target.instagram.story.policy = 'auto-publish';
  const row = buildInstagramStoryPublicationRow({
    sourcePublication: reelPublication,
    target,
  });

  assert.equal(row.metadata.instagram_story.policy, INSTAGRAM_STORY_POLICY_AUTO_PUBLISH);
  assert.equal(row.metadata.instagram_story.authorization, 'account_policy');
});

test('Story target upsert preserves an existing deterministic child', async () => {
  const target = reelPublication.metadata.publisher_target;
  const existing = buildInstagramStoryPublicationRow({ sourcePublication: reelPublication, target });
  let writes = 0;
  const result = await upsertInstagramStoryPublicationTarget({
    store: {
      async fetchPublicationById(id) {
        assert.equal(id, existing.id);
        return existing;
      },
      async upsertPublication() { writes += 1; },
    },
    sourcePublication: reelPublication,
    target,
  });

  assert.equal(writes, 0);
  assert.equal(result.preserved, true);
  assert.equal(result.publicationId, existing.id);
});

test('Instagram target fan-out creates one durable dependent Story plan when enabled', async () => {
  const rows = new Map();
  const profile = {
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    metadata: {
      publisher: {
        targets: [reelPublication.metadata.publisher_target],
      },
    },
  };
  const sourcePublication = {
    id: 'publication-youtube-1',
    video_id: 'video-1',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    title: 'Guess the Pokemon!',
    description: 'A new challenge.',
    hashtags: ['#pokemon'],
    metadata: {
      workflow_state: 'scheduled',
      render_path: '/workspace/video.mp4',
    },
  };
  const results = await upsertAdditionalPlatformPublicationTargets({
    store: {
      async fetchPublicationById(id) { return rows.get(id) || null; },
      async upsertPublication(row) {
        rows.set(row.id, row);
        return row;
      },
    },
    sourcePublication,
    videoRow: { id: 'video-1', render: { output_path: '/workspace/video.mp4' } },
    sourceChannelProfile: profile,
    scheduledFor: '2026-11-17T11:00:00.000Z',
    projectRoot: '/',
    statImpl: async () => ({ size: 4_000 }),
    hashFileImpl: async () => 'a'.repeat(64),
    approval: {
      approvedAt: '2026-11-16T12:00:00.000Z',
      approvedBy: 'Lachkid',
      approvedById: 'operator-1',
      reviewTaskId: 'TASK-1',
      instagramReels: [{
        accountKey: 'poke-quizz-instagram',
        instagramUserId: 'ig-user-1',
        creatorUsername: 'pokequizz',
        caption: 'Guess the Pokemon!',
        shareToFeed: true,
      }],
    },
  });

  assert.equal(results.length, 1);
  assert.equal(rows.size, 2);
  assert.equal(results[0].platform, 'instagram_reels');
  assert.equal(results[0].dependent_story_policy, INSTAGRAM_STORY_POLICY_AUTO_PUBLISH);
  const story = rows.get(results[0].dependent_story_publication_id);
  assert.equal(story.platform, INSTAGRAM_STORY_PLATFORM);
  assert.equal(story.metadata.source_instagram_publication_id, results[0].publication_id);
  assert.equal(story.metadata.workflow_state, 'waiting_source_publication');
});
