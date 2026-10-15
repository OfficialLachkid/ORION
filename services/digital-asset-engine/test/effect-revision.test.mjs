import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { createWeaponEffectPilot } from '../src/effect-batch.mjs';
import { reviseEffectBatch } from '../src/effect-revision.mjs';

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function revisionPlan(sourceAssetKey, sourcePilotId, targetPilotId) {
  return {
    schema_version: '1.0',
    batch_id: 'targeted-impact-revisions-v2',
    product_slug: 'neon-plasma-armory',
    revisions: [{
      source_asset_key: sourceAssetKey,
      source_pilot_id: sourcePilotId,
      target_pilot_id: targetPilotId,
      reason: 'Replace a weapon-like impact with an abstract energy collision.',
      effects: [{
        kind: 'impact_decay',
        prompt: 'Abstract radial energy collision with no weapon silhouette.',
        seed_offset: 1000,
      }],
    }],
  };
}

test('targeted revision inherits approved effects and regenerates only the selected kind', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'orion-effect-revision-'));
  const productRoot = resolve(outputRoot, 'neon-plasma-armory');
  const batch = {
    schema_version: '1.0',
    batch_id: 'source-batch-v1',
    product_slug: 'neon-plasma-armory',
    weapons: [],
  };
  const weapon = {
    source_asset_key: 'ion-pistol',
    name: 'Ion Pistol',
    profile: 'compact',
    seed_base: 14940,
    projectile_description: 'A focused ion dart.',
    muzzle_description: 'A compact electrical lance.',
    impact_description: 'An electrical impact.',
  };
  batch.weapons.push(weapon);
  const sourcePilot = createWeaponEffectPilot(batch, weapon);
  const sourceRoot = resolve(productRoot, 'experiments', sourcePilot.pilot_id);
  await writeJson(resolve(sourceRoot, 'pilot.json'), sourcePilot);
  await writeJson(resolve(sourceRoot, 'manifest.json'), {
    pilot_id: sourcePilot.pilot_id,
    source_asset_key: sourcePilot.source_asset_key,
    canonical_release_mutated: false,
    marketplace_listing_mutated: false,
  });
  for (const effect of sourcePilot.effects) {
    for (const directory of [
      'assets/source',
      'frames',
      'validation',
      'previews/transparency',
    ]) {
      await writeJson(resolve(sourceRoot, directory, effect.effect_key, 'marker.json'), {
        effect_key: effect.effect_key,
      });
    }
  }

  const targetPilotId = 'ion-pistol-effects-proof-v2';
  const plan = revisionPlan(sourcePilot.source_asset_key, sourcePilot.pilot_id, targetPilotId);
  let generatedPilot;
  const result = await reviseEffectBatch({
    plan,
    outputRoot,
    store: {
      async loadProduct() { return { slug: plan.product_slug }; },
      productRoot() { return productRoot; },
    },
    async generatePilot(options) {
      generatedPilot = options.pilot;
      const targetRoot = resolve(productRoot, 'experiments', targetPilotId);
      const projectile = options.pilot.effects.find((effect) => effect.kind === 'projectile');
      const muzzle = options.pilot.effects.find((effect) => effect.kind === 'muzzle_flash');
      const impact = options.pilot.effects.find((effect) => effect.kind === 'impact_decay');
      assert.equal(
        JSON.parse(await readFile(resolve(targetRoot, 'frames', projectile.effect_key, 'marker.json'))).effect_key,
        projectile.effect_key,
      );
      assert.equal(
        JSON.parse(await readFile(resolve(targetRoot, 'frames', muzzle.effect_key, 'marker.json'))).effect_key,
        muzzle.effect_key,
      );
      await assert.rejects(readFile(resolve(targetRoot, 'frames', impact.effect_key, 'marker.json')));
      return {
        pilot: options.pilot,
        experimentRoot: targetRoot,
        manifest: { manifest_hash: 'a'.repeat(64) },
        timing: { total_duration_ms: 100, generation_calls: 1, derived_frames: 3 },
        attack_cycle_preview_path: 'previews/ion-pistol-attack-cycle.gif',
      };
    },
  });

  const sourceImpact = sourcePilot.effects.find((effect) => effect.kind === 'impact_decay');
  const revisedImpact = generatedPilot.effects.find((effect) => effect.kind === 'impact_decay');
  assert.equal(generatedPilot.pilot_id, targetPilotId);
  assert.deepEqual(generatedPilot.revision, {
    source_pilot_id: sourcePilot.pilot_id,
    reason: plan.revisions[0].reason,
    regenerated_kinds: ['impact_decay'],
  });
  assert.equal(revisedImpact.frames[2].prompt, plan.revisions[0].effects[0].prompt);
  assert.equal(revisedImpact.frames[2].seed, sourceImpact.frames[2].seed + 1000);
  assert.deepEqual(
    generatedPilot.effects.find((effect) => effect.kind === 'projectile'),
    sourcePilot.effects.find((effect) => effect.kind === 'projectile'),
  );
  assert.equal(result.total_generation_calls, 1);
  assert.equal(result.total_duration_ms, 100);
  assert.deepEqual(result.results[0].regenerated_kinds, ['impact_decay']);
  assert.deepEqual(
    result.results[0].inherited_effects.map((effect) => effect.kind),
    ['projectile', 'muzzle_flash'],
  );
});

test('an existing target ID cannot be overwritten with a different revision specification', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'orion-effect-revision-immutable-'));
  const productRoot = resolve(outputRoot, 'neon-plasma-armory');
  const weapon = {
    source_asset_key: 'ion-pistol',
    name: 'Ion Pistol',
    profile: 'compact',
    seed_base: 14940,
    projectile_description: 'A focused ion dart.',
    muzzle_description: 'A compact electrical lance.',
    impact_description: 'An electrical impact.',
  };
  const sourcePilot = createWeaponEffectPilot({
    schema_version: '1.0',
    batch_id: 'source-batch-v1',
    product_slug: 'neon-plasma-armory',
    weapons: [weapon],
  }, weapon);
  const sourceRoot = resolve(productRoot, 'experiments', sourcePilot.pilot_id);
  await writeJson(resolve(sourceRoot, 'pilot.json'), sourcePilot);
  await writeJson(resolve(sourceRoot, 'manifest.json'), {
    pilot_id: sourcePilot.pilot_id,
    source_asset_key: sourcePilot.source_asset_key,
    canonical_release_mutated: false,
    marketplace_listing_mutated: false,
  });
  const targetPilotId = 'ion-pistol-effects-proof-v2';
  await writeJson(resolve(productRoot, 'experiments', targetPilotId, 'pilot.json'), {
    ...sourcePilot,
    pilot_id: targetPilotId,
    purpose: 'Different immutable revision.',
  });
  const plan = revisionPlan(sourcePilot.source_asset_key, sourcePilot.pilot_id, targetPilotId);
  await assert.rejects(
    reviseEffectBatch({
      plan,
      outputRoot,
      store: {
        async loadProduct() { return { slug: plan.product_slug }; },
        productRoot() { return productRoot; },
      },
      async generatePilot() { throw new Error('Generation must not run.'); },
    }),
    /already exists with a different specification/u,
  );
});
