#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { loadEngineConfig, resolveOutputRoot } from './src/config.mjs';
import { generateDigitalAssetProduct, planDigitalAssetProduct } from './src/pipeline.mjs';

const DEFAULT_CONFIG = 'services/digital-asset-engine/config.example.json';
const DEFAULT_OPPORTUNITY = 'services/digital-asset-engine/fixtures/sci-fi-plasma-rifle.opportunity.json';

function parseArguments(argv) {
  const args = { command: argv[2] || 'help', execute: false };
  for (let index = 3; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--execute') args.execute = true;
    else if (token === '--config') args.config = argv[++index];
    else if (token === '--opportunity') args.opportunity = argv[++index];
    else if (token === '--output-root') args.outputRoot = argv[++index];
    else if (token === '--now') args.now = argv[++index];
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function printHelp() {
  process.stdout.write([
    'ORION Digital Asset Engine',
    '',
    'Commands:',
    '  plan      Validate an opportunity and create a canonical product plan.',
    '  generate  Generate and post-process assets locally; requires --execute.',
    '',
    'Options:',
    `  --config <path>       Default: ${DEFAULT_CONFIG}`,
    `  --opportunity <path>  Default: ${DEFAULT_OPPORTUNITY}`,
    '  --output-root <path>  Override canonical product storage.',
    '  --now <ISO datetime>  Deterministic validation/testing time.',
    '  --execute             Required for image generation.',
    '',
  ].join('\n'));
}

async function main() {
  const args = parseArguments(process.argv);
  if (args.command === 'help' || args.command === '--help') {
    printHelp();
    return;
  }
  if (!['plan', 'generate'].includes(args.command)) throw new Error(`Unknown command: ${args.command}`);
  if (args.command === 'generate' && !args.execute) {
    throw new Error('Image generation requires --execute. Planning remains the safe default.');
  }

  let config = await loadEngineConfig(args.config || DEFAULT_CONFIG);
  if (args.outputRoot) config = { ...config, output_root: args.outputRoot };
  const opportunityPath = args.opportunity || DEFAULT_OPPORTUNITY;
  const opportunity = JSON.parse(await readFile(opportunityPath, 'utf8'));
  const common = {
    config,
    opportunity,
    outputRoot: resolveOutputRoot(config),
    projectRoot: process.cwd(),
    now: args.now,
  };

  const result = args.command === 'generate'
    ? await generateDigitalAssetProduct(common)
    : await planDigitalAssetProduct(common);
  process.stdout.write(`${JSON.stringify({
    command: args.command,
    product_id: result.product.product_id,
    title: result.product.title,
    status: result.product.status,
    output_root: common.outputRoot,
    generation: result.generation || [],
    gates: result.gates || { human_review_required: true, distribution_ready: false },
    cost: result.cost || { currency: 'EUR', incurred: 0, estimated: 0 },
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Digital Asset Engine failed: ${error.message}\n`);
  process.exitCode = 1;
});
