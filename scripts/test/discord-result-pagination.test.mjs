import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISCORD_EMBED_DESCRIPTION_BUDGET,
  paginateDiscordLines,
} from '../../services/discord-bot/src/embed-pagination.mjs';
import {
  buildResultDescriptions,
  reportLeadgenRunToDiscord,
} from '../../services/leadgen-scraper/src/discord-report.mjs';
import {
  buildLeadQualificationDescriptions,
  postLeadQualificationReport,
} from '../lib/lead-qualification-report.mjs';
import {
  buildQualifiedCallLeadDescriptions,
  normalizePhoneForTel,
  postQualifiedCallLeads,
} from '../lib/qualified-call-leads.mjs';

function occurrenceCount(text, value) {
  return text.split(value).length - 1;
}

function buildLead(index) {
  return {
    name: `Plumbing Business ${index} ${'x'.repeat(90)}`,
    url: `https://example.com/plumber/${index}?source=${'y'.repeat(60)}`,
  };
}

test('generic Discord pagination keeps every line intact and labels follow-ups', () => {
  const lines = Array.from({ length: 80 }, (_, index) => `- result-${index}-${'x'.repeat(90)}`);
  const pages = paginateDiscordLines({
    firstHeader: 'Original report',
    continuationHeader: '**Follow-up:** This belongs to **Original report** from **2026-07-30**.',
    lines,
  });
  const combined = pages.join('\n');

  assert.ok(pages.length > 1);
  assert.ok(pages.every((page) => page.length <= DISCORD_EMBED_DESCRIPTION_BUDGET));
  assert.match(pages[1], /Follow-up.*2026-07-30/u);
  for (const line of lines) {
    assert.equal(occurrenceCount(combined, line), 1);
  }
});

test('leadgen descriptions paginate without dropping clickable businesses', () => {
  const leadsPreview = Array.from({ length: 50 }, (_, index) => buildLead(index));
  const pages = buildResultDescriptions({
    title: 'Manual Leadgen',
    niche: 'plumbing',
    query: 'plumber Haarlem',
    result: {
      leadCount: leadsPreview.length,
      insertedCount: leadsPreview.length,
      searchedCount: 75,
      alreadyKnownCount: 3,
      leadsPreview,
    },
    durationMinutes: 4,
    runDate: new Date(2026, 6, 30),
  });
  const combined = pages.join('\n');

  assert.ok(pages.length > 1);
  assert.ok(pages.every((page) => page.length <= DISCORD_EMBED_DESCRIPTION_BUDGET));
  assert.doesNotMatch(combined, /and \d+ more/u);
  for (const lead of leadsPreview) {
    assert.equal(occurrenceCount(combined, `[${lead.name}](${lead.url})`), 1);
  }
});

