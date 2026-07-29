import {
  createTextAreaField,
  createTextField,
  createToggleField,
  createUrlField,
} from '../shared/field-factories.js';
import {
  createCallToActionSection,
  createSiteSection,
  createThemeSection,
} from '../shared/editor-sections.js';

const TRUST_CARD_FIELDS = Array.from({ length: 2 }, (_, index) => [
  createTextField(`Card ${index + 1} title`, `trustCards.${index}.title`),
  createTextAreaField(`Card ${index + 1} description`, `trustCards.${index}.description`),
]).flat();

const CALENDAR_HIGHLIGHT_FIELDS = Array.from({ length: 3 }, (_, index) =>
  createTextField(`Highlight ${index + 1}`, `calendar.highlights.${index}`)
);

export const TRUST_SIGNALS_EDITOR_SECTIONS = Object.freeze([
  createSiteSection({
    extraFields: [createTextField('Minimum stay label', 'stay.minimumStayLabel')],
  }),
  {
    id: 'hero',
    title: 'Hero',
    previewTargetId: 'hero.title',
    fields: [
      createToggleField('Show top bar', 'visibility.topBar'),
      createTextField('Hero eyebrow', 'hero.eyebrow'),
      createTextField('Hero title', 'hero.title'),
      createTextAreaField('Hero description', 'hero.description'),
      createUrlField('Hero image URL', 'hero.image'),
    ],
  },
  {
    id: 'trust',
    title: 'Trust cards',
    previewTargetId: 'visibility.trustCards',
    fields: [
      createToggleField('Show trust cards', 'visibility.trustCards'),
      ...TRUST_CARD_FIELDS,
    ],
  },
  {
    id: 'calendar',
    title: 'Availability card',
    previewTargetId: 'visibility.availabilityCalendar',
    fields: [
      createToggleField('Show availability card', 'visibility.availabilityCalendar'),
      createToggleField('Show availability panel', 'calendar.showPanel'),
      createTextField('Section title', 'calendar.title'),
      createTextAreaField('Section description', 'calendar.description'),
      createTextField('Month label', 'calendar.monthLabel'),
      createTextField('Availability badge', 'calendar.availabilityLabel'),
      ...CALENDAR_HIGHLIGHT_FIELDS,
    ],
  },
  createCallToActionSection(),
  createThemeSection(),
]);
