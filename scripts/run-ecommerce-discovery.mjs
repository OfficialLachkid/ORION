#!/usr/bin/env node

import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { recordOpsMetric } from '../services/lib/metrics-store.mjs';
import {
  EcommerceDiscoveryBatchError,
  EcommerceDiscoveryPilotEndedError,
  ECOMMERCE_DISCOVERY_RESULT_SCHEMA,
  readEcommerceEnvironment,
  resolveEcommerceDiscoveryConfig,
  runEcommerceDiscovery,
  sanitizeOperationalError,
} from './lib/ecommerce-discovery.mjs';

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? '' : String(process.argv[index + 1] || '').trim();
}

async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write([
      'Usage: node scripts/run-ecommerce-discovery.mjs [--validate-only] [--pilot-end YYYY-MM-DD]',
      '',
      'Supervises the ecommerce repository batch command without owning supplier,',
      'ranking, model, persistence, or dashboard behavior.',
    ].join('\n') + '\n');
    return;
  }

  const runtimeConfig = loadRuntimeConfig();
  const validateOnly = process.argv.includes('--validate-only');
  const pilotEnd = valueAfter('--pilot-end');
  let secretValues = [];
  try {
    const discoveryConfig = resolveEcommerceDiscoveryConfig(runtimeConfig.env, projectRoot);
    const ecommerceEnv = readEcommerceEnvironment(discoveryConfig.repoPath);
    secretValues = [
      ecommerceEnv.CJ_API_KEY,
      ecommerceEnv.SUPABASE_SERVICE_ROLE_KEY,
    ].filter(Boolean);
    const result = await runEcommerceDiscovery({
      environment: runtimeConfig.env,
      orionRoot: projectRoot,
      validateOnly,
      pilotEnd,
    });
    recordOpsMetric(runtimeConfig, validateOnly ? 'ecommerce_discovery_validated' : 'ecommerce_discovery_run', result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    if (error instanceof EcommerceDiscoveryPilotEndedError) {
      const result = {
        schema: ECOMMERCE_DISCOVERY_RESULT_SCHEMA,
        status: 'pilot_complete',
        pilotEnd: error.pilotEnd,
        exitCode: 0,
      };
      recordOpsMetric(runtimeConfig, 'ecommerce_discovery_pilot_complete', result);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    const batchSummary = error instanceof EcommerceDiscoveryBatchError ? error.summary : {};
    const result = {
      ...batchSummary,
      schema: ECOMMERCE_DISCOVERY_RESULT_SCHEMA,
      status: 'failed',
      exitCode: 1,
      error: sanitizeOperationalError(error, secretValues),
    };
    recordOpsMetric(runtimeConfig, 'ecommerce_discovery_failed', result);
    process.stderr.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (isMainModule) await main();
