import { createPublishedReferenceTemplate } from '../published-reference/factory.js';
import {
  imageField,
  linkField,
  textField,
} from '../published-reference/content-fields.js';

const products = [
  ['Website Chatbot', 'Embedded chat widget wired to n8n and an LLM — answers repetitive questions, recommends products, and hands off to humans when it should.'],
  ['n8n Self-Hosted Automation', 'Own your automation stack. Docker-based n8n with Cloudflare Tunnel — no more recurring SaaS bill for workflows you could run yourself.'],
  ['Voice Receptionist', 'Dutch-speaking voice AI that answers calls, handles routine questions, and books appointments straight into your calendar via n8n.'],
  ['Website Builder', 'Template-driven website delivery for small businesses. Fast turnaround, structured builder flow, publish/unpublish lifecycle.'],
  ['AI Agent Infrastructure', 'The operating system behind it all — a Mac mini orchestrator scaling into a local AI cluster. Agents that coordinate, remember, and keep working.'],
];

const showcaseItems = [
  ['Product-discovery bot on a live e-commerce site', 'Widget embedded on the Zakkenspecialist site — n8n routes visitor questions to gpt-4o-mini and returns structured product recommendations.'],
  ['Direct-booking website builder for hosts', 'Template selection, saved drafts, dedicated editor, publish/unpublish lifecycle, and per-property published snapshots.'],
  ['Mac-mini orchestrator running background agents', 'Ruflo, Claude Code, and Discord form an operations surface where memory persists and humans stay in the loop.'],
];

const services = [
  ['Website chatbots', 'n8n + LLM, embedded, learns your catalogue.'],
  ['Voice receptionists', 'Dutch-first VAPI agents that book straight into your calendar.'],
  ['n8n self-hosted setup', 'Docker + Cloudflare Tunnel — you own the runtime.'],
  ['Custom websites', 'React/Vite marketing sites and template-driven builders.'],
  ['AI-agent infrastructure', 'Mac-mini orchestrator, memory that persists, Discord ops surface.'],
  ['Prototypes & automation', 'Fast, scoped experiments — usually a week, sometimes a weekend.'],
];

const processSteps = [
  ['Discovery call', "30 minutes. What are you actually trying to move? What's the current pain, what's the ideal end state?"],
  ['Written proposal', 'Scope, timeline, price, and what handover looks like. No verbal handshakes — always in writing.'],
  ['Build in the open', 'Short sprints with visible progress. Discord for daily signal. You see the work as it takes shape.'],
  ['Handover + care', 'You own the source, the runtime, and the docs. Optional monthly care for updates and monitoring.'],
];

