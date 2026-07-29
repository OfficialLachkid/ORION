export function createTrustSignalsSeed() {
  return {
    templateId: 'trust-signals',
    site: {
      title: 'Canal Retreat Studio',
      subtitle: 'A trust-first direct-booking page focused on reassurance before conversion.',
      locationLabel: 'Amsterdam, Jordaan',
    },
    stay: {
      minimumStayLabel: '2-night minimum',
    },
    hero: {
      eyebrow: 'Trust Signals',
      title: 'Direct booking feels safer when the next step is obvious.',
      description:
        'This layout keeps the preview focused on guest confidence: clear host identity, visible availability framing, and a direct request path.',
      image:
        'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1600&q=80',
    },
    trustCards: [
      {
        title: 'Fast host response',
        description: 'Set expectations early with direct contact, clear policies, and a shorter decision path.',
      },
      {
        title: 'Transparent stay terms',
        description:
          'Use this second card for cancellation clarity, arrival rules, or direct-booking reassurance.',
      },
    ],
    calendar: {
      title: 'Availability at a glance',
      description: 'Use a compact calendar card to show current open windows before full booking exists.',
      monthLabel: 'July 2026',
      availabilityLabel: '6 nights open',
      highlights: ['Jul 12 to Jul 18', 'Jul 24 to Jul 29', 'Aug 2 to Aug 7'],
      showPanel: true,
    },
    callToAction: {
      label: 'Request a direct quote',
      note: 'No payment or live checkout is connected yet. This stays in draft mode.',
    },
    theme: {
      backgroundColor: '#f2eee5',
      surfaceColor: '#fffaf4',
      accentColor: '#54703b',
      textColor: '#1f261f',
      panelColor: '#ebe5d5',
    },
    visibility: {
      topBar: true,
      trustCards: true,
      availabilityCalendar: true,
      callToAction: true,
      residenceSection: false,
      gallerySection: false,
      amenitiesPanel: false,
      journeyStops: false,
      contactSection: false,
    },
  };
}
