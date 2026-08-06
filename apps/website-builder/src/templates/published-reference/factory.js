import { renderPublishedReferenceTemplate } from './render.js';

function setNestedValue(target, path, value) {
  const parts = path.split('.');
  let cursor = target;

  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      cursor[part] = value;
      return;
    }

    cursor[part] ||= {};
    cursor = cursor[part];
  });
}

function buildContentConfiguration(contentSections = []) {
  const content = {};
  const bindings = {};
  const navigation = {};
  const selectionPaths = {};
  const editorSections = contentSections.map((section) => {
    const sectionTargetId = `reference-section:${section.id}`;
    navigation[sectionTargetId] = section.previewSelector;

    const fields = section.fields.map((field) => {
      const path = `content.${field.key}`;
      setNestedValue(content, field.key, field.value);
      bindings[path] = field.targets;
      navigation[path] = field.previewSelector || field.targets[0]?.selector || section.previewSelector;
      selectionPaths[field.key] = path;
      return {
        label: field.label,
        path,
        type: field.type || 'text',
        description: field.description || '',
      };
    });

    return {
      id: `reference-${section.id}`,
      title: section.title,
      previewTargetId: sectionTargetId,
      fields,
    };
  });

  return { content, bindings, navigation, selectionPaths, editorSections };
}

function createPublishedReferenceSeed(config) {
  const contentConfiguration = buildContentConfiguration(config.contentSections);
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
    content: contentConfiguration.content,
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
  const contentConfiguration = buildContentConfiguration(config.contentSections);
  return Object.freeze({
    id: config.id,
    name: config.name,
    description: config.description,
    builderEnabled: true,
    createSeed: () => createPublishedReferenceSeed(config),
    editorSections: contentConfiguration.editorSections,
    referenceBindings: contentConfiguration.bindings,
    referenceNavigation: contentConfiguration.navigation,
    referenceSelectionPaths: contentConfiguration.selectionPaths,
    render: renderPublishedReferenceTemplate,
  });
}
