import test from 'node:test';
import assert from 'node:assert/strict';
import { truncateForHeader } from '../src/discord-report.mjs';

test('truncateForHeader returns short strings unchanged', () => {
  assert.equal(truncateForHeader('short error', 100), 'short error');
});

test('truncateForHeader trims and null-coerces empty/nullish input', () => {
  assert.equal(truncateForHeader(null, 100), '');
  assert.equal(truncateForHeader(undefined, 100), '');
  assert.equal(truncateForHeader('   ', 100), '');
  assert.equal(truncateForHeader('  padded  ', 100), 'padded');
});

test('truncateForHeader caps a long single-line string and appends the [truncated] marker', () => {
  // Regression guard for the 2026-09-05 sweep — plumbing and glaszetter
  // niches lost their round to a runError.message that was ~4kB and blew
  // paginateDiscordLines' 3900-char header budget. Guarantee the cap
  // works for a bare 4kB string too.
  const long = 'x'.repeat(4000);
  const truncated = truncateForHeader(long, 400);
  assert.ok(truncated.length <= 500, `expected ≤ 500 chars, got ${truncated.length}`);
  assert.match(truncated, /\[truncated\]$/u);
});

test('truncateForHeader prefers to break at a nearby newline for multi-line stack traces', () => {
  // Python stderr often arrives as a stack trace. A break at a newline
  // near the cap is friendlier than mid-line surgery — the operator can
  // still recognize the traceback's shape.
  const lines = [
    'Traceback (most recent call last):',
    '  File "search_leads.py", line 82, in <module>',
    '    results = scrapegraph.run(query, urls)',
    '  File "/usr/lib/python3.11/scrapegraphai/graph.py", line 145, in run',
    '    return self._extract(page, prompt)',
    '  File "/usr/lib/python3.11/scrapegraphai/graph.py", line 220, in _extract',
    '    raise ScrapeError("Ollama connection refused after 3 retries")',
    'scrapegraphai.exceptions.ScrapeError: Ollama connection refused after 3 retries',
  ].join('\n');
  const truncated = truncateForHeader(lines, 400);
  assert.ok(truncated.length <= 500);
  // The last kept character before " …[truncated]" should NOT be
  // mid-word; it should be a newline break.
  const beforeMarker = truncated.replace(/ …\[truncated\]$/u, '');
  assert.ok(
    !beforeMarker.endsWith('a')
    && !beforeMarker.endsWith('b'),
    `expected clean line break, got: ${JSON.stringify(beforeMarker.slice(-20))}`,
  );
});
