import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPlaylistTargetTitle,
  buildYoutubePlaylistClassification,
  classifyRelativeDifficulty,
  normalizePlaylistTemplateKey,
  YOUTUBE_PLAYLIST_CONFIGURATION_VERSION,
} from '../src/youtube-playlists/classification.mjs';

test('short-form templates automatically receive a version-stable playlist classification', () => {
  assert.deepEqual(buildYoutubePlaylistClassification({
    template_id: 'pokemon.find-the-shiny.v2',
    content_surface: 'youtube_shorts',
    selection: { difficulty_id: 'hard' },
  }), {
    schema_version: 'youtube-playlist-classification-v1',
    template_key: 'pokemon.find-the-shiny',
    template_title: 'Find The Shiny',
    difficulty_key: 'hard',
  });
  assert.equal(normalizePlaylistTemplateKey('pokemon.find-the-shiny.v12'), 'pokemon.find-the-shiny');
});

test('playlist title policy removes the suffix only for configured templates', () => {
  for (const templateKey of [
    'pokemon.build-your-team',
    'pokemon.find-the-shiny',
    'pokemon.pixelated-reveal',
    'pokemon.progressive-reveal',
  ]) {
    assert.doesNotMatch(buildPlaylistTargetTitle({
      template_key: templateKey,
      template_title: 'Readable Title',
    }), /Easy to Hard/u);
  }
  assert.equal(buildPlaylistTargetTitle({
    template_key: 'pokemon.stat-clash',
    template_title: 'Stat Clash',
  }), 'Stat Clash — Easy to Hard');
  assert.equal(YOUTUBE_PLAYLIST_CONFIGURATION_VERSION, 'youtube-playlists-v3');
});

test('long-form and explicitly disabled plans do not enter playlist automation', () => {
  assert.equal(buildYoutubePlaylistClassification({
    template_id: 'pokemon.long.ultimate-quiz.v1',
    content_surface: 'youtube_watch',
  }), null);
  assert.equal(buildYoutubePlaylistClassification({
    template_id: 'pokemon.find-the-shiny.v1',
    publication_policy: { playlist_enabled: false },
  }), null);
});

test('relative round-count difficulty maps lowest to easy, highest to hard, and middle to medium', () => {
  const counts = [3, 4, 5, 6];
  assert.equal(classifyRelativeDifficulty(3, counts), 'easy');
  assert.equal(classifyRelativeDifficulty(4, counts), 'medium');
  assert.equal(classifyRelativeDifficulty(5, counts), 'medium');
  assert.equal(classifyRelativeDifficulty(6, counts), 'hard');
  assert.equal(classifyRelativeDifficulty(3, [3]), '');
});
