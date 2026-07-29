import {
  createColorField,
  createTextAreaField,
  createTextField,
} from './field-factories.js';

export function createSiteSection({
  previewTargetId = 'site.title',
  extraFields = [],
} = {}) {
  return {
    id: 'site',
    title: 'Site',
    previewTargetId,
    fields: [
      createTextField('Website title', 'site.title'),
      createTextField('Subtitle', 'site.subtitle'),
      createTextField('Location label', 'site.locationLabel'),
      ...extraFields,
    ],
  };
}

export function createThemeSection() {
  return {
    id: 'theme',
    title: 'Theme',
    previewTargetId: 'theme.accentColor',
    fields: [
      createColorField('Background color', 'theme.backgroundColor'),
      createColorField('Surface color', 'theme.surfaceColor'),
      createColorField('Accent color', 'theme.accentColor'),
      createColorField('Text color', 'theme.textColor'),
      createColorField('Panel color', 'theme.panelColor'),
    ],
  };
}

export function createCallToActionSection({
  previewTargetId = 'callToAction.label',
  togglePath = 'visibility.callToAction',
} = {}) {
  return {
    id: 'callToAction',
    title: 'Call to action',
    previewTargetId,
    fields: [
      {
        label: 'Show call to action',
        path: togglePath,
        type: 'checkbox',
      },
      createTextField('CTA label', 'callToAction.label'),
      createTextAreaField('CTA note', 'callToAction.note'),
    ],
  };
}
