import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ArrowUpRight, Menu, X } from 'lucide-react'

gsap.registerPlugin(ScrollTrigger)

/* ----------------------------------------------------------------
   Content — Newman & Partners (v2 · Editorial Publication)
---------------------------------------------------------------- */

const NAV = [
  { label: 'Practice',  href: '#approach' },
  { label: 'Manifesto', href: '#manifesto' },
  { label: 'Index',     href: '#index' },
  { label: 'Contact',   href: '#contact' },
]

const SERVICES = [
  { title: 'Executive Search',      sub: 'Confidential C-suite and partner-level searches' },
  { title: 'Finance & Audit',       sub: 'Newly qualified auditors through Audit Partners' },
  { title: 'Tax & Transfer Pricing',sub: 'Direct tax, indirect tax, TP managers and directors' },
  { title: 'Legal & Notarial',      sub: 'Kandidaat-notarissen, corporate lawyers, in-house counsel' },
  { title: 'Interim Professionals', sub: 'Verified, vetted, ready in days rather than weeks' },
  { title: 'Career Advisory',       sub: 'Long-form guidance for professionals thinking beyond the next move' },
]

const MARQUEE_TOKENS = [
  'EXECUTIVE SEARCH', 'FINANCE', 'AUDIT', 'TAX', 'TRANSFER PRICING',
  'LEGAL', 'NOTARIAL', 'INTERIM', 'CAREER ADVISORY',
  'HUMAN TO HUMAN', 'SINCE 2013', 'AMSTERDAM',
]

const FEATURES = [
  {
    heading: 'The brief comes first',
    sub: 'Every mandate is bespoke.',
    body: 'We take the brief in person — the technical requirement, the team beneath it, the culture around it, the commercials that shape it. Only then do we start searching. There is no library of pre-vetted resumes waiting to be sent out.',
    meta: 'Approach · Newman & Partners',
    image: 'https://images.unsplash.com/photo-1568992687947-868a62a9f521?auto=format&fit=crop&w=1400&q=80',
    caption: 'Notes from a first meeting · Photograph',
  },
  {
    heading: 'The network works',
    sub: 'Twelve years of quiet introductions.',
    body: 'A decade of relationships across Amsterdam finance, tax and legal circles. Warm introductions travel faster and land better than any job board — and quietly, without disturbing anyone who does not need to be disturbed.',
    meta: 'Network · Newman & Partners',
    image: 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&w=1400&q=80',
    caption: 'Introduction in progress · Photograph',
  },
  {
    heading: 'Aftercare is standard',
    sub: 'A placement is a relationship.',
    body: 'We stay in touch six weeks in, six months in, and every year after — because a placement is the beginning of a relationship, not the end of one. Our two-year retention rate reflects that discipline.',
    meta: 'Aftercare · Newman & Partners',
    image: 'https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=1400&q=80',
    caption: 'Six months in · Photograph',
  },
]

const FLAP_CYCLE = [
  ['XII', '04', 'PRACT', 'OPEN '],
  ['XII', '04', 'BRIEF', 'ACT  '],
  ['XII', '05', 'MATCH', 'WARM '],
  ['XII', '05', 'PLACE', 'CLOSE'],
]

