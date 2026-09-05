import test from 'node:test';
import assert from 'node:assert/strict';
import { NICHE_ROTATION } from '../run-scheduled-leadgen.mjs';

test('NICHE_ROTATION keys are unique — no accidental duplicates when appending', () => {
  // Regression guard: a duplicated key would silently double-visit the
  // same niche per sweep and let the second entry's visited-set overwrite
  // the first's on every save.
  const seen = new Set();
  const dupes = [];
  for (const entry of NICHE_ROTATION) {
    if (seen.has(entry.key)) dupes.push(entry.key);
    seen.add(entry.key);
  }
  assert.deepEqual(dupes, [], `Duplicate niche keys: ${JSON.stringify(dupes)}`);
});

test('NICHE_ROTATION entries all have a non-empty key and term', () => {
  const broken = NICHE_ROTATION.filter((n) => (
    !n.key || typeof n.key !== 'string' || !n.term || typeof n.term !== 'string'
  ));
  assert.deepEqual(broken, [], `Malformed niches: ${JSON.stringify(broken)}`);
});

test('NICHE_ROTATION keys are safe as state-file JSON keys and directory-portable identifiers', () => {
  // Enforce snake_case-ish identifiers: lowercase letters, digits and
  // underscores. Everything else eventually gets crammed into filenames,
  // metric names, or SQL column filters — hyphens/spaces/uppercase in
  // any of those has burned us before.
  const bad = NICHE_ROTATION.filter((n) => !/^[a-z][a-z0-9_]*$/.test(n.key));
  assert.deepEqual(bad, [], `Non-snake_case niche keys: ${JSON.stringify(bad.map((n) => n.key))}`);
});

test('NICHE_ROTATION preserves the original 6 niches at positions 0-5 (existing state references these)', () => {
  // Existing rotation-state.json files carry visited-set entries keyed
  // by these six exact strings — reordering or renaming any of them
  // would break the visited-set lookup on the next real sweep.
  const originalKeys = [
    'electricians', 'plumbing', 'real_estate',
    'recruitment_agencies', 'clinics', 'liquor_stores',
  ];
  assert.deepEqual(NICHE_ROTATION.slice(0, 6).map((n) => n.key), originalKeys);
});

test('NICHE_ROTATION currently ships 21 niches (post-2026-09-05 expansion and prune)', () => {
  // Regression guard: net count settled at 21 after the initial +20
  // expansion and the -5 prune (schoonheidssalon, ongediertebestrijding,
  // administratiekantoor, hypotheekadviseur, kinderdagverblijf) once the
  // first live 26-niche run showed timing pressure and yield mismatch
  // vs the qualifier's 30/night ceiling. Adjust in tandem with any
  // deliberate expansion/prune; otherwise the sweep silently narrows or
  // widens without an obvious diff signal.
  assert.equal(
    NICHE_ROTATION.length, 21,
    `Expected exactly 21 niches after 2026-09-05 prune; got ${NICHE_ROTATION.length}`,
  );
});

test('NICHE_ROTATION does NOT include the 2026-09-05 pruned niches', () => {
  // Explicit guard against someone re-adding these without re-evaluating
  // the timing/yield tradeoff that motivated their removal.
  const pruned = ['schoonheidssalon', 'ongediertebestrijding', 'administratiekantoor', 'hypotheekadviseur', 'kinderdagverblijf'];
  const readded = pruned.filter((key) => NICHE_ROTATION.some((n) => n.key === key));
  assert.deepEqual(readded, [], `Pruned niches re-added without discussion: ${JSON.stringify(readded)}`);
});
