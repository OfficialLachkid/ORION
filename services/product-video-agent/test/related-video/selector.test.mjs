import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planRelatedVideoSelection,
  selectRelatedPublicationCandidate,
} from '../../src/related-video/selector.mjs';

const channelProfile = {
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  content_lane: 'poke-quizz',
};

const targetPublication = {
  id: 'pub-target',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  title: 'Guess the Pokemon: Fire / Water',
  external_id: 'yt-target',
  metadata: {
    workflow_state: 'preview_uploaded',
    template_id: 'pokemon-type-challenge-v1',
    type_pair: ['fire', 'water'],
  },
};

const publishedSamePair = {
  id: 'pub-same-pair',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  status: 'published',
  external_id: 'yt-same-pair',
  public_url: 'https://youtube.com/shorts/yt-same-pair',
  published_at: '2026-08-03T12:00:00.000Z',
  title: 'Guess the Pokemon: Water / Fire',
  metadata: {
    workflow_state: 'published',
    template_id: 'pokemon-type-challenge-v1',
    type_pair: ['water', 'fire'],
  },
};

const publishedReusable = {
  id: 'pub-bug-ground',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  status: 'published',
  external_id: 'yt-bug-ground',
  public_url: 'https://youtube.com/shorts/yt-bug-ground',
  published_at: '2026-08-03T10:00:00.000Z',
  title: 'Guess the Pokemon: Bug / Ground',
  metadata: {
    workflow_state: 'published',
    template_id: 'pokemon-type-challenge-v1',
    type_pair: ['bug', 'ground'],
  },
};

const publishedRecentReuse = {
  id: 'pub-poison-flying',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  status: 'published',
  external_id: 'yt-poison-flying',
  public_url: 'https://youtube.com/shorts/yt-poison-flying',
  published_at: '2026-08-04T06:00:00.000Z',
  title: 'Guess the Pokemon: Poison / Flying',
  metadata: {
    workflow_state: 'published',
    template_id: 'pokemon-type-challenge-v1',
    type_pair: ['poison', 'flying'],
  },
};

const recentlyPublishedUsingReusableTarget = {
  id: 'pub-published-1',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  status: 'published',
  external_id: 'yt-published-1',
  public_url: 'https://youtube.com/shorts/yt-published-1',
  published_at: '2026-08-04T07:00:00.000Z',
  title: 'Published Video 1',
  metadata: {
    workflow_state: 'published',
    related_video: {
      target_publication_id: 'pub-bug-ground',
    },
  },
};

test('Poke Quizz selector excludes exact same type-pair targets', () => {
  const selected = selectRelatedPublicationCandidate(
    [targetPublication, publishedSamePair, publishedReusable],
    targetPublication,
    { channelProfile },
  );

  assert.equal(selected?.id, 'pub-bug-ground');
});

test('related-video planner avoids recently reused targets when alternatives exist', () => {
  const planned = planRelatedVideoSelection({
    publications: [
      targetPublication,
      publishedReusable,
      publishedRecentReuse,
      recentlyPublishedUsingReusableTarget,
    ],
    targetPublication,
    channelProfile,
    asOf: '2026-08-04T08:00:00.000Z',
    recentReuseWindow: 5,
  });

  assert.equal(planned.candidate?.id, 'pub-poison-flying');
  assert.equal(planned.relatedVideo.selection_status, 'planned');
  assert.equal(planned.relatedVideo.target_publication_id, 'pub-poison-flying');
  assert.match(planned.relatedVideo.match_reason, /recent related-target reuse guard was respected/u);
});

test('related-video planner returns none when only same-pair published videos exist', () => {
  const planned = planRelatedVideoSelection({
    publications: [targetPublication, publishedSamePair],
    targetPublication,
    channelProfile,
    asOf: '2026-08-04T08:00:00.000Z',
  });

  assert.equal(planned.candidate, null);
  assert.equal(planned.relatedVideo.selection_status, 'none');
  assert.match(planned.relatedVideo.match_reason, /excluding exact same Poke Quizz type pairs/u);
});
