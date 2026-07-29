import {
  buildRevealAttributes,
  buildTargetAttributes,
  escapeAttribute,
  escapeHtml,
} from '../shared/render-helpers.js';

function renderNavItems(draft) {
  const items = [
    {
      anchorId: 'overview',
      label: 'Overview',
      sectionId: 'hero',
      targetId: 'hero.contentAlignment',
    },
    ...(draft.visibility.residenceSection
      ? [{
        anchorId: 'about',
        label: String(draft.residence.title || '').trim() || 'The residence',
        sectionId: 'residence',
        targetId: 'visibility.residenceSection',
      }]
      : []),
    ...(draft.visibility.gallerySection
      ? [{
        anchorId: 'gallery',
        label: String(draft.gallery.title || '').trim() || 'Gallery',
        sectionId: 'gallery',
        targetId: 'visibility.gallerySection',
      }]
      : []),
    ...(draft.visibility.amenitiesPanel
      ? [{
        anchorId: 'features',
        label: String(draft.amenities.title || '').trim() || 'Amenities',
        sectionId: 'amenities',
        targetId: 'visibility.amenitiesPanel',
      }]
      : []),
    ...(draft.visibility.journeyStops
      ? [{
        anchorId: 'lifestyle',
        label: 'The stay',
        sectionId: 'journey',
        targetId: 'visibility.journeyStops',
      }]
      : []),
    ...(draft.visibility.contactSection
      ? [{
        anchorId: 'contact',
        label: String(draft.contact.sectionTitle || '').trim() || 'Contact',
        sectionId: 'contact',
        targetId: 'visibility.contactSection',
      }]
      : []),
  ];

  return items
    .map((item) => `
      <a
        href="#${escapeAttribute(item.anchorId)}"
        data-nav-anchor="${escapeAttribute(item.anchorId)}"
        data-nav-section="${escapeAttribute(item.sectionId)}"
        data-nav-target-id="${escapeAttribute(item.targetId)}"
      >
        ${escapeHtml(item.label)}
      </a>
    `)
    .join('');
}

function buildStaggeredRevealAttributes(baseDelayMs, index, stepMs = 36) {
  return buildRevealAttributes(baseDelayMs + (index * stepMs));
}

function renderTrustCards(draft) {
  if (!draft.visibility.trustCards) {
    return '';
  }

  const cards = draft.trustCards
    .filter((card) => card?.title || card?.description)
    .map((card, index) => `
      <article
        ${buildTargetAttributes(`trustCards.${index}.title`, 'trust', 'preview-target panorama-trust-card')}
        ${buildStaggeredRevealAttributes(140, index)}
      >
        <div class="panorama-trust-card-icon"><span></span></div>
        <div class="panorama-trust-card-copy">
          <p class="panorama-trust-card-title">${escapeHtml(card.title)}</p>
          <p class="panorama-trust-card-description">${escapeHtml(card.description)}</p>
        </div>
      </article>
    `)
    .join('');

  return `
    <div
      ${buildTargetAttributes('visibility.trustCards', 'trust', 'preview-target panorama-trust-rail')}
      ${buildRevealAttributes(110)}
    >
      ${cards}
    </div>
  `;
}

function renderResidenceCards(draft) {
  return draft.residence.stats
    .filter((item) => item?.label || item?.value)
    .map((item, index) => `
      <article
        ${buildTargetAttributes(`residence.stats.${index}.value`, 'residence', 'preview-target panorama-residence-card')}
        ${buildStaggeredRevealAttributes(150, index)}
      >
        <span class="panorama-residence-card-label">${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(item.value)}</strong>
      </article>
    `)
    .join('');
}

function renderGalleryTiles(draft) {
  return draft.gallery.images
    .map((imageUrl) => String(imageUrl || '').trim())
    .filter(Boolean)
    .map((imageUrl, index) => `
      <figure
        ${buildTargetAttributes(`gallery.images.${index}`, 'gallery', 'preview-target panorama-gallery-tile-frame')}
        ${buildStaggeredRevealAttributes(170, index, 30)}
      >
        <img class="panorama-gallery-tile" src="${escapeAttribute(imageUrl)}" alt="Gallery image ${index + 1}" />
      </figure>
    `)
    .join('');
}

function renderAmenityCards(draft) {
  return draft.amenities.items
    .filter((item) => String(item?.label || '').trim())
    .map((item, index) => `
      <article
        ${buildTargetAttributes(`amenities.items.${index}.label`, 'amenities', 'preview-target panorama-amenity-card')}
        ${buildStaggeredRevealAttributes(190, index, 24)}
      >
        <span class="panorama-amenity-icon"><span></span></span>
        <span class="panorama-amenity-label">${escapeHtml(item.label)}</span>
      </article>
    `)
    .join('');
}

