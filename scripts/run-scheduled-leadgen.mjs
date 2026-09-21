#!/usr/bin/env node
// Runs the daily automated lead-generation sweep: ALL niches, one city per
// day, city advancing daily. Installed via scripts/install-leadgen-schedule.mjs
// as a daily 07:00 launchd job.

// Guard against transient socket-level errors from Node's built-in fetch
// (undici). When Discord throttles + tears down the keep-alive HTTP/2
// connection mid-request, undici emits an 'error' event on the underlying
// ClientHttp2Stream that our withRetry wrapper doesn't see — it only
// catches the fetch promise rejection. Without a top-level handler, Node
// treats it as an unhandled 'error' event and crashes the whole leadgen
// sweep mid-run (observed 2026-09-07 + 2026-09-08 as "leadgen got stuck").
// Log-and-continue for these transient network errors so the sweep can
// finish; re-throw anything else so real bugs still surface.
const TRANSIENT_SOCKET_ERROR_CODES = new Set([
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);
function isTransientSocketError(error) {
  const code = error?.code || '';
  const name = error?.name || '';
  return TRANSIENT_SOCKET_ERROR_CODES.has(code) || name === 'SocketError';
}
process.on('uncaughtException', (error) => {
  if (isTransientSocketError(error)) {
    process.stderr.write(
      `[leadgen] Ignoring transient socket error (${error.code || error.name}): ${error.message}\n`,
    );
    return;
  }
  process.stderr.write(`[leadgen] Uncaught exception: ${error?.stack || error}\n`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  if (isTransientSocketError(reason)) {
    process.stderr.write(
      `[leadgen] Ignoring transient socket rejection (${reason.code || reason.name}): ${reason.message}\n`,
    );
    return;
  }
  process.stderr.write(`[leadgen] Unhandled rejection: ${reason?.stack || reason}\n`);
  process.exit(1);
});

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { recordOpsMetric } from '../services/lib/metrics-store.mjs';
import { runLeadgenSearch } from '../services/leadgen-scraper/src/worker.mjs';
import { countLeads } from './lib/leadgen-supabase.mjs';
import {
  beginLeadgenProgress,
  postLeadgenQueued,
  postSweepOverview,
  reportLeadgenRunToDiscord,
  updateSweepOverview,
} from '../services/leadgen-scraper/src/discord-report.mjs';

const ROTATION_STATE_PATH = resolve(projectRoot, 'data', 'leadgen', 'rotation-state.json');
// DuckDuckGo returns ~30-40 results per query in practice, so 50 is
// effectively "everything the search engine will give us".
export const MAX_RESULTS_PER_NICHE = 50;
// Match the installer's DEFAULT_TIMES so callers that skip --times get
// the same 4 rounds the scheduled launchd job requests. Bumped 3→4 on
// 2026-09-06 after the first chained run showed contact-fallback lifted
// the usable-leads rate from 43% → 79.7% (12 no_contact of 59), and the
// qualifier's 30/night pipe was no longer close to full. 4 rounds
// projects to ~3.7h (still finishes ~06:45 CEST, well before the 09:00
// Ollama window) and produces ~60-65 qualifiable leads/day — after the
// natural rejected_fit filter (~1/3 of leads historically), that lands
// in the qualifier's sweet spot. See install-leadgen-schedule.mjs.
export const DEFAULT_SCHEDULED_SWEEP_ROUNDS = 4;
const MAX_SCHEDULED_SWEEP_ROUNDS = 10;

// Dutch search terms — this targets the Dutch market, so the query itself is
// in Dutch to get relevant local results (matches the "loodgieter Rotterdam"
// test that worked well during development).
//
// clinics: "klinieken" pulled in patient associations (epilepsie.nl),
// GP practices, and health-info portals in the 2026-09-03 batch — only
// 1 of 3 hits was a commercial clinic. "medisch centrum" targets the
// commercial-clinic segment more precisely (physical medical centers,
// private practices offering paid services).
//
// Positions 6-25 are the 2026-09-05 expansion — Dutch trades and service
// businesses picked because they take offertes / phone leads (not because
// they need complex backends or client logins). Keys use the operator's
// exact Dutch identifiers verbatim (some are already snake_case like
// `airco_installateur`); departure from the older English-key convention
// is intentional so future additions can be pasted straight from a
// business-directory listing without a manual translation step.
//
// New niches naturally start at LOCATION_ROTATION[0] on their first sweep:
// peekNicheCity's `state.visitedByNiche?.[nicheKey] || []` falls back to
// an empty set for any niche key it hasn't seen before. Existing niches
// keep their visited sets untouched.
export const NICHE_ROTATION = [
  { key: 'electricians', term: 'elektriciens' },
  { key: 'plumbing', term: 'loodgieters' },
  { key: 'real_estate', term: 'makelaars' },
  { key: 'recruitment_agencies', term: 'recruitmentbureaus' },
  { key: 'clinics', term: 'medisch centrum' },
  { key: 'liquor_stores', term: 'slijterijen' },
  { key: 'dakdekker', term: 'dakdekker' },
  { key: 'stukadoor', term: 'stukadoor' },
  { key: 'schilder', term: 'schilder' },
  { key: 'hoveniersbedrijf', term: 'hoveniersbedrijf' },
  { key: 'aannemer', term: 'aannemer' },
  { key: 'installatiebedrijf', term: 'installatiebedrijf' },
  { key: 'rijschool', term: 'rijschool' },
  { key: 'fysiotherapie', term: 'fysiotherapie' },
  { key: 'verhuisbedrijf', term: 'verhuisbedrijf' },
  { key: 'glaszetter', term: 'glaszetter' },
  { key: 'isolatiebedrijf', term: 'isolatiebedrijf' },
  { key: 'vloerlegger', term: 'vloerlegger' },
  { key: 'kozijnen', term: 'kozijnen' },
  { key: 'airco_installateur', term: 'airco installateur' },
  { key: 'warmtepomp_installateur', term: 'warmtepomp installateur' },
  // Removed 2026-09-05 (operator ask): schoonheidssalon,
  // ongediertebestrijding, administratiekantoor, hypotheekadviseur,
  // kinderdagverblijf. Existing visited-set entries for these keys stay
  // in rotation-state.json (harmless — peekNicheCity only reads keys
  // currently in NICHE_ROTATION). If they come back later, they'll
  // resume from their preserved position without a fresh cycle.
];


// Pool + version marker live in ./leadgen/location-rotation.mjs — extracted
// there so the visited-set migration code below stays inside the 700-line
// script guardrail. Re-export the two names any external caller reads.
import {
  BAG_TO_ORIGINALS_ALIAS,
  CURRENT_POOL_EXPANSION_VERSION,
  LEGACY_LOCATION_ROTATION_TIER3,
  LOCATION_ROTATION,
} from './leadgen/location-rotation.mjs';

export { CURRENT_POOL_EXPANSION_VERSION, LOCATION_ROTATION };

// Empty-combo memory (2026-09-21 operator ask): when a niche×location
// query produces zero usable leads, remember it so the next few full
// rotation cycles skip that combo — the small-town / niche-doesn't-exist
// combinations (e.g. recruitmentbureaus Chaam) burn ~48% of sweep slots
// otherwise. Every full cycle still checks every location at least once
// because the skip window is bounded (SKIP_CYCLES_AFTER_EMPTY): after
// that many niche-cycle advances, the combo becomes retry-eligible again.
// Combos that come back empty CONSECUTIVELY_EMPTY_THRESHOLD times in a
// row get flagged for operator review in the Discord sweep card so the
// operator can decide whether to prune them for good or accept them.
export const SKIP_CYCLES_AFTER_EMPTY = 3;
export const CONSECUTIVELY_EMPTY_THRESHOLD = 3;

// Rebuild the visited-set for one niche from its legacy cityIndex. The
// legacy pool was a positional array so the cursor's "current" position
// meant "everything from position 0 up to and including current has been
// searched at least once this cycle". Same-name entries across provinces
// were disambiguated at the source (Elst (Utrecht), Elst (Gelderland)),
// so the strings match exactly against the new LOCATION_ROTATION for
// the vast majority of positions. A tiny few (Den Haag alias) are
// normalized here so state stays continuous across the alias.
function backfillVisitedFromLegacyIndex(cityIndex) {
  if (!Number.isInteger(cityIndex) || cityIndex < 0) return [];
  const upto = Math.min(cityIndex + 1, LEGACY_LOCATION_ROTATION_TIER3.length);
  const names = LEGACY_LOCATION_ROTATION_TIER3.slice(0, upto);
  return names.map((n) => BAG_TO_ORIGINALS_ALIAS.get(n) || n);
}

function loadRotationState() {
  const empty = () => ({
    visitedByNiche: {},
    cycleCountByNiche: {},
    emptyByNicheLocation: {},
    poolExpansionVersion: CURRENT_POOL_EXPANSION_VERSION,
  });
  if (!existsSync(ROTATION_STATE_PATH)) return empty();

  try {
    const state = JSON.parse(readFileSync(ROTATION_STATE_PATH, 'utf8'));
    // Fast path: already in the new shape at the current version.
    if (state.visitedByNiche && Number(state.poolExpansionVersion) === CURRENT_POOL_EXPANSION_VERSION) {
      // Ensure new sub-maps exist even for state files written before the
      // 2026-09-21 empty-combo memory landed. Empty defaults are safe: an
      // absent record just means "not yet flagged as empty".
      if (!state.cycleCountByNiche) state.cycleCountByNiche = {};
      if (!state.emptyByNicheLocation) state.emptyByNicheLocation = {};
      return state;
    }

    // Migration from any prior shape (dayCount, cityIndexByNiche, older
    // poolExpansionVersion). Backfill visited per niche from whatever
    // positional cursor was stored. Once written back, we never re-read
    // the legacy shape — the visited-set model is stable across future
    // pool changes because it keys on location NAME instead of index.
    const legacyIndexPerNiche = state.cityIndexByNiche
      ? state.cityIndexByNiche
      : Number.isInteger(state.dayCount)
        ? Object.fromEntries(NICHE_ROTATION.map((n) => [n.key, state.dayCount]))
        : {};
    const visitedByNiche = Object.fromEntries(
      NICHE_ROTATION.map((n) => {
        const legacyIndex = Number.isInteger(legacyIndexPerNiche[n.key]) ? legacyIndexPerNiche[n.key] : -1;
        return [n.key, backfillVisitedFromLegacyIndex(legacyIndex)];
      }),
    );
    return {
      visitedByNiche,
      cycleCountByNiche: {},
      emptyByNicheLocation: {},
      poolExpansionVersion: CURRENT_POOL_EXPANSION_VERSION,
      migratedFromVersion: Number(state.poolExpansionVersion) || 1,
      migratedAt: new Date().toISOString(),
    };
  } catch {
    return empty();
  }
}

function saveRotationState(state) {
  mkdirSync(dirname(ROTATION_STATE_PATH), { recursive: true });
  writeFileSync(ROTATION_STATE_PATH, JSON.stringify(state, null, 2));
}

// Skip set for this niche — locations known-empty within their skip
// window. Bounded by cycle count so every location gets a check at
// least once per SKIP_CYCLES_AFTER_EMPTY cycles.
function locationsSkippedForNiche(state, nicheKey) {
  const currentCycle = Number(state.cycleCountByNiche?.[nicheKey] || 0);
  const emptyMap = state.emptyByNicheLocation?.[nicheKey] || {};
  const skipped = new Set();
  for (const [location, record] of Object.entries(emptyMap)) {
    if (Number(record?.skipUntilCycle || 0) > currentCycle) {
      skipped.add(location);
    }
  }
  return skipped;
}

// Pick first location this niche hasn't visited THIS CYCLE and isn't
// in the current skip window. Cycle wraps when the pool fills. Fallback
// on the extreme "everything skipped" case picks any unvisited location
// so the sweep never idles — skip is defer, never permanent prune.
function peekNicheCity(state, nicheKey) {
  const visited = new Set(state.visitedByNiche?.[nicheKey] || []);
  const skipped = locationsSkippedForNiche(state, nicheKey);
  const cycleComplete = visited.size >= LOCATION_ROTATION.length;
  const effectiveVisited = cycleComplete ? new Set() : visited;
  const isPickable = (name) => !effectiveVisited.has(name) && !skipped.has(name);
  const location = LOCATION_ROTATION.find(isPickable)
    || LOCATION_ROTATION.find((name) => !effectiveVisited.has(name))
    || LOCATION_ROTATION[0];
  const afterLocation = new Set(effectiveVisited);
  afterLocation.add(location);
  const isPickableAfter = (name) => !afterLocation.has(name) && !skipped.has(name);
  const nextLocation = LOCATION_ROTATION.find(isPickableAfter)
    || LOCATION_ROTATION.find((name) => !afterLocation.has(name))
    || LOCATION_ROTATION[0];
  return {
    location,
    nextLocation,
    // Kept for backwards compat with any log formatter still reading the
    // positional index. Not authoritative under the visited-set model.
    cityIndex: LOCATION_ROTATION.indexOf(location),
    cycleReset: cycleComplete,
  };
}

function commitNicheAdvance(state, nicheKey, locationOrIndex) {
  // Accept either a location name (new callers) or the legacy cityIndex
  // (older callers still passing plans[i].cityIndex). Resolve to name.
  const location = typeof locationOrIndex === 'string'
    ? locationOrIndex
    : (Number.isInteger(locationOrIndex) && locationOrIndex >= 0
      ? LOCATION_ROTATION[locationOrIndex % LOCATION_ROTATION.length]
      : '');
  if (!location) return state;
  const prevVisited = state.visitedByNiche?.[nicheKey] || [];
  const nextVisitedSet = new Set(prevVisited);
  const nextCycleCountByNiche = { ...(state.cycleCountByNiche || {}) };
  // Wrap when the visited set is already full (start of a new cycle).
  if (nextVisitedSet.size >= LOCATION_ROTATION.length) {
    nextVisitedSet.clear();
  }
  nextVisitedSet.add(location);
  // Tick the per-niche cycle counter as soon as the pool fills — this is
  // what makes skipUntilCycle records expire naturally over time.
  if (nextVisitedSet.size >= LOCATION_ROTATION.length) {
    nextCycleCountByNiche[nicheKey] = Number(nextCycleCountByNiche[nicheKey] || 0) + 1;
  }
  const nextState = {
    ...state,
    visitedByNiche: { ...(state.visitedByNiche || {}), [nicheKey]: [...nextVisitedSet] },
    cycleCountByNiche: nextCycleCountByNiche,
    poolExpansionVersion: CURRENT_POOL_EXPANSION_VERSION,
    updatedAt: new Date().toISOString(),
  };
  saveRotationState(nextState);
  return nextState;
}

// Record (niche, location) as empty. Skipped for SKIP_CYCLES_AFTER_EMPTY
// cycles then retry-eligible; flagged for review after N consecutive.
function commitNicheEmpty(state, nicheKey, location) {
  if (!nicheKey || !location) return state;
  const currentCycle = Number(state.cycleCountByNiche?.[nicheKey] || 0);
  const prev = state.emptyByNicheLocation?.[nicheKey]?.[location] || {};
  const record = {
    skipUntilCycle: currentCycle + SKIP_CYCLES_AFTER_EMPTY,
    consecutiveEmpties: Number(prev.consecutiveEmpties || 0) + 1,
    lastEmptyAt: new Date().toISOString(),
  };
  const nichesEmpty = { ...(state.emptyByNicheLocation?.[nicheKey] || {}), [location]: record };
  const nextState = {
    ...state,
    emptyByNicheLocation: { ...(state.emptyByNicheLocation || {}), [nicheKey]: nichesEmpty },
    poolExpansionVersion: CURRENT_POOL_EXPANSION_VERSION,
    updatedAt: new Date().toISOString(),
  };
  saveRotationState(nextState);
  return nextState;
}

// Successful pull — the combo is producing again. Wipe its empty record
// so it's not counted toward the consecutive-empty threshold anymore.
function clearNicheEmpty(state, nicheKey, location) {
  if (!nicheKey || !location) return state;
  const nicheMap = state.emptyByNicheLocation?.[nicheKey];
  if (!nicheMap || !nicheMap[location]) return state;
  const nextNicheMap = { ...nicheMap };
  delete nextNicheMap[location];
  const nextState = {
    ...state,
    emptyByNicheLocation: { ...(state.emptyByNicheLocation || {}), [nicheKey]: nextNicheMap },
    poolExpansionVersion: CURRENT_POOL_EXPANSION_VERSION,
    updatedAt: new Date().toISOString(),
  };
  saveRotationState(nextState);
  return nextState;
}

// Combos flagged for operator review (>= CONSECUTIVELY_EMPTY_THRESHOLD
// empties in a row). Rendered on the Discord sweep card.
export function listConfirmedEmptyCombos(state) {
  const combos = [];
  for (const [niche, locationMap] of Object.entries(state.emptyByNicheLocation || {})) {
    for (const [location, record] of Object.entries(locationMap || {})) {
      const consecutive = Number(record?.consecutiveEmpties || 0);
      if (consecutive >= CONSECUTIVELY_EMPTY_THRESHOLD) {
        combos.push({ niche, location, consecutiveEmpties: consecutive, lastEmptyAt: record.lastEmptyAt });
      }
    }
  }
  return combos.sort((a, b) => b.consecutiveEmpties - a.consecutiveEmpties);
}

// Exported for direct testing of the state machine.
export const __testables = {
  peekNicheCity,
  commitNicheAdvance,
  commitNicheEmpty,
  clearNicheEmpty,
  locationsSkippedForNiche,
};

export function resolveScheduledSweepRounds(value = DEFAULT_SCHEDULED_SWEEP_ROUNDS) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_SCHEDULED_SWEEP_ROUNDS), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_SCHEDULED_SWEEP_ROUNDS;
  }
  return Math.min(parsed, MAX_SCHEDULED_SWEEP_ROUNDS);
}

