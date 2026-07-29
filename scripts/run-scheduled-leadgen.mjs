#!/usr/bin/env node
// Runs the daily automated lead-generation sweep: ALL niches, one city per
// day, city advancing daily. Installed via scripts/install-leadgen-schedule.mjs
// as a daily 07:00 launchd job.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
const MAX_RESULTS_PER_NICHE = 50;

// Dutch search terms — this targets the Dutch market, so the query itself is
// in Dutch to get relevant local results (matches the "loodgieter Rotterdam"
// test that worked well during development).
const NICHE_ROTATION = [
  { key: 'electricians', term: 'elektriciens' },
  { key: 'plumbing', term: 'loodgieters' },
  { key: 'real_estate', term: 'makelaars' },
  { key: 'recruitment_agencies', term: 'recruitmentbureaus' },
  { key: 'clinics', term: 'klinieken' },
  { key: 'liquor_stores', term: 'slijterijen' },
];

// One fixed national query saturates fast — a 50-candidate re-run of
// "loodgieters Nederland" produced exactly 1 new (junk) lead once the
// known-domain skip was active. City-level queries surface local
// businesses the national query never ranks. Major cities + provincial
// capitals first; smaller towns (Heemskerk, Castricum, ...) are the
// planned next tier once these saturate.
const LOCATION_ROTATION = [
  'Amsterdam',
  'Rotterdam',
  'Den Haag',
  'Utrecht',
  'Eindhoven',
  'Groningen',
  'Tilburg',
  'Almere',
  'Breda',
  'Nijmegen',
  'Arnhem',
  'Haarlem',
  'Amersfoort',
  'Apeldoorn',
  "'s-Hertogenbosch",
  'Zwolle',
  'Leiden',
  'Maastricht',
  'Leeuwarden',
  'Assen',
  'Middelburg',
  'Lelystad',
];

function loadRotationState() {
  if (!existsSync(ROTATION_STATE_PATH)) {
    return { cityIndexByNiche: {} };
  }

  try {
    const state = JSON.parse(readFileSync(ROTATION_STATE_PATH, 'utf8'));
    if (state.cityIndexByNiche) {
      return state;
    }
    // Migrate from the old single-shared-counter shape: every niche was in
    // lockstep through the same city, so seed each niche at that same
    // index — only future runs can diverge.
    if (Number.isInteger(state.dayCount)) {
      const cityIndexByNiche = Object.fromEntries(
        NICHE_ROTATION.map((niche) => [niche.key, state.dayCount]),
      );
      return { cityIndexByNiche };
    }
    return { cityIndexByNiche: {} };
  } catch {
    return { cityIndexByNiche: {} };
  }
}

function saveRotationState(state) {
  mkdirSync(dirname(ROTATION_STATE_PATH), { recursive: true });
  writeFileSync(ROTATION_STATE_PATH, JSON.stringify(state, null, 2));
}

// Each niche tracks its OWN city index and advances independently —
// previously one shared counter drove all six niches together, so if 5
// niches succeeded and 1 failed, the failed niche's city silently
// advanced anyway just because the sweep "succeeded overall" (operator
// caught this: "shouldn't we update it per success leadgen per niche?").
// peek/commit split for the same reason as before: never persist an
// advance before the work is confirmed done.
function peekNicheCity(state, nicheKey) {
  const current = Number.isInteger(state.cityIndexByNiche?.[nicheKey])
    ? state.cityIndexByNiche[nicheKey]
    : -1;
  const cityIndex = current + 1;
  return {
    cityIndex,
    location: LOCATION_ROTATION[cityIndex % LOCATION_ROTATION.length],
    // Where THIS niche will search next time (after this run commits) — shown
    // in the sweep overview so the operator knows the upcoming destination.
    nextLocation: LOCATION_ROTATION[(cityIndex + 1) % LOCATION_ROTATION.length],
  };
}

function commitNicheAdvance(state, nicheKey, cityIndex) {
  const nextState = {
    cityIndexByNiche: { ...(state.cityIndexByNiche || {}), [nicheKey]: cityIndex },
    updatedAt: new Date().toISOString(),
  };
  saveRotationState(nextState);
  return nextState;
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

async function main() {
  const config = loadRuntimeConfig();
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
  const overviewMessage = await postSweepOverview(config, { statuses });

  const queuedMessages = [];
  for (const { niche, location } of plans) {
    queuedMessages.push(await postLeadgenQueued(config, {
      title: 'Scheduled Leadgen',
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
    await updateSweepOverview(config, overviewMessage, { statuses });

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
    await updateSweepOverview(config, overviewMessage, { statuses });

    // Advance ONLY this niche's city, and only on its own success — a
    // different niche failing must not hold this one back, and this one
    // failing must not silently skip its own city either.
    if (!outcome.runError) {
      rotationState = commitNicheAdvance(rotationState, niche.key, cityIndex);
    } else {
      process.stderr.write(`${niche.key} failed — not advancing its city, will retry ${location} next run.\n`);
    }
  }

  // Final overview refresh with the current total lead count — done once at
  // the end (not on every transition) so it's a single extra query per sweep.
  // Approximate on purpose: the operator's daily junk-lead review deletes some
  // rows afterward, so this is "leads in DB right after the sweep", not a
  // forever-accurate figure — still a useful at-a-glance number.
  let totalLeads = null;
  try {
    totalLeads = await countLeads();
  } catch {
    // count is a nicety, never worth failing the sweep over
  }
  await updateSweepOverview(config, overviewMessage, { statuses, totalLeads });

  const failures = outcomes.filter((outcome) => outcome.runError);

  process.stdout.write(`${JSON.stringify(
    outcomes.map(({ niche, query, result, runError }) => ({
      niche,
      query,
      leadCount: result?.leadCount ?? 0,
      insertedCount: result?.insertedCount ?? 0,
      alreadyKnownCount: result?.alreadyKnownCount ?? 0,
      searchedCount: result?.searchedCount ?? 0,
      error: runError?.message || undefined,
    })),
    null,
    2,
  )}\n`);

  if (failures.length > 0) {
    process.stderr.write(`${failures.length} niche run(s) failed.\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`Scheduled leadgen sweep failed: ${error.message}\n`);
  process.exitCode = 1;
});
