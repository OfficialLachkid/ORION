import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClippingConfigSummary, loadClippingEngineConfig } from './src/config.mjs';

export async function validateClippingEngine(options = {}) {
  const config = await loadClippingEngineConfig(options.configPath, options.projectRoot);
  return {
    schema: 'orion-clipping-engine-validation.v1',
    status: 'validated',
    ...buildClippingConfigSummary(config),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] || 'validate';
  if (command !== 'validate') throw new Error(`Unsupported clipping command: ${command}`);
  const configFlagIndex = process.argv.indexOf('--config');
  const configPath = configFlagIndex >= 0 ? process.argv[configFlagIndex + 1] : undefined;
  const result = await validateClippingEngine({ configPath });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
