import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  InstagramGraphClient,
  InstagramPublicationUncertainError,
  prepareInstagramReelPublication,
  publishInstagramReel,
} from '../src/instagram-publication-executor.mjs';

const renderPath = resolve('/workspace/video.mp4');
const sha256 = 'a'.repeat(64);
const target = {
  accountKey: 'poke-quizz-instagram',
  instagram: {
    user_id: 'ig-user-1',
    expected_username: 'pokequizz',
    access_token_env: 'INSTAGRAM_POKE_QUIZZ_ACCESS_TOKEN',
  },
};
const publication = {
  id: 'publication-instagram-1',
  video_id: 'video-1',
  external_id: null,
  metadata: {
    render_path: renderPath,
    publisher_target: target,
    instagram_reel_approval: {
      version: 1,
      approved: true,
      approved_at: '2026-10-09T10:00:00.000Z',
      publication_id: 'publication-instagram-1',
      video_id: 'video-1',
      account_key: 'poke-quizz-instagram',
      instagram_user_id: 'ig-user-1',
      creator_username: 'pokequizz',
      render_path: renderPath,
      video_size_bytes: 4_000,
      video_sha256: sha256,
      caption: 'Guess the Pokemon! #pokemon',
      share_to_feed: true,
    },
  },
};
const runtimeEnv = {
  INSTAGRAM_GRAPH_API_VERSION: 'v25.0',
  INSTAGRAM_POKE_QUIZZ_ACCESS_TOKEN: 'secret-token',
};

function graphResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('InstagramGraphClient creates, checks, publishes, and resolves a Reel', async () => {
  const requests = [];
  const client = new InstagramGraphClient({
    accessToken: 'secret-token',
    apiVersion: 'v25.0',
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith('/ig-user-1/media')) return graphResponse({ id: 'container-1' });
      if (String(url).includes('/container-1?')) {
        return graphResponse({ id: 'container-1', status_code: 'FINISHED', status: 'Finished' });
      }
      if (String(url).endsWith('/ig-user-1/media_publish')) return graphResponse({ id: 'media-1' });
      return graphResponse({
        id: 'media-1',
        media_type: 'VIDEO',
        permalink: 'https://www.instagram.com/reel/example/',
        timestamp: '2026-10-09T10:05:00+0000',
      });
    },
  });

  const created = await client.createReelContainer({
    instagramUserId: 'ig-user-1',
    videoUrl: 'https://storage.example/video.mp4',
    caption: 'Caption',
    shareToFeed: true,
  });
  const status = await client.fetchContainerStatus(created.containerId);
  const published = await client.publishReel({
    instagramUserId: 'ig-user-1',
    containerId: created.containerId,
  });
  const media = await client.fetchMedia(published.mediaId);

  assert.equal(created.containerId, 'container-1');
  assert.equal(status.statusCode, 'FINISHED');
  assert.equal(published.mediaId, 'media-1');
  assert.equal(media.permalink, 'https://www.instagram.com/reel/example/');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer secret-token');
  assert.equal(requests[0].url, 'https://graph.instagram.com/v25.0/ig-user-1/media');
  assert.equal(new URLSearchParams(requests[0].options.body).get('media_type'), 'REELS');
  assert.equal(new URLSearchParams(requests[0].options.body).get('share_to_feed'), 'true');
  assert.doesNotMatch(requests[0].url, /secret-token/u);
});

test('prepareInstagramReelPublication binds delivery to exact approved file and account', async () => {
  const result = await prepareInstagramReelPublication({
    publication,
    videoRow: {},
    target,
    runtimeEnv,
    projectRoot: '/',
    statImpl: async () => ({ size: 4_000 }),
    hashFileImpl: async () => sha256,
  });

  assert.equal(result.approval.instagramUserId, 'ig-user-1');
  assert.equal(result.approval.creatorUsername, 'pokequizz');
  assert.equal(result.approval.shareToFeed, true);
  assert.equal(result.videoSha256, sha256);
});