async function runNiche(config, niche, location, queuedMessage) {
  const query = `${niche.term} ${location}`;
  const startedAtMs = Date.now();
  const progress = beginLeadgenProgress(config, queuedMessage, {
    title: 'Scheduled Leadgen',
    niche: niche.key,
    query,
  });

  let result;
  let runError = null;
  try {
    result = await runLeadgenSearch(query, MAX_RESULTS_PER_NICHE, config, {
      niche: niche.key,
      // Stored as "City, Country" so the format survives international
      // expansion; the search query itself stays "<term> <city>".
      location: `${location}, Nederland`,
    });
  } catch (error) {
    runError = error;
  } finally {
    progress.stop();
  }
  const durationMinutes = Math.max(1, Math.round((Date.now() - startedAtMs) / 60000));

  recordOpsMetric(config, 'scheduled_leadgen_run', {
    niche: niche.key,
    query,
    leadCount: result?.leadCount ?? 0,
    insertedCount: result?.insertedCount ?? 0,
    error: runError?.message || '',
  });

  await reportLeadgenRunToDiscord(config, {
    title: 'Scheduled Leadgen',
    niche: niche.key,
    query,
    result,
    runError,
    startedMessage: queuedMessage,
    durationMinutes,
  });

  return { niche: niche.key, query, result, runError, durationMinutes };
}