function renderJourneyCards(draft) {
  if (!draft.visibility.journeyStops) {
    return '';
  }

  return `
    <section id="lifestyle" class="section-card" ${buildRevealAttributes(180)}>
      <div class="section-heading">
        <p class="section-eyebrow">The stay</p>
        <h2>From first impression to arrival, the flow stays easy to follow.</h2>
      </div>

      <div ${buildTargetAttributes('visibility.journeyStops', 'journey', 'preview-target panorama-journey-grid')}>
        ${draft.journeyStops
          .filter((stop) => stop?.title || stop?.description)
          .map((stop, index) => `
            <article
              ${buildTargetAttributes(`journeyStops.${index}.title`, 'journey', 'preview-target panorama-journey-card')}
              ${buildStaggeredRevealAttributes(220, index)}
            >
              <span class="panorama-journey-index">0${index + 1}</span>
              <p class="panorama-journey-title">${escapeHtml(stop.title)}</p>
              <p class="panorama-journey-description">${escapeHtml(stop.description)}</p>
            </article>
          `)
          .join('')}
      </div>
    </section>
  `;
}

function renderContactSection(draft) {
  if (!draft.visibility.contactSection) {
    return '';
  }

  const hostName = String(draft.contact.hostName || '').trim() || 'Host';
  const hostInitial = hostName.charAt(0).toUpperCase() || 'H';
  const avatarImage = String(draft.contact.avatarImage || '').trim();

  return `
    <section id="contact" class="panorama-contact-shell" ${buildRevealAttributes(220)}>
      <div ${buildTargetAttributes('visibility.contactSection', 'contact', 'preview-target panorama-contact-section')}>
        <div class="panorama-contact-copy">
          <p ${buildTargetAttributes('contact.sectionTitle', 'contact', 'preview-target panorama-contact-eyebrow')}>
            ${escapeHtml(draft.contact.sectionTitle)}
          </p>
          <h2 ${buildTargetAttributes('contact.title', 'contact', 'preview-target panorama-contact-title')}>
            ${escapeHtml(draft.contact.title)}
          </h2>
          <p ${buildTargetAttributes('contact.description', 'contact', 'preview-target panorama-contact-description')}>
            ${escapeHtml(draft.contact.description)}
          </p>
          <div class="panorama-contact-meta">
            <span ${buildTargetAttributes('contact.email', 'contact')} ${buildRevealAttributes(250)}>${escapeHtml(draft.contact.email)}</span>
            <span ${buildTargetAttributes('contact.phone', 'contact')} ${buildRevealAttributes(280)}>${escapeHtml(draft.contact.phone)}</span>
            <span ${buildTargetAttributes('contact.whatsapp', 'contact')} ${buildRevealAttributes(310)}>${escapeHtml(draft.contact.whatsapp)}</span>
          </div>
        </div>

        <div class="panorama-host-card" ${buildRevealAttributes(260)}>
          <div ${buildTargetAttributes('contact.avatarImage', 'contact', 'preview-target panorama-host-avatar-shell')}>
            ${avatarImage
              ? `<img src="${escapeAttribute(avatarImage)}" alt="${escapeAttribute(hostName)}" class="panorama-host-avatar" />`
              : `<span class="panorama-host-avatar-fallback" aria-hidden="true">${escapeHtml(hostInitial)}</span>`}
          </div>
          <div class="panorama-host-copy">
            <span class="panorama-host-label">Hosted by</span>
            <h3 ${buildTargetAttributes('contact.hostName', 'contact', 'preview-target panorama-host-name')}>${escapeHtml(hostName)}</h3>
          </div>
        </div>
      </div>
    </section>
  `;
}

