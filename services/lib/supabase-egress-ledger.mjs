import { access, appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function rowCount(body) {
  if (Array.isArray(body)) return body.length;
  if (body === null || body === undefined || body === '') return 0;
  return typeof body === 'object' ? 1 : 0;
}

function inferResource(urlValue) {
  try {
    const url = new URL(urlValue);
    const match = url.pathname.match(/\/(?:rest\/v1|storage\/v1\/object)\/([^/]+)/u);
    return match?.[1] || 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function recordSupabaseEgress(event, dependencies = {}) {
  const ledgerDir = String(event?.ledgerDir || '').trim();
  if (!ledgerDir) return false;

  const now = dependencies.now?.() || new Date();
  const mkdirImpl = dependencies.mkdir || mkdir;
  const appendFileImpl = dependencies.appendFile || appendFile;
  const accessImpl = dependencies.access || access;
  const responseBytes = Buffer.byteLength(String(event.responseText || ''), 'utf8');
  const contentLength = Number.parseInt(String(event.response?.headers?.get?.('content-length') || ''), 10);
  const record = {
    timestamp: now.toISOString(),
    job: String(event.service || event.job || 'unknown'),
    table_or_bucket: String(event.resource || event.tableOrBucket || inferResource(event.url)),
    operation: String(event.operation || event.method || 'GET').toUpperCase(),
    query_class: String(event.queryClass || 'unspecified'),
    rows_returned: rowCount(event.body),
    response_bytes: responseBytes,
    wire_bytes: Number.isFinite(contentLength) ? contentLength : responseBytes,
    status: Number(event.response?.status || 0),
    cache_status: String(
      event.response?.headers?.get?.('cf-cache-status')
      || event.response?.headers?.get?.('x-cache')
      || '',
    ),
  };

  try {
    const volumeRoot = ledgerDir.match(/^\/Volumes\/[^/]+/u)?.[0];
    if (volumeRoot) await accessImpl(volumeRoot);
    await mkdirImpl(ledgerDir, { recursive: true });
    const day = record.timestamp.slice(0, 10);
    await appendFileImpl(join(ledgerDir, `${day}.jsonl`), `${JSON.stringify(record)}\n`, 'utf8');
    return true;
  } catch {
    // Telemetry must never interrupt leadgen, publication, or other runtime work.
    return false;
  }
}
