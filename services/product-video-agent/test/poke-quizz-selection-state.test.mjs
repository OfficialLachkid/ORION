import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPokeQuizzSelectionStateFromHistory,
  createPokeQuizzVideoSignatureKey,
  loadPokeQuizzSelectionStateFromStore,
  mergePokeQuizzSelectionStates,
  normalizePokeQuizzSelectionState,
} from '../src/poke-quizz-selection-state.mjs';

test('normalizePokeQuizzSelectionState folds the last video into the used signature history', () => {
  const state = normalizePokeQuizzSelectionState({
    last_type_pair_key: 'water|psychic',
    last_background_path: 'C:\\tmp\\Background-1.png',
    used_video_signatures: ['water|psychic::c:/tmp/background-1.png'],
  });

  assert.equal(state.last_type_pair_key, 'water|psychic');
  assert.equal(state.last_background_path, 'c:/tmp/background-1.png');
  assert.deepEqual(state.used_video_signatures, ['water|psychic::c:/tmp/background-1.png']);
});

test('mergePokeQuizzSelectionStates prefers the first recent state and unions signature history', () => {
  const merged = mergePokeQuizzSelectionStates(
    {
      last_type_pair_key: 'fighting|flying',
      last_background_path: '/tmp/background-2.png',
      used_video_signatures: ['fighting|flying::/tmp/background-2.png'],
    },
    {
      last_type_pair_key: 'grass|poison',
      last_background_path: '/tmp/background-1.png',
      used_video_signatures: ['grass|poison::/tmp/background-1.png'],
    },
  );

  assert.equal(merged.last_type_pair_key, 'fighting|flying');
  assert.equal(merged.last_background_path, '/tmp/background-2.png');
  assert.deepEqual(merged.used_video_signatures, [
    'fighting|flying::/tmp/background-2.png',
    'grass|poison::/tmp/background-1.png',
  ]);
});

test('buildPokeQuizzSelectionStateFromHistory captures the latest pair, background, and exact signatures', () => {
  const state = buildPokeQuizzSelectionStateFromHistory([
    {
      publication: {
        metadata: {
          type_pair: ['fighting', 'flying'],
        },
      },
      video: {
        source_data: {
          type_pair: ['fighting', 'flying'],
          background_path: '/tmp/background-2.png',
        },
      },
    },
    {
      publication: {
        metadata: {
          type_pair: ['grass', 'poison'],
          background_path: '/tmp/background-1.png',
        },
      },
      video: null,
    },
  ]);

  assert.equal(state.last_type_pair_key, 'fighting|flying');
  assert.equal(state.last_background_path, '/tmp/background-2.png');
  assert.deepEqual(state.used_video_signatures, [
    'fighting|flying::/tmp/background-2.png',
    'grass|poison::/tmp/background-1.png',
  ]);
});

test('loadPokeQuizzSelectionStateFromStore derives history from recent channel publications', async () => {
  const store = {
    async fetchPublicationsByChannel() {
      return [
        { id: 'pub-2', video_id: 'video-2', metadata: { type_pair: ['fighting', 'flying'] } },
        { id: 'pub-1', video_id: 'video-1', metadata: { type_pair: ['grass', 'poison'] } },
      ];
    },
    async fetchVideoById(videoId) {
      return {
        id: videoId,
        source_data: {
          type_pair: videoId === 'video-2' ? ['fighting', 'flying'] : ['grass', 'poison'],
          background_path: videoId === 'video-2' ? '/tmp/background-2.png' : '/tmp/background-1.png',
        },
      };
    },
  };

  const state = await loadPokeQuizzSelectionStateFromStore({
    store,
    channelProfile: {
      platform: 'youtube_shorts',
      account_key: 'poke-quizz-youtube',
    },
    limit: 8,
  });

  assert.equal(state.last_type_pair_key, 'fighting|flying');
  assert.equal(state.last_background_path, '/tmp/background-2.png');
  assert.equal(
    state.used_video_signatures.includes(
      createPokeQuizzVideoSignatureKey(['grass', 'poison'], '/tmp/background-1.png'),
    ),
    true,
  );
});
