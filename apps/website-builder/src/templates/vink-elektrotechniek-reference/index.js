import { createPublishedReferenceTemplate } from '../published-reference/factory.js';
import {
  imageField,
  linkField,
  textField,
} from '../published-reference/content-fields.js';

const serviceCards = [
  ['Groepenkasten', 'Volgens NEN 1010', 'Van 1-fase woningaansluiting tot 3-fasen bedrijfsverdeling. We ontwerpen, leveren en installeren — netjes, meetbaar, gedocumenteerd.'],
  ['Storingsdienst', 'Dag & nacht bereikbaar', 'Uitval, kortsluiting, brandalarm? We rukken snel uit. Eén telefoontje en de monteur is onderweg — ook in het weekend.'],
  ['Renovatie & Nieuwbouw', 'Van tekening tot oplevering', 'Compleet elektrotechnisch installatiewerk voor renovaties en nieuwbouw. We plannen samen, leveren op tijd, ondersteunen erna.'],
];

const processSteps = [
  ['Inventarisatie', 'We luisteren eerst.', 'We komen langs, kijken de situatie ter plekke en geven eerlijk advies. Vaste offerte vooraf, geen verrassingen achteraf.'],
  ['Ontwerp & Installatie', 'Netjes uitgevoerd.', 'Ontwerp volgens NEN 1010, materialen van A-merken. We werken schoon, dichten alles af en dragen het pand netjes over.'],
  ['Oplevering & Nazorg', 'We blijven bereikbaar.', 'Meting, keuring en heldere documentatie bij oplevering. En daarna: één telefoontje en we staan klaar. Zo simpel is het.'],
];

const trustCards = [
  ['Kenteq erkend leerbedrijf', 'Officieel geautoriseerd als leerbedrijf door Kenteq. Wij leiden vakmensen op en houden de kennis in huis.'],
  ['NEN 1010 conform', 'Alle installaties voldoen aan de laatste normeringen. Meten, keuren en documenteren horen bij het werk.'],
  ['25+ jaar in Zaanstreek', 'Ruim twee decennia elektrotechnisch werk in Zaandam en omgeving. Een afspraak is een afspraak.'],
];

