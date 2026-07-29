import { createPublishedReferenceTemplate } from '../published-reference/factory.js';

export const vbjServicesReferenceTemplate = createPublishedReferenceTemplate({
  id: 'vbj-services-reference',
  name: 'Cinematic Command Layout',
  description:
    'Imported from the VBJ Services / Vink Elektrotechniek v3 family: command-nav, scene hero, showcase frames, and a cinematic process story.',
  siteTitle: 'Cinematic Command Layout',
  siteSubtitle:
    'Reference-first layout for modern AI, automation, and high-end service offers that need a sharper cinematic sales flow.',
  sourceLabel: 'Source preview: VBJ Services',
  previewUrl: 'https://officiallachkid.github.io/ruflo/sites/vbj-services/',
  previewNote:
    'This design is currently a reusable reference layout. Full field-level editing for this imported family is a separate import step.',
  theme: {
    backgroundColor: '#0f1320',
    surfaceColor: '#161b2b',
    accentColor: '#f1c64c',
    textColor: '#f5f1e8',
    panelColor: '#1d2438',
  },
});
