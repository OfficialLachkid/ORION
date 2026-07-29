import {
  createDefaultDraft,
  hydrateDraft,
  getTemplateById,
} from './schema.js';
import { mergeDeep } from './lib/draft.js';

const LIBRARY_STORAGE_KEY = 'orion.website-builder.library.v1';
const SESSION_STORAGE_KEY = 'orion.website-builder.session.v1';

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeDraft(input, templateId) {
  if (input) {
    return hydrateDraft(templateId ? { ...input, templateId } : input);
  }

  return createDefaultDraft(templateId);
}

function getSessionTitle(kind, entryTitle, draft) {
  const normalizedEntryTitle = normalizeText(entryTitle);
  if (normalizedEntryTitle) {
    return normalizedEntryTitle;
  }

  const siteTitle = normalizeText(draft?.site?.title);
  if (siteTitle) {
    return kind === 'design' ? `${siteTitle} design` : siteTitle;
  }

  return kind === 'design' ? 'Untitled design' : 'Untitled website';
}

export function createSession(kind = 'design', options = {}) {
  const templateId = normalizeText(options.templateId) || undefined;
  const draft = normalizeDraft(options.draft, templateId);
  const nextKind = kind === 'website' ? 'website' : 'design';

  return {
    recordKind: nextKind,
    recordId: normalizeText(options.recordId),
    entryTitle: getSessionTitle(nextKind, options.entryTitle, draft),
    companyName: nextKind === 'website'
      ? normalizeText(options.companyName) || normalizeText(draft.site?.title)
      : '',
    summary: normalizeText(options.summary),
    sourceDesignId: nextKind === 'website' ? normalizeText(options.sourceDesignId) : '',
    draft,
  };
}

function normalizeEntry(kind, entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const nextKind = kind === 'website' ? 'website' : 'design';
  const draft = normalizeDraft(entry.draft, entry.templateId);
  const normalizedEntry = {
    id: normalizeText(entry.id) || createId(nextKind),
    kind: nextKind,
    templateId: draft.templateId,
    title: getSessionTitle(nextKind, entry.title, draft),
    companyName: nextKind === 'website'
      ? normalizeText(entry.companyName) || normalizeText(draft.site?.title)
      : '',
    summary: normalizeText(entry.summary),
    sourceDesignId: nextKind === 'website' ? normalizeText(entry.sourceDesignId) : '',
    createdAt: normalizeText(entry.createdAt) || nowIso(),
    updatedAt: normalizeText(entry.updatedAt) || nowIso(),
    draft,
  };

  return normalizedEntry;
}

function createStarterDesignId(templateId) {
  return `starter-design-${normalizeText(templateId)}`;
}

const STARTER_DESIGN_SPECS = Object.freeze([
  {
    id: createStarterDesignId('panorama-landing'),
    templateId: 'panorama-landing',
  },
  {
    id: createStarterDesignId('trust-signals'),
    templateId: 'trust-signals',
  },
  {
    id: 'starter-design-vink-elektrotechniek-reference',
    templateId: 'vink-elektrotechniek-reference',
    title: 'Vink Elektrotechniek design',
    summary:
      'Imported from the published Vink Elektrotechniek site. Reusable Premium Service Layout reference for premium service-business websites.',
    draftOverrides: {
      site: {
        title: 'Vink Elektrotechniek',
        subtitle: 'Vakwerk voor huis en bedrijf in Zaandam en omgeving.',
      },
      reference: {
        sourceLabel: 'Source preview: Vink Elektrotechniek',
        previewUrl: 'https://officiallachkid.github.io/ruflo/sites/vink-elektrotechniek/',
      },
    },
  },
  {
    id: 'starter-design-newman-partners-reference',
    templateId: 'vink-elektrotechniek-reference',
    title: 'Newman & Partners v1 design',
    summary:
      'Imported from the published Newman & Partners v1 site. Reusable Premium Service Layout reference for executive-search and advisory websites.',
    draftOverrides: {
      site: {
        title: 'Newman & Partners',
        subtitle: 'Recruitment is all about your future.',
      },
      reference: {
        sourceLabel: 'Source preview: Newman & Partners v1',
        previewUrl: 'https://officiallachkid.github.io/ruflo/sites/newman-partners/',
      },
    },
  },
  {
    id: 'starter-design-newman-partners-editorial-reference',
    templateId: 'newman-partners-editorial-reference',
    title: 'Newman & Partners editorial design',
    summary:
      'Imported from the published Newman & Partners v2 site. Reusable Editorial Authority Layout reference for premium recruitment and consulting websites.',
    draftOverrides: {
      site: {
        title: 'Newman & Partners',
        subtitle: 'Editorial authority layout for human-first executive search.',
      },
      reference: {
        sourceLabel: 'Source preview: Newman & Partners v2',
        previewUrl: 'https://officiallachkid.github.io/ruflo/sites/newman-partners-v2/',
      },
    },
  },
  {
    id: 'starter-design-vbj-services-reference',
    templateId: 'vbj-services-reference',
    title: 'VBJ Services design',
    summary:
      'Imported from the published VBJ Services site. Reusable Cinematic Command Layout reference for modern AI and automation offers.',
    draftOverrides: {
      site: {
        title: 'VBJ Services',
        subtitle: 'Digital products, automation & AI agents.',
      },
      reference: {
        sourceLabel: 'Source preview: VBJ Services',
        previewUrl: 'https://officiallachkid.github.io/ruflo/sites/vbj-services/',
      },
    },
  },
]);

