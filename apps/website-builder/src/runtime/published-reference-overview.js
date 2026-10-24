import { setupPublishedReferenceFrame } from './published-reference-frame.js';

export function setupPublishedReferencePreviews(container, entries, getTemplateById) {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const controllers = [...container.querySelectorAll('[data-preview-entry-id]')]
    .map((root) => {
      const entry = entriesById.get(root.dataset.previewEntryId || '');
      if (!entry) {
        return null;
      }

      return setupPublishedReferenceFrame(
        root,
        entry.draft,
        getTemplateById(entry.templateId)
      );
    })
    .filter(Boolean);

  return () => controllers.forEach((controller) => controller.teardown());
}
