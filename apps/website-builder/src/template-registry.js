import { mergeDeep, isPlainObject } from './lib/draft.js';
import { newmanPartnersEditorialReferenceTemplate } from './templates/newman-partners-editorial-reference/index.js';
import { panoramaTemplate } from './templates/panorama/index.js';
import { trustSignalsTemplate } from './templates/trust-signals/index.js';
import { vbjServicesReferenceTemplate } from './templates/vbj-services-reference/index.js';
import { vinkElektrotechniekReferenceTemplate } from './templates/vink-elektrotechniek-reference/index.js';

const DEFAULT_TEMPLATE_ID = 'panorama-landing';

const TEMPLATE_REGISTRY = Object.freeze({
  [vinkElektrotechniekReferenceTemplate.id]: vinkElektrotechniekReferenceTemplate,
  [newmanPartnersEditorialReferenceTemplate.id]: newmanPartnersEditorialReferenceTemplate,
  [vbjServicesReferenceTemplate.id]: vbjServicesReferenceTemplate,
  [panoramaTemplate.id]: panoramaTemplate,
  [trustSignalsTemplate.id]: trustSignalsTemplate,
});

function normalizeTemplateId(templateId) {
  return String(templateId || '').trim().toLowerCase();
}

export const TEMPLATE_OPTIONS = Object.freeze(
  Object.values(TEMPLATE_REGISTRY).map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    builderEnabled: template.builderEnabled,
  }))
);

export function getTemplateById(templateId) {
  return TEMPLATE_REGISTRY[normalizeTemplateId(templateId)] || TEMPLATE_REGISTRY[DEFAULT_TEMPLATE_ID];
}

export function createDefaultDraft(templateId = DEFAULT_TEMPLATE_ID) {
  const template = getTemplateById(templateId);

  return {
    ...structuredClone(template.createSeed()),
    templateId: template.id,
    updatedAt: new Date().toISOString(),
  };
}

export function hydrateDraft(input) {
  const normalizedInput = isPlainObject(input) ? input : {};
  const templateId = getTemplateById(normalizedInput.templateId).id;
  const mergedDraft = mergeDeep(createDefaultDraft(templateId), normalizedInput);
  mergedDraft.templateId = templateId;
  return mergedDraft;
}

export function reseedDraftForTemplate(input, templateId) {
  const nextTemplate = getTemplateById(templateId);
  const normalizedInput = isPlainObject(input) ? structuredClone(input) : {};
  const mergedDraft = mergeDeep(createDefaultDraft(nextTemplate.id), normalizedInput);
  mergedDraft.templateId = nextTemplate.id;
  mergedDraft.updatedAt = new Date().toISOString();
  return mergedDraft;
}

export function getEditorSections(templateId) {
  return getTemplateById(templateId).editorSections;
}

export function renderTemplate(draft) {
  return getTemplateById(draft?.templateId).render(draft);
}
