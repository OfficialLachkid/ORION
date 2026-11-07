import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { projectRoot } from '../../lib/runtime-config.mjs';

const RECEIPT_SCHEMA_VERSION = 1;

function normalizeText(value) {
  return String(value || '').trim();
}

function safeReceiptId(value) {
  const normalized = normalizeText(value);
  if (!normalized) throw new Error('Outbound receipt requires a task id.');
  return normalized.replace(/[^a-zA-Z0-9._-]+/gu, '_');
}

function hashText(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

export function resolveOutboundReceiptJournalDir(config = {}) {
  return resolve(
    config?.env?.OUTBOUND_RECEIPT_JOURNAL_DIR
      || config?.runtimePaths?.tmpDir
      || resolve(projectRoot, 'data', 'runtime', 'tmp'),
    config?.env?.OUTBOUND_RECEIPT_JOURNAL_DIR ? '.' : 'outbound-receipts',
  );
}

export function resolveOutboundReceiptPath(config, taskId) {
  return resolve(resolveOutboundReceiptJournalDir(config), `${safeReceiptId(taskId)}.json`);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
  return value;
}

export async function readOutboundReceipt(config, taskId) {
  return readJson(resolveOutboundReceiptPath(config, taskId));
}

export async function prepareGmailSendReceipt(task, config, options = {}) {
  const taskId = safeReceiptId(task?.task_id);
  const existing = await readOutboundReceipt(config, taskId);
  if (existing?.state === 'reconciled' || existing?.state === 'sent_receipt_pending') {
    return existing;
  }
  const now = options.now || new Date().toISOString();
  const receipt = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    receipt_type: 'gmail_send',
    task_id: normalizeText(task?.task_id),
    lead_id: normalizeText(task?.lead_id),
    lead_domain: normalizeText(task?.lead_domain).toLowerCase(),
    gmail_draft_id: normalizeText(task?.gmail_draft?.draftId),
    recipient: normalizeText(task?.gmail_draft?.to || task?.email_request?.to).toLowerCase(),
    subject_sha256: hashText(task?.gmail_draft?.subject || task?.email_request?.subject),
    state: 'prepared',
    prepared_at: existing?.prepared_at || now,
    sent_at: '',
    gmail_message_id: '',
    gmail_thread_id: normalizeText(task?.gmail_draft?.threadId),
    reconciled_at: '',
    last_reconcile_attempt_at: '',
    reconcile_attempt_count: 0,
    last_error: '',
  };
  return writeJsonAtomic(resolveOutboundReceiptPath(config, taskId), receipt);
}

export async function markGmailSendReceiptSent(task, config, result = {}, options = {}) {
  const taskId = safeReceiptId(task?.task_id);
  const existing = await prepareGmailSendReceipt(task, config, options);
  if (existing.state === 'reconciled') return existing;
  const now = options.now || new Date().toISOString();
  const receipt = {
    ...existing,
    state: 'sent_receipt_pending',
    sent_at: existing.sent_at || now,
    gmail_message_id: normalizeText(result.messageId) || existing.gmail_message_id || '',
    gmail_thread_id: normalizeText(result.threadId)
      || existing.gmail_thread_id
      || normalizeText(task?.gmail_draft?.threadId),
    last_error: '',
  };
  return writeJsonAtomic(resolveOutboundReceiptPath(config, taskId), receipt);
}

export async function markOutboundReceiptReconcileAttempt(config, receipt, error, options = {}) {
  const now = options.now || new Date().toISOString();
  const next = {
    ...receipt,
    state: 'sent_receipt_pending',
    last_reconcile_attempt_at: now,
    reconcile_attempt_count: Number(receipt?.reconcile_attempt_count || 0) + 1,
    last_error: normalizeText(error?.message || error).slice(0, 1000),
  };
  return writeJsonAtomic(resolveOutboundReceiptPath(config, receipt.task_id), next);
}

export async function markOutboundReceiptReconciled(config, receipt, options = {}) {
  const now = options.now || new Date().toISOString();
  const next = {
    ...receipt,
    state: 'reconciled',
    reconciled_at: now,
    last_reconcile_attempt_at: now,
    reconcile_attempt_count: Number(receipt?.reconcile_attempt_count || 0) + 1,
    last_error: '',
  };
  return writeJsonAtomic(resolveOutboundReceiptPath(config, receipt.task_id), next);
}

export async function listPendingOutboundReceipts(config) {
  const journalDir = resolveOutboundReceiptJournalDir(config);
  let names = [];
  try {
    names = await readdir(journalDir);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const receipts = [];
  for (const name of names.filter((value) => value.endsWith('.json')).sort()) {
    const receipt = await readJson(resolve(journalDir, name));
    if (receipt?.state === 'sent_receipt_pending') receipts.push(receipt);
  }
  return receipts;
}
