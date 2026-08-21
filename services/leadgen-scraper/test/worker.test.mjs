import test from 'node:test';
import assert from 'node:assert/strict';
import { isNoResultsLeadgenError } from '../src/worker.mjs';

test('isNoResultsLeadgenError matches DuckDuckGo empty-result failures', () => {
  const error = new Error([
    'DuckDuckGo search failed (attempt 1), retrying in 15s: DuckDuckGo search failed: No results found.',
    'scrapegraphai.utils.research_web.SearchRequestError: DuckDuckGo search failed: No results found.',
  ].join('\n'));

  assert.equal(isNoResultsLeadgenError(error), true);
});

test('isNoResultsLeadgenError ignores non-empty-result failures', () => {
  assert.equal(isNoResultsLeadgenError(new Error('DuckDuckGo search failed: connection reset by peer')), false);
  assert.equal(isNoResultsLeadgenError(new Error('Discord API request failed (500): upstream timeout')), false);
});
