export function createPanoramaSeed() {
  return {
    templateId: 'panorama-landing',
    site: {
      title: 'North Coast Hideaway',
      subtitle: 'A direct-booking website draft with local-first storage.',
      locationLabel: 'Scheveningen, The Hague',
    },
    stay: {
      minimumStayLabel: '3-night minimum',
    },
    hero: {
      eyebrow: 'Panorama Landing',
      title: 'Stay close to the sea, without platform noise.',
      description:
        'A polished local-first website draft that keeps the direct-booking Website Builder flow without PMS dependency.',
      contentAlignment: 'center-left',
      ctaLabel: 'Request your stay',
      ctaNote: 'No live publish or domain connection yet.',
      image:
        'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1800&q=80',
    },
    trustCards: [
      {
        title: 'Clear direct contact',
        description: 'Guests immediately see how to reach the host without marketplace friction.',
      },
      {
        title: 'Calmer booking path',
        description:
          'The page guides visitors toward a direct request instead of a noisy multi-step funnel.',
      },
      {
        title: 'Structured for later scale',
        description:
          'This draft model can move from local storage to Supabase without reshaping the editor.',
      },
    ],
    residence: {
      title: 'The residence',
      headline: 'Designed to present the stay with clarity and confidence.',
      description:
        'Use this section for the strongest short-form property story, supported by a lead image and key stay signals.',
      image:
        'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1600&q=80',
      showPanel: true,
      stats: [
        { label: 'Sleeps', value: '4 guests' },
        { label: 'Check-in', value: 'Self check-in' },
        { label: 'Stay', value: '3-night minimum' },
        { label: 'Booking', value: 'Direct request only' },
      ],
    },
    gallery: {
      title: 'Gallery',
      description: 'A more editorial presentation of the property.',
      browseLabel: 'Browse',
      showPanel: true,
      images: [
        'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1400&q=80',
        'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1400&q=80',
        'https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=1400&q=80',
        'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1400&q=80',
        'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1400&q=80',
        'https://images.unsplash.com/photo-1448630360428-65456885c650?auto=format&fit=crop&w=1400&q=80',
      ],
    },
    amenities: {
      title: 'Amenities',
      description: 'Every detail considered.',
      items: [
        { label: 'Fast Wi-Fi' },
        { label: 'Walk to beach' },
        { label: 'Self check-in' },
        { label: 'Workspace corner' },
        { label: 'Private terrace' },
        { label: 'Washer' },
        { label: 'Blackout bedroom' },
        { label: 'Smart TV' },
        { label: 'Coffee station' },
      ],
    },
    journeyStops: [
      {
        title: 'First impression',
        description:
          'The page opens with confidence and gives guests a clear sense of the stay.',
      },
      {
        title: 'During the stay',
        description:
          'Amenities, visuals, and property detail support the decision without overwhelming the visitor.',
      },
      {
        title: 'Next step',
        description: 'The CTA and contact section make the direct request path obvious.',
      },
    ],
    contact: {
      sectionTitle: 'Direct contact',
      title: 'Talk to the host directly',
      description:
        'Use email, phone, or WhatsApp while booking logic and publish flow remain out of scope.',
      hostName: 'North Coast Host',
      avatarImage: '',
      email: 'host@example.com',
      phone: '+31 6 1234 5678',
      whatsapp: '+31 6 1234 5678',
    },
    calendar: {
      title: 'Availability',
      description: 'Reserved for later real availability and quote flow work.',
      monthLabel: 'Not connected',
      availabilityLabel: 'Preview only',
      highlights: ['Live calendar is not connected yet.'],
      showPanel: true,
    },
    callToAction: {
      label: 'Request your stay',
      note: 'No live publish or domain connection yet.',
    },
    theme: {
      backgroundColor: '#f4efe5',
      surfaceColor: '#fffaf2',
      accentColor: '#234c3d',
      textColor: '#17211f',
      panelColor: '#f8f1e5',
    },
    visibility: {
      topBar: true,
      callToAction: true,
      trustCards: true,
      residenceSection: true,
      gallerySection: true,
      amenitiesPanel: true,
      journeyStops: true,
      contactSection: true,
      availabilityCalendar: false,
    },
  };
}
