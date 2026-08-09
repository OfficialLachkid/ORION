import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  inferVoiceProfileGender,
  resolvePokeQuizzVoiceRuntime,
  selectPokeQuizzVoiceProfile,
} from '../src/poke-quizz-voice-runtime.mjs';

const config = {
  voice: {
    executable: '.venv-product-video-kokoro/bin/python',
    data_directory: 'data/runtime/product-video-agent/models/kokoro',
    script_path: 'services/product-video-agent/scripts/kokoro-synthesize.py',
    default_profile_id: 'us-female-kokoro-heart',
    profiles: [
      {
        profile_id: 'us-female-kokoro-heart',
        voice: 'af_heart',
      },
      {
        profile_id: 'us-male-kokoro-deep',
        voice: 'am_fenrir,am_onyx',
      },
    ],
  },
};

const template = {
  template_id: 'pokemon.find-the-shiny.v1',
  audio: {
    voice_profile_selection: {
      mode: 'seeded_random',
      allowed_genders: ['female', 'male'],
      allow_profile_ids: ['us-female-kokoro-heart', 'us-male-kokoro-deep'],
    },
  },
};

test('inferVoiceProfileGender detects Kokoro female and male voices', () => {
  assert.equal(inferVoiceProfileGender(config.voice.profiles[0]), 'female');
  assert.equal(inferVoiceProfileGender(config.voice.profiles[1]), 'male');
});

test('selectPokeQuizzVoiceProfile uses deterministic seeded random selection when configured', () => {
  const firstSelection = selectPokeQuizzVoiceProfile({
    config,
    template,
    plan: { seed: 'find-the-shiny-seed-a' },
  });
  const secondSelection = selectPokeQuizzVoiceProfile({
    config,
    template,
    plan: { seed: 'find-the-shiny-seed-a' },
  });
  const alternateSelection = selectPokeQuizzVoiceProfile({
    config,
    template,
    plan: { seed: 'find-the-shiny-seed-b' },
  });

  assert.equal(firstSelection.profile_id, secondSelection.profile_id);
  assert.equal(
    ['us-female-kokoro-heart', 'us-male-kokoro-deep'].includes(firstSelection.profile_id),
    true,
  );
  assert.equal(
    ['us-female-kokoro-heart', 'us-male-kokoro-deep'].includes(alternateSelection.profile_id),
    true,
  );
});

test('selectPokeQuizzVoiceProfile respects explicit profile overrides', () => {
  const profile = selectPokeQuizzVoiceProfile({
    config,
    template,
    plan: { seed: 'find-the-shiny-seed-a' },
    overrideProfileId: 'us-male-kokoro-deep',
  });

  assert.equal(profile.profile_id, 'us-male-kokoro-deep');
});

test('selectPokeQuizzVoiceProfile falls back to the default profile when seeded candidates are unavailable', () => {
  const profile = selectPokeQuizzVoiceProfile({
    config,
    template: {
      ...template,
      audio: {
        voice_profile_selection: {
          mode: 'seeded_random',
          allow_profile_ids: ['missing-profile'],
          allowed_genders: ['robot'],
        },
      },
    },
    plan: { seed: 'find-the-shiny-seed-a' },
  });

  assert.equal(profile.profile_id, 'us-female-kokoro-heart');
});

test('resolvePokeQuizzVoiceRuntime builds absolute runtime paths and seeded profile selection', () => {
  const runtime = resolvePokeQuizzVoiceRuntime({
    config,
    template,
    plan: { seed: 'find-the-shiny-seed-a' },
    projectRoot: '/workspace/orion',
  });

  assert.equal(runtime.pythonExecutable, resolve('/workspace/orion', '.venv-product-video-kokoro/bin/python'));
  assert.equal(runtime.scriptPath, resolve('/workspace/orion', 'services/product-video-agent/scripts/kokoro-synthesize.py'));
  assert.equal(runtime.cacheDir, resolve('/workspace/orion', 'data/runtime/product-video-agent/models/kokoro'));
  assert.equal(
    ['us-female-kokoro-heart', 'us-male-kokoro-deep'].includes(runtime.profile.profile_id),
    true,
  );
});
