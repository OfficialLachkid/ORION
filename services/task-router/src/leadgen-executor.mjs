import { runLeadgenSearch } from '../../leadgen-scraper/src/worker.mjs';
import { runLeadgenSweepRound } from '../../../scripts/run-scheduled-leadgen.mjs';

export function describeExplicitLeadgenAction(task) {
  const action = String(task?.runtime_action || '').trim();
  if (action === 'leadgen_search') {
    return {
      action,
      description: 'Search for candidate leads and extract structured records from public pages.',
    };
  }
  if (action === 'leadgen_sweep') {
    return {
      action,
      description: 'Run the rotating leadgen sweep across all configured niches.',
    };
  }

  return null;
}

export async function executeLeadgenAction(task, config, options = {}) {
  const request = task?.leadgen_request;
  const action = String(task?.runtime_action || '').trim();

  if (action === 'leadgen_sweep' || String(request?.mode || '').trim().toLowerCase() === 'sweep') {
    const rounds = Math.max(1, Number.parseInt(String(request?.rounds ?? 1), 10) || 1);
    const runSweepRound = options.runLeadgenSweepRound || runLeadgenSweepRound;
    const roundReports = [];

    for (let index = 0; index < rounds; index += 1) {
      const roundLabel = rounds > 1 ? ` (${index + 1}/${rounds})` : '';
      roundReports.push(await runSweepRound({
        config,
        title: `Manual Leadgen Sweep${roundLabel}`,
        overviewTitle: `Manual Leadgen Sweep${roundLabel}`,
      }));
    }

    const outcomes = roundReports.flatMap((entry) => entry?.outcomes || []);
    const failedCount = outcomes.filter((entry) => entry?.runError).length;
    const completedCount = outcomes.length - failedCount;
    const leadCount = outcomes.reduce((sum, entry) => sum + Number(entry?.result?.leadCount || 0), 0);
    const insertedCount = outcomes.reduce((sum, entry) => sum + Number(entry?.result?.insertedCount || 0), 0);
    const searchedCount = outcomes.reduce((sum, entry) => sum + Number(entry?.result?.searchedCount || 0), 0);

    return {
      rawStdout: '',
      report: {
        state: failedCount > 0 ? 'completed_with_failures' : 'completed',
        severity: failedCount > 0 ? 'warning' : 'success',
        summary: `Completed ${rounds} leadgen sweep round(s) across all niches: ${leadCount} new lead(s), ${insertedCount} saved, ${failedCount} niche run(s) failed.`,
        mode: 'sweep',
        rounds,
        nicheRunCount: outcomes.length,
        completedNicheRunCount: completedCount,
        failedNicheRunCount: failedCount,
        leadCount,
        insertedCount,
        searchedCount,
        leadsPreview: [],
      },
    };
  }

  if (!request?.query) {
    throw new Error('Leadgen task is missing a search query.');
  }

  const runSearch = options.runLeadgenSearch || runLeadgenSearch;
  const result = await runSearch(request.query, request.max, config, options);

  return {
    rawStdout: '',
    report: {
      state: 'completed',
      severity: 'success',
      summary: `Found ${result.leadCount} candidate lead(s) for "${request.query}" (${result.insertedCount} saved to the leads table).`,
      query: request.query,
      leadCount: result.leadCount,
      skippedCount: result.skippedCount,
      insertedCount: result.insertedCount,
      leadsPreview: (result.leadsPreview || []).map((lead) => lead?.name || lead),
    },
  };
}
