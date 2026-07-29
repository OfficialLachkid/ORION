#!/usr/bin/env node
// Ad-hoc leadgen run — same pipeline as the scheduled job, explicit query
// instead of picking from the rotation, and it does NOT touch rotation
// state. Posts to Discord the same way the scheduled job does, since a
// one-off script has no live gateway connection for the bot's normal event
// dispatch to flow through — this calls Discord's REST API directly.
//
// Usage:
//   node scripts/run-manual-leadgen.mjs "loodgieters Nederland" --niche plumbing --max 20

import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import { recordOpsMetric } from '../services/lib/metrics-store.mjs';
import { runLeadgenSearch } from '../services/leadgen-scraper/src/worker.mjs';
import { beginLeadgenProgress, postLeadgenQueued, reportLeadgenRunToDiscord } from '../services/leadgen-scraper/src/discord-report.mjs';

function getArgValue(flag, fallbackValue = '') {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return fallbackValue;
  }
  return process.argv[index + 1] || fallbackValue;
}

async function main() {
  const query = process.argv[2];
  if (!query || query.startsWith('--')) {
    process.stderr.write('Usage: node scripts/run-manual-leadgen.mjs "<query>" [--niche X] [--location Y] [--max N]\n');
    process.exitCode = 1;
    return;
  }

  const niche = getArgValue('--niche', '');
  const location = getArgValue('--location', '');
  const max = Number(getArgValue('--max', '10'));

  const config = loadRuntimeConfig();

  const startedMessage = await postLeadgenQueued(config, {
    title: 'Manual Leadgen',
    niche: niche || '(none)',
    query,
  });
  const progress = beginLeadgenProgress(config, startedMessage, {
    title: 'Manual Leadgen',
    niche: niche || '(none)',
    query,
  });

  const startedAtMs = Date.now();
  let result;
  let runError = null;
  try {
    result = await runLeadgenSearch(query, max, config, { niche, location });
  } catch (error) {
    runError = error;
  } finally {
    progress.stop();
  }
  const durationMinutes = Math.max(1, Math.round((Date.now() - startedAtMs) / 60000));

  recordOpsMetric(config, 'manual_leadgen_run', {
    niche,
    query,
    leadCount: result?.leadCount ?? 0,
    insertedCount: result?.insertedCount ?? 0,
    error: runError?.message || '',
  });

  await reportLeadgenRunToDiscord(config, {
    title: 'Manual Leadgen',
    niche: niche || '(none)',
    query,
    result,
    runError,
    startedMessage,
    durationMinutes,
  });

  if (runError) {
    process.stderr.write(`${runError.message}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`${JSON.stringify({ niche, query, ...result }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Manual leadgen run failed: ${error.message}\n`);
  process.exitCode = 1;
});