test('leadgen continuation messages reply to the first Discord result', async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options, body: JSON.parse(options.body || '{}') });
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: requests.length === 1 ? 'queued-message' : `message-${requests.length}` }),
    };
  };

  try {
    const leadsPreview = Array.from({ length: 50 }, (_, index) => buildLead(index));
    await reportLeadgenRunToDiscord(
      {
        env: { DISCORD_BOT_TOKEN: 'test-token' },
        channelIds: { leadGeneration: 'leadgen-channel' },
      },
      {
        title: 'Scheduled Leadgen',
        niche: 'plumbing',
        query: 'plumber Haarlem',
        result: {
          leadCount: leadsPreview.length,
          insertedCount: leadsPreview.length,
          leadsPreview,
        },
        startedMessage: {
          channelId: 'leadgen-channel',
          messageId: 'queued-message',
        },
        runDate: new Date(2026, 6, 30),
      },
    );

    assert.ok(requests.length > 1);
    assert.equal(requests[0].options.method, 'PATCH');
    for (const request of requests.slice(1)) {
      assert.deepEqual(request.body.message_reference, {
        message_id: 'queued-message',
        channel_id: 'leadgen-channel',
        fail_if_not_exists: false,
      });
      assert.match(request.body.embeds[0].title, /Continued/u);
      assert.match(request.body.embeds[0].description, /2026-07-30/u);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('qualification descriptions preserve every clickable lead and full reason', () => {
  const outcomes = Array.from({ length: 45 }, (_, index) => ({
    lead: `Business ${index}`,
    sourceUrl: `https://example.com/business/${index}`,
    status: 'rejected_fit',
    offer_angle: 'website performance',
    leadAgeDays: index,
    lcp_seconds: 3.2,
    reasoning: `Reason ${index}: ${'not a strong fit '.repeat(10)}`,
  }));
  const pages = buildLeadQualificationDescriptions({
    outcomes,
    outreachChannel: '<#outreach-channel>',
    runTitle: 'Lead Qualification',
    runDate: new Date(2026, 6, 30),
  });
  const combined = pages.join('\n');

  assert.ok(pages.length > 1);
  assert.ok(pages.every((page) => page.length <= DISCORD_EMBED_DESCRIPTION_BUDGET));
  assert.doesNotMatch(combined, /and \d+ more/u);
  for (const [index, outcome] of outcomes.entries()) {
    assert.equal(occurrenceCount(combined, `[${outcome.lead}](${outcome.sourceUrl})`), 1);
    assert.match(combined, new RegExp(`Reason ${index}:`, 'u'));
  }
});

test('qualification continuation messages reply to the first Discord result', async () => {
  const outcomes = Array.from({ length: 45 }, (_, index) => ({
    lead: `Business ${index}`,
    sourceUrl: `https://example.com/business/${index}`,
    status: 'rejected_fit',
    reasoning: `Reason ${index}: ${'not a strong fit '.repeat(10)}`,
  }));
  const payloads = [];

  await postLeadQualificationReport({
    channelId: 'qualification-channel',
    outcomes,
    outreachChannel: '<#outreach-channel>',
    runTitle: 'Lead Qualification',
    runDate: new Date(2026, 6, 30),
    postMessage: async (payload) => {
      payloads.push(payload);
      return { id: payloads.length === 1 ? 'qualification-first' : `qualification-${payloads.length}` };
    },
  });

  assert.ok(payloads.length > 1);
  assert.equal(payloads[0].message_reference, undefined);
  for (const payload of payloads.slice(1)) {
    assert.deepEqual(payload.message_reference, {
      message_id: 'qualification-first',
      channel_id: 'qualification-channel',
      fail_if_not_exists: false,
    });
    assert.match(payload.embeds[0].title, /Continued/u);
    assert.match(payload.embeds[0].description, /2026-07-30/u);
  }
});

test('qualified call leads keep website, phone, KVK, and fit details', () => {
  const outcomes = [{
    lead: 'Haarlem Plumbing BV',
    sourceUrl: 'https://example.com/haarlem-plumbing',
    status: 'qualified_no_email',
    contactPhone: '+31 (0)23 123 45 67',
    kvkNumber: '12345678',
    offer_angle: 'website_builder',
  }, {
    lead: 'No Phone Plumbing',
    sourceUrl: 'https://example.com/no-phone',
    status: 'qualified_no_email',
    contactPhone: '',
    offer_angle: 'Voice receptionist',
  }];
  const pages = buildQualifiedCallLeadDescriptions({
    outcomes,
    runDate: new Date(2026, 6, 30),
  });
  const combined = pages.join('\n');

  assert.equal(pages.length, 1);
  assert.match(combined, /\[Haarlem Plumbing BV\]\(https:\/\/example\.com\/haarlem-plumbing\)/u);
  assert.match(combined, /\[\+31 \(0\)23 123 45 67\]\(tel:\+31231234567\)/u);
  assert.doesNotMatch(combined, /copy:/u);
  assert.match(combined, /KVK: `12345678`/u);
  assert.match(combined, /Fit: New website/u);
  assert.match(combined, /No public phone found/u);
  assert.doesNotMatch(combined, /permission to call|verify legal form|eligibility/iu);
  assert.equal(normalizePhoneForTel('0031 23 123 45 67'), '+31231234567');

  const [qualificationSummary] = buildLeadQualificationDescriptions({
    outcomes,
    outreachChannel: '<#outreach-channel>',
    qualifiedCallLeadsChannel: '<#qualified-call-leads-thread>',
    runTitle: 'Lead Qualification',
    runDate: new Date(2026, 6, 30),
  });
  assert.match(
    qualificationSummary,
    /phone outreach in <#qualified-call-leads-thread>/u,
  );
});

test('qualified call leads paginate and reply to their first thread message', async () => {
  const outcomes = Array.from({ length: 55 }, (_, index) => ({
    lead: `Business ${index} ${'x'.repeat(50)}`,
    sourceUrl: `https://example.com/business/${index}`,
    status: 'qualified_no_email',
    contactPhone: `+31 23 123 ${String(index).padStart(4, '0')}`,
    kvkNumber: String(10000000 + index),
    offer_angle: `Website improvement ${'y'.repeat(40)}`,
  }));
  const payloads = [];

  await postQualifiedCallLeads({
    channelId: 'qualified-call-leads-thread',
    outcomes,
    runDate: new Date(2026, 6, 30),
    postMessage: async (payload) => {
      payloads.push(payload);
      return { id: payloads.length === 1 ? 'no-email-first' : `no-email-${payloads.length}` };
    },
  });

  assert.ok(payloads.length > 1);
  assert.ok(payloads.every((payload) => (
    payload.embeds[0].description.length <= DISCORD_EMBED_DESCRIPTION_BUDGET
  )));
  assert.ok(payloads.every((payload) => payload.embeds[0].color === 0x5865F2));
  for (const payload of payloads.slice(1)) {
    assert.deepEqual(payload.message_reference, {
      message_id: 'no-email-first',
      channel_id: 'qualified-call-leads-thread',
      fail_if_not_exists: false,
    });
    assert.match(payload.embeds[0].title, /Continued/u);
  }
});
