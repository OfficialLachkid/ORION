import { getQualificationBatchTimeoutMs } from '../night-shift-runtime.mjs';
import {
  parseLastJsonObject,
  parseTrailingJsonArray,
  runProjectNodeScript,
} from './process-utils.mjs';

function runQualificationScript(args, timeoutMs) {
  const result = runProjectNodeScript('scripts/run-lead-qualification.mjs', args, {
    timeoutMs,
  });
  const outcomes = parseTrailingJsonArray(result.stdout);
  const ran = outcomes.length > 0;
  const allErrored = ran && outcomes.every((outcome) => outcome.error);
  const systemicFailure = (!ran && result.status !== 0) || allErrored;
  const childStderr = String(result.stderr || '').trim();
  const outcomeErrors = [...new Set(outcomes.map((outcome) => outcome.error).filter(Boolean))];
  const processError = result.error?.message
    || (result.signal ? `Qualification process ended with signal ${result.signal}.` : '');
  const diagnostic = childStderr || outcomeErrors.slice(0, 3).join(' | ') || processError;

  return {
    outcomes,
    systemicFailure,
    exitCode: result.status ?? -1,
    stderr: diagnostic,
  };
}

export function runQualification(limit) {
  return runQualificationScript(
    ['--limit', String(limit)],
    getQualificationBatchTimeoutMs(limit),
  );
}

export function runRedraftRejected(limit) {
  return runQualificationScript(
    ['--redraft-rejected', '--limit', String(limit)],
    getQualificationBatchTimeoutMs(limit),
  );
}

export function runFollowUps(limit) {
  const result = runProjectNodeScript('scripts/run-follow-ups.mjs', ['--limit', String(limit)], {
    timeoutMs: 30 * 60 * 1000,
  });
  const parsed = parseLastJsonObject(result.stdout);
  const drafted = Number(parsed?.drafted || 0);
  return Number.isFinite(drafted) ? drafted : 0;
}
