import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PipelineConfigSchema, VoiceLicenseRecordSchema } from './schemas.mjs';

export async function loadPipelineConfig(configPath, projectRoot = process.cwd(), overrides = {}) {
  const absolutePath = resolve(projectRoot, configPath);
  const parsed = JSON.parse(await readFile(absolutePath, 'utf8'));
  return PipelineConfigSchema.parse({
    ...parsed,
    ...overrides,
  });
}

export function selectVoiceProfile(config, index = 0) {
  const profiles = config.voice.profiles;
  const profileId = config.voice.assignment_strategy === 'round_robin'
    ? profiles[index % profiles.length].profile_id
    : config.voice.default_profile_id;
  const profile = profiles.find((item) => item.profile_id === profileId);
  if (!profile) {
    throw new Error(`Configured voice profile ${profileId} was not found.`);
  }
  return profile;
}

export async function loadVoiceLicenseRecord(config, projectRoot = process.cwd(), profileInput) {
  const profile = profileInput || selectVoiceProfile(config);
  const absolutePath = resolve(projectRoot, profile.license_record_path);
  const parsed = JSON.parse(await readFile(absolutePath, 'utf8'));
  const record = VoiceLicenseRecordSchema.parse(parsed);
  if (record.voice_id !== profile.model) {
    throw new Error(`Voice license record ${record.voice_id} does not match configured model ${profile.model}.`);
  }
  return record;
}

export async function loadVoiceLicenseRecords(config, projectRoot = process.cwd()) {
  const records = await Promise.all(config.voice.profiles.map((profile) => (
    loadVoiceLicenseRecord(config, projectRoot, profile)
  )));
  return [...new Map(records.map((record) => [record.voice_id, record])).values()];
}
