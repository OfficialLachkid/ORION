import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkBodyLength,
  checkDrafterLeakage,
  checkEmailShape,
  checkPerDomainDailyCap,
  checkPlaceholderLeakage,
  checkRequiredFields,
  checkSuppressedDomain,
  DEFAULT_BODY_MIN_CHARS,
  DEFAULT_PER_DOMAIN_DAILY_CAP,
  runPresendChecks,
} from './outreach-presend-checks.mjs';

function makeTask(overrides = {}) {
  const body = overrides.body ?? `Hi there,\n\nI noticed your workshop in Rotterdam and wondered if a 10-minute call next week would be useful to talk through how a few other operators in your region are handling booking automation. If not, no worries.\n\nBest,\nJacob`;
  return {
    task_id: 'TASK-A',
    source_type: 'lead_qualification',
    runtime_action: 'gmail_send_draft',
    email_request: {
      to: overrides.to ?? 'info@example.nl',
      subject: overrides.subject ?? 'Quick question about Rotterdam bookings',
      bodyText: body,
    },
    lead_id: overrides.lead_id ?? 'LEAD-1',
    lead_domain: overrides.lead_domain ?? 'example.nl',
  };
}

// ─── Pure checks ────────────────────────────────────────────────────

test('checkRequiredFields rejects when to/subject/body are missing', () => {
  assert.ok(checkRequiredFields(makeTask()).ok);
  assert.equal(checkRequiredFields(makeTask({ to: '' })).reason, 'missing_to_address');
  assert.equal(checkRequiredFields(makeTask({ subject: '' })).reason, 'missing_subject');
  assert.equal(checkRequiredFields(makeTask({ body: '' })).reason, 'missing_body');
});

test('checkEmailShape catches malformed addresses', () => {
  assert.ok(checkEmailShape(makeTask()).ok);
  assert.match(checkEmailShape(makeTask({ to: 'not-an-email' })).reason, /^invalid_to_address:/u);
  assert.match(checkEmailShape(makeTask({ to: 'foo@bar' })).reason, /^invalid_to_address:/u);
  assert.match(checkEmailShape(makeTask({ to: 'two@at@signs.com' })).reason, /^invalid_to_address:/u);
});

// Regression for 2026-10-27 live run: `flags@2x.webp` passed the plain
// shape regex and burned a Gmail send on nothing. The TLD-extension
// blocklist rejects known file extensions.
test('checkEmailShape rejects scraped-asset addresses whose TLD is a known file extension', () => {
  const assetAddrs = [
    'flags@2x.webp',    // the one we actually saw in production
    'logo@sprite.png',
    'icon@menu.svg',
    'bundle@app.js',
    'style@theme.css',
    'brochure@assets.pdf',
    'font@body.woff2',
  ];
  for (const to of assetAddrs) {
    const result = checkEmailShape(makeTask({ to }));
    assert.equal(result.ok, false, `${to} must be rejected`);
    assert.match(result.reason, /^invalid_to_address_asset_tld:/u, `${to} must flag the asset-TLD reason`);
  }
});

test('checkEmailShape still accepts legitimate TLDs (regression guard — do not over-reject)', () => {
  const okAddrs = [
    'info@example.nl',
    'contact@firstlast.co.uk',
    'hello@my-business.com',
    'user@gmail.com',
    'ops@orion.io',
    'team@startup.ai',
    'kontakt@foo.de',
  ];
  for (const to of okAddrs) {
    assert.ok(checkEmailShape(makeTask({ to })).ok, `${to} must pass`);
  }
});

test('checkBodyLength refuses bodies shorter than the min or longer than the max', () => {
  assert.ok(checkBodyLength(makeTask()).ok);
  const tooShort = makeTask({ body: 'Hi' });
  assert.match(checkBodyLength(tooShort).reason, new RegExp(`^body_too_short:\\d+<${DEFAULT_BODY_MIN_CHARS}$`, 'u'));
  const tooLong = makeTask({ body: 'x'.repeat(6000) });
  assert.match(checkBodyLength(tooLong).reason, /^body_too_long:\d+>5000$/u);
});

