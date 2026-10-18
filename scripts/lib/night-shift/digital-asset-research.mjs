import { resolve } from 'node:path';
import { projectRoot } from '../../../services/lib/runtime-config.mjs';
import { loadResearchConfig } from '../../../services/digital-asset-research/src/pipeline.mjs';
import {
  DEFAULT_MINIMUM_INTERVAL_MS,
  resolveResearchSchedulePaths,
  runScheduledDigitalAssetResearch,
} from '../digital-asset-research-schedule.mjs';

export const NIGHT_SHIFT_RESEARCH_MAX_RUNTIME_MS = 10 * 60 * 1000;

export async function runNightShiftDigitalAssetResearch(runtimeConfig, options = {}) {
  const root = options.projectRoot || projectRoot;
  const assetArchiveRoot = String(runtimeConfig.env.DIGITAL_ASSET_ARCHIVE_ROOT || '')
    .trim()
    .replace(/[\\/]+$/u, '');
  if (!assetArchiveRoot) throw new Error('DIGITAL_ASSET_ARCHIVE_ROOT is required.');

  const archiveRoot = resolve(assetArchiveRoot, 'research');
  const paths = resolveResearchSchedulePaths(root, archiveRoot);
  const researchConfig = await loadResearchConfig(
    'services/digital-asset-research/config.example.json',
    root,
    { archiveRoot },
  );

  return runScheduledDigitalAssetResearch({
    ...paths,
    ollamaBaseUrl: researchConfig.model.endpoint,
    ollamaModel: researchConfig.model.model,
    maxRuntimeMs: options.maxRuntimeMs || NIGHT_SHIFT_RESEARCH_MAX_RUNTIME_MS,
    minimumIntervalMs: options.minimumIntervalMs || DEFAULT_MINIMUM_INTERVAL_MS,
  });
}
