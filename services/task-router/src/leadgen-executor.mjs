import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { projectRoot } from '../../lib/runtime-config.mjs';
import { runLeadgenSearch } from '../../leadgen-scraper/src/worker.mjs';
import { runLeadgenSweepRound } from '../../../scripts/run-scheduled-leadgen.mjs';

function clampQualificationLimit(value) {
  const parsed = Number.parseInt(String(value ?? 3), 10);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 3, 100));
}

function launchLeadQualification(request, config) {
  return new Promise((resolvePromise, rejectPromise) => {
    const limit = clampQualificationLimit(request?.limit);
    const child = spawn(
      process.execPath,
      [resolve(projectRoot, 'scripts', 'run-lead-qualification.mjs'), '--limit', String(limit)],
      {
        cwd: projectRoot,
        env: { ...process.env, ...(config?.env || {}) },
        detached: true,
        stdio: ['ignore', 'inherit', 'inherit'],
      },
    );

    child.once('error', rejectPromise);
    child.once('spawn', () => {
      child.unref();
      resolvePromise({ pid: child.pid || 0 });
    });
  });
}

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
  if (action === 'lead_qualification') {
    return {
      action,
      description: 'Start the existing lead qualification workflow for new leads.',
    };
  }

  return null;
}

export async function executeLeadgenAction(task, config, options = {}) {
  const request = task?.leadgen_request;
  const action = String(task?.runtime_action || '').trim();

  if (action === 'lead_qualification' || String(request?.mode || '').trim().toLowerCase() === 'qualification') {
    const limit = clampQualificationLimit(request?.limit);
    const launcher = options.launchLeadQualification
      || ((launchRequest) => launchLeadQualification(launchRequest, config));
    const launched = await launcher({ limit });

    return {
      rawStdout: '',
      report: {
        state: 'started',
        severity: 'info',
        summary: `Started lead qualification for up to ${limit} new lead(s). Live progress and the final report will appear in the lead qualification channel.`,
        mode: 'qualification',
        limit,
        pid: Number(launched?.pid || 0),
      },
    };
  }

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
