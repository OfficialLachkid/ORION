import { TRUST_SIGNALS_EDITOR_SECTIONS } from './editor-config.js';
import { renderTrustSignalsTemplate } from './render.js';
import { createTrustSignalsSeed } from './seed.js';

export const trustSignalsTemplate = Object.freeze({
  id: 'trust-signals',
  name: 'Trust Signals',
  description: 'Trust-first hero, reassurance stack, and compact availability preview.',
  builderEnabled: true,
  createSeed: createTrustSignalsSeed,
  editorSections: TRUST_SIGNALS_EDITOR_SECTIONS,
  render: renderTrustSignalsTemplate,
});
