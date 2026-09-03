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

test('LOCATION_ROTATION has expanded to at least 2000 entries (Tier 4 all-active CBS BAG 2026-09-03)', () => {
  // Regression guard against reverting the full-pool switch. The
  // 2026-09-03 change opened is_active=true for every CBS BAG
  // woonplaats — dropping back below 2000 would mean someone
  // reintroduced the aggressive filter that was cutting ~1660 real
  // localities.
  assert.ok(
    LOCATION_ROTATION.length >= 2000,
    `Expected at least 2000 locations after Tier 4 all-active; got ${LOCATION_ROTATION.length}`,
  );
});

test('LOCATION_ROTATION disambiguates cross-province namesake towns with a "(Province)" suffix', () => {
  // Bergen and Valkenburg have real towns in multiple provinces AND both
  // instances live in BAG under abbreviated disambiguators ("Bergen (NH)",
  // "Bergen L"). LOCATION_ROTATION post-processes these into readable
  // "Name (Provincie)" so search queries stay unambiguous. Elst is a
  // one-off in BAG (bare "Elst" for Gelderland-Overbetuwe, "Elst Ut"
  // for Utrecht-Rhenen) — the Ut form gets rewritten too.
  const namesakes = [
    { suffixed: ['Elst (Utrecht)', 'Elst'] },
    { suffixed: ['Bergen (Noord-Holland)', 'Bergen (Limburg)'], bareForbidden: 'Bergen' },
    { suffixed: ['Valkenburg (Zuid-Holland)', 'Valkenburg (Limburg)'], bareForbidden: 'Valkenburg' },
  ];
  for (const entry of namesakes) {
    for (const suffixedName of entry.suffixed) {
      assert.ok(
        LOCATION_ROTATION.includes(suffixedName),
        `Missing disambiguated variant: "${suffixedName}"`,
      );
    }
    if (entry.bareForbidden) {
      assert.equal(
        LOCATION_ROTATION.includes(entry.bareForbidden),
        false,
        `Bare "${entry.bareForbidden}" is ambiguous — must be disambiguated with a province suffix`,
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
  // Regression guard: every pool composition change needs a matching
  // bump of CURRENT_POOL_EXPANSION_VERSION so loadRotationState() knows
  // to run the migration (backfill visited-set from legacy cityIndex,
  // etc.). Skip the bump and the state file stays in whatever prior
  // shape it was written under.
  const mod = await import('../run-scheduled-leadgen.mjs');
  assert.ok(
    Number.isInteger(mod.CURRENT_POOL_EXPANSION_VERSION) && mod.CURRENT_POOL_EXPANSION_VERSION >= 4,
    `Expected CURRENT_POOL_EXPANSION_VERSION ≥ 4 after 2026-09-03 visited-set switch; got ${mod.CURRENT_POOL_EXPANSION_VERSION}`,
  );
});

test('LOCATION_ROTATION expansion pool is deterministically shuffled (no alphabetical clustering)', () => {
  // 2026-09-03: alphabetical ordering caused a 6-city dead zone during a
  // real sweep — every niche's first 5 attempts hit "'s-Gravenmoer",
  // "'s-Graveland", "'s-Gravendeel", "'s-Gravenpolder", "'s-Gravenzande",
  // "'s-Heer Abtskerke" (tiny hamlets with 0 elektriciens/loodgieters).
  // Deterministic shuffle spreads BAG's alphabetical hot spots across the
  // pool. Guard: the first 30 non-original slots must NOT be dominated
  // by any single first character. In an alphabetical layout, positions
  // 22-51 would all start with "'" or "A".
  const firstThirty = LOCATION_ROTATION.slice(22, 52);
  const firstCharCounts = new Map();
  for (const name of firstThirty) {
    const key = name[0].toLowerCase();
    firstCharCounts.set(key, (firstCharCounts.get(key) || 0) + 1);
  }
  const maxCluster = Math.max(...firstCharCounts.values());
  assert.ok(
    maxCluster < 15,
    `Alphabetical clustering detected: ${maxCluster}/30 positions share a first letter. `
    + `First 30 non-original entries: ${JSON.stringify(firstThirty)}`,
  );
});

test('LOCATION_ROTATION shuffle is stable across rebuilds (same input → same order)', async () => {
  // Deterministic shuffle is worthless if it re-orders on every restart —
  // the visited-set would still be correct (name-keyed), but logs, tests,
  // and cycle-progression reasoning would drift. Import twice via cache
  // bust and assert identity.
  const mod1 = await import(`../../scripts/leadgen/location-rotation.mjs?stable1=${Date.now()}`);
  const mod2 = await import(`../../scripts/leadgen/location-rotation.mjs?stable2=${Date.now()}`);
  assert.deepEqual(mod1.LOCATION_ROTATION, mod2.LOCATION_ROTATION);
});