export const vbjServicesReferenceTemplate = createPublishedReferenceTemplate({
  id: 'vbj-services-reference',
  name: 'Cinematic Command Layout',
  description:
    'Imported from the VBJ Services / Vink Elektrotechniek v3 family: command-nav, scene hero, showcase frames, and a cinematic process story.',
  siteTitle: 'Cinematic Command Layout',
  siteSubtitle:
    'Reference-first layout for modern AI, automation, and high-end service offers that need a sharper cinematic sales flow.',
  sourceLabel: 'Source preview: VBJ Services',
  previewUrl: 'https://officiallachkid.github.io/ORION/sites/vbj-services/',
  previewNote:
    'Edit company text and images while the cinematic command layout and its motion remain locked.',
  contentSections: [
    {
      id: 'navigation',
      title: 'Navigation',
      previewSelector: 'nav',
      fields: [
        textField('navigation.brandPrimary', 'Company name start', 'VBJ'),
        textField('navigation.brandSecondary', 'Company name ending', 'Services'),
        textField('navigation.cta', 'Call-to-action button', 'Book a call'),
      ],
    },
    {
      id: 'hero',
      title: 'Hero content',
      previewSelector: '#top',
      fields: [
        textField('hero.eyebrow', 'Eyebrow', 'Vol. 26 · Edition IV'),
        textField('hero.byline', 'Byline', 'Digital products · AI agents · Automation'),
        textField('hero.titlePrimary', 'Heading start', 'Digital tools that'),
        textField('hero.titleAccent', 'Accent heading', 'keep working'),
        textField('hero.titleSecondary', 'Heading continuation', 'when you'),
        textField('hero.titleEnding', 'Heading ending', "aren't looking."),
        textField('hero.description', 'Description', 'We build websites, chatbots, voice agents and workflow automation — then wire them into an AI operating system that actually stays useful.', { type: 'textarea' }),
        imageField('hero.imageUrl', 'Background image', 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=2000&q=80'),
        textField('hero.primaryCta', 'Primary button', 'Start a project'),
        textField('hero.secondaryCta', 'Secondary button', 'See what we ship'),
      ],
    },
    {
      id: 'manifesto',
      title: 'Manifesto',
      previewSelector: '#manifesto',
      fields: [
        textField('manifesto.eyebrow', 'Eyebrow', '╱ 01 · Manifesto'),
        textField('manifesto.opening', 'Opening statement', "We don't ship demos. We ship "),
        textField('manifesto.accent', 'Accent word', 'coworkers'),
        textField('manifesto.ending', 'Closing statement', ' — small, specific pieces of software that keep doing the work 24/7.'),
      ],
    },
    {
      id: 'products',
      title: 'Products',
      previewSelector: '#products',
      fields: [
        textField('products.titlePrimary', 'Heading', 'What'),
        textField('products.titleAccent', 'Accent heading', 'we offer.'),
        textField('products.description', 'Description', 'Each product stands alone — but they compound. A chatbot leads to workflow automation. Automation leads to voice. Voice leads to a full agent infrastructure. Same runtime underneath.', { type: 'textarea' }),
        ...products.flatMap(([title, description], index) => [
          textField(`products.items.${index}.title`, `Product ${index + 1} title`, title),
          textField(`products.items.${index}.description`, `Product ${index + 1} description`, description, { type: 'textarea' }),
        ]),
      ],
    },
    {
      id: 'showcase',
      title: 'Case studies',
      previewSelector: '#showcase',
      fields: [
        textField('showcase.eyebrow', 'Eyebrow', '╱ 03 · Work in the wild'),
        textField('showcase.titlePrimary', 'Heading', 'Three shipped,'),
        textField('showcase.titleAccent', 'Accent heading', 'one still running.'),
        textField('showcase.cta', 'Call-to-action link', 'Case studies on request'),
        ...showcaseItems.flatMap(([title, description], index) => [
          textField(`showcase.items.${index}.title`, `Case study ${index + 1} title`, title),
          textField(`showcase.items.${index}.description`, `Case study ${index + 1} description`, description, { type: 'textarea' }),
        ]),
      ],
    },
    {
      id: 'services',
      title: 'Services',
      previewSelector: '#index',
      fields: [
        textField('services.eyebrow', 'Eyebrow', '╱ 04 · Index of services'),
        textField('services.titlePrimary', 'Heading start', 'An'),
        textField('services.titleAccent', 'Accent heading', 'opinionated'),
        textField('services.titleEnding', 'Heading ending', 'list.'),
        textField('services.description', 'Description', "If your problem is in this list, we have a shape for it. If it's not — bring it anyway; new shapes are how the list grows.", { type: 'textarea' }),
        ...services.flatMap(([title, description], index) => [
          textField(`services.items.${index}.title`, `Service ${index + 1} title`, title),
          textField(`services.items.${index}.description`, `Service ${index + 1} description`, description),
        ]),
      ],
    },
    {
      id: 'process',
      title: 'Process',
      previewSelector: '#process',
      fields: [
        textField('process.eyebrow', 'Eyebrow', '╱ 06 · Engagement'),
        textField('process.titlePrimary', 'Heading', 'Four steps,'),
        textField('process.titleAccent', 'Accent heading', 'nothing hidden.'),
        textField('process.description', 'Description', 'From the first call to a working system. No surprises, no vendor traps.', { type: 'textarea' }),
        ...processSteps.flatMap(([title, description], index) => [
          textField(`process.steps.${index}.title`, `Step ${index + 1} title`, title),
          textField(`process.steps.${index}.description`, `Step ${index + 1} description`, description, { type: 'textarea' }),
        ]),
      ],
    },
    {
      id: 'contact',
      title: 'Contact content',
      previewSelector: '#contact',
      fields: [
        textField('contact.titlePrimary', 'Heading', 'Bring us a'),
        textField('contact.titleAccent', 'Accent heading', 'problem worth solving.'),
        textField('contact.description', 'Description', "Every engagement starts with a free discovery call. Tell us where you're stuck and we'll tell you honestly whether we're the right fit.", { type: 'textarea' }),
        linkField('contact.email', 'Email', 'hello@vbjservices.com', { type: 'email', prefix: 'mailto:' }),
        textField('contact.city', 'Location', 'Amsterdam, NL · Working remotely across NL / EU'),
        textField('contact.secondaryCta', 'Secondary button', 'See products'),
        textField('contact.panelHeading', 'Contact panel heading', 'How to reach us'),
        textField('contact.opsSurface', 'Operations channel', 'Discord ops channel — invite on request'),
      ],
    },
    {
      id: 'footer',
      title: 'Footer',
      previewSelector: '#footer',
      fields: [
        textField('footer.brand', 'Company name', 'VBJ Services'),
        textField('footer.description', 'Company description', 'Digital products · AI agents · Automation. Built from a Mac mini in Amsterdam.', { type: 'textarea' }),
      ],
    },
  ],
  theme: {
    backgroundColor: '#0f1320',
    surfaceColor: '#161b2b',
    accentColor: '#f1c64c',
    textColor: '#f5f1e8',
    panelColor: '#1d2438',
  },
});