export async function runLeadgenSweepRound({
  config = loadRuntimeConfig(),
  title = 'Scheduled Leadgen',
  overviewTitle = 'Daily Leadgen Sweep',
} = {}) {
  let rotationState = loadRotationState();

  // Each niche independently picks up wherever IT left off — they can be
  // searching different cities on the same calendar day if one's history
  // of failures differs from another's.
  const plans = NICHE_ROTATION.map((niche) => ({ niche, ...peekNicheCity(rotationState, niche.key) }));
  const outcomes = [];

  // One overview message tracks the whole sweep (X/6 complete, what's
  // running, what's queued), then the per-niche plan is posted upfront as
  // queued messages, in order — each flips to "Running (X min)" when its
  // turn comes and is edited in place with results. Each line carries its
  // own city since niches are no longer guaranteed to share one.
  const statuses = plans.map(({ niche, location, nextLocation }) => ({ niche: niche.key, location, nextLocation, state: 'queued' }));
  const overviewMessage = await postSweepOverview(config, {
    statuses,
    title: overviewTitle,
  });

  const queuedMessages = [];
  for (const { niche, location } of plans) {
    queuedMessages.push(await postLeadgenQueued(config, {
      title,
      niche: niche.key,
      query: `${niche.term} ${location}`,
    }));
  }

  // Sequential on purpose: one Ollama model instance, one Playwright at a
  // time — parallel niches would fight over the same 16GB.
  //
  // Each niche is isolated by its own try/catch: this loop runs unattended
  // for 1-2 hours, and one niche throwing (network blip, Discord hiccup,
  // anything unexpected) must never abandon the remaining niches — a bug
  // in reportLeadgenRunToDiscord's error handling did exactly that on
  // 2026-07-20, killing the whole sweep after ~15 minutes with nothing
  // saved for the day. That specific bug is fixed too, but this loop-level
  // guard is the backstop against the next unforeseen one.
  for (let i = 0; i < plans.length; i += 1) {
    const { niche, cityIndex, location } = plans[i];
    statuses[i].state = 'running';
    await updateSweepOverview(config, overviewMessage, {
      statuses,
      title: overviewTitle,
    });

    let outcome;
    try {
      outcome = await runNiche(config, niche, location, queuedMessages[i]);
    } catch (error) {
      outcome = { niche: niche.key, query: `${niche.term} ${location}`, result: null, runError: error, durationMinutes: 0 };
      process.stderr.write(`Niche ${niche.key} crashed, continuing sweep: ${error.message}\n`);
    }
    outcomes.push(outcome);

    statuses[i].state = outcome.runError ? 'failed' : 'completed';
    statuses[i].leadCount = outcome.result?.leadCount ?? 0;
    statuses[i].durationMinutes = outcome.durationMinutes;
    await updateSweepOverview(config, overviewMessage, {
      statuses,
      title: overviewTitle,
    });

    // Advance ONLY this niche's city, and only on its own success — a
    // different niche failing must not hold this one back, and this one
    // failing must not silently skip its own city either.
    if (!outcome.runError) {
      // Pass the location NAME (visited-set model) rather than cityIndex
      // — the pool can reshuffle across expansions without invalidating
      // per-niche progress.
      rotationState = commitNicheAdvance(rotationState, niche.key, location);
      // Empty-combo memory: if this run produced ZERO usable leads, mark
      // the combo so the next SKIP_CYCLES_AFTER_EMPTY cycles skip it and
      // spend that slot on a location that might actually produce. If
      // the run DID find leads, wipe any prior empty record so the combo
      // isn't dragged toward the confirmed-empty operator-review flag by
      // stale history.
      const leadCount = Number(outcome.result?.leadCount || 0);
      if (leadCount === 0) {
        rotationState = commitNicheEmpty(rotationState, niche.key, location);
      } else {
        rotationState = clearNicheEmpty(rotationState, niche.key, location);
      }
    } else {
      process.stderr.write(`${niche.key} failed — not advancing its city, will retry ${location} next run.\n`);
    }
  }

  // Final overview refresh with the current total lead count — done once at
  // the end (not on every transition) so it's a single extra query per sweep.
  // Approximate on purpose: the operator's daily junk-lead review deletes some
  // rows afterward, so this is "leads in DB right after the sweep", not a
  // forever-accurate figure — still a useful at-a-glance number.
  //
  // newLeadsInDatabase is separately counted with status='new' so the overview
  // shows how many total leads the qualifier has queued across all pending
  // days (not just this sweep) — three progress lines in one card: DB-wide
  // qualifier backlog, this-sweep additions, and grand DB total.
  let totalLeads = null;
  let newLeadsInDatabase = null;
  try {
    [totalLeads, newLeadsInDatabase] = await Promise.all([
      countLeads(),
      countLeads({ status: 'new' }),
    ]);
  } catch {
    // counts are a nicety, never worth failing the sweep over
  }
  // Confirmed-empty combos: (niche, location) pairs that returned zero
  // leads CONSECUTIVELY_EMPTY_THRESHOLD or more times in a row. Surfaced
  // on the sweep overview so the operator can decide per combo whether
  // to prune the location for that niche or accept it as known-empty.
  const confirmedEmptyCombos = listConfirmedEmptyCombos(rotationState);
  await updateSweepOverview(config, overviewMessage, {
    statuses,
    totalLeads,
    newLeadsInDatabase,
    confirmedEmptyCombos,
    title: overviewTitle,
  });

  return {
    title,
    overviewTitle,
    outcomes,
    statuses,
    totalLeads,
    newLeadsInDatabase,
    confirmedEmptyCombos,
    failures: outcomes.filter((outcome) => outcome.runError),
  };
}