export function renderPanoramaTemplate(draft) {
  const heroAlignment = String(draft.hero.contentAlignment || 'center').trim().toLowerCase();
  const showResidencePanel = draft.residence.showPanel !== false;
  const showGalleryPanel = draft.gallery.showPanel !== false;

  return `
    <article class="template-site template-site-panorama">
      ${draft.visibility.topBar ? `
        <div ${buildTargetAttributes('visibility.topBar', 'hero', 'preview-target panorama-top-bar-shell')}>
          <div class="template-top-bar">
            <div ${buildTargetAttributes('site.title', 'site', 'preview-target template-top-bar-brand')}>
              <span class="template-top-bar-mark" aria-hidden="true"></span>
              <span>${escapeHtml(draft.site.title)}</span>
            </div>
            <nav class="template-top-bar-nav">
              ${renderNavItems(draft)}
            </nav>
          </div>
        </div>
      ` : ''}

      <section id="overview" class="panorama-editorial-hero ${draft.visibility.topBar ? 'panorama-editorial-hero-with-top-bar' : ''}" ${buildRevealAttributes(40)}>
        <div class="panorama-hero-backdrop-shell">
          <img
            ${buildTargetAttributes('hero.image', 'hero', 'preview-target panorama-hero-backdrop')}
            src="${escapeAttribute(draft.hero.image)}"
            alt="${escapeAttribute(draft.hero.title)}"
          />
          <div class="panorama-hero-overlay" aria-hidden="true"></div>
          <div class="panorama-hero-inner" data-panorama-hero-alignment="${escapeAttribute(heroAlignment)}">
            <div
              ${buildTargetAttributes('hero.contentAlignment', 'hero', 'preview-target panorama-hero-copy-block')}
              data-panorama-hero-alignment="${escapeAttribute(heroAlignment)}"
            >
              <p ${buildTargetAttributes('hero.eyebrow', 'hero', 'preview-target panorama-hero-eyebrow')}>
                ${escapeHtml(draft.hero.eyebrow)}
              </p>
              <h1 ${buildTargetAttributes('hero.title', 'hero', 'preview-target panorama-hero-headline')}>
                ${escapeHtml(draft.hero.title)}
              </h1>
              <p ${buildTargetAttributes('hero.description', 'hero', 'preview-target panorama-hero-blurb')}>
                ${escapeHtml(draft.hero.description)}
              </p>
              ${draft.visibility.callToAction ? `
                <div class="panorama-hero-action-row" data-panorama-hero-alignment="${escapeAttribute(heroAlignment)}">
                  <div ${buildTargetAttributes('hero.ctaLabel', 'hero', 'preview-target panorama-hero-primary-action')}>
                    <strong>${escapeHtml(draft.hero.ctaLabel)}</strong>
                    <span>${escapeHtml(draft.hero.ctaNote)}</span>
                  </div>
                </div>
              ` : ''}
            </div>
          </div>
        </div>
        ${renderTrustCards(draft)}
      </section>

      ${draft.visibility.residenceSection ? `
        <section
          id="about"
          ${buildTargetAttributes(
            'visibility.residenceSection',
            'residence',
            `preview-target panorama-residence-section ${showResidencePanel ? 'panorama-residence-section-panel' : ''}`.trim()
          )}
          ${buildRevealAttributes(80)}
        >
          <div class="section-heading panorama-residence-heading">
            <p ${buildTargetAttributes('residence.title', 'residence', 'preview-target panorama-residence-eyebrow')}>
              ${escapeHtml(draft.residence.title)}
            </p>
            <h2 ${buildTargetAttributes('residence.headline', 'residence', 'preview-target panorama-residence-headline')}>
              ${escapeHtml(draft.residence.headline)}
            </h2>
            <p ${buildTargetAttributes('residence.description', 'residence', 'preview-target panorama-residence-description')}>
              ${escapeHtml(draft.residence.description)}
            </p>
          </div>

          <div class="panorama-residence-grid">
            <div class="panorama-residence-visual-column">
              <img
                ${buildTargetAttributes('residence.image', 'residence', 'preview-target panorama-residence-image')}
                ${buildRevealAttributes(120)}
                src="${escapeAttribute(draft.residence.image)}"
                alt="${escapeAttribute(draft.residence.headline)}"
              />
            </div>
            <div class="panorama-residence-card-rail">
              ${renderResidenceCards(draft)}
            </div>
          </div>
        </section>
      ` : ''}

      ${draft.visibility.gallerySection ? `
        <section
          id="gallery"
          ${buildTargetAttributes(
            'visibility.gallerySection',
            'gallery',
            `preview-target panorama-gallery-section ${showGalleryPanel ? 'panorama-gallery-section-panel' : ''}`.trim()
          )}
          ${buildRevealAttributes(120)}
        >
          <div class="panorama-gallery-heading">
            <p ${buildTargetAttributes('gallery.title', 'gallery', 'preview-target section-eyebrow')}>
              ${escapeHtml(draft.gallery.title)}
            </p>
            <h2 ${buildTargetAttributes('gallery.description', 'gallery', 'preview-target panorama-gallery-heading-title')}>
              ${escapeHtml(draft.gallery.description)}
            </h2>
          </div>

          <div class="panorama-gallery-grid">
            ${renderGalleryTiles(draft)}
          </div>

          <div class="panorama-gallery-actions">
            <button
              ${buildTargetAttributes('gallery.browseLabel', 'gallery', 'preview-target panorama-amenity-show-all-button')}
              ${buildRevealAttributes(210)}
              type="button"
            >
              ${escapeHtml(draft.gallery.browseLabel)}
            </button>
          </div>
        </section>
      ` : ''}

      ${draft.visibility.amenitiesPanel ? `
        <section
          id="features"
          ${buildTargetAttributes('visibility.amenitiesPanel', 'amenities', 'preview-target panorama-amenities-section')}
          ${buildRevealAttributes(150)}
        >
          <div class="panorama-amenity-intro">
            <p ${buildTargetAttributes('amenities.title', 'amenities', 'preview-target panorama-amenity-eyebrow')}>
              ${escapeHtml(draft.amenities.title)}
            </p>
            <h2 ${buildTargetAttributes('amenities.description', 'amenities', 'preview-target panorama-amenity-title')}>
              ${escapeHtml(draft.amenities.description)}
            </h2>
            <span class="panorama-amenity-divider" aria-hidden="true"></span>
          </div>

          <div class="panorama-amenity-grid">
            ${renderAmenityCards(draft)}
          </div>
        </section>
      ` : ''}

      ${renderJourneyCards(draft)}
      ${renderContactSection(draft)}
    </article>
  `;
}
