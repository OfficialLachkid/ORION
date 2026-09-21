import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The leadgen script writes to data/leadgen/rotation-state.json in projectRoot
// on every commit* call. Redirect projectRoot to a temp dir before importing
// the module so the state-machine tests don't stomp real state.
const origCwd = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), 'orion-leadgen-empty-'));
mkdirSync(join(tmp, 'data', 'leadgen'), { recursive: true });
// Seed an empty rotation-state.json so loadRotationState hits the fast path.
writeFileSync(join(tmp, 'data', 'leadgen', 'rotation-state.json'), JSON.stringify({
  visitedByNiche: {},
  cycleCountByNiche: {},
  emptyByNicheLocation: {},
  poolExpansionVersion: 999999, // will be normalized by the module
}));

// Force the projectRoot resolution before the module loads.
process.chdir(tmp);

const module_ = await import('../run-scheduled-leadgen.mjs');
const {
  LOCATION_ROTATION,
  SKIP_CYCLES_AFTER_EMPTY,
  CONSECUTIVELY_EMPTY_THRESHOLD,
  listConfirmedEmptyCombos,
  __testables: { peekNicheCity, commitNicheAdvance, commitNicheEmpty, clearNicheEmpty, locationsSkippedForNiche },
} = module_;

test.after(() => {
  process.chdir(origCwd);
  rmSync(tmp, { recursive: true, force: true });
});

function freshState() {
  return { visitedByNiche: {}, cycleCountByNiche: {}, emptyByNicheLocation: {}, poolExpansionVersion: 999999 };
}

test('peekNicheCity picks first location on empty state', () => {
  const state = freshState();
  const pick = peekNicheCity(state, 'plumbing');
  assert.equal(pick.location, LOCATION_ROTATION[0]);
  assert.equal(pick.nextLocation, LOCATION_ROTATION[1]);
});

test('empty combo is skipped for SKIP_CYCLES_AFTER_EMPTY cycles then becomes eligible again', () => {
  let state = freshState();
  const niche = 'plumbing';
  const emptyLoc = LOCATION_ROTATION[0];

  // Mark first location empty.
  state = commitNicheEmpty(state, niche, emptyLoc);
  assert.equal(state.emptyByNicheLocation[niche][emptyLoc].skipUntilCycle, 0 + SKIP_CYCLES_AFTER_EMPTY);

  // Next peek should skip the empty location and pick the next unvisited one.
  const pick = peekNicheCity(state, niche);
  assert.notEqual(pick.location, emptyLoc);
  assert.equal(pick.location, LOCATION_ROTATION[1]);

  // Advance through enough full cycles to exhaust the skip window. Each
  // cycle completes when the visited set covers LOCATION_ROTATION.length —
  // simulate that by cycling commit through the whole pool (excluding the
  // skipped one until it becomes eligible).
  for (let cycle = 0; cycle < SKIP_CYCLES_AFTER_EMPTY; cycle += 1) {
    for (const loc of LOCATION_ROTATION) {
      state = commitNicheAdvance(state, niche, loc);
    }
  }
  // After SKIP_CYCLES_AFTER_EMPTY cycles the counter equals the record's
  // skipUntilCycle, so it should NO LONGER be skipped.
  assert.equal(locationsSkippedForNiche(state, niche).has(emptyLoc), false);
  // The visited set is FULL (just completed a cycle) so the next
  // commitNicheAdvance wraps it — after the wrap the previously-empty
  // location must be selectable by peekNicheCity again since neither
  // visited nor the skip filter blocks it.
  state = commitNicheAdvance(state, niche, LOCATION_ROTATION[1]);
  const eligible = peekNicheCity(state, niche);
  assert.ok(eligible.location, 'peekNicheCity must still return a valid location');
  const skipped = locationsSkippedForNiche(state, niche);
  assert.equal(skipped.has(emptyLoc), false, 'empty location must no longer be filtered by skip window');
});

test('clearNicheEmpty wipes the record so consecutive-empties counter restarts', () => {
  let state = freshState();
  const niche = 'plumbing';
  const loc = LOCATION_ROTATION[0];

  state = commitNicheEmpty(state, niche, loc);
  state = commitNicheEmpty(state, niche, loc);
  assert.equal(state.emptyByNicheLocation[niche][loc].consecutiveEmpties, 2);

  state = clearNicheEmpty(state, niche, loc);
  assert.equal(state.emptyByNicheLocation[niche][loc], undefined);
});

test('consecutive empties beyond threshold surface via listConfirmedEmptyCombos', () => {
  let state = freshState();
  const niche = 'recruitment_agencies';
  const loc = LOCATION_ROTATION[0];

  for (let i = 0; i < CONSECUTIVELY_EMPTY_THRESHOLD; i += 1) {
    state = commitNicheEmpty(state, niche, loc);
  }
  const combos = listConfirmedEmptyCombos(state);
  assert.equal(combos.length, 1);
  assert.equal(combos[0].niche, niche);
  assert.equal(combos[0].location, loc);
  assert.equal(combos[0].consecutiveEmpties, CONSECUTIVELY_EMPTY_THRESHOLD);
});

test('combos below threshold do NOT appear in the review list', () => {
  let state = freshState();
  const niche = 'plumbing';
  const loc = LOCATION_ROTATION[1];
  state = commitNicheEmpty(state, niche, loc);
  assert.equal(listConfirmedEmptyCombos(state).length, 0);
});

test('per-niche independence: one niche flagging empty must not affect another niche', () => {
  let state = freshState();
  const loc = LOCATION_ROTATION[0];
  state = commitNicheEmpty(state, 'plumbing', loc);
  const plumbingPick = peekNicheCity(state, 'plumbing');
  const electriciansPick = peekNicheCity(state, 'electricians');
  assert.notEqual(plumbingPick.location, loc, 'plumbing must skip its empty combo');
  assert.equal(electriciansPick.location, loc, 'electricians must NOT be affected by plumbing\'s empty record');
});

test('cycle counter ticks when the visited set wraps a full pool', () => {
  let state = freshState();
  const niche = 'plumbing';
  for (const loc of LOCATION_ROTATION) {
    state = commitNicheAdvance(state, niche, loc);
  }
  assert.equal(state.cycleCountByNiche[niche], 1, 'cycle counter must tick to 1 after one full pool wrap');
});
