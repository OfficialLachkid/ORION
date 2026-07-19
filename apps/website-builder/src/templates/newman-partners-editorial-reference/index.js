import { createPublishedReferenceTemplate } from '../published-reference/factory.js';
import {
  imageField,
  linkField,
  textField,
} from '../published-reference/content-fields.js';

const features = [
  ['The brief comes first', 'Every mandate is bespoke.', 'We take the brief in person — the technical requirement, the team beneath it, the culture around it, the commercials that shape it. Only then do we start searching.', 'https://images.unsplash.com/photo-1568992687947-868a62a9f521?auto=format&fit=crop&w=1400&q=80'],
  ['The network works', 'Twelve years of quiet introductions.', 'A decade of relationships across Amsterdam finance, tax and legal circles. Warm introductions travel faster and land better than any job board.', 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&w=1400&q=80'],
  ['Aftercare is standard', 'A placement is a relationship.', 'We stay in touch six weeks in, six months in, and every year after — because a placement is the beginning of a relationship, not the end of one.', 'https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=1400&q=80'],
];

const services = [
  ['Executive Search', 'Confidential C-suite and partner-level searches'],
  ['Finance & Audit', 'Newly qualified auditors through Audit Partners'],
  ['Tax & Transfer Pricing', 'Direct tax, indirect tax, TP managers and directors'],
  ['Legal & Notarial', 'Kandidaat-notarissen, corporate lawyers, in-house counsel'],
  ['Interim Professionals', 'Verified, vetted, ready in days rather than weeks'],
  ['Career Advisory', 'Long-form guidance for professionals thinking beyond the next move'],
];

export const newmanPartnersEditorialReferenceTemplate = createPublishedReferenceTemplate({
  id: 'newman-partners-editorial-reference',
  name: 'Editorial Authority Layout',
  description:
    'Imported from Newman & Partners v2: editorial masthead, manifesto sections, feature splits, and a slower premium narrative flow.',
  siteTitle: 'Editorial Authority Layout',
  siteSubtitle:
    'Reference-first layout for premium recruitment, consulting, and advisory websites that need a calmer editorial story.',
  sourceLabel: 'Source preview: Newman & Partners v2',
  previewUrl: 'https://officiallachkid.github.io/ORION/sites/newman-partners-v2/',
  previewNote:
    'Edit company text and images while the editorial structure and its motion remain locked.',
  contentSections: [
    {
      id: 'navigation',
      title: 'Navigation',
      previewSelector: 'header',
      fields: [
        textField('navigation.brand', 'Company name', 'Newman & Partners'),
        textField('navigation.cta', 'Call-to-action button', 'Start a conversation'),
      ],
    },
    {
      id: 'hero',
      title: 'Hero content',
      previewSelector: '#top',
      fields: [
        textField('hero.eyebrow', 'Eyebrow', '╱ Amsterdam · Established MMXIII'),
        textField('hero.titleLine1', 'Heading line 1', 'Recruitment'),
        textField('hero.titleLine2', 'Heading line 2', 'is all about'),
        textField('hero.titleLine3', 'Accent heading', 'your future.'),
        textField('hero.description', 'Description', 'An Amsterdam-based executive-search practice for finance, audit, tax and legal professionals. Human to human, always.', { type: 'textarea' }),
        imageField('hero.imageUrl', 'Hero image', 'https://images.unsplash.com/photo-1573497019418-b400bb3ab074?auto=format&fit=crop&w=1200&q=80'),
        textField('hero.imageCaption', 'Image caption', 'Fig. 01 — On the office floor, IJsbaanpad, Amsterdam · Photograph'),
      ],
    },
    {
      id: 'manifesto',
      title: 'Manifesto',
      previewSelector: '#manifesto',
      fields: [
        textField('manifesto.eyebrow', 'Eyebrow', '╱ Manifesto'),
        textField('manifesto.opening', 'Opening statement', 'We treat every candidate as a colleague. Every brief as a '),
        textField('manifesto.accent', 'Accent word', 'conversation'),
        textField('manifesto.ending', 'Closing statement', ' — not a transaction.'),
      ],
    },
    {
      id: 'features',
      title: 'Feature stories',
      previewSelector: '#approach',
      fields: features.flatMap(([title, subtitle, description, imageUrl], index) => [
        textField(`features.items.${index}.title`, `Feature ${index + 1} title`, title),
        textField(`features.items.${index}.subtitle`, `Feature ${index + 1} subtitle`, subtitle),
        textField(`features.items.${index}.description`, `Feature ${index + 1} description`, description, { type: 'textarea' }),
        imageField(`features.items.${index}.imageUrl`, `Feature ${index + 1} image`, imageUrl),
      ]),
    },
    {
      id: 'services',
      title: 'Practice areas',
      previewSelector: '#index',
      fields: [
        textField('services.eyebrow', 'Eyebrow', '╱ Index'),
        textField('services.heading', 'Heading', 'Practice areas'),
        textField('services.description', 'Description', 'Six focused verticals — every consultant works one deeply.', { type: 'textarea' }),
        ...services.flatMap(([title, description], index) => [
          textField(`services.items.${index}.title`, `Practice ${index + 1} title`, title),
          textField(`services.items.${index}.description`, `Practice ${index + 1} description`, description),
        ]),
      ],
    },
    {
      id: 'testimonial',
      title: 'Testimonial',
      previewSelector: '#testimonial',
      fields: [
        textField('testimonial.eyebrow', 'Eyebrow', '╱ Testimonial'),
        textField('testimonial.quote', 'Quote', 'What distinguished Newman & Partners from others was their personalised approach — they truly grasped my needs and dedicated themselves to helping me uncover the perfect fit.', { type: 'textarea' }),
        textField('testimonial.author', 'Author', 'Rik Kramer RA · Audit Partner'),
      ],
    },
    {
      id: 'contact',
      title: 'Contact content',
      previewSelector: '#contact',
      fields: [
        textField('contact.eyebrow', 'Eyebrow', '╱ Begin'),
        textField('contact.heading', 'Call to action', 'Whether you’re hiring or exploring your next move — come and talk to us.', { type: 'textarea' }),
        imageField('contact.imageUrl', 'Background image', 'https://images.unsplash.com/photo-1512470876302-972faa2aa9a4?auto=format&fit=crop&w=2000&q=80'),
        linkField('contact.email', 'Email', 'jasper@newmanpartners.nl', { type: 'email', prefix: 'mailto:' }),
        linkField('contact.phone', 'Phone', '+31 6 27 51 80 19', { prefix: 'tel:' }),
        textField('contact.address', 'Address', 'IJsbaanpad 2, 1076 CV Amsterdam'),
      ],
    },
    {
      id: 'footer',
      title: 'Footer',
      previewSelector: '#footer',
      fields: [
        textField('footer.brand', 'Company name', 'Newman & Partners'),
        textField('footer.tagline', 'Tagline', 'Recruitment is all about your future.'),
        textField('footer.description', 'Company description', 'An Amsterdam-based executive-search practice for finance, audit, tax and legal professionals. Established 2013 · Founded and run by Jasper Newman.', { type: 'textarea' }),
      ],
    },
  ],
  theme: {
    backgroundColor: '#f6f1ea',
    surfaceColor: '#fffaf5',
    accentColor: '#5b4132',
    textColor: '#221a16',
    panelColor: '#efe3d7',
  },
});
