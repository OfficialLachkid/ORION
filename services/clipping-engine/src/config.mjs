import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { ClippingEngineConfigSchema } from './schemas.mjs';

export const DEFAULT_CLIPPING_CONFIG_PATH = 'config/clipping/engine.example.json';

export async function loadClippingEngineConfig(
  configPath = DEFAULT_CLIPPING_CONFIG_PATH,
  projectRoot = process.cwd(),
) {
  const absolutePath = isAbsolute(configPath) ? configPath : resolve(projectRoot, configPath);
  const parsed = JSON.parse(await readFile(absolutePath, 'utf8'));
  return ClippingEngineConfigSchema.parse(parsed);
}

export function buildClippingConfigSummary(config) {
  return {
    schema_version: config.schema_version,
    enabled: config.enabled,
    marketplace_count: config.marketplaces.length,
    channel_profile_count: config.channel_profiles.length,
    search_profiles: config.search_profiles.map((profile) => ({
      key: profile.key,
      channel_profile_key: profile.channel_profile_key,
      enabled: profile.enabled,
    })),
    budgets: config.budgets,
  };
}
