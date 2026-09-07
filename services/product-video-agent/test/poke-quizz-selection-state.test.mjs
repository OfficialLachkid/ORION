import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPokeQuizzSelectionStateFromHistory,
  createPokeQuizzVideoSignatureKey,
  loadPokeQuizzSelectionStateFromStore,
  mergePokeQuizzSelectionStates,
  normalizePokeQuizzSelectionState,
  resolvePokeQuizzSelectionStatePath,
} from '../src/poke-quizz-selection-state.mjs';

test('normalizePokeQuizzSelectionState folds the last video into the used signature history', () => {
  const state = normalizePokeQuizzSelectionState({
    last_type_pair_key: 'water|psychic',
    last_background_path: 'C:\\tmp\\Background-1.png',
    used_video_signatures: ['water|psychic::c:/tmp/background-1.png'],
    type_pair_usage_counts: {
      'water|psychic': 3,
    },
  });

  assert.equal(state.last_type_pair_key, 'psychic|water');
  assert.equal(state.last_background_path, 'c:/tmp/background-1.png');
  assert.deepEqual(state.used_video_signatures, ['psychic|water::c:/tmp/background-1.png']);
  assert.deepEqual(state.type_pair_usage_counts, {
    'psychic|water': 3,
  });
});

test('mergePokeQuizzSelectionStates prefers the first recent state and unions signature history', () => {
  const merged = mergePokeQuizzSelectionStates(
    {
      last_type_pair_key: 'fighting|flying',
      last_background_path: '/tmp/background-2.png',
      used_video_signatures: ['fighting|flying::/tmp/background-2.png'],
      type_pair_usage_counts: {
        'fighting|flying': 2,
        'grass|poison': 1,
      },
    },
    {
      last_type_pair_key: 'grass|poison',
      last_background_path: '/tmp/background-1.png',
      used_video_signatures: ['grass|poison::/tmp/background-1.png'],
      type_pair_usage_counts: {
        'grass|poison': 4,
      },
    },
  );

  assert.equal(merged.last_type_pair_key, 'fighting|flying');
  assert.equal(merged.last_background_path, '/tmp/background-2.png');
  assert.deepEqual(merged.used_video_signatures, [
    'fighting|flying::/tmp/background-2.png',
    'grass|poison::/tmp/background-1.png',
  ]);
  assert.deepEqual(merged.type_pair_usage_counts, {
    'fighting|flying': 2,
    'grass|poison': 4,
  });
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
    {
      publication: {
        status: 'deleted',
        metadata: {
          type_pair: ['grass', 'poison'],
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
  assert.deepEqual(state.type_pair_usage_counts, {
    'fighting|flying': 1,
    'grass|poison': 1,
  });
});

test('loadPokeQuizzSelectionStateFromStore derives history from recent channel publications', async () => {
  const store = {
    async fetchPublicationsByChannel() {
      return [
        { id: 'pub-2', video_id: 'video-2', status: 'approved', metadata: { type_pair: ['fighting', 'flying'] } },
        { id: 'pub-1', video_id: 'video-1', status: 'deleted', metadata: { type_pair: ['grass', 'poison'] } },
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
  assert.deepEqual(state.type_pair_usage_counts, {
    'fighting|flying': 1,
  });
  assert.equal(
    state.used_video_signatures.includes(
      createPokeQuizzVideoSignatureKey(['grass', 'poison'], '/tmp/background-1.png'),
    ),
    true,
  );
});

test('resolvePokeQuizzSelectionStatePath scopes runtime state by template', () => {
  assert.equal(
    resolvePokeQuizzSelectionStatePath({ template_id: 'pokemon.find-the-shiny.v1' }),
    'data/runtime/product-video-agent/poke-quizz/selection-state-find-the-shiny.json',
  );
  assert.equal(
    resolvePokeQuizzSelectionStatePath({ template_id: 'pokemon.dual-type-reveal.v1' }),
    'data/runtime/product-video-agent/poke-quizz/selection-state-dual-type-reveal.json',
  );
  assert.equal(
    resolvePokeQuizzSelectionStatePath({ template_id: 'pokemon.type-quiz.v1' }),
    'data/runtime/product-video-agent/poke-quizz/selection-state-type-quiz.json',
  );
  assert.equal(
    resolvePokeQuizzSelectionStatePath({ template_id: 'pokemon.memory.v1' }),
    'data/runtime/product-video-agent/poke-quizz/selection-state-memory.json',
  );
  assert.equal(
    resolvePokeQuizzSelectionStatePath({ template_id: 'pokemon.know-your-shiny.v1' }),
    'data/runtime/product-video-agent/poke-quizz/selection-state-know-your-shiny.json',
  );
  assert.equal(
    resolvePokeQuizzSelectionStatePath({ template_id: 'pokemon.stat-clash.v1' }),
    'data/runtime/product-video-agent/poke-quizz/selection-state-stat-clash.json',
  );
  assert.equal(
    resolvePokeQuizzSelectionStatePath({ template_id: 'pokemon.type-speed-quiz.v1' }),
    'data/runtime/product-video-agent/poke-quizz/selection-state-type-quiz.json',
  );
});

test('loadPokeQuizzSelectionStateFromStore filters history by template scope', async () => {
  const store = {
    async fetchPublicationsByChannel() {
      return [
        {
          id: 'pub-find-2',
          video_id: 'video-find-2',
          status: 'approved',
          metadata: { type_pair: ['rock', 'fairy'], template_id: 'pokemon.find-the-shiny.v1' },
        },
        {
          id: 'pub-dual-1',
          video_id: 'video-dual-1',
          status: 'approved',
          metadata: { type_pair: ['water', 'flying'], template_id: 'pokemon.dual-type-reveal.v1' },
        },
        {
          id: 'pub-find-1',
          video_id: 'video-find-1',
          status: 'deleted',
          metadata: { type_pair: ['bug', 'poison'], template_id: 'pokemon.find-the-shiny.v1' },
        },
      ];
    },
    async fetchVideoById(videoId) {
      if (videoId === 'video-find-2') {
        return {
          id: videoId,
          template_key: 'find-the-shiny',
          source_data: {
            type_pair: ['rock', 'fairy'],
            background_path: '/tmp/background-find-2.png',
          },
        };
      }
      if (videoId === 'video-dual-1') {
        return {
          id: videoId,
          template_key: 'dual-type-reveal',
          source_data: {
            type_pair: ['water', 'flying'],
            background_path: '/tmp/background-dual-1.png',
          },
        };
      }
      return {
        id: videoId,
        template_key: 'find-the-shiny',
        source_data: {
          type_pair: ['bug', 'poison'],
          background_path: '/tmp/background-find-1.png',
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
    templateId: 'pokemon.find-the-shiny.v1',
    limit: 8,
  });

  assert.equal(state.last_type_pair_key, 'fairy|rock');
  assert.equal(state.last_background_path, '/tmp/background-find-2.png');
  assert.deepEqual(state.type_pair_usage_counts, {
    'fairy|rock': 1,
  });
  assert.equal(
    state.used_video_signatures.includes(
      createPokeQuizzVideoSignatureKey(['water', 'flying'], '/tmp/background-dual-1.png'),
    ),
    false,
  );
});
