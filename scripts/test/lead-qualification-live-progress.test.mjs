import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLiveProgressBody } from '../lib/lead-qualification-report.mjs';

test('renderLiveProgressBody shows an empty state before the first lead lands', () => {
  const body = renderLiveProgressBody({
    outcomes: [],
    total: 30,
    runTitle: 'Lead Qualification',
    state: 'in_progress',
  });

  assert.match(body, /Lead Qualification/);
  assert.match(body, /in progress/);
  assert.match(body, /0\/30/);
  assert.match(body, /Waiting for the first lead/);
});

test('renderLiveProgressBody surfaces the current lead while in progress', () => {
  const body = renderLiveProgressBody({
    outcomes: [],
    total: 30,
    runTitle: 'Lead Qualification',
    state: 'in_progress',
    currentLead: 'Loodgieter Rotterdam',
  });

  assert.match(body, /Currently: Loodgieter Rotterdam/);
});

test('renderLiveProgressBody renders per-outcome lines with status icons', () => {
  const outcomes = [
    { lead: 'Alpha', sourceUrl: 'https://a.example', status: 'qualified', offer_angle: 'website_builder' },
    { lead: 'Beta', sourceUrl: 'https://b.example', status: 'rejected_fit' },
    { lead: 'Gamma', sourceUrl: 'https://c.example', status: 'site_unreachable' },
    { lead: 'Delta', sourceUrl: 'https://d.example', error: 'timeout' },
    { lead: 'Epsilon', sourceUrl: 'https://e.example', decision: 'qualified', draftError: 'auth' },
  ];
  const body = renderLiveProgressBody({
    outcomes,
    total: 5,
    runTitle: 'Lead Qualification',
    state: 'in_progress',
  });

  assert.match(body, /5\/5/);
  assert.match(body, /✅ \[Alpha\]\(https:\/\/a\.example\) — qualified · website_builder/);
  assert.match(body, /❌ \[Beta\]\(https:\/\/b\.example\) — rejected_fit/);
  assert.match(body, /⏭ \[Gamma\]\(https:\/\/c\.example\) — site_unreachable/);
  assert.match(body, /💥 \[Delta\]\(https:\/\/d\.example\) — call failed/);
  assert.match(body, /⚠️ \[Epsilon\]\(https:\/\/e\.example\) — qualified but draft failed/);
});

test('renderLiveProgressBody flips to a completed banner at end of run', () => {
  const body = renderLiveProgressBody({
    outcomes: [{ lead: 'Alpha', status: 'qualified' }],
    total: 1,
    runTitle: 'Lead Qualification',
    state: 'completed',
  });

  assert.match(body, /✅ \*\*Lead Qualification\*\* — completed/);
  assert.doesNotMatch(body, /Currently:/);
});

test('renderLiveProgressBody drops oldest lines and warns when the message exceeds Discord content budget', () => {
  const longName = 'x'.repeat(150);
  const outcomes = Array.from({ length: 30 }, (_, index) => ({
    lead: `${longName}-${index}`,
    sourceUrl: `https://example.com/${'y'.repeat(60)}/${index}`,
    status: 'qualified',
    offer_angle: 'website_builder',
  }));

  const body = renderLiveProgressBody({
    outcomes,
    total: 30,
    runTitle: 'Lead Qualification',
    state: 'in_progress',
  });

  assert.ok(body.length <= 2000, `body should fit under Discord 2000-char cap, got ${body.length}`);
  assert.match(body, /earlier lead\(s\) omitted for length/);
  // The most recent lead's line is preserved even after truncation kicks in.
  assert.match(body, new RegExp(`${longName.slice(0, 30)}.*-29`));
});

test('renderLiveProgressBody accepts null total gracefully', () => {
  const body = renderLiveProgressBody({
    outcomes: [{ lead: 'Alpha', status: 'qualified' }],
    total: undefined,
    runTitle: 'Lead Qualification',
    state: 'in_progress',
  });

  assert.match(body, /1\/\?/);
});
