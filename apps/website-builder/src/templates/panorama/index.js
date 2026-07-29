import { PANORAMA_EDITOR_SECTIONS } from './editor-config.js';
import { renderPanoramaTemplate } from './render.js';
import { createPanoramaSeed } from './seed.js';

export const panoramaTemplate = Object.freeze({
  id: 'panorama-landing',
  name: 'Panorama Landing',
  description: 'Large hero image with fast trust signals and a guided booking call-to-action.',
  builderEnabled: true,
  createSeed: createPanoramaSeed,
  editorSections: PANORAMA_EDITOR_SECTIONS,
  render: renderPanoramaTemplate,
});
