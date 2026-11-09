import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  FacebookGraphClient,
  publishFacebookReel,
} from '../src/facebook-publication-executor.mjs';

const AS_OF = '2026-11-09T16:00:00.000Z';

function target() {
  return {
    accountKey: 'poke-quizz-facebook',
    facebook: {
      page_id: 'page-123',
      expected_page_name: 'Poke Quizz',
      access_token_env: 'FACEBOOK_POKE_QUIZZ_PAGE_ACCESS_TOKEN',
    },
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'orion-facebook-reel-'));
  const renderPath = join(root, 'approved.mp4');
  const bytes = Buffer.from('approved-facebook-reel');
  await writeFile(renderPath, bytes);
  const videoSha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    publication: {
      id: 'publication-facebook-1',
      video_id: 'video-1',
      platform: 'facebook_reels',
      account_key: 'poke-quizz-facebook',
      status: 'publishing',
      external_id: null,
      uploaded_at: null,
      metadata: {
        render_path: renderPath,
        facebook_reel_approval: {
          version: 1,
          approved: true,
          approved_at: AS_OF,
          publication_id: 'publication-facebook-1',
          video_id: 'video-1',
          account_key: 'poke-quizz-facebook',
          page_id: 'page-123',
          expected_page_name: 'Poke Quizz',
          render_path: renderPath,
          video_size_bytes: bytes.length,
          video_sha256: videoSha256,
          description: 'Approved description',
        },
      },
    },
    bytes,
  };
}

const runtimeEnv = {
  FACEBOOK_POKE_QUIZZ_PAGE_ACCESS_TOKEN: 'page-token',
  FACEBOOK_GRAPH_API_VERSION: 'v27.0',
};

test('FacebookGraphClient uploads Reel bytes directly to Meta without a public URL', async () => {
  const requests = [];
  const client = new FacebookGraphClient({
    accessToken: 'page-token',
    apiVersion: 'v27.0',
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const bytes = Buffer.from('video-bytes');
  await client.uploadReelBytes({
    uploadUrl: 'https://rupload.facebook.com/video-upload/v1',
    bytes,
    fileSize: bytes.length,
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://rupload.facebook.com/video-upload/v1');
  assert.equal(requests[0].options.headers.Authorization, 'OAuth page-token');
  assert.equal(requests[0].options.headers.file_size, String(bytes.length));
  assert.equal(requests[0].options.body, bytes);
});

test('publishFacebookReel starts and uploads an approved local MP4 in the first phase', async () => {
  const { publication, bytes } = await fixture();
  const events = [];
  const result = await publishFacebookReel({
    publication,
    videoRow: {},
    target: target(),
    runtimeEnv,
    asOf: AS_OF,
    graphClient: {
      async startReelUpload(pageId) {
        assert.equal(pageId, 'page-123');
        return { videoId: 'facebook-video-1', uploadUrl: 'https://upload.example/reel' };
      },
      async uploadReelBytes(input) {
        assert.equal(input.uploadUrl, 'https://upload.example/reel');
        assert.deepEqual(input.bytes, bytes);
      },
    },
    onInitialized: async (event) => events.push(['initialized', event.videoId]),
    onUploaded: async (event) => events.push(['uploaded', event.videoId]),
  });
  assert.equal(result.workflowState, 'publishing');
  assert.equal(result.status, 'uploaded');
  assert.equal(result.externalId, 'facebook-video-1');
  assert.deepEqual(events, [
    ['initialized', 'facebook-video-1'],
    ['uploaded', 'facebook-video-1'],
  ]);
});

test('publishFacebookReel resumes the same video id for finish and status polling', async () => {
  const base = await fixture();
  base.publication.external_id = 'facebook-video-1';
  base.publication.uploaded_at = AS_OF;
  base.publication.metadata.facebook_upload_completed_at = AS_OF;
  base.publication.metadata.facebook_upload_url = 'https://upload.example/reel';
  const finishEvents = [];
  const processing = await publishFacebookReel({
    publication: base.publication,
    videoRow: {},
    target: target(),
    runtimeEnv,
    asOf: AS_OF,
    graphClient: {
      async finishReel(input) {
        assert.equal(input.videoId, 'facebook-video-1');
        assert.equal(input.description, 'Approved description');
      },
    },
    onFinishRequested: async (event) => finishEvents.push(event.videoId),
  });
  assert.equal(processing.status, 'processing');
  assert.deepEqual(finishEvents, ['facebook-video-1']);

  const publishedPublication = {
    ...base.publication,
    metadata: {
      ...base.publication.metadata,
      facebook_finish_requested_at: AS_OF,
    },
  };
  const published = await publishFacebookReel({
    publication: publishedPublication,
    videoRow: {},
    target: target(),
    runtimeEnv,
    asOf: AS_OF,
    graphClient: {
      async fetchReel(videoId) {
        assert.equal(videoId, 'facebook-video-1');
        return {
          status: 'ready',
          permalink: 'https://www.facebook.com/reel/123',
          createdTime: AS_OF,
        };
      },
    },
  });
  assert.equal(published.workflowState, 'published');
  assert.equal(published.publicUrl, 'https://www.facebook.com/reel/123');
});