function createStarterDesignEntry(spec) {
  const template = getTemplateById(spec.templateId);
  const draft = mergeDeep(createDefaultDraft(template.id), spec.draftOverrides || {});
  const baseTitle = normalizeText(spec.title) || normalizeText(draft.site?.title) || template.name;
  const summary = normalizeText(spec.summary)
    || `${template.description} Starter reusable design imported from the ${template.name} template.`;

  return normalizeEntry('design', {
    id: spec.id || createStarterDesignId(template.id),
    title: baseTitle,
    summary,
    templateId: template.id,
    draft,
  });
}

function areStarterDesignEntriesEquivalent(existingEntry, starterEntry) {
  const existingDraft = structuredClone(existingEntry?.draft || {});
  const starterDraft = structuredClone(starterEntry?.draft || {});
  delete existingDraft.updatedAt;
  delete starterDraft.updatedAt;

  return existingEntry?.templateId === starterEntry.templateId
    && existingEntry?.title === starterEntry.title
    && existingEntry?.summary === starterEntry.summary
    && JSON.stringify(existingDraft) === JSON.stringify(starterDraft);
}

export function createEmptyLibrary() {
  return {
    designs: [],
    websites: [],
  };
}

export function hydrateLibrary(input) {
  const parsed = input && typeof input === 'object' ? input : {};
  const designs = Array.isArray(parsed.designs)
    ? parsed.designs.map((entry) => normalizeEntry('design', entry)).filter(Boolean)
    : [];
  const websites = Array.isArray(parsed.websites)
    ? parsed.websites.map((entry) => normalizeEntry('website', entry)).filter(Boolean)
    : [];

  return { designs, websites };
}

function mergeEntryCollections(preferredCollection = [], fallbackCollection = []) {
  const mergedById = new Map();

  for (const entry of [...preferredCollection, ...fallbackCollection]) {
    if (!entry?.id || mergedById.has(entry.id)) {
      continue;
    }

    mergedById.set(entry.id, entry);
  }

  return [...mergedById.values()];
}

export function mergeLibraries(preferredLibrary, fallbackLibrary) {
  const preferred = hydrateLibrary(preferredLibrary);
  const fallback = hydrateLibrary(fallbackLibrary);

  return {
    designs: mergeEntryCollections(preferred.designs, fallback.designs),
    websites: mergeEntryCollections(preferred.websites, fallback.websites),
  };
}

export function hasLibraryEntries(library) {
  return (library?.designs?.length || 0) > 0 || (library?.websites?.length || 0) > 0;
}

export function createStarterDesignEntries() {
  return STARTER_DESIGN_SPECS.map((spec) => createStarterDesignEntry(spec)).filter(Boolean);
}

export function getMissingStarterDesignEntries(library) {
  const existingDesignEntries = new Map(
    hydrateLibrary(library).designs.map((entry) => [entry.id, entry]).filter(([entryId]) => Boolean(entryId))
  );

  return createStarterDesignEntries().filter((entry) => {
    const existingEntry = existingDesignEntries.get(entry.id);
    return !existingEntry || !areStarterDesignEntriesEquivalent(existingEntry, entry);
  });
}

export function loadLibrary() {
  if (!globalThis.localStorage) {
    return createEmptyLibrary();
  }

  const stored = globalThis.localStorage.getItem(LIBRARY_STORAGE_KEY);
  return hydrateLibrary(stored ? safeJsonParse(stored) : null);
}

export function saveLibrary(library) {
  if (!globalThis.localStorage) {
    return false;
  }

  globalThis.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify({
    designs: Array.isArray(library?.designs) ? library.designs : [],
    websites: Array.isArray(library?.websites) ? library.websites : [],
  }));

  return true;
}

