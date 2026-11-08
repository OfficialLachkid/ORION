import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reconcileGmailSendReceiptForTask } from '../src/gmail-send-receipts.mjs';
import {
  markGmailSendReceiptSent,
  readOutboundReceipt,
} from '../src/outbound-receipt-journal.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orion-receipt-test-'));
  return {
    root,
    config: {
      env: {
        OUTBOUND_RECEIPT_JOURNAL_DIR: root,
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_SECRET_KEY: 'secret',
        LEADGEN_LEADS_TABLE: 'leads',
      },
    },
    task: {
      task_id: 'TASK-RECEIPT-1',
      lead_id: 'lead-1',
      lead_domain: 'example.nl',
      gmail_draft: { draftId: 'draft-1', to: 'lead@example.nl', subject: 'Hello' },
    },
  };
}

test('Gmail receipt reconciliation updates Supabase and marks the journal reconciled', async () => {
  const { root, config, task } = fixture();
  try {
    await markGmailSendReceiptSent(task, config, { messageId: 'm1', threadId: 't1' }, {
      now: '2026-11-07T07:00:00.000Z',
    });
    const calls = [];
    const fetchImpl = async (_url, init = {}) => {
      calls.push(init);
      if ((init.method || 'GET') === 'GET') {
        return { ok: true, json: async () => [{ id: 'lead-1', qualification: { score: 9 } }] };
      }
      return { ok: true, status: 204, text: async () => '' };
    };
    const result = await reconcileGmailSendReceiptForTask(task, config, { fetchImpl });
    assert.equal(result.status, 'reconciled');
    const patch = JSON.parse(calls[1].body);
    assert.equal(patch.status, 'sent');
    assert.equal(patch.last_contacted_at, '2026-11-07T07:00:00.000Z');
    assert.equal(patch.qualification.gmail_thread_id, 't1');
    assert.equal((await readOutboundReceipt(config, task.task_id)).state, 'reconciled');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Gmail receipt reconciliation remains pending when Supabase is restricted', async () => {
  const { root, config, task } = fixture();
  try {
    await markGmailSendReceiptSent(task, config, { messageId: 'm1', threadId: 't1' });
    const result = await reconcileGmailSendReceiptForTask(task, config, {
      fetchImpl: async () => ({
        ok: false,
        status: 402,
        text: async () => '{"code":"exceed_egress_quota"}',
      }),
    });
    assert.equal(result.status, 'pending');
    assert.equal(result.statusCode, 402);
    assert.equal((await readOutboundReceipt(config, task.task_id)).state, 'sent_receipt_pending');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
