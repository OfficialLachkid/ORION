import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPokeQuizzFallbackPublicationMetadata,
  generatePokeQuizzPublicationMetadata,
  resolvePokeQuizzPublicationMetadata,
} from '../src/local-publication-metadata.mjs';
import { normalizePublicationChannelProfile } from '../src/publication-channels.mjs';

const channelProfile = normalizePublicationChannelProfile({
  id: 'video-channel-poke-quizz-youtube',
  name: 'Poke Quizz',
  niche: 'pokemon_quiz',
  content_lane: 'poke-quizz',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  language: 'en-US',
  timezone: 'Europe/Amsterdam',
  status: 'active',
  schedule_slots: [{ hour: 8, minute: 0 }],
  workflow: {
    preview_visibility: 'unlisted',
    publish_visibility: 'public',
    require_preview_approval: true,
    require_publish_approval: true,
    delete_preview_on_reject: true,
  },
  youtube: {
    channel_id: 'UC-POKE-QUIZZ',
    default_category_id: '24',
    oauth_client_secret_path: 'config/youtube/client-secret.json',
    oauth_refresh_token_env: 'YOUTUBE_POKE_QUIZZ_REFRESH_TOKEN',
  },
  metadata: {
    title_generation_model: 'local_ollama',
    description_generation_model: 'local_ollama',
  },
});

const plan = {
  template_id: 'pokemon.dual-type-reveal.v1',
  selection: {
    type_pair: ['psychic', 'water'],
    selected_subjects: [{ name: 'Slowpoke' }, { name: 'Starmie' }],
  },
};

const findTheShinyPlan = {
  template_id: 'pokemon.find-the-shiny.v1',
  selection: {
    type_pair: ['rock', 'fairy'],
    selected_subjects: [{ name: 'Carbink' }],
  },
};

const typeQuizPlan = {
  template_id: 'pokemon.type-quiz.v1',
  selection: {
    mode: 'random',
    round_count: 5,
    selected_subjects: [
      { name: 'Pikachu' },
      { name: 'Bulbasaur' },
      { name: 'Gengar' },
      { name: 'Eevee' },
      { name: 'Dragonite' },
    ],
  },
};

const memoryPlan = {
  template_id: 'pokemon.memory.v1',
  selection: {
    type_pair: ['fire', 'ice'],
    display_subject_count: 6,
    selected_subjects: [
      { name: 'Vulpix' },
      { name: 'Growlithe' },
      { name: 'Ponyta' },
      { name: 'Magmar' },
      { name: 'Flareon' },
      { name: 'Articuno' },
    ],
  },
  question: {
    question_text: 'Which Pokemon was NOT on screen?',
  },
};

const expectedSeededTitles = new Set([
  'Psychic/Water Type Quiz - Can You Guess?',
  'Can You Guess This Psychic/Water Pokemon?',
  'Psychic/Water Pokemon Quiz - Beat the Timer',
  'Which Pokemon Fits Psychic/Water?',
  'Psychic/Water Challenge - Name These Pokemon',
]);

const expectedFindTheShinySeededTitles = new Set([
  'Find the Shiny Pokemon',
  'Find the Shiny ✨',
]);

const expectedTypeQuizSeededTitles = new Set([
  'Guess the typing!',
]);

const expectedMemorySeededTitles = new Set([
  'Pokemon Memory Challenge',
  'Can You Remember These Pokemon?',
]);

test('fallback publication metadata keeps the quiz type pair intact', () => {
  const metadata = buildPokeQuizzFallbackPublicationMetadata(plan);
  assert.equal(metadata.title, 'Psychic/Water Type Quiz - Can You Guess?');
  assert.equal(
    metadata.description,
    "Think you're a Pokémon master? Take this timed quiz to see how well you know your Psychic/Water types! I've got 2 tricky ones for you to guess.",
  );
  assert.ok(metadata.hashtags.includes('#pokemon'));
  assert.ok(metadata.hashtags.includes('#psychictype'));
  assert.ok(metadata.hashtags.includes('#watertype'));
});

test('local publication metadata uses Ollama output when available', async () => {
  const metadata = await generatePokeQuizzPublicationMetadata({
    plan,
    config: {
      script: {
        provider: 'ollama',
        endpoint: 'http://127.0.0.1:11434',
        model: 'llama3.1:8b',
        keep_alive: '0s',
      },
    },
    channelProfile,
    fetchImpl: async () => Response.json({
      response: JSON.stringify({
        title: 'Guess the Psychic / Water Pair',
        description: 'Timed Pokemon quiz short.',
        hashtags: ['pokemon', '#shorts', 'watertype', 'psychictype'],
      }),
    }),
  });

  assert.equal(metadata.title, 'Psychic/Water Type Quiz - Can You Guess?');
  assert.equal(
    metadata.description,
    "Think you're a Pokémon master? Take this timed quiz to see how well you know your Psychic/Water types! I've got 2 tricky ones for you to guess.",
  );
  assert.deepEqual(metadata.hashtags, ['#pokemon', '#shorts', '#watertype', '#psychictype']);
  assert.equal(metadata.generation_provider, 'ollama');
});