export function loadSession() {
  if (!globalThis.localStorage) {
    return createSession('design');
  }

  const stored = globalThis.localStorage.getItem(SESSION_STORAGE_KEY);
  const parsed = stored ? safeJsonParse(stored) : null;

  if (!parsed || typeof parsed !== 'object') {
    return createSession('design');
  }

  if (parsed.draft === undefined && parsed.templateId) {
    return createSession('design', {
      entryTitle: '',
      summary: '',
      draft: parsed,
    });
  }

  return createSession(parsed.recordKind, parsed);
}

export function saveSession(session) {
  if (!globalThis.localStorage) {
    return false;
  }

  globalThis.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    ...session,
    draft: hydrateDraft(session.draft),
  }));

  return true;
}

export function resetSession(session) {
  return createSession(session.recordKind, {
    recordId: session.recordId,
    entryTitle: session.entryTitle,
    companyName: session.companyName,
    summary: session.summary,
    sourceDesignId: session.sourceDesignId,
    templateId: session.draft?.templateId,
  });
}

export function getEntriesByKind(library, kind) {
  return kind === 'website' ? library.websites : library.designs;
}

export function getEntryById(library, kind, entryId) {
  return getEntriesByKind(library, kind).find((entry) => entry.id === entryId) || null;
}

function upsertEntryInCollection(collection, nextEntry) {
  const index = collection.findIndex((entry) => entry.id === nextEntry.id);
  if (index < 0) {
    return [nextEntry, ...collection];
  }

  const nextCollection = [...collection];
  nextCollection[index] = nextEntry;
  return nextCollection;
}

export function createSessionFromEntry(entry) {
  return createSession(entry.kind, {
    recordId: entry.id,
    entryTitle: entry.title,
    companyName: entry.companyName,
    summary: entry.summary,
    sourceDesignId: entry.sourceDesignId,
    draft: entry.draft,
  });
}

export function createWebsiteSessionFromDesign(entry) {
  return createSession('website', {
    entryTitle: `${entry.title} website`,
    companyName: normalizeText(entry.draft?.site?.title),
    summary: entry.summary,
    sourceDesignId: entry.id,
    draft: entry.draft,
  });
}

function getNextWebsiteTitle(library, baseTitle) {
  const normalizedBaseTitle = normalizeText(baseTitle) || 'Untitled website';
  const existingTitles = new Set(
    (library?.websites || []).map((entry) => normalizeText(entry.title).toLowerCase()).filter(Boolean)
  );

  if (!existingTitles.has(normalizedBaseTitle.toLowerCase())) {
    return normalizedBaseTitle;
  }

  let suffix = 2;
  while (existingTitles.has(`${normalizedBaseTitle} ${suffix}`.toLowerCase())) {
    suffix += 1;
  }

  return `${normalizedBaseTitle} ${suffix}`;
}

export function saveEntryFromSession(library, session, targetKind = session.recordKind) {
  const nextKind = targetKind === 'website' ? 'website' : 'design';
  const existingEntry = nextKind === session.recordKind
    ? getEntryById(library, nextKind, session.recordId)
    : null;
  const timestamp = nowIso();
  const draft = hydrateDraft(session.draft);
  const entry = normalizeEntry(nextKind, {
    id: existingEntry?.id || createId(nextKind),
    title: session.entryTitle,
    companyName: nextKind === 'website' ? session.companyName : '',
    summary: session.summary,
    sourceDesignId: nextKind === 'website'
      ? normalizeText(
        session.recordKind === 'design'
          ? session.recordId || session.sourceDesignId
          : session.sourceDesignId
      )
      : '',
    createdAt: existingEntry?.createdAt || timestamp,
    updatedAt: timestamp,
    templateId: draft.templateId,
    draft,
  });

  const nextLibrary = {
    designs: nextKind === 'design'
      ? upsertEntryInCollection(library.designs, entry)
      : library.designs,
    websites: nextKind === 'website'
      ? upsertEntryInCollection(library.websites, entry)
      : library.websites,
  };

  return {
    library: nextLibrary,
    entry,
    session: createSessionFromEntry(entry),
  };
}

export function buildWebsiteFromDesign(library, designEntry) {
  const baseSession = createWebsiteSessionFromDesign(designEntry);
  const nextSession = {
    ...baseSession,
    entryTitle: getNextWebsiteTitle(library, baseSession.entryTitle),
  };

  return saveEntryFromSession(library, nextSession, 'website');
}
