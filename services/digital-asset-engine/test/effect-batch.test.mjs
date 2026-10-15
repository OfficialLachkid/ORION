import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createWeaponEffectPilot, generateEffectBatch } from '../src/effect-batch.mjs';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');

async function loadPlan() {
  return JSON.parse(await readFile(resolve(
    projectRoot,
    'services/digital-asset-engine/fixtures/remaining-weapon-effects.batch.json',
  ), 'utf8'));
}

test('remaining weapon batch expands into five isolated valid effect pilots', async () => {
  const plan = await loadPlan();
  const pilots = plan.weapons.map((weapon) => createWeaponEffectPilot(plan, weapon));
  assert.deepEqual(pilots.map((pilot) => pilot.source_asset_key), [
    'ion-pistol',
    'plasma-carbine',
    'pulse-rifle',
    'energy-shotgun',
    'rail-rifle',
  ]);
  assert.equal(new Set(pilots.map((pilot) => pilot.pilot_id)).size, 5);
  assert.equal(new Set(pilots.flatMap((pilot) => pilot.effects.map((effect) => (
    effect.effect_key
  )))).size, 15);
  assert.equal(pilots.every((pilot) => pilot.effects.length === 3), true);
});

test('effect batch runs sequential pilots and summarizes timing without marketplace mutation', async () => {
  const plan = await loadPlan();
  const calls = [];
  const result = await generateEffectBatch({
    plan,
    async generatePilot(options) {
      calls.push(options.pilot.source_asset_key);
      return {
        pilot: options.pilot,
        experimentRoot: `/archive/${options.pilot.pilot_id}`,
        manifest: {
          manifest_hash: 'a'.repeat(64),
          source_weapon_muzzle_anchor: { x: 100, y: 20 },
          canonical_release_mutated: false,
          marketplace_listing_mutated: false,
        },
        timing: { total_duration_ms: 100, generation_calls: 3, derived_frames: 6 },
        attack_cycle_preview_path: `previews/${options.pilot.source_asset_key}-attack-cycle.gif`,
      };
    },
  });
  assert.deepEqual(calls, plan.weapons.map((weapon) => weapon.source_asset_key));
  assert.equal(result.results.length, 5);
  assert.equal(result.total_generation_calls, 15);
  assert.equal(result.total_duration_ms, 500);
  assert.equal(result.incurred_cost, 0);
  assert.equal(result.results.every((item) => item.manifest.canonical_release_mutated === false), true);
});
