import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  prepareInstagramStoryPublication,
  publishInstagramStory,
} from '../src/instagram-story-executor.mjs';
import { renderInstagramStoryVideo } from '../src/instagram-story-renderer.mjs';
import {
  executeDueInstagramStories,
  resolveInstagramStoryDueAction,
} from '../scripts/publication/social/instagram/execute-due-stories.mjs';

const target = {
  platform: 'instagram_reels',
  account_key: 'poke-quizzz-instagram',
  instagram: {
    user_id: 'ig-user-1',
    expected_username: 'pokequizzz',
    access_token_env: 'INSTAGRAM_POKE_QUIZZ_ACCESS_TOKEN',
    story: {
      enabled: true,
      recipe_version: 'instagram-story-promotion.v1',
      delay_seconds: 0,
    },
  },
};

function sourcePublication(overrides = {}) {
  return {
    id: 'publication-reel-1',
    video_id: 'video-1',
    platform: 'instagram_reels',
    account_key: 'poke-quizzz-instagram',
    status: 'published',
    external_id: 'reel-media-1',
    published_at: '2026-11-16T11:00:00.000Z',
    metadata: {
      workflow_state: 'published',
      instagram_media_id: 'reel-media-1',
      instagram_reel_approval: {
        render_path: '/video.mp4',
        video_sha256: 'source-sha',
        creator_username: 'pokequizzz',
      },
    },
    ...overrides,
  };
}

function storyPublication(overrides = {}) {
  return {
    id: 'publication-story-1',
    video_id: 'video-1',
    platform: 'instagram_story',
    account_key: 'poke-quizzz-instagram',
    status: 'queued',
    external_id: null,
    scheduled_for: null,
    title: 'Guess the Pokemon!',
    metadata: {
      workflow_state: 'waiting_source_publication',
      source_instagram_publication_id: 'publication-reel-1',
      publisher_target: target,
      instagram_story: {
        policy: 'auto_publish',
        recipe_version: 'instagram-story-promotion.v1',
        delay_seconds: 0,
      },
    },
    ...overrides,
  };
}