/* ----------------------------------------------------------------
   Split-Flap Character
---------------------------------------------------------------- */
function FlapChar({ char, delay }) {
  const [display, setDisplay] = useState(char)
  const [flipping, setFlipping] = useState(false)

  useEffect(() => {
    if (display === char) return
    setFlipping(true)
    const t1 = setTimeout(() => {
      setDisplay(char)
    }, 140 + delay)
    const t2 = setTimeout(() => {
      setFlipping(false)
    }, 280 + delay)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [char, display, delay])

  return (
    <span
      className={`inline-flex items-center justify-center h-7 w-5 sm:w-6 border border-rule bg-paper font-mono text-[13px] sm:text-[15px] font-medium text-ink transition-transform duration-150 ease-out`}
      style={{
        transformOrigin: 'center',
        transform: flipping ? 'scaleY(0.05)' : 'scaleY(1)',
      }}
    >
      {display === ' ' ? ' ' : display}
    </span>
  )
}

function SplitFlap({ label, value }) {
  const chars = value.padEnd(5, ' ').split('').slice(0, 5)
  return (
    <div className="flex flex-col items-start gap-2">
      <span className="font-mono text-[9px] tracking-wide32 uppercase text-muted">
        {label}
      </span>
      <div className="flex items-center gap-0.5">
        {chars.map((c, i) => <FlapChar key={i} char={c} delay={i * 55} />)}
      </div>
    </div>
  )
}

function MastheadFlaps({ compact = false }) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 2300)
    return () => clearInterval(i)
  }, [])
  const v = FLAP_CYCLE[tick % FLAP_CYCLE.length]
  return (
    <div className={`flex items-end ${compact ? 'gap-4' : 'gap-6 sm:gap-10'}`}>
      <SplitFlap label="Vol"     value={v[0]} />
      <SplitFlap label="Issue"   value={v[1]} />
      <SplitFlap label="Section" value={v[2]} />
      <SplitFlap label="Status"  value={v[3]} />
    </div>
  )
}

