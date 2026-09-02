import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SCHEDULED_SWEEP_ROUNDS,
  LOCATION_ROTATION,
  resolveScheduledSweepRounds,
} from '../run-scheduled-leadgen.mjs';

test('LOCATION_ROTATION preserves the original 22 major cities at positions 0-21', () => {
  // Positions 0-21 must NOT be reordered. Operator explicitly asked to
  // preserve them so future cycles return to them after ~500 days. Any
  // rotation-state file in the wild references these positions directly.
  const originals = [
    'Amsterdam', 'Rotterdam', 'Den Haag', 'Utrecht', 'Eindhoven',
    'Groningen', 'Tilburg', 'Almere', 'Breda', 'Nijmegen', 'Arnhem',
    'Haarlem', 'Amersfoort', 'Apeldoorn', "'s-Hertogenbosch", 'Zwolle',
    'Leiden', 'Maastricht', 'Leeuwarden', 'Assen', 'Middelburg', 'Lelystad',
  ];
  assert.deepEqual(LOCATION_ROTATION.slice(0, 22), originals);
});

test('LOCATION_ROTATION has no duplicate entries (case-sensitive, whitespace-normalized)', () => {
  const seen = new Map();
  const duplicates = [];
  for (let index = 0; index < LOCATION_ROTATION.length; index += 1) {
    const raw = LOCATION_ROTATION[index];
    if (seen.has(raw)) {
      duplicates.push({ value: raw, firstIndex: seen.get(raw), duplicateIndex: index });
    } else {
      seen.set(raw, index);
    }
  }
  assert.deepEqual(duplicates, [], `Found duplicate locations: ${JSON.stringify(duplicates)}`);
});

test('LOCATION_ROTATION entries have no leading, trailing, or double whitespace', () => {
  const offenders = LOCATION_ROTATION.filter((entry) => (
    typeof entry !== 'string'
    || entry !== entry.trim()
    || /\s{2,}/u.test(entry)
    || entry.length === 0
  ));
  assert.deepEqual(offenders, [], `Whitespace-dirty entries: ${JSON.stringify(offenders)}`);
});

test('LOCATION_ROTATION has expanded to at least 800 entries (Tier 4 CBS BAG 2026-09-02)', () => {
  // Regression guard against an accidental revert of either the Tier 1
  // (2026-08-10, 22→568) or Tier 4 (2026-09-02, 568→841) expansions.
  // If the list shrinks below 800, at 6 sweeps/day the rotation would
  // start hitting each town more than once every 4 months, closer to
  // the earlier saturation curve.
  assert.ok(
    LOCATION_ROTATION.length >= 800,
    `Expected at least 800 locations after Tier 4 expansion; got ${LOCATION_ROTATION.length}`,
  );
});

test('LOCATION_ROTATION disambiguates cross-province namesake towns with a "(Province)" suffix', () => {
  // Elst, Bergen, and Valkenburg all have real towns in multiple provinces.
  // Both instances must be present, and both must carry the disambiguating
  // suffix — otherwise the search query "elektriciens Elst" is ambiguous
  // between Utrecht (near Amersfoort) and Gelderland (near Nijmegen).
  const namesakes = [
    { bare: 'Elst', suffixed: ['Elst (Utrecht)', 'Elst (Gelderland)'] },
    { bare: 'Bergen', suffixed: ['Bergen (Noord-Holland)', 'Bergen (Limburg)'] },
    { bare: 'Valkenburg', suffixed: ['Valkenburg (Zuid-Holland)', 'Valkenburg (Limburg)'] },
  ];
  for (const { bare, suffixed } of namesakes) {
    assert.equal(
      LOCATION_ROTATION.includes(bare),
      false,
      `Bare "${bare}" is ambiguous — must be disambiguated with a province suffix`,
    );
    for (const suffixedName of suffixed) {
      assert.ok(
        LOCATION_ROTATION.includes(suffixedName),
        `Missing disambiguated variant: "${suffixedName}"`,
      );
    }
  }
});

test('LOCATION_ROTATION originals are not accidentally duplicated in the expansion pool', () => {
  const originalsSet = new Set(LOCATION_ROTATION.slice(0, 22));
  const dupesInPool = LOCATION_ROTATION.slice(22).filter((entry) => originalsSet.has(entry));
  assert.deepEqual(
    dupesInPool, [],
    `Originals accidentally re-listed in the expansion pool: ${JSON.stringify(dupesInPool)}`,
  );
});

test('scheduled leadgen defaults to six sweep rounds per daily run (post-Tier-4 CBS-BAG expansion, 2026-09-02)', () => {
  // Bumped from 2 to 6 alongside the CBS BAG pool expansion (568→841
  // active locations) so the qualifier's 30-lead nightly ceiling gets
  // saturated instead of running at ~33% utilization. Rotation window
  // stays healthy at ~140 days per niche.
  assert.equal(DEFAULT_SCHEDULED_SWEEP_ROUNDS, 6);
  assert.equal(resolveScheduledSweepRounds(undefined), 6);
  assert.equal(resolveScheduledSweepRounds(''), 6);
  assert.equal(resolveScheduledSweepRounds(0), 6);
});

test('scheduled leadgen rounds are clamped to a sane ceiling', () => {
  assert.equal(resolveScheduledSweepRounds(3), 3);
  assert.equal(resolveScheduledSweepRounds(999), 10);
});

test('CURRENT_POOL_EXPANSION_VERSION reflects the latest LOCATION_ROTATION expansion', async () => {
  // Regression guard: every LOCATION_ROTATION expansion needs a matching
  // bump of CURRENT_POOL_EXPANSION_VERSION so the state-file migration
  // detects "pool grew since I last ran" and jumps each niche's cursor
  // to the first new location. Skip the bump and the operator waits
  // months for the rotation to naturally reach the new territory —
  // defeats the point of expanding.
  const mod = await import('../run-scheduled-leadgen.mjs');
  assert.ok(
    Number.isInteger(mod.CURRENT_POOL_EXPANSION_VERSION) && mod.CURRENT_POOL_EXPANSION_VERSION >= 3,
    `Expected CURRENT_POOL_EXPANSION_VERSION ≥ 3 after Tier 4; got ${mod.CURRENT_POOL_EXPANSION_VERSION}`,
  );
});