test('checkPlaceholderLeakage flags unresolved template tags', () => {
  assert.ok(checkPlaceholderLeakage(makeTask()).ok);
  assert.match(checkPlaceholderLeakage(makeTask({ body: 'Hi {{first_name}}, hope you are well. '.repeat(5) })).reason, /^unresolved_placeholder:/u);
  assert.match(checkPlaceholderLeakage(makeTask({ subject: 'Quick note for [COMPANY]' })).reason, /^unresolved_placeholder:/u);
  assert.match(checkPlaceholderLeakage(makeTask({ body: `${'x'.repeat(200)} TODO: write actual body` })).reason, /^unresolved_placeholder:/u);
});

test('checkDrafterLeakage flags common LLM-leakage phrases', () => {
  assert.ok(checkDrafterLeakage(makeTask()).ok);
  const aiLeak = makeTask({ body: `${'x'.repeat(200)} as an AI language model I cannot generate this` });
  assert.match(checkDrafterLeakage(aiLeak).reason, /^drafter_leakage:/u);
  const apology = makeTask({ body: `I apologize, here's a draft: ${'x'.repeat(200)}` });
  assert.match(checkDrafterLeakage(apology).reason, /^drafter_leakage:/u);
  const lorem = makeTask({ body: `${'x'.repeat(200)} Lorem ipsum dolor sit amet` });
  assert.match(checkDrafterLeakage(lorem).reason, /^drafter_leakage:/u);
});

// ─── Supabase-backed checks ─────────────────────────────────────────

test('checkSuppressedDomain rejects when the lead_domain has an unsubscribed/bounced sibling', async () => {
  const supabaseFetch = async (path) => {
    assert.match(path, /^leads\?select=status&status=in\.\(unsubscribed,bounced\)&domain=eq\.example\.nl/u);
    return [{ status: 'unsubscribed' }];
  };
  const result = await checkSuppressedDomain(makeTask(), { supabaseFetch });
  assert.equal(result.ok, false);
  assert.match(result.reason, /^suppressed_domain:example\.nl:unsubscribed$/u);
});

test('checkSuppressedDomain passes when no sibling matches the filter', async () => {
  const supabaseFetch = async () => [];
  assert.ok((await checkSuppressedDomain(makeTask(), { supabaseFetch })).ok);
});

test('checkSuppressedDomain falls open (passes) when supabaseFetch is not provided', async () => {
  assert.ok((await checkSuppressedDomain(makeTask(), {})).ok);
});

test('checkSuppressedDomain derives the domain from the address when lead_domain is missing', async () => {
  let seen = '';
  const supabaseFetch = async (path) => { seen = path; return []; };
  await checkSuppressedDomain(makeTask({ lead_domain: '', to: 'info@fallback.com' }), { supabaseFetch });
  assert.match(seen, /domain=eq\.fallback\.com/u);
});

test('checkPerDomainDailyCap rejects when today-count already meets the cap', async () => {
  const supabaseFetch = async (path) => {
    assert.match(path, /^leads\?select=id&domain=eq\.example\.nl&last_contacted_at=gte\./u);
    return [{ id: 'LEAD-X' }];
  };
  const result = await checkPerDomainDailyCap(makeTask(), { supabaseFetch });
  assert.equal(result.ok, false);
  assert.match(result.reason, new RegExp(`^per_domain_cap_hit:example\\.nl:1>=${DEFAULT_PER_DOMAIN_DAILY_CAP}$`, 'u'));
});

test('checkPerDomainDailyCap passes when below cap, and when cap<=0 disables the check', async () => {
  assert.ok((await checkPerDomainDailyCap(makeTask(), { supabaseFetch: async () => [] })).ok);
  assert.ok((await checkPerDomainDailyCap(makeTask(), { supabaseFetch: async () => [{ id: 'X' }], cap: 0 })).ok);
});

// ─── Orchestrator ───────────────────────────────────────────────────

test('runPresendChecks short-circuits at the first failing check (cheap-first ordering)', async () => {
  let supabaseCalls = 0;
  const supabaseFetch = async () => { supabaseCalls += 1; return []; };
  // Field failure: supabase never consulted
  const bad = makeTask({ to: '' });
  const result = await runPresendChecks(bad, { supabaseFetch });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing_to_address');
  assert.equal(supabaseCalls, 0, 'cheap check must short-circuit before any Supabase call');
});

test('runPresendChecks returns ok when every check passes', async () => {
  const supabaseFetch = async () => [];
  assert.ok((await runPresendChecks(makeTask(), { supabaseFetch })).ok);
});
