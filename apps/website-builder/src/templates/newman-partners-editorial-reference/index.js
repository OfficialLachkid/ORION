import { createPublishedReferenceTemplate } from '../published-reference/factory.js';

export const newmanPartnersEditorialReferenceTemplate = createPublishedReferenceTemplate({
  id: 'newman-partners-editorial-reference',
  name: 'Editorial Authority Layout',
  description:
    'Imported from Newman & Partners v2: editorial masthead, manifesto sections, feature splits, and a slower premium narrative flow.',
  siteTitle: 'Editorial Authority Layout',
  siteSubtitle:
    'Reference-first layout for premium recruitment, consulting, and advisory websites that need a calmer editorial story.',
  sourceLabel: 'Source preview: Newman & Partners v2',
  previewUrl: 'https://officiallachkid.github.io/ruflo/sites/newman-partners-v2/',
  previewNote:
    'This design is currently a reusable reference layout. Full field-level editing for this imported family is a separate import step.',
  theme: {
    backgroundColor: '#f6f1ea',
    surfaceColor: '#fffaf5',
    accentColor: '#5b4132',
    textColor: '#221a16',
    panelColor: '#efe3d7',
  },
});
