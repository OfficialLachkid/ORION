import { createSupabaseApiHeaders } from '../../lib/supabase-api-headers.mjs';
import {
  listPendingOutboundReceipts,
  markOutboundReceiptReconcileAttempt,
  markOutboundReceiptReconciled,
  readOutboundReceipt,
} from './outbound-receipt-journal.mjs';

function normalizeText(value) {
  return String(value || '').trim();
}

class ReceiptReconcileError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ReceiptReconcileError';
    this.status = status;
  }
}

function resolveSupabase(config = {}) {
  return {
    url: normalizeText(config?.env?.SUPABASE_URL),
    apiKey: normalizeText(
      config?.env?.SUPABASE_SECRET_KEY || config?.env?.SUPABASE_PUBLISHABLE_KEY,
    ),
    leadsTable: normalizeText(config?.env?.LEADGEN_LEADS_TABLE) || 'leads',
  };
}

async function readResponseText(response) {
  return typeof response?.text === 'function' ? response.text().catch(() => '') : '';
}

async function fetchLeadReceiptState(receipt, config, fetchImpl) {
  const supabase = resolveSupabase(config);
  if (!supabase.url || !supabase.apiKey) {
    throw new ReceiptReconcileError('Supabase configuration is unavailable.');
  }
  const url = new URL(`/rest/v1/${supabase.leadsTable}`, supabase.url);
  url.searchParams.set('id', `eq.${receipt.lead_id}`);
  url.searchParams.set('select', 'id,qualification');
  url.searchParams.set('limit', '1');
  const response = await fetchImpl(url, {
    headers: createSupabaseApiHeaders(supabase.apiKey, { Accept: 'application/json' }),
  });
  if (!response.ok) {
    throw new ReceiptReconcileError(
      `Supabase lead receipt lookup failed (${response.status}): ${(await readResponseText(response)).slice(0, 500)}`,
      response.status,
    );
  }
  const rows = await response.json();
  const lead = Array.isArray(rows) ? rows[0] : null;
  if (!lead?.id) throw new ReceiptReconcileError(`Lead ${receipt.lead_id} was not found.`, 404);
  return lead;
}

async function patchLeadReceipt(receipt, lead, config, fetchImpl) {
  const supabase = resolveSupabase(config);
  const url = new URL(`/rest/v1/${supabase.leadsTable}`, supabase.url);
  url.searchParams.set('id', `eq.${receipt.lead_id}`);
  const qualification = lead?.qualification && typeof lead.qualification === 'object'
    ? lead.qualification
    : {};
  const response = await fetchImpl(url, {
    method: 'PATCH',
    headers: createSupabaseApiHeaders(supabase.apiKey, {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    }),
    body: JSON.stringify({
      status: 'sent',
      sent_at: receipt.sent_at,
      last_contacted_at: receipt.sent_at,
      qualification: receipt.gmail_thread_id
        ? { ...qualification, gmail_thread_id: receipt.gmail_thread_id }
        : qualification,
    }),
  });
  if (!response.ok) {
    throw new ReceiptReconcileError(
      `Supabase lead receipt update failed (${response.status}): ${(await readResponseText(response)).slice(0, 500)}`,
      response.status,
    );
  }
}

export async function reconcileGmailSendReceipt(receipt, config, options = {}) {
  if (!receipt || receipt.receipt_type !== 'gmail_send') {
    return { status: 'skipped', reason: 'unsupported_receipt', receipt };
  }
  if (receipt.state === 'reconciled') return { status: 'reconciled', reused: true, receipt };
  if (!normalizeText(receipt.lead_id)) {
    const reconciled = await markOutboundReceiptReconciled(config, receipt, options);
    return { status: 'reconciled', reused: false, receipt: reconciled };
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  try {
    const lead = await fetchLeadReceiptState(receipt, config, fetchImpl);
    await patchLeadReceipt(receipt, lead, config, fetchImpl);
    const reconciled = await markOutboundReceiptReconciled(config, receipt, options);
    return { status: 'reconciled', reused: false, receipt: reconciled };
  } catch (error) {
    const pending = await markOutboundReceiptReconcileAttempt(config, receipt, error, options);
    return {
      status: 'pending',
      retryable: error?.status !== 404,
      statusCode: Number(error?.status || 0),
      error: error?.message || String(error),
      receipt: pending,
    };
  }
}

export async function reconcileGmailSendReceiptForTask(task, config, options = {}) {
  const receipt = await readOutboundReceipt(config, task?.task_id);
  if (!receipt) return { status: 'missing', receipt: null };
  return reconcileGmailSendReceipt(receipt, config, options);
}

export async function reconcilePendingGmailSendReceipts(config, options = {}) {
  const receipts = await listPendingOutboundReceipts(config);
  const limit = Math.max(1, Number(options.limit || 100));
  const results = [];
  for (const receipt of receipts.slice(0, limit)) {
    const result = await reconcileGmailSendReceipt(receipt, config, options);
    results.push(result);
    if (result.status === 'pending' && [401, 402, 403].includes(result.statusCode)) break;
  }
  return {
    inspected: results.length,
    reconciled: results.filter((item) => item.status === 'reconciled').length,
    pending: results.filter((item) => item.status === 'pending').length,
    results,
  };
}
