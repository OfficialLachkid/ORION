import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCATION_ROTATION } from '../run-scheduled-leadgen.mjs';

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

test('LOCATION_ROTATION has expanded to at least 400 entries (Tier 1 expansion 2026-08-10)', () => {
  // Regression guard against an accidental revert of the Tier 1 expansion.
  // If someone shortens the list again, the rotation would collapse back
  // toward the 22-day saturation cycle.
  assert.ok(
    LOCATION_ROTATION.length >= 400,
    `Expected at least 400 locations after Tier 1 expansion; got ${LOCATION_ROTATION.length}`,
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
