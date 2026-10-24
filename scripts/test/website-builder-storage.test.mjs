import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createStarterDesignEntries,
  getMissingStarterDesignEntries,
  mergeLibraries,
} from '../../apps/website-builder/src/storage.js';
import {
  createDefaultDraft,
  getEditorSections,
  getTemplateById,
  reseedDraftForTemplate,
} from '../../apps/website-builder/src/schema.js';
import { createWebsiteAutosave } from '../../apps/website-builder/src/runtime/website-autosave.js';
import { resolvePublishedPreviewUrl } from '../../apps/website-builder/src/templates/published-reference/render.js';

function wait(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

test('createStarterDesignEntries returns Panorama, Trust Signals, and imported published-site designs', () => {
  const starterDesigns = createStarterDesignEntries();

  assert.equal(starterDesigns.length, 6);
  assert.ok(starterDesigns.every((entry) => entry.kind === 'design'));
  assert.ok(starterDesigns.some((entry) => entry.id === 'starter-design-panorama-landing'));
  assert.ok(starterDesigns.some((entry) => entry.id === 'starter-design-trust-signals'));
  assert.ok(starterDesigns.some((entry) => entry.id === 'starter-design-vink-elektrotechniek-reference'));
  assert.ok(starterDesigns.some((entry) => entry.id === 'starter-design-newman-partners-reference'));
  assert.ok(
    starterDesigns.some((entry) => entry.id === 'starter-design-newman-partners-editorial-reference')
  );
  assert.ok(starterDesigns.some((entry) => entry.id === 'starter-design-vbj-services-reference'));
});

test('imported starter designs use the published sites as their own source previews', () => {
  const starterDesigns = createStarterDesignEntries();
  const vinkDesign = starterDesigns.find((entry) => entry.id === 'starter-design-vink-elektrotechniek-reference');
  const newmanDesign = starterDesigns.find((entry) => entry.id === 'starter-design-newman-partners-reference');
  const editorialDesign = starterDesigns.find(
    (entry) => entry.id === 'starter-design-newman-partners-editorial-reference')
  ;

  assert.equal(vinkDesign?.templateId, 'vink-elektrotechniek-reference');
  assert.equal(vinkDesign?.draft.reference.previewUrl, 'https://officiallachkid.github.io/ORION/sites/vink-elektrotechniek/');
  assert.equal(newmanDesign?.templateId, 'vink-elektrotechniek-reference');
  assert.equal(newmanDesign?.draft.reference.previewUrl, 'https://officiallachkid.github.io/ORION/sites/newman-partners/');
  assert.equal(editorialDesign?.templateId, 'newman-partners-editorial-reference');
  assert.equal(
    editorialDesign?.draft.reference.previewUrl,
    'https://officiallachkid.github.io/ORION/sites/newman-partners-v2/'
  );
});

test('imported starter designs expose content-only editor fields and iframe bindings', () => {
  const templateIds = [
    'vink-elektrotechniek-reference',
    'newman-partners-editorial-reference',
    'vbj-services-reference',
  ];

  for (const templateId of templateIds) {
    const template = getTemplateById(templateId);
    const fields = getEditorSections(templateId).flatMap((section) => section.fields);

    assert.ok(fields.length >= 20, `${templateId} should expose broad editable content`);
    assert.ok(fields.every((field) => field.path.startsWith('content.')));
    assert.ok(fields.every((field) => !['color', 'checkbox', 'position-matrix'].includes(field.type)));
    assert.ok(Object.keys(template.referenceBindings).length > 0);
    assert.ok(template.createSeed().content.hero);
  }
});

test('published previews use local mounts only on the dedicated dev server or explicit test mode', () => {
  const source = 'https://officiallachkid.github.io/ruflo/sites/vbj-services/';

  assert.equal(
    resolvePublishedPreviewUrl(source, { hostname: '127.0.0.1', port: '4173', search: '' }),
    '/ruflo/sites/vbj-services/'
  );
  assert.equal(
    resolvePublishedPreviewUrl(source, { hostname: '127.0.0.1', port: '5500', search: '' }),
    source
  );
  assert.equal(
    resolvePublishedPreviewUrl(source, { hostname: '127.0.0.1', port: '4195', search: '?localPreviews=1' }),
    '/ruflo/sites/vbj-services/'
  );
});

test('switching templates keeps site identity without leaking the prior layout configuration', () => {
  const vinkDraft = createDefaultDraft('vink-elektrotechniek-reference');
  vinkDraft.site.title = 'Example Company';
  vinkDraft.content.hero.titlePrimary = 'Old template content';

  const editorialDraft = reseedDraftForTemplate(vinkDraft, 'newman-partners-editorial-reference');

  assert.equal(editorialDraft.site.title, 'Example Company');
  assert.equal(editorialDraft.reference.previewUrl.includes('newman-partners-v2'), true);
  assert.equal(editorialDraft.content.hero.titleLine1, 'Recruitment');
  assert.equal(editorialDraft.content.hero.titlePrimary, undefined);
  assert.equal(editorialDraft.theme.accentColor, '#5b4132');
});

test('getMissingStarterDesignEntries returns starter entries that are missing or stale', () => {
  const starterDesigns = createStarterDesignEntries();
  const staleVink = {
    ...starterDesigns.find((entry) => entry.id === 'starter-design-vink-elektrotechniek-reference'),
    title: 'Premium Service Layout design',
  };

  const missingDesigns = getMissingStarterDesignEntries({
    designs: [
      starterDesigns.find((entry) => entry.id === 'starter-design-panorama-landing'),
      staleVink,
    ],
    websites: [],
  });

  assert.equal(missingDesigns.some((entry) => entry.id === 'starter-design-panorama-landing'), false);
  assert.equal(missingDesigns.some((entry) => entry.id === 'starter-design-vink-elektrotechniek-reference'), true);
  assert.ok(missingDesigns.length >= 1);
});

test('mergeLibraries keeps preferred entries first while preserving missing fallback entries', () => {
  const merged = mergeLibraries(
    {
      designs: [{ id: 'design-1', kind: 'design', title: 'Remote', templateId: 'panorama-landing', draft: {} }],
      websites: [],
    },
    {
      designs: [{ id: 'design-2', kind: 'design', title: 'Local', templateId: 'trust-signals', draft: {} }],
      websites: [],
    }
  );

  assert.deepEqual(merged.designs.map((entry) => entry.id), ['design-1', 'design-2']);
});

test('website autosave debounces rapid edits and persists only the latest entry', async () => {
  const persistedTitles = [];
  const settledTitles = [];
  const autosave = createWebsiteAutosave({
    delayMs: 5,
    persist: async (entry) => {
      persistedTitles.push(entry.title);
      return { library: {}, persistenceMode: 'supabase' };
    },
    onSettled: (_result, entry) => settledTitles.push(entry.title),
  });

  autosave.schedule({ id: 'website-1', title: 'First edit' });
  autosave.schedule({ id: 'website-1', title: 'Latest edit' });
  await wait(15);
  await autosave.flush();

  assert.deepEqual(persistedTitles, ['Latest edit']);
  assert.deepEqual(settledTitles, ['Latest edit']);
});

test('website autosave serializes writes and does not settle a stale response', async () => {
  const resolvers = [];
  const persistedTitles = [];
  const settledTitles = [];
  const autosave = createWebsiteAutosave({
    delayMs: 1,
    persist: (entry) => new Promise((resolve) => {
      persistedTitles.push(entry.title);
      resolvers.push(resolve);
    }),
    onSettled: (_result, entry) => settledTitles.push(entry.title),
  });

  autosave.schedule({ id: 'website-1', title: 'In flight' });
  await wait(5);
  autosave.schedule({ id: 'website-1', title: 'Queued latest' });
  resolvers.shift()({ library: {}, persistenceMode: 'supabase' });
  await wait(5);
  resolvers.shift()({ library: {}, persistenceMode: 'supabase' });
  await autosave.flush();

  assert.deepEqual(persistedTitles, ['In flight', 'Queued latest']);
  assert.deepEqual(settledTitles, ['Queued latest']);
});
