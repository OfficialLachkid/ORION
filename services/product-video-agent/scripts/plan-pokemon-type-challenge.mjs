#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  projectRoot,
} from '../../../scripts/lib/ruflo-wrapper-utils.mjs';
import { normalizeTypePair } from '../src/pokemon-type-pairs.mjs';
import { planPokemonTypeChallenge } from '../src/pokemon-type-challenge-planner.mjs';

async function loadJson(relativePath) {
  const absolutePath = resolve(projectRoot, relativePath);
  return JSON.parse(await readFile(absolutePath, 'utf8'));
}

async function writeJson(relativePath, payload) {
  const absolutePath = resolve(projectRoot, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return absolutePath;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseArgs();

  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/plan-pokemon-type-challenge.mjs [options]',
      '',
      'Options:',
      '  --catalog-json <path>     Parsed Pokedex rows JSON. Required.',
      '  --template <path>         Template JSON path. Default: pokemon-type-challenge-v1.template.json',
      '  --output <path>           Output planning JSON path',
      '  --seed <text>             Deterministic seed. Default: poke-quizz-default',
      '  --type-pair <a,b>         Optional forced pair such as grass,poison',
    ]);
    process.exit(0);
  }

  const catalogJson = getStringOption(options, 'catalog-json', '');
  if (!catalogJson) {
    throw new Error('The --catalog-json option is required.');
  }

  const templatePath = getStringOption(
    options,
    'template',
    'services/product-video-agent/pokemon-type-challenge-v1.template.json',
  );
  const outputPath = getStringOption(
    options,
    'output',
    'data/runtime/product-video-agent/poke-quizz/first-type-challenge-plan.json',
  );
  const forcedTypePairInput = getStringOption(options, 'type-pair', '');
  const forcedTypePair = forcedTypePairInput
    ? normalizeTypePair(forcedTypePairInput.split(','))
    : null;

  const [template, pokedexRows] = await Promise.all([
    loadJson(templatePath),
    loadJson(catalogJson),
  ]);
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: getStringOption(options, 'seed', 'poke-quizz-default'),
    forcedTypePair,
  });
  const absoluteOutputPath = await writeJson(outputPath, plan);
  printInfo(`Wrote Pokemon type challenge plan to ${absoluteOutputPath}`);
}
