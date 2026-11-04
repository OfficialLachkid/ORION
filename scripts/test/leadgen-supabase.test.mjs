import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countLeads,
  fetchLeadBatch,
  fetchLeads,
  upsertLeads,
  updateLead,
} from '../lib/leadgen-supabase.mjs';

function config(fetchImpl) {
  return {
    supabaseUrl: 'https://example.supabase.co',
    apiKey: 'test-key',
    leadsTable: 'leads',
    egressLedgerDir: '',
    fetchImpl,
  };
}

test('countLeads uses an exact count request without downloading the backlog', async () => {
  let requestedUrl = '';
  const total = await countLeads({ status: 'new' }, config(async (url, options) => {
    requestedUrl = url;
    assert.match(options.headers.Prefer, /count=exact/u);
    return new Response('[{"id":"lead-1"}]', {
      status: 200,
      headers: { 'content-range': '0-0/393' },
    });
  }));
  assert.equal(total, 393);
  assert.equal(new URL(requestedUrl).searchParams.get('limit'), '1');
  assert.equal(new URL(requestedUrl).searchParams.get('select'), 'id');
});

test('qualification fetches lightweight IDs then hydrates only the selected leads in order', async () => {
  const requests = [];
  const leads = await fetchLeadBatch({ status: 'new', niche: 'dentist', limit: 2, order: 'oldest' }, config(async (url) => {
    const parsed = new URL(url);
    requests.push(parsed);
    if (parsed.searchParams.get('select') === 'id') {
      return new Response('[{"id":"lead-b"},{"id":"lead-a"}]', { status: 200 });
    }
    return new Response('[{"id":"lead-a","business_name":"A"},{"id":"lead-b","business_name":"B"}]', { status: 200 });
  }));

  assert.equal(requests.length, 2);
  assert.equal(requests[0].searchParams.get('limit'), '2');
  assert.equal(requests[0].searchParams.get('order'), 'created_at.asc');
  assert.equal(requests[0].searchParams.get('status'), 'eq.new');
  assert.equal(requests[0].searchParams.get('niche'), 'eq.dentist');
  assert.match(requests[1].searchParams.get('id'), /lead-b/u);
  assert.equal(requests[1].searchParams.get('status'), 'eq.new');
  assert.equal(requests[1].searchParams.get('niche'), 'eq.dentist');
  assert.deepEqual(leads.map((lead) => lead.id), ['lead-b', 'lead-a']);
});

test('lead projections and minimal updates preserve workflow behavior without unused rows', async () => {
  const requests = [];
  const cfg = config(async (url, options) => {
    requests.push({ url: new URL(url), options });
    return options.method === 'PATCH'
      ? new Response(null, { status: 204 })
      : new Response('[{"id":"lead-1","qualification":{}}]', { status: 200 });
  });

  await fetchLeads({ status: 'sent', limit: 500, select: 'id,qualification' }, cfg);
  await updateLead('lead-1', { status: 'replied' }, cfg);

  assert.equal(requests[0].url.searchParams.get('select'), 'id,qualification');
  assert.equal(requests[0].url.searchParams.get('limit'), '500');
  assert.equal(requests[1].options.headers.Prefer, 'return=minimal');
});

test('lead upserts return no rows so the scraper preserves its submitted-row count fallback', async () => {
  let requestOptions = null;
  const result = await upsertLeads([
    { source_url: 'https://example.com', domain: 'example.com' },
  ], config(async (_url, options) => {
    requestOptions = options;
    return new Response(null, { status: 204 });
  }));

  assert.equal(result, null);
  assert.equal(requestOptions.headers.Prefer, 'resolution=merge-duplicates,return=minimal');
});
