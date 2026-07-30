#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getStringOption,
  parseArgs,
  printUsage,
  projectRoot,
} from '../../../scripts/lib/ruflo-wrapper-utils.mjs';
import { loadJson } from '../src/poke-quizz-renderer.mjs';

function buildPlanSummary(plan, outputOverride = null) {
  return {
    seed: plan.seed,
    type_pair: plan.selection?.type_pair || [],
    catalog_match_count: plan.selection?.catalog_match_count ?? 0,
    selected_subjects: (plan.selection?.selected_subjects || []).map((subject) => ({
      name: subject.name,
      generation: subject.generation,
      national_dex_number: subject.national_dex_number,
    })),
    background: plan.assets?.background?.selected_path || null,
    music: plan.assets?.audio?.selected_battle_intro_music_path || null,
    output: outputOverride || null,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseArgs();

  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/summarize-poke-quizz-plan.mjs [options]',
      '',
      'Options:',
      '  --plan <path>            Required plan JSON path',
      '  --output <path>          Optional rendered output path to include in the summary',
    ]);
    process.exit(0);
  }

  const planPath = getStringOption(options, 'plan', '');
  if (!planPath) {
    throw new Error('The --plan option is required.');
  }

  const plan = await loadJson(resolve(projectRoot, planPath));
  const summary = buildPlanSummary(
    plan,
    getStringOption(options, 'output', ''),
  );
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
