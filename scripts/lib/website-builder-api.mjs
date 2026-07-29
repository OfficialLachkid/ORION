import {
  createEmptyLibrary,
  hydrateLibrary,
} from '../../apps/website-builder/src/storage.js';
import {
  fetchWebsiteBuilderLibrary,
  getWebsiteBuilderPersistenceConfig,
  isWebsiteBuilderPersistenceConfigured,
  upsertWebsiteBuilderEntries,
} from './website-builder-supabase.mjs';

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function getPersistenceMode(configured) {
  return configured ? 'supabase' : 'local-unconfigured';
}

async function readRequestJson(request) {
  let body = '';

  for await (const chunk of request) {
    body += chunk;
  }

  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`Could not parse request JSON: ${error.message}`);
  }
}

function normalizeIncomingEntries(kind, body) {
  const entries = Array.isArray(body?.entries) ? body.entries : [];

  return kind === 'website'
    ? hydrateLibrary({ designs: [], websites: entries }).websites
    : hydrateLibrary({ designs: entries, websites: [] }).designs;
}

export async function maybeHandleWebsiteBuilderApiRequest(request, response) {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');

  if (!requestUrl.pathname.startsWith('/api/website-builder')) {
    return false;
  }

  const config = getWebsiteBuilderPersistenceConfig();
  const configured = isWebsiteBuilderPersistenceConfigured(config);
  const persistenceMode = getPersistenceMode(configured);

  if (request.method === 'GET' && requestUrl.pathname === '/api/website-builder/library') {
    if (!configured) {
      sendJson(response, 200, {
        library: createEmptyLibrary(),
        persistenceMode,
      });
      return true;
    }

    try {
      const library = hydrateLibrary(await fetchWebsiteBuilderLibrary(config));
      sendJson(response, 200, { library, persistenceMode });
    } catch (error) {
      sendJson(response, 500, {
        error: error.message,
        persistenceMode,
      });
    }

    return true;
  }

  if (
    request.method === 'POST'
    && (
      requestUrl.pathname === '/api/website-builder/designs/bulk-upsert'
      || requestUrl.pathname === '/api/website-builder/websites/bulk-upsert'
    )
  ) {
    if (!configured) {
      sendJson(response, 503, {
        error: 'Website Builder Supabase persistence is not configured for this runtime.',
        persistenceMode,
      });
      return true;
    }

    const kind = requestUrl.pathname.includes('/websites/') ? 'website' : 'design';

    try {
      const body = await readRequestJson(request);
      const entries = normalizeIncomingEntries(kind, body);
      const library = hydrateLibrary(await upsertWebsiteBuilderEntries(kind, entries, config));
      sendJson(response, 200, { library, persistenceMode });
    } catch (error) {
      sendJson(response, 400, {
        error: error.message,
        persistenceMode,
      });
    }

    return true;
  }

  sendJson(response, 404, {
    error: 'Website Builder API route not found.',
    persistenceMode,
  });
  return true;
}
