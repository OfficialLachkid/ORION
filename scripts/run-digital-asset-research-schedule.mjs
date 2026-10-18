#!/usr/bin/env node
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { loadResearchConfig } from '../services/digital-asset-research/src/pipeline.mjs';
import { recordOpsMetric } from '../services/lib/metrics-store.mjs';
import {
  DEFAULT_MAX_RUNTIME_MS,
  DEFAULT_MINIMUM_INTERVAL_MS,
  resolveResearchSchedulePaths,
  runScheduledDigitalAssetResearch,
} from './lib/digital-asset-research-schedule.mjs';

function getNumberArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const parsed = Number(process.argv[index + 1]);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} expects a positive number.`);
  return parsed;
}

async function main() {
  const runtimeConfig = loadRuntimeConfig({ envFilePath: 'config/discord/.env' });
  const archiveRoot = `${String(runtimeConfig.env.DIGITAL_ASSET_ARCHIVE_ROOT || '').replace(/\/+$/u, '')}/research`;
  if (archiveRoot === '/research') throw new Error('DIGITAL_ASSET_ARCHIVE_ROOT is required.');
  const paths = resolveResearchSchedulePaths(projectRoot, archiveRoot);
  const researchConfig = await loadResearchConfig(
    'services/digital-asset-research/config.example.json',
    projectRoot,
    { archiveRoot },
  );
  const result = await runScheduledDigitalAssetResearch({
    ...paths,
    ollamaBaseUrl: researchConfig.model.endpoint,
    ollamaModel: researchConfig.model.model,
    maxRuntimeMs: getNumberArg('--max-runtime-minutes', DEFAULT_MAX_RUNTIME_MS / 60_000) * 60_000,
    minimumIntervalMs: getNumberArg('--minimum-interval-hours', DEFAULT_MINIMUM_INTERVAL_MS / 3_600_000) * 3_600_000,
  });
  recordOpsMetric(runtimeConfig, 'digital_asset_research_schedule_run', result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});
