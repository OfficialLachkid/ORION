import {
  HERO_ALIGNMENT_OPTIONS,
  createEmailField,
  createField,
  createTextAreaField,
  createTextField,
  createToggleField,
  createUrlField,
} from '../shared/field-factories.js';
import {
  createSiteSection,
  createThemeSection,
} from '../shared/editor-sections.js';

const GALLERY_IMAGE_FIELDS = Array.from({ length: 6 }, (_, index) =>
  createUrlField(`Gallery image URL ${index + 1}`, `gallery.images.${index}`)
);

const TRUST_CARD_FIELDS = Array.from({ length: 3 }, (_, index) => [
  createTextField(`Card ${index + 1} title`, `trustCards.${index}.title`),
  createTextAreaField(`Card ${index + 1} description`, `trustCards.${index}.description`),
]).flat();

const RESIDENCE_STAT_FIELDS = Array.from({ length: 4 }, (_, index) => [
  createTextField(`Stat ${index + 1} label`, `residence.stats.${index}.label`),
  createTextField(`Stat ${index + 1} value`, `residence.stats.${index}.value`),
]).flat();

const AMENITY_FIELDS = Array.from({ length: 9 }, (_, index) =>
  createTextField(`Amenity ${index + 1}`, `amenities.items.${index}.label`)
);

const JOURNEY_FIELDS = Array.from({ length: 3 }, (_, index) => [
  createTextField(`Stop ${index + 1} title`, `journeyStops.${index}.title`),
  createTextAreaField(`Stop ${index + 1} description`, `journeyStops.${index}.description`),
]).flat();

export const PANORAMA_EDITOR_SECTIONS = Object.freeze([
  createSiteSection({
    extraFields: [createTextField('Minimum stay label', 'stay.minimumStayLabel')],
  }),
  {
    id: 'hero',
    title: 'Hero',
    previewTargetId: 'hero.contentAlignment',
    fields: [
      createToggleField('Show top bar', 'visibility.topBar'),
      createToggleField('Show booking prompt', 'visibility.callToAction'),
      createTextField('Hero eyebrow', 'hero.eyebrow'),
      createTextField('Hero title', 'hero.title'),
      createTextAreaField('Hero description', 'hero.description'),
      createField('Hero text alignment', 'hero.contentAlignment', 'position-matrix', {
        description: 'Matches the original Panorama hero positioning control.',
        options: HERO_ALIGNMENT_OPTIONS,
      }),
      createTextField('CTA label', 'hero.ctaLabel'),
      createTextAreaField('CTA note', 'hero.ctaNote'),
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
    id: 'residence',
    title: 'The residence',
    previewTargetId: 'visibility.residenceSection',
    fields: [
      createToggleField('Show residence section', 'visibility.residenceSection'),
      createToggleField('Show residence panel', 'residence.showPanel'),
      createTextField('Section title', 'residence.title'),
      createTextField('Headline', 'residence.headline'),
      createTextAreaField('Description', 'residence.description'),
      createUrlField('Residence image URL', 'residence.image'),
      ...RESIDENCE_STAT_FIELDS,
    ],
  },
  {
    id: 'gallery',
    title: 'Gallery',
    previewTargetId: 'visibility.gallerySection',
    fields: [
      createToggleField('Show gallery section', 'visibility.gallerySection'),
      createToggleField('Show gallery panel', 'gallery.showPanel'),
      createTextField('Section title', 'gallery.title'),
      createTextAreaField('Section subtitle', 'gallery.description'),
      createTextField('Browse button label', 'gallery.browseLabel'),
      ...GALLERY_IMAGE_FIELDS,
    ],
  },
  {
    id: 'amenities',
    title: 'Amenities',
    previewTargetId: 'visibility.amenitiesPanel',
    fields: [
      createToggleField('Show amenities section', 'visibility.amenitiesPanel'),
      createTextField('Section title', 'amenities.title'),
      createTextAreaField('Section subtitle', 'amenities.description'),
      ...AMENITY_FIELDS,
    ],
  },
  {
    id: 'journey',
    title: 'The stay',
    previewTargetId: 'visibility.journeyStops',
    fields: [
      createToggleField('Show journey section', 'visibility.journeyStops'),
      ...JOURNEY_FIELDS,
    ],
  },
  {
    id: 'contact',
    title: 'Contact',
    previewTargetId: 'visibility.contactSection',
    fields: [
      createToggleField('Show contact section', 'visibility.contactSection'),
      createTextField('Section label', 'contact.sectionTitle'),
      createTextField('Section title', 'contact.title'),
      createTextAreaField('Section description', 'contact.description'),
      createTextField('Host name', 'contact.hostName'),
      createUrlField('Avatar image URL', 'contact.avatarImage'),
      createEmailField('Email', 'contact.email'),
      createTextField('Phone', 'contact.phone'),
      createTextField('WhatsApp', 'contact.whatsapp'),
    ],
  },
  createThemeSection(),
]);
