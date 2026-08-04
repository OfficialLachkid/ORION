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
  selection: {
    type_pair: ['psychic', 'water'],
    selected_subjects: [{ name: 'Slowpoke' }, { name: 'Starmie' }],
  },
};

const expectedSeededTitles = new Set([
  'Psychic/Water Type Quiz - Can You Guess?',
  'Can You Guess This Psychic/Water Pokemon?',
  'Psychic/Water Pokemon Quiz - Beat the Timer',
  'Which Pokemon Fits Psychic/Water?',
  'Psychic/Water Challenge - Name These Pokemon',
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