/* ----------------------------------------------------------------
   1. Masthead Nav
---------------------------------------------------------------- */
function MastheadNav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
      <header
        className={`fixed top-0 inset-x-0 z-50 transition-all ${
          scrolled
            ? 'bg-paper/95 backdrop-blur-sm border-b border-rule py-3'
            : 'bg-transparent py-5'
        }`}
      >
        <div className="max-w-editorial mx-auto px-6 sm:px-12 lg:px-24 flex items-center justify-between gap-6">
          <a href="#top" className="flex items-center gap-2.5">
            <span className="inline-flex h-7 w-7 items-center justify-center border border-ink">
              <span className="font-serif text-sm leading-none text-ink">N</span>
            </span>
            <span data-builder-field="navigation.brand" className="font-serif text-lg leading-none tracking-tight2 text-ink">
              Newman &amp; Partners
            </span>
          </a>

          <nav className="hidden lg:flex items-center gap-10">
            {NAV.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="font-mono text-[11px] uppercase tracking-wide28 text-ink/70 hover:text-ink transition-colors"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <a href="#contact" className="hidden lg:inline-flex items-center gap-1.5 group">
             <span data-builder-field="navigation.cta" className="font-serif italic text-ink">Start a conversation</span>
            <ArrowUpRight
              className="h-4 w-4 text-ink transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              strokeWidth={1.6}
            />
          </a>

          <button
            onClick={() => setOpen(true)}
            className="lg:hidden text-ink"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div
        className={`fixed inset-0 z-[60] bg-paper transition-opacity lg:hidden ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="px-6 pt-6 pb-12 h-full flex flex-col">
          <div className="flex items-center justify-between">
            <span data-builder-field="navigation.brand" className="font-serif text-lg">Newman &amp; Partners</span>
            <button onClick={() => setOpen(false)} className="text-ink">
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="mt-16 flex flex-col gap-1">
            {NAV.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="font-serif text-3xl border-b border-rule py-4"
              >
                {l.label}
              </a>
            ))}
          </nav>
          <a
            href="#contact"
            onClick={() => setOpen(false)}
            className="mt-8 inline-flex items-center gap-2 border border-ink text-ink px-6 py-3 self-start"
          >
            <span data-builder-field="navigation.cta" className="font-serif italic">Start a conversation</span>
            <ArrowUpRight className="h-4 w-4" strokeWidth={1.6} />
          </a>
        </div>
      </div>
    </>
  )
}

/* ----------------------------------------------------------------
   2. Editorial Hero
---------------------------------------------------------------- */
function EditorialHero() {
  const ref = useRef(null)
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.hero-r', {
        y: 24,
        opacity: 0,
        duration: 0.9,
        ease: 'power2.out',
        stagger: 0.08,
        delay: 0.25,
      })
    }, ref)
    return () => ctx.revert()
  }, [])

  return (
    <section id="top" ref={ref} className="relative pt-32 pb-0 min-h-[100dvh] flex flex-col">
      <div className="flex-1 max-w-editorial w-full mx-auto px-6 sm:px-12 lg:px-24 grid grid-cols-12 gap-6 lg:gap-10 items-center">
        <div className="col-span-12 lg:col-span-7">
          <span data-builder-field="hero.eyebrow" className="hero-r eyebrow">╱ Amsterdam · Established MMXIII</span>
          <h1 className="hero-r mt-6 font-serif font-medium text-[clamp(48px,7.5vw,120px)] leading-[0.98] tracking-tight2 text-ink">
            <span data-builder-field="hero.titleLine1" className="block">Recruitment</span>
            <span data-builder-field="hero.titleLine2" className="block">is all about</span>
            <span data-builder-field="hero.titleLine3" className="block italic">your future.</span>
          </h1>
          <p data-builder-field="hero.description" className="hero-r mt-10 font-serif italic text-[clamp(18px,1.4vw,22px)] leading-[1.5] text-muted max-w-md">
            An Amsterdam-based executive-search practice for finance, audit, tax and legal professionals. Human to human, always.
          </p>
        </div>

        <div className="col-span-12 lg:col-span-5">
          <div className="hero-r aspect-[3/4] overflow-hidden bg-rule/40">
            <img
              data-builder-field="hero.imageUrl"
              src="https://images.unsplash.com/photo-1573497019418-b400bb3ab074?auto=format&fit=crop&w=1200&q=80"
              alt=""
              className="w-full h-full object-cover"
            />
          </div>
          <p data-builder-field="hero.imageCaption" className="hero-r caption mt-3 max-w-xs">
            Fig. 01 — On the office floor, IJsbaanpad, Amsterdam · Photograph
          </p>
        </div>
      </div>

      <div className="border-t border-rule mt-16">
        <div className="max-w-editorial mx-auto px-6 sm:px-12 lg:px-24 py-6 flex items-center justify-between gap-8">
          <span className="hidden sm:inline font-mono text-[11px] uppercase tracking-wide28 text-muted">
            The Masthead
          </span>
          <MastheadFlaps />
          <span className="hidden sm:inline font-mono text-[11px] uppercase tracking-wide28 text-muted">
            2026 · Amsterdam
          </span>
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------
   3. Marquee Band
---------------------------------------------------------------- */
function MarqueeBand() {
  const doubled = [...MARQUEE_TOKENS, ...MARQUEE_TOKENS]
  return (
    <section className="marquee border-y border-rule py-3.5 bg-paper">
      <div className="marquee-track font-mono text-[13px] uppercase tracking-wide32 text-ink/75">
        {doubled.map((t, i) => (
          <span key={i} className="flex items-center gap-6 pr-6 shrink-0">
            {t}
            <span className="text-[color:var(--accent)]">●</span>
          </span>
        ))}
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------
   4. Manifesto
---------------------------------------------------------------- */
function Manifesto() {
  const ref = useRef(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setActive(true)
          io.disconnect()
        }
      },
      { threshold: 0.35 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section
      id="manifesto"
      ref={ref}
      className={`py-32 sm:py-48 ${active ? 'underline-active' : ''}`}
    >
      <div className="max-w-editorial mx-auto px-6 sm:px-12 lg:px-24">
        <span data-builder-field="manifesto.eyebrow" className="eyebrow">╱ Manifesto</span>
        <h2 className="mt-8 font-serif italic text-[clamp(40px,6vw,88px)] leading-[1.06] tracking-tight2 text-balance max-w-5xl">
          <span data-builder-field="manifesto.opening">We treat every candidate as a colleague. Every brief as a </span>
          <span className="relative inline-block">
            <span data-builder-field="manifesto.accent">conversation</span>
            <svg
              className="absolute left-0 -bottom-2 w-full h-2.5"
              viewBox="0 0 200 8"
              preserveAspectRatio="none"
            >
              <path
                className="underline-path"
                d="M 4 5 Q 100 -1 196 5"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2.4"
                pathLength="1"
              />
            </svg>
          </span>
          <span data-builder-field="manifesto.ending"> — not a transaction.</span>
        </h2>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------
   5. Feature Splits
---------------------------------------------------------------- */
function FeatureSplits() {
  const wrap = useRef(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.utils.toArray('.split-row').forEach((row) => {
        const img = row.querySelector('.split-img')
        const txt = row.querySelector('.split-txt')
        gsap.to(img, {
          yPercent: -6,
          ease: 'none',
          scrollTrigger: { trigger: row, start: 'top bottom', end: 'bottom top', scrub: true },
        })
        gsap.to(txt, {
          yPercent: 3,
          ease: 'none',
          scrollTrigger: { trigger: row, start: 'top bottom', end: 'bottom top', scrub: true },
        })
      })
    }, wrap)
    return () => ctx.revert()
  }, [])

  return (
    <section id="approach" ref={wrap} className="pt-8 pb-16 sm:pt-16 sm:pb-24">
      {FEATURES.map((f, i) => {
        const flipped = i % 2 === 1
        return (
          <div key={i} className="split-row py-14 sm:py-24">
            <div className="max-w-editorial mx-auto px-6 sm:px-12 lg:px-24 grid grid-cols-12 gap-6 lg:gap-10 items-center">
              <div className={`split-img col-span-12 lg:col-span-6 ${flipped ? 'lg:col-start-7 lg:order-2' : ''}`}>
                <div className="aspect-[4/5] overflow-hidden bg-rule/40">
                  <img data-builder-field={`features.items.${i}.imageUrl`} src={f.image} alt={f.caption} loading="lazy" className="w-full h-full object-cover" />
                </div>
                <p className="caption mt-3">
                  Fig. {String(i + 2).padStart(2, '0')} — {f.caption}
                </p>
              </div>

              <div
                className={`split-txt col-span-12 lg:col-span-5 ${
                  flipped ? 'lg:col-start-1 lg:order-1' : 'lg:col-start-8'
                }`}
              >
                <span className="eyebrow">Feature {String(i + 1).padStart(2, '0')}</span>
                <h3 className="mt-4 font-serif font-medium text-[clamp(28px,3.5vw,48px)] leading-[1.05] tracking-tight2 text-ink">
                    <span data-builder-field={`features.items.${i}.title`}>{f.heading}</span>
                </h3>
                <p className="mt-3 font-serif italic text-[clamp(20px,1.8vw,26px)] text-muted">
                    <span data-builder-field={`features.items.${i}.subtitle`}>{f.sub}</span>
                </p>
                  <p data-builder-field={`features.items.${i}.description`} className="mt-8 font-serif text-[17px] leading-[1.6] max-w-md text-ink/85">
                  {f.body}
                </p>
                <p className="mt-10 eyebrow">{f.meta}</p>
              </div>
            </div>
          </div>
        )
      })}
    </section>
  )
}

/* ----------------------------------------------------------------
   6. Index (Services)
---------------------------------------------------------------- */
function IndexList() {
  return (
    <section id="index" className="py-32 sm:py-48">
      <div className="max-w-editorial mx-auto px-6 sm:px-12 lg:px-24">
        <div className="flex items-end justify-between gap-8">
          <div>
            <span data-builder-field="services.eyebrow" className="eyebrow">╱ Index</span>
            <h2 data-builder-field="services.heading" className="mt-6 font-serif font-medium text-[clamp(40px,5vw,72px)] leading-[1.02] tracking-tight2 text-ink">
              Practice areas
            </h2>
          </div>
          <p data-builder-field="services.description" className="hidden sm:block font-serif italic text-lg text-muted max-w-xs text-right">
            Six focused verticals — every consultant works one deeply.
          </p>
        </div>

        <ul className="mt-16 border-t border-rule">
          {SERVICES.map((s, i) => (
            <li key={i} className="index-row group border-b border-rule">
              <a
                href="#contact"
                className="grid grid-cols-[56px_1fr_auto] sm:grid-cols-[80px_1fr_auto] items-baseline gap-4 sm:gap-8 py-6 sm:py-9 px-2 hover:bg-ink/[0.03] transition-colors"
              >
                <span className="font-serif text-2xl sm:text-3xl text-muted tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <div className="relative inline-block">
                    <span data-builder-field={`services.items.${i}.title`} className="font-serif text-2xl sm:text-[32px] text-ink">
                      {s.title}
                    </span>
                    <svg
                      className="absolute left-0 -bottom-1 w-full h-1.5"
                      viewBox="0 0 200 6"
                      preserveAspectRatio="none"
                    >
                      <path
                        className="underline-path"
                        d="M 0 3 L 200 3"
                        stroke="var(--accent)"
                        strokeWidth="1.5"
                        fill="none"
                        pathLength="1"
                      />
                    </svg>
                  </div>
                  <p data-builder-field={`services.items.${i}.description`} className="mt-1 font-serif italic text-base sm:text-lg text-muted max-w-lg">
                    {s.sub}
                  </p>
                </div>
                <span className="font-mono text-[13px] tracking-wide28 uppercase text-muted group-hover:text-ink transition-colors">
                  ↗
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------
   7. Testimonial
---------------------------------------------------------------- */
function Testimonial() {
  return (
    <section id="testimonial" className="py-32 sm:py-48">
      <div className="max-w-4xl mx-auto px-6 sm:px-12 lg:px-24">
        <span data-builder-field="testimonial.eyebrow" className="eyebrow block text-center">╱ Testimonial</span>
        <div className="mt-10 text-center">
          <span className="font-serif italic text-[7rem] sm:text-[10rem] text-muted leading-none block">
            &ldquo;
          </span>
          <p data-builder-field="testimonial.quote" className="mt-0 font-serif italic text-[clamp(24px,3vw,40px)] leading-[1.35] text-balance text-ink">
            What distinguished Newman &amp; Partners from others was their personalised
            approach — they truly grasped my needs and dedicated themselves to helping me
            uncover the perfect fit.
          </p>
          <div className="mt-12 flex items-center justify-center gap-3">
            <span className="h-2 w-2 rounded-full bg-[color:var(--accent)]" />
            <p data-builder-field="testimonial.author" className="font-mono text-[11px] uppercase tracking-wide28 text-muted">
              Rik Kramer RA · Audit Partner
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------
   8. CTA Banner
---------------------------------------------------------------- */
function CTABanner() {
  return (
    <section
      id="contact"
      className="relative min-h-[70vh] flex items-center justify-center overflow-hidden py-24"
    >
      <img
        data-builder-field="contact.imageUrl"
        src="https://images.unsplash.com/photo-1512470876302-972faa2aa9a4?auto=format&fit=crop&w=2000&q=80"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        style={{ filter: 'grayscale(0.2) contrast(0.98) brightness(0.85)' }}
      />
      <div className="absolute inset-0 bg-ink/15" />
      <div className="relative bg-paper py-14 sm:py-16 px-8 sm:px-14 max-w-[720px] w-[90%] mx-auto border-t-2 border-b-2 border-[color:var(--accent)] text-center">
        <span data-builder-field="contact.eyebrow" className="eyebrow">╱ Begin</span>
        <p data-builder-field="contact.heading" className="mt-6 font-serif italic text-[clamp(26px,3.5vw,44px)] leading-[1.18] text-balance text-ink">
          Whether you&rsquo;re hiring or exploring your next move&nbsp;—<br className="hidden sm:inline" />
          come and talk to us.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            data-builder-link="contact.email"
            href="mailto:jasper@newmanpartners.nl"
            className="inline-flex items-center gap-2 border border-ink text-ink px-6 py-3 hover:bg-ink hover:text-paper transition-colors duration-500"
          >
            <span data-builder-field="contact.email" className="font-serif italic">jasper@newmanpartners.nl</span>
            <ArrowUpRight className="h-4 w-4" strokeWidth={1.6} />
          </a>
          <a
            data-builder-field="contact.phone"
            data-builder-link="contact.phone"
            href="tel:+31627518019"
            className="font-mono text-[11px] uppercase tracking-wide28 text-muted hover:text-ink"
          >
            +31 6 27 51 80 19
          </a>
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------
   9. Colophon Footer
---------------------------------------------------------------- */
function ColophonFooter() {
  return (
    <footer id="footer" className="border-t border-rule pt-20 sm:pt-24 pb-12 bg-paper">
      <div className="max-w-editorial mx-auto px-6 sm:px-12 lg:px-24">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5">
            <div className="flex items-center gap-2.5 mb-4">
              <span className="inline-flex h-7 w-7 items-center justify-center border border-ink">
                <span className="font-serif text-sm leading-none text-ink">N</span>
              </span>
              <span data-builder-field="footer.brand" className="font-serif text-lg leading-none">Newman &amp; Partners</span>
            </div>
            <p data-builder-field="footer.tagline" className="font-serif italic text-xl text-muted mt-3 max-w-sm">
              Recruitment is all about your future.
            </p>
            <p data-builder-field="footer.description" className="mt-6 font-serif text-[15px] leading-[1.6] max-w-sm text-ink/80">
              An Amsterdam-based executive-search practice for finance, audit, tax and legal
              professionals. Established 2013 · Founded and run by Jasper Newman.
            </p>
            <div className="mt-8 scale-[0.85] origin-left">
              <MastheadFlaps compact />
            </div>
          </div>

          <div className="lg:col-span-3">
            <p className="eyebrow">Contact</p>
            <ul className="mt-5 space-y-3 text-[15px]">
              <li>
                <a
                  data-builder-field="contact.phone"
                  data-builder-link="contact.phone"
                  href="tel:+31627518019"
                  className="font-mono text-ink hover:text-[color:var(--accent)] transition-colors"
                >
                  +31 6 27 51 80 19
                </a>
              </li>
              <li>
                <a
                  data-builder-field="contact.email"
                  data-builder-link="contact.email"
                  href="mailto:jasper@newmanpartners.nl"
                  className="font-mono text-ink hover:text-[color:var(--accent)] transition-colors break-all"
                >
                  jasper@newmanpartners.nl
                </a>
              </li>
              <li data-builder-field="contact.address" className="font-serif text-ink/80 leading-[1.5]">
                IJsbaanpad 2<br />1076 CV Amsterdam
              </li>
            </ul>
          </div>

          <div className="lg:col-span-2">
            <p className="eyebrow">Practice</p>
            <ul className="mt-5 space-y-3 font-serif italic text-lg">
              {SERVICES.slice(0, 4).map((s, i) => (
                <li key={i}>
                  <a
                    href="#index"
                    className="text-ink hover:text-[color:var(--accent)] transition-colors"
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-2">
            <p className="eyebrow">Colophon</p>
            <ul className="mt-5 space-y-3 font-mono text-[11px] uppercase tracking-wide28">
              <li>
                <a
                  href="https://www.linkedin.com/company/newman-partners/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink hover:text-[color:var(--accent)] transition-colors"
                >
                  LinkedIn
                </a>
              </li>
              <li>
                <Link to="/colophon" className="text-ink hover:text-[color:var(--accent)] transition-colors">
                  Privacy · Terms
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-20 pt-8 border-t border-rule text-center">
          <p className="font-mono text-[10px] uppercase tracking-wide32 text-muted">
            Set in Instrument Serif · Published in Amsterdam · MMXXVI · Newman &amp; Partners
          </p>
        </div>
        <p className="mt-6 font-mono text-[10px] uppercase tracking-wide28 text-muted text-center sm:text-left">
          © 2026 Newman &amp; Partners. All rights reserved.
        </p>
      </div>
    </footer>
  )
}

/* ----------------------------------------------------------------
   App
---------------------------------------------------------------- */
export default function App() {
  useEffect(() => {
    const t1 = setTimeout(() => ScrollTrigger.refresh(), 200)
    const t2 = setTimeout(() => ScrollTrigger.refresh(), 1000)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])

  return (
    <div className="relative bg-paper text-ink font-serif antialiased">
      <MastheadNav />
      <main>
        <EditorialHero />
        <MarqueeBand />
        <Manifesto />
        <FeatureSplits />
        <IndexList />
        <Testimonial />
        <CTABanner />
      </main>
      <ColophonFooter />
    </div>
  )
}