test('resolved publication metadata falls back deterministically when the local model is disabled', async () => {
  const metadata = await resolvePokeQuizzPublicationMetadata({
    plan,
    config: {
      script: {
        provider: 'ollama',
        endpoint: 'http://127.0.0.1:11434',
        model: 'llama3.1:8b',
      },
    },
    channelProfile,
    localModel: false,
  });

  assert.equal(metadata.title, 'Psychic/Water Type Quiz - Can You Guess?');
  assert.equal(metadata.generation_provider, 'template');
  assert.equal(metadata.model, 'fallback');
});

test('seeded fallback publication metadata varies the title deterministically', () => {
  const firstSeeded = buildPokeQuizzFallbackPublicationMetadata({
    ...plan,
    seed: 'psychic-water-random-20260804t080000z',
  });
  const secondSeeded = buildPokeQuizzFallbackPublicationMetadata({
    ...plan,
    seed: 'psychic-water-random-20260804t120000z',
  });

  assert.ok(expectedSeededTitles.has(firstSeeded.title));
  assert.ok(expectedSeededTitles.has(secondSeeded.title));
  assert.notEqual(firstSeeded.title, secondSeeded.title);
});

test('fallback publication metadata frames find-the-shiny as a shiny challenge', () => {
  const metadata = buildPokeQuizzFallbackPublicationMetadata(findTheShinyPlan);

  assert.equal(metadata.title, 'Find the Shiny Pokemon');
  assert.equal(
    metadata.description,
    'One of these Rock/Fairy Pokemon turns shiny after the countdown. Pick a spot before the reveal.',
  );
  assert.deepEqual(metadata.hashtags, [
    '#pokemon',
    '#findtheshiny',
    '#shinypokemon',
    '#rocktype',
    '#fairytype',
    '#shorts',
  ]);
});

test('seeded find-the-shiny fallback metadata uses the supported generic title variants', () => {
  const firstSeeded = buildPokeQuizzFallbackPublicationMetadata({
    ...findTheShinyPlan,
    seed: 'find-the-shiny-rock-fairy-1',
  });
  const secondSeeded = buildPokeQuizzFallbackPublicationMetadata({
    ...findTheShinyPlan,
    seed: 'find-the-shiny-rock-fairy-2',
  });

  assert.ok(expectedFindTheShinySeededTitles.has(firstSeeded.title));
  assert.ok(expectedFindTheShinySeededTitles.has(secondSeeded.title));
  assert.notEqual(firstSeeded.title, secondSeeded.title);
});

test('fallback publication metadata frames type-quiz as a rapid-fire challenge', () => {
  const metadata = buildPokeQuizzFallbackPublicationMetadata(typeQuizPlan);

  assert.equal(metadata.title, 'Guess the typing!');
  assert.equal(
    metadata.description,
    'Can you get 5/5? Watch each Pokemon, beat the timer, and lock in its type before the reveal.',
  );
  assert.deepEqual(metadata.hashtags, [
    '#pokemon',
    '#pokemontypes',
    '#typequiz',
    '#pokemonquiz',
    '#shorts',
  ]);
});

test('seeded type-quiz fallback metadata uses the supported generic title variants', () => {
  const firstSeeded = buildPokeQuizzFallbackPublicationMetadata({
    ...typeQuizPlan,
    seed: 'type-quiz-seed-1',
  });
  const secondSeeded = buildPokeQuizzFallbackPublicationMetadata({
    ...typeQuizPlan,
    seed: 'type-quiz-seed-2',
  });

  assert.ok(expectedTypeQuizSeededTitles.has(firstSeeded.title));
  assert.ok(expectedTypeQuizSeededTitles.has(secondSeeded.title));
  assert.equal(firstSeeded.title, 'Guess the typing!');
  assert.equal(secondSeeded.title, 'Guess the typing!');
});

test('fallback publication metadata frames memory as a rapid recall challenge', () => {
  const metadata = buildPokeQuizzFallbackPublicationMetadata(memoryPlan);

  assert.equal(metadata.title, 'Pokemon Memory Challenge');
  assert.equal(
    metadata.description,
    'Memorize 6 Pokemon, hide the board, and pick the one that never appeared before the timer ends.',
  );
  assert.deepEqual(metadata.hashtags, [
    '#pokemon',
    '#pokemonmemory',
    '#memorychallenge',
    '#firetype',
    '#icetype',
    '#shorts',
  ]);
});

test('seeded memory fallback metadata uses the supported generic title variants', () => {
  const firstSeeded = buildPokeQuizzFallbackPublicationMetadata({
    ...memoryPlan,
    seed: 'memory-seed-1',
  });
  const secondSeeded = buildPokeQuizzFallbackPublicationMetadata({
    ...memoryPlan,
    seed: 'memory-seed-2',
  });

  assert.ok(expectedMemorySeededTitles.has(firstSeeded.title));
  assert.ok(expectedMemorySeededTitles.has(secondSeeded.title));
});
