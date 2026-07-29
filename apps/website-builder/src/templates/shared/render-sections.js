import {
  buildRevealAttributes,
  buildTargetAttributes,
  escapeHtml,
} from './render-helpers.js';

export function renderAvailabilityCalendar(draft, options = {}) {
  const {
    wrapperClassName = 'preview-target trust-availability-card',
    targetId = 'visibility.availabilityCalendar',
    sectionId = 'calendar',
    revealDelay = 120,
  } = options;
  const calendar = draft.calendar || {};
  const highlights = Array.isArray(calendar.highlights)
    ? calendar.highlights.filter((item) => String(item || '').trim())
    : [];
  const calendarClassName = calendar.showPanel === false
    ? `${wrapperClassName} trust-availability-card-plain`
    : wrapperClassName;

  return `
    <section
      ${buildTargetAttributes(targetId, sectionId, calendarClassName)}
      ${buildRevealAttributes(revealDelay)}
    >
      <div class="trust-availability-copy">
        <p ${buildTargetAttributes('calendar.title', sectionId, 'preview-target trust-availability-eyebrow')}>
          ${escapeHtml(calendar.title)}
        </p>
        <h2 ${buildTargetAttributes('calendar.description', sectionId, 'preview-target trust-availability-title')}>
          ${escapeHtml(calendar.description)}
        </h2>
      </div>

      <div class="trust-availability-panel">
        <div class="trust-availability-panel-header">
          <span ${buildTargetAttributes('calendar.monthLabel', sectionId, 'preview-target trust-availability-month')}>
            ${escapeHtml(calendar.monthLabel)}
          </span>
          <span
            ${buildTargetAttributes(
              'calendar.availabilityLabel',
              sectionId,
              'preview-target trust-availability-badge'
            )}
          >
            ${escapeHtml(calendar.availabilityLabel)}
          </span>
        </div>

        <div class="trust-availability-highlight-list">
          ${highlights
            .map(
              (highlight, index) => `
                <span
                  ${buildTargetAttributes(
                    `calendar.highlights.${index}`,
                    sectionId,
                    'preview-target trust-availability-highlight'
                  )}
                >
                  ${escapeHtml(highlight)}
                </span>
              `
            )
            .join('')}
        </div>
      </div>
    </section>
  `;
}

export function renderSoftCallout(draft, options = {}) {
  const {
    className = 'preview-target trust-soft-callout',
    targetId = 'callToAction.label',
    sectionId = 'callToAction',
  } = options;

  return `
    <div ${buildTargetAttributes(targetId, sectionId, className)}>
      <strong>${escapeHtml(draft.callToAction?.label)}</strong>
      <p ${buildTargetAttributes('callToAction.note', sectionId, 'preview-target trust-soft-callout-note')}>
        ${escapeHtml(draft.callToAction?.note)}
      </p>
    </div>
  `;
}