export const vinkElektrotechniekReferenceTemplate = createPublishedReferenceTemplate({
  id: 'vink-elektrotechniek-reference',
  name: 'Premium Service Layout',
  description:
    'Imported from the Vink Elektrotechniek / Newman & Partners v1 family: bold hero, proof-driven sections, and a strong service-business conversion flow.',
  siteTitle: 'Premium Service Layout',
  siteSubtitle:
    'Reference-first template family for service businesses that need a premium hero, trust band, and structured conversion path.',
  sourceLabel: 'Source preview: Vink Elektrotechniek',
  previewUrl: 'https://officiallachkid.github.io/ORION/sites/vink-elektrotechniek/',
  previewNote:
    'Edit company text and images while the premium service layout and its motion remain locked.',
  contentSections: [
    {
      id: 'navigation',
      title: 'Navigation',
      previewSelector: 'nav',
      fields: [
        textField('navigation.brand', 'Company name', 'Vink Elektrotechniek'),
        textField('navigation.cta', 'Call-to-action button', 'Vraag offerte'),
      ],
    },
    {
      id: 'hero',
      title: 'Hero content',
      previewSelector: '#home',
      fields: [
        textField('hero.eyebrow', 'Eyebrow', 'Sinds decennia gevestigd in Zaandam'),
        textField('hero.titlePrimary', 'Heading', 'Uw partner in'),
        textField('hero.titleAccent', 'Accent heading', 'elektrotechniek.'),
        textField('hero.description', 'Description', 'Gespecialiseerd in utiliteitsbouw en renovatiewerken. Alles voor in en om het huis of bedrijfspand.', { type: 'textarea' }),
        imageField('hero.imageUrl', 'Background image', 'https://images.unsplash.com/photo-1558449028-b53a39d100fc?auto=format&fit=crop&w=2400&q=80'),
        textField('hero.primaryCta', 'Primary button', 'Vraag een offerte aan'),
      ],
    },
    {
      id: 'services',
      title: 'Services',
      previewSelector: '#diensten',
      fields: [
        textField('services.eyebrow', 'Eyebrow', '╱ Onze kernthema’s'),
        textField('services.titlePrimary', 'Heading', 'Drie pijlers.'),
        textField('services.titleAccent', 'Accent heading', 'Eén ambacht.'),
        ...serviceCards.flatMap(([title, subtitle, description], index) => [
          textField(`services.cards.${index}.title`, `Service ${index + 1} title`, title),
          textField(`services.cards.${index}.subtitle`, `Service ${index + 1} subtitle`, subtitle),
          textField(`services.cards.${index}.description`, `Service ${index + 1} description`, description, { type: 'textarea' }),
        ]),
      ],
    },
    {
      id: 'process',
      title: 'Process',
      previewSelector: '#werkwijze',
      fields: [
        textField('process.eyebrow', 'Eyebrow', '╱ Zo werken wij'),
        textField('process.titlePrimary', 'Heading', 'Drie stappen.'),
        textField('process.titleAccent', 'Accent heading', 'Geen verrassingen.'),
        ...processSteps.flatMap(([title, tagline, description], index) => [
          textField(`process.steps.${index}.title`, `Step ${index + 1} title`, title),
          textField(`process.steps.${index}.tagline`, `Step ${index + 1} tagline`, tagline),
          textField(`process.steps.${index}.description`, `Step ${index + 1} description`, description, { type: 'textarea' }),
        ]),
      ],
    },
    {
      id: 'trust',
      title: 'Trust signals',
      previewSelector: '#waarom-vink',
      fields: [
        textField('trust.eyebrow', 'Eyebrow', '╱ Waarom Vink'),
        textField('trust.heading', 'Heading', 'Meer dan een offerte.'),
        ...trustCards.flatMap(([title, description], index) => [
          textField(`trust.cards.${index}.title`, `Trust card ${index + 1} title`, title),
          textField(`trust.cards.${index}.description`, `Trust card ${index + 1} description`, description, { type: 'textarea' }),
        ]),
        textField('trust.cta', 'Call-to-action button', 'Vraag een offerte aan'),
      ],
    },
    {
      id: 'contact',
      title: 'Contact content',
      previewSelector: '#contact',
      fields: [
        textField('contact.titlePrimary', 'Heading', 'Waarmee kunnen'),
        textField('contact.titleAccent', 'Accent heading', 'we u helpen?'),
        textField('contact.description', 'Description', 'Laat uw gegevens achter en we nemen zo snel mogelijk contact op om uw wensen te bespreken.', { type: 'textarea' }),
        linkField('contact.officePhone', 'Office phone', '075 - 77 17 667', { prefix: 'tel:' }),
        linkField('contact.mobilePhone', 'Mobile phone', '06 - 22 86 57 68', { prefix: 'tel:' }),
        linkField('contact.email', 'Email', 'info@vink-elektrotechniek.nl', { type: 'email', prefix: 'mailto:' }),
        textField('contact.address', 'Address', 'Harmoniehof 15, 1507 TX Zaandam'),
      ],
    },
    {
      id: 'footer',
      title: 'Footer',
      previewSelector: '#footer',
      fields: [
        textField('footer.titlePrimary', 'Heading', 'Vakwerk met'),
        textField('footer.titleAccent', 'Accent heading', 'spanning erop.'),
        textField('footer.description', 'Description', 'Vink Elektrotechniek — thuis in Zaandam, actief in de hele Zaanstreek en omgeving.', { type: 'textarea' }),
        textField('footer.cta', 'Call-to-action button', 'Vraag offerte'),
        textField('footer.brand', 'Company name', 'Vink Elektrotechniek'),
        textField('footer.summary', 'Company summary', 'Gespecialiseerd in utiliteitsbouw en renovatiewerken. Ook voor service en onderhoud van installaties.', { type: 'textarea' }),
      ],
    },
  ],
  theme: {
    backgroundColor: '#f4efe5',
    surfaceColor: '#fffaf2',
    accentColor: '#163a59',
    textColor: '#111b28',
    panelColor: '#eef3f7',
  },
});
