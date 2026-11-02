import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assetSlugFromPath,
  buildVideoSignals,
  createPokeQuizzPublicationRegistration,
  mergeRegisteredPublicationRow,
} from '../src/poke-quizz-publication-registration.mjs';
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
    reveal_methods: ['spiral', 'diamond', 'cross'],
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
  assert.deepEqual(registration.videoRow.source_data.reveal_methods, ['spiral', 'diamond', 'cross']);
  assert.match(registration.publicationRow.metadata.background_path || '', /beach-backgrounds/u);
});

// ─── video_signals pilot (2026-11-02 — stat-clash first) ────────────

test('assetSlugFromPath returns the basename stem — no extension, no directory', () => {
  assert.equal(
    assetSlugFromPath('/Volumes/T7/.../Backgrounds/neon-plasma-armory.jpg'),
    'neon-plasma-armory',
  );
  assert.equal(
    assetSlugFromPath('/x/audio/upbeat-electronic-01.wav'),
    'upbeat-electronic-01',
  );
  assert.equal(assetSlugFromPath(''), null);
  assert.equal(assetSlugFromPath(null), null);
  assert.equal(assetSlugFromPath('bare-name'), 'bare-name');
});

test('buildVideoSignals emits a compact object for a fully-populated stat-clash plan', () => {
  const statClashPlan = {
    selection: {
      difficulty_id: 'hard',
      round_count: 7,
      pool_key: 'gen1_starters',
    },
    assets: {
      background: { selected_path: '/x/backgrounds/neon-plasma-armory.jpg' },
      audio: { selected_battle_intro_music_path: '/y/music/upbeat-01.wav' },
    },
    timing: { total_duration_seconds: 48.57 },
  };
  const signals = buildVideoSignals(statClashPlan);
  assert.deepEqual(signals, {
    variant: { difficulty: 'hard', round_count: 7 },
    selection: { background_slug: 'neon-plasma-armory', music_slug: 'upbeat-01' },
    shape: { duration_seconds: 48.6, subject_pool: 'gen1_starters' },
  });
  // Egress discipline — the whole object should be under ~300 bytes to
  // keep the publication-metadata JSONB from inflating. See
  // Jacobs-2/07_Products/Product_Video_Agent/Runtime_Ops.md § egress.
  assert.ok(JSON.stringify(signals).length < 300, 'video_signals must stay compact');
});

test('buildVideoSignals returns null for a plan with no variant / selection / shape data', () => {
  assert.equal(buildVideoSignals(null), null);
  assert.equal(buildVideoSignals({}), null);
  assert.equal(buildVideoSignals({ selection: {}, assets: {}, timing: {} }), null);
});

test('buildVideoSignals is null-safe — only populates sub-objects that have at least one value', () => {
  const planOnlyVariant = { selection: { difficulty_id: 'easy', round_count: 3 } };
  assert.deepEqual(buildVideoSignals(planOnlyVariant), {
    variant: { difficulty: 'easy', round_count: 3 },
  });
  const planOnlySelection = {
    assets: { background: { selected_path: '/x/beach-01.jpg' } },
  };
  assert.deepEqual(buildVideoSignals(planOnlySelection), {
    selection: { background_slug: 'beach-01' },
  });
});

test('publication registration attaches video_signals when the plan carries variant data (stat-clash shape)', async () => {
  const statClashPlan = {
    ...plan,
    template_id: 'pokemon.stat-clash.v3',
    template_key: 'stat-clash',
    selection: {
      ...plan.selection,
      difficulty_id: 'hard',
      round_count: 7,
      pool_key: 'kanto',
    },
    assets: {
      ...plan.assets,
      audio: { selected_battle_intro_music_path: '/music/upbeat-01.wav' },
    },
    timing: { total_duration_seconds: 48 },
  };
  const registration = await createPokeQuizzPublicationRegistration({
    plan: statClashPlan,
    channelProfile,
    renderPath: '/Volumes/T7/.../stat-clash-video.mp4',
    metadata: { title: 'x', description: 'y', hashtags: ['#a', '#b', '#c'] },
    registeredAt: '2026-11-02T19:30:00.000Z',
    renderFileDetails: { sizeBytes: 1024, modifiedAt: '2026-11-02T19:07:29.000Z' },
  });
  assert.equal(registration.publicationRow.metadata.video_signals.variant.difficulty, 'hard');
  assert.equal(registration.publicationRow.metadata.video_signals.variant.round_count, 7);
  assert.equal(registration.publicationRow.metadata.video_signals.shape.subject_pool, 'kanto');
  assert.equal(registration.publicationRow.metadata.video_signals.selection.music_slug, 'upbeat-01');
  assert.match(registration.publicationRow.metadata.video_signals.selection.background_slug, /beach/u);
});

test('publication registration still emits ONLY the sub-objects it actually has — un-onboarded template gets just the background slug (free signal, no variant/music keys)', async () => {
  // The baseline `plan` fixture is a type-quiz with no difficulty_id,
  // round_count, music path, or duration. It DOES have a background,
  // so video_signals carries just selection.background_slug — a free
  // asset signal every poke-quizz template gets even without being
  // explicitly onboarded. The empty sub-objects (variant/shape) are
  // omitted entirely so metadata stays flat.
  const registration = await createPokeQuizzPublicationRegistration({
    plan,
    channelProfile,
    renderPath: '/x/preview.mp4',
    metadata: { title: 'x', description: 'y', hashtags: ['#a', '#b', '#c'] },
    registeredAt: '2026-11-02T19:30:00.000Z',
    renderFileDetails: { sizeBytes: 1024, modifiedAt: '2026-11-02T19:07:29.000Z' },
  });
  const signals = registration.publicationRow.metadata.video_signals;
  assert.ok(signals, 'video_signals present because the plan carries a background path');
  assert.ok(signals.selection?.background_slug, 'background slug captured');
  assert.equal(signals.variant, undefined, 'no variant block for un-onboarded template');
  assert.equal(signals.shape, undefined, 'no shape block without duration or pool_key');
  assert.ok(JSON.stringify(signals).length < 100, 'un-onboarded signal payload is tiny');
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
