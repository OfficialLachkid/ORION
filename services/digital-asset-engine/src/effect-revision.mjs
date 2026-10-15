import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { CanonicalProductStore } from './canonical-store.mjs';
import { generateEffectPilot } from './effect-pilot.mjs';
import { EffectPilotSchema, EffectRevisionBatchPlanSchema } from './schemas.mjs';

function resolveInside(rootPath, candidatePath, label) {
  const root = resolve(rootPath);
  const target = resolve(root, candidatePath);
  const child = relative(root, target);
  if (child.startsWith('..') || isAbsolute(child)) throw new Error(`${label} must stay inside ${root}.`);
  return target;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function pathExists(path) {
  try { await stat(path); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function copyIfPresent(source, destination) {
  if (!await pathExists(source)) return false;
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
  return true;
}

async function assertTargetIsCompatible(targetRoot, pilot) {
  const targetPilotPath = resolveInside(targetRoot, 'pilot.json', 'Target pilot');
  if (!await pathExists(targetPilotPath)) return;
  const existingPilot = EffectPilotSchema.parse(await readJson(targetPilotPath));
  if (JSON.stringify(existingPilot) !== JSON.stringify(pilot)) {
    throw new Error(
      `${pilot.pilot_id} already exists with a different specification; use a new target pilot ID.`,
    );
  }
}

function revisedPilot(sourcePilot, revision) {
  const revisionsByKind = new Map(revision.effects.map((effect) => [effect.kind, effect]));
  const effects = sourcePilot.effects.map((effect) => {
    const change = revisionsByKind.get(effect.kind);
    if (!change) return effect;
    return {
      ...effect,
      frames: effect.frames.map((frame) => (
        effect.generation.strategy === 'independent'
        || frame.frame === effect.generation.keyframe
      )
        ? {
          ...frame,
          prompt: change.prompt,
          seed: frame.seed + change.seed_offset,
        }
        : frame),
    };
  });
  const missingKinds = [...revisionsByKind.keys()].filter((kind) => (
    !sourcePilot.effects.some((effect) => effect.kind === kind)
  ));
  if (missingKinds.length) {
    throw new Error(`${revision.source_pilot_id} does not contain: ${missingKinds.join(', ')}.`);
  }
  return EffectPilotSchema.parse({
    ...sourcePilot,
    pilot_id: revision.target_pilot_id,
    purpose: `${sourcePilot.purpose} Revision: ${revision.reason}`,
    effects,
    revision: {
      source_pilot_id: revision.source_pilot_id,
      reason: revision.reason,
      regenerated_kinds: revision.effects.map((effect) => effect.kind),
    },
  });
}

async function inheritUnchangedEffects({ sourceRoot, targetRoot, sourcePilot, regeneratedKinds }) {
  const inherited = [];
  for (const effect of sourcePilot.effects) {
    if (regeneratedKinds.has(effect.kind)) continue;
    const paths = [
      `assets/source/${effect.effect_key}`,
      `frames/${effect.effect_key}`,
      `validation/${effect.effect_key}`,
      `previews/transparency/${effect.effect_key}`,
    ];
    for (const path of paths) {
      await copyIfPresent(
        resolveInside(sourceRoot, path, 'Inherited source path'),
        resolveInside(targetRoot, path, 'Inherited target path'),
      );
    }
    inherited.push({ effect_key: effect.effect_key, kind: effect.kind });
  }
  return inherited;
}

export async function reviseEffectBatch(options) {
  const plan = EffectRevisionBatchPlanSchema.parse(options.plan);
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = await store.loadProduct(plan.product_slug);
  const productRoot = store.productRoot(product);
  const generatePilot = options.generatePilot || generateEffectPilot;
  const results = [];

  for (const revision of plan.revisions) {
    const sourceRoot = resolveInside(
      productRoot,
      `experiments/${revision.source_pilot_id}`,
      'Source experiment path',
    );
    const targetRoot = resolveInside(
      productRoot,
      `experiments/${revision.target_pilot_id}`,
      'Target experiment path',
    );
    const [sourcePilot, sourceManifest] = await Promise.all([
      readJson(resolveInside(sourceRoot, 'pilot.json', 'Source pilot')),
      readJson(resolveInside(sourceRoot, 'manifest.json', 'Source manifest')),
    ]);
    if (
      sourcePilot.pilot_id !== revision.source_pilot_id
      || sourcePilot.product_slug !== plan.product_slug
      || sourcePilot.source_asset_key !== revision.source_asset_key
      || sourceManifest.pilot_id !== revision.source_pilot_id
      || sourceManifest.source_asset_key !== revision.source_asset_key
      || sourceManifest.canonical_release_mutated !== false
      || sourceManifest.marketplace_listing_mutated !== false
    ) throw new Error(`${revision.source_pilot_id} is not a valid isolated source proof.`);

    const pilot = revisedPilot(sourcePilot, revision);
    await assertTargetIsCompatible(targetRoot, pilot);
    const regeneratedKinds = new Set(revision.effects.map((effect) => effect.kind));
    const inherited = await inheritUnchangedEffects({
      sourceRoot,
      targetRoot,
      sourcePilot,
      regeneratedKinds,
    });
    const result = await generatePilot({ ...options, pilot, store });
    results.push({
      ...result,
      source_pilot_id: revision.source_pilot_id,
      target_pilot_id: revision.target_pilot_id,
      inherited_effects: inherited,
      regenerated_kinds: [...regeneratedKinds],
    });
  }

  return {
    batch_id: plan.batch_id,
    product_slug: plan.product_slug,
    results,
    total_generation_calls: results.reduce((sum, result) => sum + result.timing.generation_calls, 0),
    total_duration_ms: results.reduce((sum, result) => sum + result.timing.total_duration_ms, 0),
    incurred_cost: 0,
  };
}
