import {
  buildRevealAttributes,
  buildTargetAttributes,
  escapeAttribute,
  escapeHtml,
} from '../shared/render-helpers.js';
import {
  renderAvailabilityCalendar,
  renderSoftCallout,
} from '../shared/render-sections.js';

function renderTrustCards(draft) {
  return draft.trustCards
    .slice(0, 2)
    .filter((card) => card?.title || card?.description)
    .map(
      (card, index) => `
        <article
          ${buildTargetAttributes(
            `trustCards.${index}.title`,
            'trust',
            'preview-target trust-signals-card'
          )}
        >
          <div class="trust-signals-card-mark" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <div class="trust-signals-card-copy">
            <p class="trust-signals-card-title">${escapeHtml(card.title)}</p>
            <p class="trust-signals-card-description">${escapeHtml(card.description)}</p>
          </div>
        </article>
      `
    )
    .join('');
}

export function renderTrustSignalsTemplate(draft) {
  const showTopBar = draft.visibility?.topBar !== false;
  const showTrustCards = draft.visibility?.trustCards !== false;
  const showAvailabilityCalendar = draft.visibility?.availabilityCalendar !== false;
  const showCallToAction = draft.visibility?.callToAction !== false;

  return `
    <article class="template-site template-site-trust-signals">
      ${showTopBar ? `
        <div ${buildTargetAttributes('visibility.topBar', 'hero', 'preview-target trust-signals-top-bar-shell')}>
          <div class="template-top-bar trust-signals-top-bar">
            <div ${buildTargetAttributes('site.title', 'site', 'preview-target template-top-bar-brand')}>
              <span class="template-top-bar-mark" aria-hidden="true"></span>
              <span>${escapeHtml(draft.site.title)}</span>
            </div>
            <div class="trust-signals-top-bar-meta">
              <span ${buildTargetAttributes('stay.minimumStayLabel', 'site', 'preview-target trust-signals-meta-pill')}>
                ${escapeHtml(draft.stay?.minimumStayLabel)}
              </span>
              <span ${buildTargetAttributes('site.locationLabel', 'site', 'preview-target trust-signals-meta-pill')}>
                ${escapeHtml(draft.site.locationLabel)}
              </span>
            </div>
          </div>
        </div>
      ` : ''}

      <section class="trust-signals-shell">
        <div class="trust-signals-intro-grid" ${buildRevealAttributes(40)}>
          <div class="trust-signals-intro-copy">
            <p ${buildTargetAttributes('hero.eyebrow', 'hero', 'preview-target trust-signals-eyebrow')}>
              ${escapeHtml(draft.hero.eyebrow)}
            </p>
            <h1 ${buildTargetAttributes('hero.title', 'hero', 'preview-target trust-signals-title')}>
              ${escapeHtml(draft.hero.title)}
            </h1>
            <p ${buildTargetAttributes('hero.description', 'hero', 'preview-target trust-signals-description')}>
              ${escapeHtml(draft.hero.description)}
            </p>
          </div>

          <div ${buildTargetAttributes('hero.image', 'hero', 'preview-target trust-signals-hero-visual')}>
            <img
              class="trust-signals-hero-image"
              src="${escapeAttribute(draft.hero.image)}"
              alt="${escapeAttribute(draft.hero.title)}"
            />
          </div>
        </div>

        ${showTrustCards ? `
          <div
            ${buildTargetAttributes(
              'visibility.trustCards',
              'trust',
              'preview-target trust-signals-stack'
            )}
            ${buildRevealAttributes(90)}
          >
            ${renderTrustCards(draft)}
          </div>
        ` : ''}

        ${showAvailabilityCalendar ? renderAvailabilityCalendar(draft, {
          wrapperClassName: 'preview-target trust-availability-card',
          targetId: 'visibility.availabilityCalendar',
          sectionId: 'calendar',
          revealDelay: 135,
        }) : ''}

        ${showCallToAction ? `
          <div class="trust-signals-footer" ${buildRevealAttributes(180)}>
            ${renderSoftCallout(draft, {
              className: 'preview-target trust-soft-callout',
              targetId: 'callToAction.label',
              sectionId: 'callToAction',
            })}
          </div>
        ` : ''}
      </section>
    </article>
  `;
}
