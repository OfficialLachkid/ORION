#!/usr/bin/env node
import process from 'node:process';
import { loadRuntimeConfig } from '../lib/runtime-config.mjs';
import {
  analyzeResearchHistory,
  createMagicWorkflowSimulation,
  createWorkflowSimulation,
  loadResearchConfig,
  runResearchCollection,
} from './src/pipeline.mjs';

function parseArguments(argv) {
  const args = { command: argv[2] || 'help', postToDiscord: false, scheduled: false, workflowSimulation: false };
  for (let index = 3; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--post-to-discord') args.postToDiscord = true;
    else if (token === '--workflow-simulation') args.workflowSimulation = true;
    else if (token === '--scheduled') args.scheduled = true;
    else if (token === '--config') args.config = argv[++index];
    else if (token === '--archive-root') args.archiveRoot = argv[++index];
    else if (token === '--runtime-env') args.runtimeEnv = argv[++index];
    else if (token === '--now') args.now = argv[++index];
    else if (token === '--fixture') args.fixture = argv[++index];
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

async function main() {
  const args = parseArguments(process.argv);
  if (args.command === 'help' || args.command === '--help') {
    process.stdout.write([
      'ORION Digital Asset Research',
      '',
      'Commands:',
      '  collect  Manually collect one marketplace snapshot and analyze when enough history exists.',
      '  analyze  Analyze already-stored snapshots without collecting another marketplace sample.',
      '  simulate-magic  Post an explicitly labelled magic-pack workflow simulation.',
      '  simulate-pack  Post an explicitly labelled fixture-driven workflow simulation.',
      '',
      'Options:',
      '  --config <path>         Default: services/digital-asset-research/config.example.json',
      '  --archive-root <path>   Store raw evidence on the T7 or another local archive.',
      '  --runtime-env <path>    Existing ORION runtime .env.',
      '  --post-to-discord       Post the baseline or recommendation to Discord.',
      '  --workflow-simulation   Explicit acknowledgement required for simulation commands.',
      '  --fixture <id>          Required fixture id for simulate-pack.',
      '  --scheduled             Require scheduling to be enabled in the research config.',
      '  --now <ISO datetime>    Deterministic timestamp for testing.',
      '',
      'Scheduled collection is owned by the existing night shift. Approved recommendations queue local generation but never publication.',
    ].join('\n'));
    return;
  }
  if (!['collect', 'analyze', 'simulate-magic', 'simulate-pack'].includes(args.command)) throw new Error(`Unknown command: ${args.command}`);
  const config = await loadResearchConfig(
    args.config || 'services/digital-asset-research/config.example.json',
    process.cwd(),
    { archiveRoot: args.archiveRoot },
  );
  const runtimeConfig = loadRuntimeConfig({ envFilePath: args.runtimeEnv });
  if (args.command === 'simulate-magic') {
    if (!args.workflowSimulation || !args.postToDiscord) {
      throw new Error('simulate-magic requires --workflow-simulation and --post-to-discord.');
    }
    const result = await createMagicWorkflowSimulation({
      config,
      runtimeConfig,
      now: args.now,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (args.command === 'simulate-pack') {
    if (!args.workflowSimulation || !args.postToDiscord || !args.fixture) {
      throw new Error('simulate-pack requires --fixture, --workflow-simulation, and --post-to-discord.');
    }
    const result = await createWorkflowSimulation({
      config,
      runtimeConfig,
      fixtureId: args.fixture,
      now: args.now,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const operation = args.command === 'collect' ? runResearchCollection : analyzeResearchHistory;
  const result = await operation({
    config,
    runtimeConfig,
    now: args.now,
    postToDiscord: args.postToDiscord,
    scheduled: args.scheduled,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});
