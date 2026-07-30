import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  approvalEmbedNeedsSync,
  reconcileDrafts,
  rewriteApprovalEmbedFields,
} from '../lib/draft-reconciler.mjs';

function buildConfig(tmpDir) {
  return {
    env: {
      DISCORD_BOT_TOKEN: 'discord-token',
      PENDING_APPROVAL_TASKS_PATH: join(tmpDir, 'pending.json'),
    },
    channelIds: {
      outreachAgent: 'outreach-channel',
      approvals: 'approvals-channel',
    },
    runtimePaths: { tmpDir },
  };
}

function buildTask(bodyText = 'Original body') {
  return {
    task_id: 'TASK-RECONCILE-1',
    lead_business_name: 'Example Plumber',
    gmail_draft: {
      draftId: 'draft-1',
      to: 'lead@example.com',
      subject: 'Original subject',
      bodyText,
      bodyPreview: bodyText,
    },
    email_request: {
      to: 'lead@example.com',
      subject: 'Original subject',
      bodyText,
    },
  };
}

function buildApprovalMessage(bodyText = 'Original body') {
  return {
    id: 'message-1',
    content: '<@&operator-role>',
    embeds: [{
      title: 'Approval Needed · TASK-RECONCILE-1',
      fields: [
        { name: 'Subject', value: 'Original subject' },
        { name: 'Body', value: bodyText },
        { name: 'Draft', value: '`draft-1`' },
      ],
    }],
    components: [{ type: 1 }],
  };
}

function writePending(config, tasks) {
  writeFileSync(config.env.PENDING_APPROVAL_TASKS_PATH, `${JSON.stringify(tasks, null, 2)}\n`);
}

function readPending(config) {
  return JSON.parse(readFileSync(config.env.PENDING_APPROVAL_TASKS_PATH, 'utf8'));
}

function gmailOptions(currentDraft) {
  return {
    getGmailDraft: async () => currentDraft,
    listGmailDraftsSummary: async () => [{
      id: 'draft-1',
      to: 'lead@example.com',
      subject: currentDraft.subject,
      internalDate: 100,
    }],
  };
}

test('approval embed comparison and rewrite use Discord field limits', () => {
  const message = buildApprovalMessage();
  const original = message.embeds[0];
  assert.equal(approvalEmbedNeedsSync(original, {
    subject: 'Original subject',
    bodyText: 'Original body',
    draftId: 'draft-1',
  }), false);
  assert.equal(approvalEmbedNeedsSync(original, {
    subject: 'Edited subject',
    bodyText: 'Original body',
    draftId: 'draft-1',
  }), true);

  const longBody = 'x'.repeat(1100);
  const rewritten = rewriteApprovalEmbedFields(original, { bodyText: longBody });
  assert.equal(rewritten.fields.find((field) => field.name === 'Body').value.length, 1024);
});

test('reconcile uses Discord Bot auth and persists Gmail edits after a successful patch', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'draft-reconcile-'));
  const config = buildConfig(tmpDir);
  writePending(config, [buildTask()]);
  let patchRequest = null;
  const message = buildApprovalMessage();
  const fetch = async (_url, options = {}) => {
    if (options.method === 'PATCH') {
      patchRequest = options;
      return { ok: true, status: 200, text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => [message] };
  };

  try {
    const result = await reconcileDrafts(config, {
      ...gmailOptions({
        subject: 'Edited subject',
        bodyText: 'Edited body',
        bodyPreview: 'Edited body',
      }),
      fetch,
    });

    assert.deepEqual(result, { sent: 0, edited: 1, repointed: 0 });
    assert.equal(patchRequest.headers.Authorization, 'Bot discord-token');
    const pending = readPending(config);
    assert.equal(pending[0].gmail_draft.subject, 'Edited subject');
    assert.equal(pending[0].gmail_draft.bodyText, 'Edited body');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('reconcile repairs a stale Discord card when Gmail already matches local state', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'draft-reconcile-'));
  const config = buildConfig(tmpDir);
  writePending(config, [buildTask('Edited body')]);
  let patchCount = 0;
  const fetch = async (_url, options = {}) => {
    if (options.method === 'PATCH') {
      patchCount += 1;
      return { ok: true, status: 200, text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => [buildApprovalMessage('Original body')] };
  };

  try {
    const result = await reconcileDrafts(config, {
      ...gmailOptions({
        subject: 'Original subject',
        bodyText: 'Edited body',
        bodyPreview: 'Edited body',
      }),
      fetch,
    });

    assert.deepEqual(result, { sent: 0, edited: 1, repointed: 0 });
    assert.equal(patchCount, 1);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('failed Discord patches leave the pending snapshot unchanged for retry', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'draft-reconcile-'));
  const config = buildConfig(tmpDir);
  writePending(config, [buildTask()]);
  const fetch = async (_url, options = {}) => {
    if (options.method === 'PATCH') {
      return { ok: false, status: 401, text: async () => 'unauthorized' };
    }
    return { ok: true, status: 200, json: async () => [buildApprovalMessage()] };
  };

  try {
    const result = await reconcileDrafts(config, {
      ...gmailOptions({
        subject: 'Edited subject',
        bodyText: 'Edited body',
        bodyPreview: 'Edited body',
      }),
      fetch,
    });

    assert.deepEqual(result, { sent: 0, edited: 0, repointed: 0 });
    const pending = readPending(config);
    assert.equal(pending[0].gmail_draft.subject, 'Original subject');
    assert.equal(pending[0].gmail_draft.bodyText, 'Original body');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