export async function runScheduledLeadgen({
  config = loadRuntimeConfig(),
  rounds = DEFAULT_SCHEDULED_SWEEP_ROUNDS,
  title = 'Scheduled Leadgen',
  overviewTitle = 'Daily Leadgen Sweep',
} = {}) {
  const normalizedRounds = resolveScheduledSweepRounds(rounds);
  const roundReports = [];

  for (let index = 0; index < normalizedRounds; index += 1) {
    const roundLabel = normalizedRounds > 1 ? ` (${index + 1}/${normalizedRounds})` : '';
    roundReports.push(await runLeadgenSweepRound({
      config,
      title: `${title}${roundLabel}`,
      overviewTitle: `${overviewTitle}${roundLabel}`,
    }));
  }

  const outcomes = roundReports.flatMap((entry) => entry?.outcomes || []);
  const statuses = roundReports.flatMap((entry) => entry?.statuses || []);
  const failures = outcomes.filter((outcome) => outcome?.runError);
  const totalLeads = roundReports.at(-1)?.totalLeads ?? null;
  const newLeadsInDatabase = roundReports.at(-1)?.newLeadsInDatabase ?? null;

  return {
    title,
    overviewTitle,
    rounds: normalizedRounds,
    roundReports,
    outcomes,
    statuses,
    totalLeads,
    newLeadsInDatabase,
    failures,
  };
}

