import test from 'node:test';
import assert from 'node:assert/strict';
import { createPokeQuizzPublicationRegistration, mergeRegisteredPublicationRow } from '../src/poke-quizz-publication-registration.mjs';
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
});

const plan = {
  schema_version: 'poke-quizz-plan-v1',
  template_id: 'pokemon.type-quiz.v1',
  template_key: 'type-quiz',
  seed: 'random-20260731t190729z',
  selection: {
    type_pair: ['psychic', 'water'],
    catalog_match_count: 4,
    compatible_display_count: 4,
    selected_subjects: [
      { name: 'Slowpoke', types: ['psychic', 'water'] },
      { name: 'Starmie', types: ['psychic', 'water'] },
    ],
  },
  narration: {
    lines: [
      { role: 'hook', text: 'Guess the Pokemon' },
      { role: 'prompt', text: 'These Pokemon share two types.' },
      { role: 'reveal', text: 'The answer is here.' },
    ],
  },
  assets: {
    background: {
      selected_path: '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Backgrounds/beach-backgrounds/beach-background.jpg',
    },
    outputs: {
      previews_directory: '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Previews/Type Quiz',
    },
  },
};

test('Poke Quizz publication registration creates pending preview-upload rows', async () => {
  const registration = await createPokeQuizzPublicationRegistration({
    plan,
    channelProfile,
    renderPath: '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Previews/Type Quiz/psychic-water-random-20260731t190729z.mp4',
    metadata: {
      title: 'Psychic/Water Type Quiz - Can You Guess?',
      description: 'Beat the timer.',
      hashtags: ['#pokemon', '#shorts'],
      generation_provider: 'template',
      model: 'fallback',
    },
    registeredAt: '2026-07-31T19:30:00.000Z',
    renderFileDetails: {
      sizeBytes: 1024,
      modifiedAt: '2026-07-31T19:07:29.000Z',
    },
  });

  assert.equal(registration.videoRow.status, 'completed');
  assert.equal(registration.videoRow.render.output_file_name, 'psychic-water-random-20260731t190729z.mp4');
  assert.equal(registration.publicationRow.visibility, 'unlisted');
  assert.equal(registration.publicationRow.metadata.workflow_state, 'preview_upload_pending');
  assert.deepEqual(registration.publicationRow.metadata.type_pair, ['psychic', 'water']);
  assert.match(registration.publicationRow.metadata.background_path || '', /beach-backgrounds/u);
});

test('mergeRegisteredPublicationRow preserves upload state on re-registration', () => {
  const merged = mergeRegisteredPublicationRow({
    id: 'publication-1',
    status: 'approved',
    visibility: 'unlisted',
    preview_url: 'https://youtube.com/shorts/abc123',
    external_id: 'abc123',
    metadata: {
      workflow_state: 'preview_uploaded',
    },
  }, {
    id: 'publication-1',
    status: 'approved',
    visibility: 'unlisted',
    preview_url: null,
    external_id: null,
    metadata: {
      workflow_state: 'preview_upload_pending',
      type_pair: ['psychic', 'water'],
    },
  });

  assert.equal(merged.preview_url, 'https://youtube.com/shorts/abc123');
  assert.equal(merged.external_id, 'abc123');
  assert.equal(merged.metadata.workflow_state, 'preview_uploaded');
  assert.deepEqual(merged.metadata.type_pair, ['psychic', 'water']);
});
