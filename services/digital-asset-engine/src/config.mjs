import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { EngineConfigSchema } from './schemas.mjs';

export async function loadEngineConfig(configPath, projectRoot = process.cwd(), overrides = {}) {
  const absolutePath = isAbsolute(configPath) ? configPath : resolve(projectRoot, configPath);
  const parsed = JSON.parse(await readFile(absolutePath, 'utf8'));
  const generationOverrides = overrides.generation || {};
  return EngineConfigSchema.parse({
    ...parsed,
    ...overrides,
    output_root: overrides.output_root || process.env.DIGITAL_ASSET_ARCHIVE_ROOT || parsed.output_root,
    generation: {
      ...parsed.generation,
      endpoint: process.env.OLLAMA_URL || parsed.generation.endpoint,
      model: process.env.DIGITAL_ASSET_IMAGE_MODEL || parsed.generation.model,
      ...generationOverrides,
    },
  });
}

export function resolveOutputRoot(config, projectRoot = process.cwd()) {
  return isAbsolute(config.output_root)
    ? resolve(config.output_root)
    : resolve(projectRoot, config.output_root);
}