test('Story renderer creates a deterministic branded teaser beside the approved Reel', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orion-story-'));
  const sourcePath = join(root, 'approved.mp4');
  await writeFile(sourcePath, 'approved-source');
  const source = sourcePublication({
    metadata: {
      workflow_state: 'published',
      instagram_media_id: 'reel-media-1',
      instagram_reel_approval: {
        render_path: sourcePath,
        video_sha256: 'source-sha',
        creator_username: 'pokequizzz',
      },
    },
  });
  const commands = [];
  const fakeSharp = () => ({
    png() { return this; },
    async toFile(path) { await writeFile(path, 'overlay'); },
  });
  try {
    const rendered = await renderInstagramStoryVideo({
      publication: storyPublication(),
      sourcePublication: source,
      target,
      projectRoot: root,
      sharpImpl: fakeSharp,
      hashFileImpl: async (path) => (path === sourcePath ? 'source-sha' : 'story-sha'),
      runProcess: async ({ args }) => {
        commands.push(args);
        await writeFile(args.at(-1), 'story-video');
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    assert.equal(rendered.videoSha256, 'story-sha');
    assert.equal(rendered.sourceVideoSha256, 'source-sha');
    assert.match(rendered.outputPath, /instagram-stories/u);
    assert.match((await readFile(rendered.outputPath)).toString(), /story-video/u);
    assert.equal(commands.length, 1);
    assert.ok(commands[0].some((argument) => (
      argument.includes('1080:1920:force_original_aspect_ratio=increase')
    )));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Story preparation inherits authorization from account policy and published Reel receipt', async () => {
  let renderCalls = 0;
  const prepared = await prepareInstagramStoryPublication({
    publication: storyPublication(),
    sourcePublication: sourcePublication(),
    target,
    runtimeEnv: {
      INSTAGRAM_GRAPH_API_VERSION: 'v25.0',
      INSTAGRAM_POKE_QUIZZ_ACCESS_TOKEN: 'secret',
    },
    renderStory: async () => {
      renderCalls += 1;
      return { outputPath: '/story.mp4', videoSha256: 'story-sha' };
    },
  });

  assert.equal(renderCalls, 1);
  assert.equal(prepared.instagramUserId, 'ig-user-1');
  assert.equal(prepared.policy.policy, 'auto_publish');
});

test('Story publishing persists staging and container boundaries before returning processing', async () => {
  const callbacks = [];
  const result = await publishInstagramStory({
    publication: storyPublication(),
    sourcePublication: sourcePublication(),
    target,
    runtimeEnv: {
      INSTAGRAM_GRAPH_API_VERSION: 'v25.0',
      INSTAGRAM_POKE_QUIZZ_ACCESS_TOKEN: 'secret',
    },
    renderStory: async () => ({
      outputPath: '/story.mp4',
      videoSha256: 'story-sha',
      sourceVideoSha256: 'source-sha',
      durationSeconds: 8,
    }),
    stagingClient: {
      async stageFile() {
        return { objectPath: 'instagram-story/object.mp4', publicUrl: 'https://cdn/story.mp4' };
      },
      async verifyPublicObject() {},
    },
    graphClient: {
      async createStoryContainer({ videoUrl }) {
        assert.equal(videoUrl, 'https://cdn/story.mp4');
        return { containerId: 'story-container-1' };
      },
    },
    onRendered: async () => callbacks.push('rendered'),
    onStaged: async () => callbacks.push('staged'),
    onInitialized: async () => callbacks.push('initialized'),
  });

  assert.deepEqual(callbacks, ['rendered', 'staged', 'initialized']);
  assert.equal(result.workflowState, 'publishing');
  assert.equal(result.externalId, 'story-container-1');
});

test('Story publishing resumes a finished container without creating a duplicate', async () => {
  let removed = '';
  const result = await publishInstagramStory({
    publication: storyPublication({
      status: 'publishing',
      external_id: 'story-container-1',
      metadata: {
        ...storyPublication().metadata,
        workflow_state: 'publishing',
        instagram_story_staging_object_path: 'instagram-story/object.mp4',
        instagram_story_staging_public_url: 'https://cdn/story.mp4',
      },
    }),
    sourcePublication: sourcePublication(),
    target,
    runtimeEnv: {
      INSTAGRAM_GRAPH_API_VERSION: 'v25.0',
      INSTAGRAM_POKE_QUIZZ_ACCESS_TOKEN: 'secret',
    },
    renderStory: async () => ({
      outputPath: '/story.mp4',
      videoSha256: 'story-sha',
      sourceVideoSha256: 'source-sha',
      durationSeconds: 8,
    }),
    stagingClient: {
      async removeObject(path) { removed = path; },
    },
    graphClient: {
      async fetchContainerStatus() { return { statusCode: 'FINISHED' }; },
      async publishStory() { return { mediaId: 'story-media-1' }; },
      async fetchMedia() {
        return { permalink: 'https://instagram/story/1', timestamp: '2026-11-16T11:05:00.000Z' };
      },
    },
  });

  assert.equal(result.workflowState, 'published');
  assert.equal(result.mediaId, 'story-media-1');
  assert.equal(removed, 'instagram-story/object.mp4');
});

test('Story due action waits for the Reel receipt and publishes immediately afterward', () => {
  assert.equal(resolveInstagramStoryDueAction(
    storyPublication(),
    null,
    '2026-11-16T11:01:00.000Z',
    24,
  ), '');
  assert.equal(resolveInstagramStoryDueAction(
    storyPublication(),
    sourcePublication({ status: 'publishing', metadata: { workflow_state: 'publishing' } }),
    '2026-11-16T11:01:00.000Z',
    24,
  ), '');
  assert.equal(resolveInstagramStoryDueAction(
    storyPublication(),
    sourcePublication(),
    '2026-11-16T11:01:00.000Z',
    24,
  ), 'upload');
});

test('Story runner skips a missing source without blocking a valid Story', async () => {
  const missingSourceStory = storyPublication({
    id: 'publication-story-missing-source',
    metadata: {
      ...storyPublication().metadata,
      source_instagram_publication_id: 'publication-reel-missing',
    },
  });
  let validStory = storyPublication({ id: 'publication-story-valid' });
  const source = sourcePublication();
  let publishCalls = 0;
  const merge = (row, patch) => ({
    ...row,
    ...patch,
    metadata: patch.metadata || row.metadata,
  });

  const results = await executeDueInstagramStories({
    'as-of': '2026-11-16T11:01:00.000Z',
  }, {
    runtimeConfig: {
      env: {
        INSTAGRAM_DELIVERY_ENABLED: 'true',
        INSTAGRAM_GRAPH_API_VERSION: 'v25.0',
        INSTAGRAM_POKE_QUIZZ_ACCESS_TOKEN: 'secret',
      },
    },
    publicationStore: {
      async fetchPublicationsByPlatform() { return [missingSourceStory, validStory]; },
      async fetchPublicationsByIds() { return [source]; },
      async fetchPublicationById(id) { return id === source.id ? source : validStory; },
      async updatePublication(id, patch) {
        assert.equal(id, validStory.id);
        validStory = merge(validStory, patch);
        return validStory;
      },
      async claimPublicationForUpload(id, patch) {
        assert.equal(id, validStory.id);
        validStory = merge(validStory, patch);
        return validStory;
      },
    },
    publishInstagramStory: async () => {
      publishCalls += 1;
      return {
        workflowState: 'published',
        status: 'published',
        externalId: 'story-media-valid',
        mediaId: 'story-media-valid',
        publicUrl: 'https://instagram/story/valid',
        publishedAt: '2026-11-16T11:01:00.000Z',
        stagingRemoved: true,
      };
    },
  });

  assert.equal(publishCalls, 1);
  assert.equal(validStory.status, 'published');
  assert.ok(results.some((result) => result.action === 'instagram_story_published'));
});

test('Story runner automatically publishes the enabled child after its source Reel', async () => {
  let stored = storyPublication();
  const source = sourcePublication();
  let publishCalls = 0;
  const merge = (row, patch) => ({
    ...row,
    ...patch,
    metadata: patch.metadata || row.metadata,
  });
  const results = await executeDueInstagramStories({
    'as-of': '2026-11-16T11:01:00.000Z',
  }, {
    runtimeConfig: {
      env: {
        INSTAGRAM_DELIVERY_ENABLED: 'true',
        INSTAGRAM_GRAPH_API_VERSION: 'v25.0',
        INSTAGRAM_POKE_QUIZZ_ACCESS_TOKEN: 'secret',
      },
    },
    publicationStore: {
      async fetchPublicationsByPlatform() { return [stored]; },
      async fetchPublicationsByIds() { return [source]; },
      async fetchPublicationById(id) { return id === source.id ? source : stored; },
      async updatePublication(id, patch) {
        assert.equal(id, stored.id);
        stored = merge(stored, patch);
        return stored;
      },
      async claimPublicationForUpload(id, patch) {
        assert.equal(id, stored.id);
        stored = merge(stored, patch);
        return stored;
      },
    },
    publishInstagramStory: async ({ onRendered, onStaged, onInitialized, onPublished }) => {
      publishCalls += 1;
      await onRendered({
        outputPath: '/story.mp4',
        videoSha256: 'story-sha',
        sourceVideoSha256: 'source-sha',
        durationSeconds: 8,
      });
      await onStaged({ objectPath: 'instagram-story/1.mp4', publicUrl: 'https://cdn/1.mp4' });
      await onInitialized({ containerId: 'container-1' });
      await onPublished({ mediaId: 'story-media-1' });
      return {
        workflowState: 'published',
        status: 'published',
        externalId: 'story-media-1',
        mediaId: 'story-media-1',
        publicUrl: 'https://instagram/story/1',
        publishedAt: '2026-11-16T11:01:00.000Z',
        stagingRemoved: true,
      };
    },
  });

  assert.equal(publishCalls, 1);
  assert.equal(stored.status, 'published');
  assert.equal(stored.metadata.workflow_state, 'published');
  assert.ok(results.some((result) => result.action === 'instagram_story_published'));
});