test('publishInstagramReel stages once, persists container id, then publishes and cleans up', async () => {
  const events = [];
  const stagingClient = {
    async stageFile(input) {
      events.push(['stage', input]);
      return {
        objectPath: 'instagram/publication-instagram-1--random.mp4',
        publicUrl: 'https://storage.example/video.mp4',
      };
    },
    async verifyPublicObject(url) { events.push(['verify', url]); },
    async removeObject(path) { events.push(['remove', path]); },
  };
  const graphClient = {
    async createReelContainer(input) {
      events.push(['create', input]);
      return { containerId: 'container-1' };
    },
    async fetchContainerStatus(id) {
      events.push(['status', id]);
      return { statusCode: 'FINISHED', status: 'Finished' };
    },
    async publishReel(input) {
      events.push(['publish', input]);
      return { mediaId: 'media-1' };
    },
    async fetchMedia(id) {
      events.push(['media', id]);
      return {
        permalink: 'https://www.instagram.com/reel/example/',
        timestamp: '2026-10-09T10:05:00.000Z',
      };
    },
  };
  const persisted = [];
  const initialized = await publishInstagramReel({
    publication,
    videoRow: {},
    target,
    runtimeEnv,
    projectRoot: '/',
    statImpl: async () => ({ size: 4_000 }),
    hashFileImpl: async () => sha256,
    stagingClient,
    graphClient,
    onStaged: async (value) => persisted.push(['staged', value.objectPath]),
    onInitialized: async (value) => persisted.push(['initialized', value.containerId]),
  });

  assert.equal(initialized.workflowState, 'publishing');
  assert.equal(initialized.externalId, 'container-1');
  assert.deepEqual(persisted, [
    ['staged', 'instagram/publication-instagram-1--random.mp4'],
    ['initialized', 'container-1'],
  ]);

  const resumedPublication = {
    ...publication,
    external_id: 'container-1',
    metadata: {
      ...publication.metadata,
      instagram_staging_object_path: 'instagram/publication-instagram-1--random.mp4',
      instagram_staging_public_url: 'https://storage.example/video.mp4',
    },
  };
  const published = await publishInstagramReel({
    publication: resumedPublication,
    videoRow: {},
    target,
    runtimeEnv,
    projectRoot: '/',
    statImpl: async () => ({ size: 4_000 }),
    hashFileImpl: async () => sha256,
    stagingClient,
    graphClient,
    onPublished: async (value) => persisted.push(['published', value.mediaId]),
  });

  assert.equal(published.workflowState, 'published');
  assert.equal(published.mediaId, 'media-1');
  assert.equal(published.stagingRemoved, true);
  assert.deepEqual(events.at(-1), ['remove', 'instagram/publication-instagram-1--random.mp4']);
  assert.deepEqual(persisted.at(-1), ['published', 'media-1']);
});

test('publishInstagramReel blocks automatic retry when publish outcome is uncertain', async () => {
  const resumed = {
    ...publication,
    external_id: 'container-1',
    metadata: {
      ...publication.metadata,
      instagram_staging_object_path: 'instagram/video.mp4',
      instagram_staging_public_url: 'https://storage.example/video.mp4',
    },
  };
  await assert.rejects(
    () => publishInstagramReel({
      publication: resumed,
      videoRow: {},
      target,
      runtimeEnv,
      projectRoot: '/',
      statImpl: async () => ({ size: 4_000 }),
      hashFileImpl: async () => sha256,
      stagingClient: {},
      graphClient: {
        async fetchContainerStatus() { return { statusCode: 'FINISHED' }; },
        async publishReel() { throw new TypeError('network dropped'); },
      },
    }),
    InstagramPublicationUncertainError,
  );
});

test('publishInstagramReel resumes cleanup after the media id was safely persisted', async () => {
  const removed = [];
  const resumed = {
    ...publication,
    external_id: 'container-1',
    metadata: {
      ...publication.metadata,
      instagram_media_id: 'media-1',
      instagram_staging_object_path: 'instagram/video.mp4',
    },
  };
  const result = await publishInstagramReel({
    publication: resumed,
    videoRow: {},
    target,
    runtimeEnv,
    projectRoot: '/',
    statImpl: async () => ({ size: 4_000 }),
    hashFileImpl: async () => sha256,
    stagingClient: {
      async removeObject(path) { removed.push(path); },
    },
    graphClient: {
      async fetchMedia() {
        return {
          permalink: 'https://www.instagram.com/reel/example/',
          timestamp: '2026-10-09T10:05:00.000Z',
        };
      },
    },
  });

  assert.equal(result.stagingRemoved, true);
  assert.deepEqual(removed, ['instagram/video.mp4']);
});
