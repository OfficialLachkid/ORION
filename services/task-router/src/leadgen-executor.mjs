import { runLeadgenSearch } from '../../leadgen-scraper/src/worker.mjs';

export function describeExplicitLeadgenAction(task) {
  const action = String(task?.runtime_action || '').trim();
  if (action === 'leadgen_search') {
    return {
      action,
      description: 'Search for candidate leads and extract structured records from public pages.',
    };
  }

  return null;
}

export async function executeLeadgenAction(task, config, options = {}) {
  const request = task?.leadgen_request;
  if (!request?.query) {
    throw new Error('Leadgen task is missing a search query.');
  }

  const result = await runLeadgenSearch(request.query, request.max, config, options);

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
