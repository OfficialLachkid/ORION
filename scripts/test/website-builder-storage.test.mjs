import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createStarterDesignEntries,
  getMissingStarterDesignEntries,
  mergeLibraries,
} from '../../apps/website-builder/src/storage.js';

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
  assert.equal(vinkDesign?.draft.reference.previewUrl, 'https://officiallachkid.github.io/ruflo/sites/vink-elektrotechniek/');
  assert.equal(newmanDesign?.templateId, 'vink-elektrotechniek-reference');
  assert.equal(newmanDesign?.draft.reference.previewUrl, 'https://officiallachkid.github.io/ruflo/sites/newman-partners/');
  assert.equal(editorialDesign?.templateId, 'newman-partners-editorial-reference');
  assert.equal(
    editorialDesign?.draft.reference.previewUrl,
    'https://officiallachkid.github.io/ruflo/sites/newman-partners-v2/'
  );
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
