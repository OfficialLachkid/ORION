import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recordSupabaseEgress } from '../../services/lib/supabase-egress-ledger.mjs';

test('Supabase egress ledger records response size without query values', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'orion-egress-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const response = new Response(JSON.stringify([{ id: 'lead-1' }]), {
    status: 200,
    headers: { 'content-length': '21', 'x-cache': 'MISS' },
  });

  const recorded = await recordSupabaseEgress({
    ledgerDir: root,
    service: 'leadgen',
    queryClass: 'qualification_candidate_ids',
    url: 'https://example.supabase.co/rest/v1/leads?contact_email=eq.secret@example.com',
    response,
    responseText: '[{"id":"lead-1"}]',
    body: [{ id: 'lead-1' }],
  }, { now: () => new Date('2026-11-04T12:00:00.000Z') });

  assert.equal(recorded, true);
  const line = await readFile(join(root, '2026-11-04.jsonl'), 'utf8');
  const event = JSON.parse(line);
  assert.equal(event.job, 'leadgen');
  assert.equal(event.table_or_bucket, 'leads');
  assert.equal(event.rows_returned, 1);
  assert.equal(event.response_bytes, 17);
  assert.equal(event.wire_bytes, 21);
  assert.equal(line.includes('secret@example.com'), false);
});

test('Supabase egress ledger is fail-open when local storage is unavailable', async () => {
  const recorded = await recordSupabaseEgress({
    ledgerDir: 'unavailable',
    service: 'leadgen',
    responseText: '[]',
    body: [],
  }, {
    mkdir: async () => { throw new Error('T7 unavailable'); },
  });
  assert.equal(recorded, false);
});