function getCliFlagValue(flag, argv = process.argv.slice(2)) {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return '';
  }
  return argv[index + 1] || '';
}

function resolveCliSweepRounds(argv = process.argv.slice(2)) {
  const timesValue = getCliFlagValue('--times', argv);
  if (timesValue) {
    return resolveScheduledSweepRounds(timesValue);
  }
  return resolveScheduledSweepRounds(getCliFlagValue('--rounds', argv));
}

async function main() {
  const rounds = resolveCliSweepRounds();
  const result = await runScheduledLeadgen({ rounds });

  process.stdout.write(`${JSON.stringify(
    result.outcomes.map(({ niche, query, result: outcomeResult, runError }) => ({
      niche,
      query,
      leadCount: outcomeResult?.leadCount ?? 0,
      insertedCount: outcomeResult?.insertedCount ?? 0,
      alreadyKnownCount: outcomeResult?.alreadyKnownCount ?? 0,
      searchedCount: outcomeResult?.searchedCount ?? 0,
      error: runError?.message || undefined,
    })),
    null,
    2,
  )}\n`);

  if (result.failures.length > 0) {
    process.stderr.write(`${result.failures.length} niche run(s) failed across ${result.rounds} sweep(s).\n`);
    process.exitCode = 1;
  }
}

// Chain N sequential sweeps in one launchd fire. Operator's use case
// (2026-08-15): the 07:00 slot is the only quiet-machine window before
// the operator starts using Ollama themselves at ~9-10am; running a
// second sweep back-to-back inside that window doubles rotation speed
// without contending with their workday sessions. Each sweep reloads
// rotation-state.json fresh, so sweep 2 sees the commits from sweep 1
// and advances to the NEXT set of cities — the two sweeps hit distinct
// (city, niche) combinations, not the same ones twice.
//
// --times defaults to 1 (existing behavior preserved for callers that
// don't pass it). Hard-capped at 10 as a runaway guard — realistically
// 2-3 is the useful range given the qualification cap at 60/day.
async function legacySequentialSweepMain() {
  const config = loadRuntimeConfig();
  const times = getIntFlag('--times', 1, 1, 10);
  let totalFailures = 0;

  for (let sweep = 1; sweep <= times; sweep += 1) {
    if (times > 1) {
      process.stderr.write(`Scheduled leadgen: starting sweep ${sweep}/${times}.\n`);
    }
    const { failures } = await runOneSweep(config);
    totalFailures += failures.length;
    if (times > 1) {
      process.stderr.write(`Scheduled leadgen: sweep ${sweep}/${times} complete (${failures.length} niche failure(s)).\n`);
    }
  }

  if (totalFailures > 0) {
    process.stderr.write(`${totalFailures} total niche run(s) failed across ${times} sweep(s).\n`);
    process.exitCode = 1;
  }
}

// Guard main() so importing this file (e.g. from tests that need
// LOCATION_ROTATION) doesn't kick off a real leadgen sweep. Only runs when
// invoked as the CLI, not on `import`.
const IS_MAIN_MODULE = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (IS_MAIN_MODULE) {
  main().catch((error) => {
    process.stderr.write(`Scheduled leadgen sweep failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
