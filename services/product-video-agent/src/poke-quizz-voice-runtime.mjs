import { resolve } from 'node:path';

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'poke-quizz-default-seed')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createPrng(seedInput) {
  let seed = hashSeed(seedInput) || 1;
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let result = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeConfiguredList(values) {
  return Array.isArray(values)
    ? values.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
}

export function inferVoiceProfileGender(profile) {
  const voiceTokens = String(profile?.voice || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  for (const token of voiceTokens) {
    if (/^[a-z]f_/u.test(token)) {
      return 'female';
    }
    if (/^[a-z]m_/u.test(token)) {
      return 'male';
    }
  }

  const profileId = String(profile?.profile_id || '').trim().toLowerCase();
  if (profileId.includes('female')) {
    return 'female';
  }
  if (profileId.includes('male')) {
    return 'male';
  }
  return '';
}

function resolveVoiceProfileById(profiles, profileId) {
  return profiles.find((profile) => profile.profile_id === profileId) || null;
}

function selectSeededVoiceProfile(profiles, template, plan) {
  const selectionConfig = template?.audio?.voice_profile_selection
    && typeof template.audio.voice_profile_selection === 'object'
    ? template.audio.voice_profile_selection
    : {};
  const selectionMode = String(selectionConfig.mode || '').trim().toLowerCase();
  if (selectionMode !== 'seeded_random') {
    return null;
  }

  let candidates = [...profiles];
  const allowedProfileIds = normalizeConfiguredList(selectionConfig.allow_profile_ids);
  if (allowedProfileIds.length > 0) {
    const allowedSet = new Set(allowedProfileIds);
    const matchedProfiles = candidates.filter((profile) => allowedSet.has(profile.profile_id));
    if (matchedProfiles.length > 0) {
      candidates = matchedProfiles;
    }
  }

  const allowedGenders = normalizeConfiguredList(selectionConfig.allowed_genders)
    .map((value) => value.toLowerCase());
  if (allowedGenders.length > 0) {
    const allowedGenderSet = new Set(allowedGenders);
    const matchedProfiles = candidates.filter((profile) => allowedGenderSet.has(inferVoiceProfileGender(profile)));
    if (matchedProfiles.length > 0) {
      candidates = matchedProfiles;
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const random = createPrng(`${plan?.seed || ''}|${template?.template_id || ''}|voice-profile`);
  return candidates[Math.floor(random() * candidates.length)] || candidates[0];
}

export function selectPokeQuizzVoiceProfile({
  config,
  template = null,
  plan = null,
  overrideProfileId = '',
} = {}) {
  const profiles = Array.isArray(config?.voice?.profiles)
    ? config.voice.profiles
    : [];
  if (profiles.length === 0) {
    throw new Error('No voice profiles are configured.');
  }

  const explicitProfileId = String(overrideProfileId || '').trim();
  if (explicitProfileId) {
    const explicitProfile = resolveVoiceProfileById(profiles, explicitProfileId);
    if (!explicitProfile) {
      throw new Error(`Voice profile ${explicitProfileId} was not found in ${config.voice.default_profile_id}.`);
    }
    return explicitProfile;
  }

  const seededProfile = selectSeededVoiceProfile(profiles, template, plan);
  if (seededProfile) {
    return seededProfile;
  }

  const defaultProfileId = String(config?.voice?.default_profile_id || '').trim();
  const defaultProfile = resolveVoiceProfileById(profiles, defaultProfileId);
  if (!defaultProfile) {
    throw new Error(`Voice profile ${defaultProfileId} was not found in ${config.voice.default_profile_id}.`);
  }
  return defaultProfile;
}

export function resolvePokeQuizzVoiceRuntime({
  config,
  template = null,
  plan = null,
  projectRoot,
  voiceProfileId = '',
  voicePython = '',
  voiceScript = '',
  voiceCacheDir = '',
} = {}) {
  const profile = selectPokeQuizzVoiceProfile({
    config,
    template,
    plan,
    overrideProfileId: voiceProfileId,
  });

  return {
    pythonExecutable: resolve(projectRoot, voicePython || config.voice.executable),
    scriptPath: resolve(projectRoot, voiceScript || config.voice.script_path),
    cacheDir: resolve(projectRoot, voiceCacheDir || config.voice.data_directory),
    profile,
  };
}
