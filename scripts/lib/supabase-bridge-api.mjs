import { getStringOption } from './ruflo-wrapper-utils.mjs';

export const DEFAULT_MEMORY_TABLE = 'orion_memory_records';
export const DEFAULT_SYNC_RUNS_TABLE = 'orion_memory_sync_runs';

export function createHeaders(apiKey, extraHeaders = {}) {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
}

export function getRuntimeApiKey(env) {
  return env.SUPABASE_SECRET_KEY || env.SUPABASE_PUBLISHABLE_KEY || '';
}

export function getSourceDevice(env, options = {}) {
  return getStringOption(options, 'source-device')
    || env.ORION_SOURCE_DEVICE
    || env.HOSTNAME
    || env.COMPUTERNAME
    || 'unknown-device';
}

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    throw new Error(`Supabase request failed (${response.status}): ${text}`);
  }

  return body;
}

export async function fetchBridgeRecords(supabaseUrl, tableName, apiKey, options = {}) {
  const url = new URL(`/rest/v1/${tableName}`, supabaseUrl);
  url.searchParams.set('select', options.select || 'id,record_key,source_sha256,version');
  url.searchParams.set('source_kind', 'eq.vault_bridge_note');
  url.searchParams.set('memory_namespace', 'eq.bridge');
  url.searchParams.set('limit', String(options.limit || 500));
  url.searchParams.set('order', options.order || 'topic.asc');

  return fetchJson(url.toString(), {
    headers: createHeaders(apiKey),
  });
}

export async function upsertBridgeRecords(supabaseUrl, tableName, apiKey, records) {
  const url = new URL(`/rest/v1/${tableName}`, supabaseUrl);
  url.searchParams.set('on_conflict', 'record_key');

  return fetchJson(url.toString(), {
    method: 'POST',
    headers: createHeaders(apiKey, {
      Prefer: 'resolution=merge-duplicates,return=representation',
    }),
    body: JSON.stringify(records),
  });
}

export async function insertSyncRun(supabaseUrl, tableName, apiKey, syncRun) {
  const url = new URL(`/rest/v1/${tableName}`, supabaseUrl);
  return fetchJson(url.toString(), {
    method: 'POST',
    headers: createHeaders(apiKey, {
      Prefer: 'return=minimal',
    }),
    body: JSON.stringify(syncRun),
  });
}
