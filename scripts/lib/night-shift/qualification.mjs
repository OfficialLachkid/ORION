import { getQualificationBatchTimeoutMs } from '../night-shift-runtime.mjs';
import {
  parseLastJsonObject,
  parseTrailingJsonArray,
  runProjectNodeScript,
} from './process-utils.mjs';

// Matches the shapes Claude's `claude -p` subprocess surfaces when it can't
// serve a request due to usage-quota / rate-limit exhaustion. Kept generous
// on purpose — false positives just cause a benign 07:00 fallback re-run,
// but a false negative traps rate-limited leads for a full day.
//
// Observed shapes as of 2026-08-09:
//   - "Claude Code usage limit reached. Please try again after ..."
//   - "5-hour limit reached"
//   - "Please wait until 20:00 CET"
//   - "Try again in 4h"
//   - "Retry after 2026-..."
//   - "Insufficient credits"
//   - HTTP 429 wrapped errors
//   - "rate_limit_error" / "rate_limit_exceeded" (Anthropic API codes)
//   - "overloaded_error" (5xx transient bursts, resets faster than usage)
//   - "too many requests"
//   - "quota exceeded" / "resource_exhausted"
export function isClaudeUsageLimitError(errorMessage) {
  const text = String(errorMessage || '').toLowerCase();
  if (!text) return false;
  return /usage limit|usage_limit|rate.?limit|rate_limit|\b429\b|overloaded_error|please try again after|please wait until|try again in\b|retry after|too many requests|quota exceeded|resource_exhausted|insufficient credits|\b5.?hour\b.*(limit|reached)|limit reached/u.test(text);
}

// True if any qualification outcome errored with a Claude usage-limit-shaped
// error. Used by the night-shift core to decide whether to leave the daily
// marker unwritten so the 07:00 fallback picks up the unfinished leads once
// Claude's window resets.
export function hasClaudeUsageLimitOutcome(outcomes = []) {
  return (Array.isArray(outcomes) ? outcomes : []).some((outcome) => (
    outcome && outcome.error && isClaudeUsageLimitError(outcome.error)
  ));
}

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
  // rateLimited surfaces the partial-progress-plus-usage-cap case separately
  // from systemicFailure. Both leave the marker unwritten so the 07:00
  // fallback re-runs; the two are distinguished so telemetry / the digest
  // can report the recoverable path without flagging it as an outage.
  const rateLimited = hasClaudeUsageLimitOutcome(outcomes)
    || isClaudeUsageLimitError(childStderr);

  return {
    outcomes,
    systemicFailure,
    rateLimited,
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
