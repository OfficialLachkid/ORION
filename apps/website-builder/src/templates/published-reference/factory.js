import { PUBLISHED_REFERENCE_EDITOR_SECTIONS } from './editor-config.js';
import { renderPublishedReferenceTemplate } from './render.js';

function createPublishedReferenceSeed(config) {
  return {
    templateId: config.id,
    site: {
      title: config.siteTitle,
      subtitle: config.siteSubtitle,
      locationLabel: config.locationLabel || '',
    },
    theme: {
      backgroundColor: config.theme.backgroundColor,
      surfaceColor: config.theme.surfaceColor,
      accentColor: config.theme.accentColor,
      textColor: config.theme.textColor,
      panelColor: config.theme.panelColor,
    },
    reference: {
      sourceLabel: config.sourceLabel,
      previewUrl: config.previewUrl,
      previewNote: config.previewNote,
    },
    visibility: {
      topBar: false,
      trustCards: false,
      availabilityCalendar: false,
      callToAction: false,
      residenceSection: false,
      gallerySection: false,
      amenitiesPanel: false,
      journeyStops: false,
      contactSection: false,
    },
  };
}

export function createPublishedReferenceTemplate(config) {
  return Object.freeze({
    id: config.id,
    name: config.name,
    description: config.description,
    builderEnabled: true,
    createSeed: () => createPublishedReferenceSeed(config),
    editorSections: PUBLISHED_REFERENCE_EDITOR_SECTIONS,
    render: renderPublishedReferenceTemplate,
  });
}
