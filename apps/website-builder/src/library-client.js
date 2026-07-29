import {
  createEmptyLibrary,
  getMissingStarterDesignEntries,
  hasLibraryEntries,
  hydrateLibrary,
  loadLibrary,
  mergeLibraries,
  saveLibrary,
} from './storage.js';

const API_ROOT = '/api/website-builder';

function createEmptyPayload(persistenceMode = 'local-fallback') {
  return {
    library: createEmptyLibrary(),
    persistenceMode,
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, options);
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    const detail = typeof body === 'string'
      ? body
      : body?.error || `Request failed with status ${response.status}`;
    throw new Error(detail);
  }

  return body;
}

async function fetchRemoteLibrary() {
  return requestJson('/library');
}

async function bulkUpsertEntries(kind, entries) {
  if (!Array.isArray(entries) || entries.length < 1) {
    return createEmptyPayload();
  }

  const collectionPath = kind === 'website' ? 'websites' : 'designs';
  return requestJson(`/${collectionPath}/bulk-upsert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ entries }),
  });
}

async function syncLocalCacheToRemote(localLibrary) {
  let latestPayload = null;

  if (localLibrary.designs.length > 0) {
    latestPayload = await bulkUpsertEntries('design', localLibrary.designs);
  }

  if (localLibrary.websites.length > 0) {
    latestPayload = await bulkUpsertEntries('website', localLibrary.websites);
  }

  return latestPayload;
}

export async function loadPersistedLibrary(options = {}) {
  const {
    ensureStarterDesigns = true,
    syncLocalCache = true,
  } = options;

  const localLibrary = hydrateLibrary(loadLibrary());
  let library = localLibrary;
  let persistenceMode = 'local-fallback';
  let remotePersistenceAvailable = false;

  try {
    const remotePayload = await fetchRemoteLibrary();
    library = hydrateLibrary(remotePayload?.library);
    persistenceMode = remotePayload?.persistenceMode || persistenceMode;
    remotePersistenceAvailable = persistenceMode === 'supabase';

    if (syncLocalCache && remotePersistenceAvailable && hasLibraryEntries(localLibrary)) {
      const syncedPayload = await syncLocalCacheToRemote(localLibrary);
      if (syncedPayload?.library) {
        library = hydrateLibrary(syncedPayload.library);
        persistenceMode = syncedPayload.persistenceMode || persistenceMode;
      } else {
        const refreshedPayload = await fetchRemoteLibrary();
        library = hydrateLibrary(refreshedPayload?.library);
        persistenceMode = refreshedPayload?.persistenceMode || persistenceMode;
      }
    }
  } catch {
    library = localLibrary;
  }

  const missingStarterDesigns = ensureStarterDesigns
    ? getMissingStarterDesignEntries(library)
    : [];

  if (missingStarterDesigns.length > 0) {
    if (remotePersistenceAvailable) {
      try {
        const seededPayload = await bulkUpsertEntries('design', missingStarterDesigns);
        library = hydrateLibrary(seededPayload?.library);
        persistenceMode = seededPayload?.persistenceMode || persistenceMode;
      } catch {
        library = mergeLibraries(
          { designs: missingStarterDesigns, websites: [] },
          library
        );
        persistenceMode = 'local-fallback';
      }
    } else {
      library = mergeLibraries(
        { designs: missingStarterDesigns, websites: [] },
        library
      );
    }
  }

  saveLibrary(library);

  return {
    library,
    persistenceMode,
  };
}

export async function persistLibraryEntries(kind, entries) {
  const nextKind = kind === 'website' ? 'website' : 'design';
  const normalizedEntries = Array.isArray(entries)
    ? entries.filter(Boolean)
    : [];

  if (normalizedEntries.length < 1) {
    return {
      library: hydrateLibrary(loadLibrary()),
      persistenceMode: 'local-fallback',
    };
  }

  try {
    const payload = await bulkUpsertEntries(nextKind, normalizedEntries);
    const library = hydrateLibrary(payload?.library);
    saveLibrary(library);
    return {
      library,
      persistenceMode: payload?.persistenceMode || 'supabase',
      persistedRemotely: true,
    };
  } catch (error) {
    const cachedLibrary = hydrateLibrary(loadLibrary());
    const fallbackLibrary = mergeLibraries(
      nextKind === 'design'
        ? { designs: normalizedEntries, websites: [] }
        : { designs: [], websites: normalizedEntries },
      cachedLibrary
    );
    saveLibrary(fallbackLibrary);

    return {
      library: fallbackLibrary,
      persistenceMode: 'local-fallback',
      persistedRemotely: false,
      error,
    };
  }
}

export async function persistLibraryEntry(kind, entry) {
  return persistLibraryEntries(kind, entry ? [entry] : []);
}
