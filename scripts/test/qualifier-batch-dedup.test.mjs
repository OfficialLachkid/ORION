import test from 'node:test';
import assert from 'node:assert/strict';
import { domainOfLead, partitionBatchByDomain } from '../lib/qualifier-batch-dedup.mjs';

function lead(id, domain, overrides = {}) {
  return { id, domain, ...overrides };
}

test('partitionBatchByDomain keeps one primary per domain + lists the siblings', () => {
  const batch = [
    lead('L1', 'foo.nl'),
    lead('L2', 'foo.nl'),
    lead('L3', 'bar.nl'),
    lead('L4', 'foo.nl'),
    lead('L5', 'baz.nl'),
  ];
  const { primaries, deferredSiblings } = partitionBatchByDomain(batch);
  assert.deepEqual(primaries.map((l) => l.id), ['L1', 'L3', 'L5']);
  assert.deepEqual(deferredSiblings.map((l) => l.id), ['L2', 'L4']);
});

test('partitionBatchByDomain preserves input order — oldest wins', () => {
  // Caller fetches batch with order='oldest' (asc by created_at), so the
  // first-seen lead per domain is the oldest. The helper never reorders.
  const batch = [
    lead('OLDEST',   'foo.nl', { created_at: '2026-11-01' }),
    lead('MID',      'foo.nl', { created_at: '2026-11-05' }),
    lead('YOUNGEST', 'foo.nl', { created_at: '2026-11-13' }),
  ];
  const { primaries, deferredSiblings } = partitionBatchByDomain(batch);
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0].id, 'OLDEST');
  assert.deepEqual(deferredSiblings.map((l) => l.id), ['MID', 'YOUNGEST']);
});

test('partitionBatchByDomain is case-insensitive on domain', () => {
  const batch = [
    lead('L1', 'Foo.nl'),
    lead('L2', 'FOO.NL'),
    lead('L3', 'foo.nl'),
  ];
  const { primaries, deferredSiblings } = partitionBatchByDomain(batch);
  assert.deepEqual(primaries.map((l) => l.id), ['L1']);
  assert.deepEqual(deferredSiblings.map((l) => l.id), ['L2', 'L3']);
});

test('partitionBatchByDomain never collapses leads with no resolvable domain', () => {
  // Leads without a domain can't be grouped reliably — pass them all
  // through as primaries and let downstream TLD / shape gates handle
  // the fallout. Better than silently dropping ambiguous rows.
  const batch = [
    lead('L1', ''),
    lead('L2', null),
    lead('L3', undefined),
    lead('L4', 'real.nl'),
  ];
  const { primaries, deferredSiblings } = partitionBatchByDomain(batch);
  assert.deepEqual(primaries.map((l) => l.id), ['L1', 'L2', 'L3', 'L4']);
  assert.deepEqual(deferredSiblings, []);
});

test('partitionBatchByDomain returns empty arrays on empty/invalid input', () => {
  assert.deepEqual(partitionBatchByDomain([]), { primaries: [], deferredSiblings: [] });
  assert.deepEqual(partitionBatchByDomain(null), { primaries: [], deferredSiblings: [] });
  assert.deepEqual(partitionBatchByDomain(undefined), { primaries: [], deferredSiblings: [] });
});

test('domainOfLead trims + lowercases + null-safe', () => {
  assert.equal(domainOfLead({ domain: '  Foo.NL  ' }), 'foo.nl');
  assert.equal(domainOfLead({ domain: '' }), '');
  assert.equal(domainOfLead({}), '');
  assert.equal(domainOfLead(null), '');
});
