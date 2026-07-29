# Code Snippets — v2 (Editorial Publication)

Paste-ready skeletons. Substitute brand hex + copy from intake.

---

## src/index.css

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --accent: <ACCENT>;
}

@layer base {
  html { scroll-behavior: smooth; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
  body { @apply bg-paper text-ink font-serif; overflow-x: hidden; }
  ::selection { background-color: var(--accent); color: #F4F1EA; }
  ::-webkit-scrollbar { width: 8px; }
  ::-webkit-scrollbar-track { background: #F4F1EA; }
  ::-webkit-scrollbar-thumb { background: #D8D3C8; border-radius: 0; }
  ::-webkit-scrollbar-thumb:hover { background: var(--accent); }
}

@layer components {
  .rule { @apply h-px bg-rule w-full; }
  .eyebrow { @apply font-mono text-[11px] uppercase tracking-[0.28em] text-muted; }
  .caption { @apply font-mono text-[12px] tracking-[0.14em] text-muted; }

  /* Underline draw for Manifesto + Index hover */
  .underline-path {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    transition: stroke-dashoffset 1.4s cubic-bezier(0.65, 0, 0.35, 1);
    vector-effect: non-scaling-stroke;
  }
  .underline-active .underline-path { stroke-dashoffset: 0; }

  /* Marquee */
  .marquee { overflow: hidden; }
  .marquee-track {
    display: inline-flex;
    white-space: nowrap;
    animation: marquee-scroll 40s linear infinite;
    will-change: transform;
  }
  .marquee:hover .marquee-track { animation-direction: reverse; }
  @keyframes marquee-scroll {
    from { transform: translate3d(0, 0, 0); }
    to   { transform: translate3d(-50%, 0, 0); }
  }
}

@layer utilities {
  .text-balance { text-wrap: balance; }
}
```

---

## App.jsx skeleton

```jsx
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ArrowUpRight, Mail, Phone, MapPin, Menu, X } from 'lucide-react'

gsap.registerPlugin(ScrollTrigger)

const NAV = [
  { label: 'Practice', href: '#practice' },
  { label: 'Approach', href: '#approach' },
  { label: 'Index',    href: '#index' },
  { label: 'Contact',  href: '#contact' },
]

const SERVICES = [
  // 6 items from intake — { title, sub }
]

const MARQUEE_TOKENS = [
  // uppercase strings from intake
]

const FEATURES = [
  // 3 items — { number, heading, sub, body, meta, image, caption }
]

const FLAP_CYCLE = [
  // 4-tuples from industry-themes mapping
]

function MastheadNav() { /* structure §1 */ }
function EditorialHero() { /* structure §2 */ }
function MarqueeBand() { /* structure §3 */ }
function Manifesto() { /* structure §4 */ }
function FeatureSplits() { /* structure §5 */ }
function IndexList() { /* structure §6 */ }
function Testimonial() { /* structure §7 */ }
function CTABanner() { /* structure §8 */ }
function ColophonFooter() { /* structure §9 */ }
function MastheadFlaps({ scale = 1 }) { /* animations §5 */ }

export default function App() {
  useEffect(() => {
    const t1 = setTimeout(() => ScrollTrigger.refresh(), 200)
    const t2 = setTimeout(() => ScrollTrigger.refresh(), 1000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
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
```

---

## MastheadNav

```jsx
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
      <header className={`fixed top-0 inset-x-0 z-50 transition-all ${
        scrolled ? 'bg-paper/95 backdrop-blur-sm border-b border-rule py-3' : 'bg-transparent py-5'
      }`}>
        <div className="max-w-editorial mx-auto px-6 sm:px-12 lg:px-24 flex items-center justify-between gap-6">
          <a href="#top" className="flex items-center gap-2.5">
            <span className="inline-flex h-7 w-7 items-center justify-center border border-ink">
              <span className="font-serif text-sm leading-none text-ink"><INITIAL></span>
            </span>
            <span className="font-serif text-lg leading-none tracking-tight2 text-ink"><COMPANY_NAME></span>
          </a>

          <nav className="hidden lg:flex items-center gap-10">
            {NAV.map((l) => (
              <a key={l.href} href={l.href}
                 className="font-mono text-[11px] uppercase tracking-[0.28em] text-ink/70 hover:text-ink transition-colors">
                {l.label}
              </a>
            ))}
          </nav>

          <a href="#contact" className="hidden lg:inline-flex items-center gap-1.5 group">
            <span className="font-serif italic text-ink">Start a conversation</span>
            <ArrowUpRight className="h-4 w-4 text-ink transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" strokeWidth={1.6} />
          </a>

          <button onClick={() => setOpen(true)} className="lg:hidden text-ink" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      <div className={`fixed inset-0 z-[60] bg-paper transition-opacity lg:hidden ${
        open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}>
        <div className="px-6 pt-6 pb-12 h-full flex flex-col">
          <div className="flex items-center justify-between">
            <span className="font-serif text-lg"><COMPANY_NAME></span>
            <button onClick={() => setOpen(false)} className="text-ink"><X className="h-5 w-5" /></button>
          </div>
          <nav className="mt-16 flex flex-col gap-4">
            {NAV.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)}
                 className="font-serif text-3xl border-b border-rule py-3">
                {l.label}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </>
  )
}
```

---

## EditorialHero

```jsx
function EditorialHero() {
  const ref = useRef(null)
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.hero-r', {
        y: 24, opacity: 0, duration: 0.9, ease: 'power2.out',
        stagger: 0.08, delay: 0.3,
      })
    }, ref)
    return () => ctx.revert()
  }, [])

  return (
    <section id="top" ref={ref} className="relative pt-32 pb-0 min-h-[100dvh] flex flex-col">
      <div className="max-w-editorial mx-auto px-6 sm:px-12 lg:px-24 grid grid-cols-12 gap-6 flex-1">
        {/* Left: title */}
        <div className="col-span-12 lg:col-span-7 flex flex-col justify-center">
          <span className="hero-r eyebrow">╱ Amsterdam · Since 2013</span>
          <h1 className="hero-r mt-6 font-serif font-medium text-[clamp(48px,8vw,128px)] leading-[0.98] tracking-tight2">
            <span className="block">Recruitment</span>
            <span className="block">is all about</span>
            <span className="block italic">your future.</span>
          </h1>
          <p className="hero-r mt-8 text-lg leading-[1.55] text-muted max-w-md italic">
            An Amsterdam-based executive-search practice for finance, audit, tax and legal professionals. Human to human, always.
          </p>
        </div>
        {/* Right: portrait */}
        <div className="col-span-12 lg:col-span-5 flex flex-col justify-center">
          <div className="hero-r aspect-[3/4] overflow-hidden">
            <img src="<UNSPLASH_PORTRAIT>" alt=""
                 className="w-full h-full object-cover" />
          </div>
          <p className="hero-r caption mt-3">
            Fig. 01 — On the office floor · Photograph
          </p>
        </div>
      </div>

      {/* Byline row with split-flap */}
      <div className="border-t border-rule mt-16">
        <div className="max-w-editorial mx-auto px-6 sm:px-12 lg:px-24 py-6">
          <MastheadFlaps />
        </div>
      </div>
    </section>
  )
}
```

---

## MarqueeBand

```jsx
function MarqueeBand() {
  return (
    <section className="marquee border-y border-rule py-3.5">
      <div className="marquee-track font-mono text-[13px] uppercase tracking-[0.32em] text-ink/75">
        {[0, 1].map((k) => (
          <div key={k} className="flex items-center shrink-0">
            {MARQUEE_TOKENS.map((t, i) => (
              <span key={i} className="px-6 flex items-center gap-6 shrink-0">
                {t}
                <span className="text-[color:var(--accent)]">●</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
```

---

## Manifesto

```jsx
function Manifesto() {
  const ref = useRef(null)
  const [active, setActive] = useState(false)
  useEffect(() => {
    const el = ref.current
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setActive(true); io.disconnect() }
    }, { threshold: 0.4 })
    if (el) io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section ref={ref} className={`py-32 sm:py-48 ${active ? 'underline-active' : ''}`}>
      <div className="max-w-editorial mx-auto px-6 sm:px-12 lg:px-24">
        <span className="eyebrow">╱ Manifesto</span>
        <h2 className="mt-6 font-serif italic text-[clamp(40px,5vw,80px)] leading-[1.05] text-balance max-w-4xl">
          We treat every candidate as a colleague. Every brief as a{' '}
          <span className="relative inline-block">
            conversation
            <svg className="absolute left-0 -bottom-2 w-full h-2" viewBox="0 0 200 8" preserveAspectRatio="none">
              <path className="underline-path" d="M 4 4 Q 100 -2 196 4"
                    fill="none" stroke="var(--accent)" strokeWidth="2" pathLength="1" />
            </svg>
          </span>
          {' '}— not a transaction.
        </h2>
      </div>
    </section>
  )
}
```

---

## FeatureSplits

```jsx
function FeatureSplits() {
  const wrap = useRef(null)
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.utils.toArray('.split-row').forEach((row) => {
        const img = row.querySelector('.split-img')
        const txt = row.querySelector('.split-txt')
        gsap.to(img, {
          yPercent: -6, ease: 'none',
          scrollTrigger: { trigger: row, start: 'top bottom', end: 'bottom top', scrub: true },
        })
        gsap.to(txt, {
          yPercent: 3, ease: 'none',
          scrollTrigger: { trigger: row, start: 'top bottom', end: 'bottom top', scrub: true },
        })
      })
    }, wrap)
    return () => ctx.revert()
  }, [])

  return (
    <section id="approach" ref={wrap} className="py-16 sm:py-24">
      {FEATURES.map((f, i) => {
        const flipped = i % 2 === 1
        return (
          <div key={i} className="split-row py-16 sm:py-24">
            <div className="max-w-editorial mx-auto px-6 sm:px-12 lg:px-24 grid grid-cols-12 gap-6 items-center">
              <div className={`split-img col-span-12 lg:col-span-6 ${flipped ? 'lg:col-start-7 lg:order-2' : ''}`}>
                <div className="aspect-[4/5] overflow-hidden">
                  <img src={f.image} alt={f.caption} className="w-full h-full object-cover" />
                </div>
                <p className="caption mt-3">Fig. {String(i + 2).padStart(2, '0')} — {f.caption}</p>
              </div>
              <div className={`split-txt col-span-12 lg:col-span-5 ${flipped ? 'lg:col-start-1 lg:order-1' : 'lg:col-start-8'}`}>
                <span className="eyebrow">Feature {String(i + 1).padStart(2, '0')}</span>
                <h3 className="mt-4 font-serif font-semibold text-[clamp(28px,3.5vw,44px)] leading-[1.1] tracking-tight2">
                  {f.heading}
                </h3>
                <p className="mt-2 font-serif italic text-2xl text-muted">{f.sub}</p>
                <p className="mt-6 text-base leading-[1.6] max-w-md">{f.body}</p>
                <p className="mt-10 eyebrow">{f.meta}</p>
              </div>
            </div>
          </div>
        )
      })}
    </section>
  )
}
```

---

## IndexList

```jsx
function IndexList() {
  return (
    <section id="index" className="py-32 sm:py-48">
      <div className="max-w-editorial mx-auto px-6 sm:px-12 lg:px-24">
        <span className="eyebrow">╱ Index</span>
        <h2 className="mt-6 font-serif font-medium text-[clamp(40px,5vw,72px)] leading-[1.02] tracking-tight2">
          Services
        </h2>

        <ul className="mt-16 border-t border-rule">
          {SERVICES.map((s, i) => (
            <li key={i} className="group border-b border-rule">
              <a href="#contact" className="grid grid-cols-[80px_1fr_auto] items-baseline gap-6 py-8 px-2 hover:bg-ink/[0.02] transition-colors">
                <span className="font-serif text-3xl text-muted">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <div className="relative inline-block">
                    <span className="font-serif text-2xl text-ink">{s.title}</span>
                    <svg className="absolute left-0 -bottom-1 w-full h-1.5" viewBox="0 0 200 6" preserveAspectRatio="none">
                      <path
                        className="underline-path group-hover:!stroke-dashoffset-0"
                        d="M 0 3 L 200 3"
                        stroke="var(--accent)" strokeWidth="1.5" fill="none" pathLength="1"
                        style={{ transitionDuration: '0.4s' }}
                      />
                    </svg>
                  </div>
                  <p className="mt-1 font-serif italic text-lg text-muted">{s.sub}</p>
                </div>
                <span className="font-mono text-[11px] tracking-[0.28em] uppercase text-muted group-hover:text-ink transition-colors">↗</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
```

Note: the hover-underline uses a CSS trick — the group's `hover` toggles the SVG path's `stroke-dashoffset` via a class. Because Tailwind can't directly target `stroke-dashoffset` in JIT reliably, we use a plain CSS rule instead:

```css
.group:hover .underline-path { stroke-dashoffset: 0; }
```

Add this to `index.css` under `@layer components`.

---

## Testimonial

```jsx
function Testimonial() {
  return (
    <section className="py-32 sm:py-48">
      <div className="max-w-editorial mx-auto px-6 sm:px-12 lg:px-24 max-w-4xl">
        <span className="eyebrow block text-center">╱ Testimonial</span>
        <div className="mt-10 text-center">
          <span className="font-serif italic text-[8rem] text-muted leading-none">&ldquo;</span>
          <p className="mt-2 font-serif italic text-[clamp(24px,3vw,40px)] leading-[1.35] text-balance">
            <QUOTE>
          </p>
          <div className="mt-10 flex items-center justify-center gap-3">
            <span className="h-2 w-2 rounded-full bg-[color:var(--accent)]" />
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
              <NAME> · <ROLE> · <FIRM>
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
```

---

## CTABanner

```jsx
function CTABanner() {
  return (
    <section id="contact" className="relative min-h-[70vh] flex items-center justify-center overflow-hidden">
      <img src="<UNSPLASH_CTA>" alt=""
           className="absolute inset-0 w-full h-full object-cover"
           style={{ filter: 'grayscale(0.15) contrast(0.98)' }} />
      <div className="absolute inset-0 bg-ink/10" />
      <div className="relative bg-paper py-16 px-8 sm:px-14 max-w-[720px] w-[90%] mx-auto border-t border-b border-[color:var(--accent)] text-center">
        <span className="eyebrow">╱ Begin</span>
        <p className="mt-6 font-serif italic text-[clamp(28px,3.5vw,48px)] leading-[1.15] text-balance">
          Whether you&rsquo;re hiring or exploring your next move —
          <br className="hidden sm:inline" /> come and talk to us.
        </p>
        <a href="mailto:<EMAIL>" className="mt-10 inline-flex items-center gap-2 border border-ink text-ink px-6 py-3 hover:bg-ink hover:text-paper transition-colors duration-500">
          <span className="font-serif italic">Write to us</span>
          <ArrowUpRight className="h-4 w-4" strokeWidth={1.6} />
        </a>
      </div>
    </section>
  )
}
```

---

## ColophonFooter

```jsx
function ColophonFooter() {
  return (
    <footer className="border-t border-rule pt-24 pb-12">
      <div className="max-w-editorial mx-auto px-6 sm:px-12 lg:px-24">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-12">
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <span className="inline-flex h-7 w-7 items-center justify-center border border-ink">
                <span className="font-serif text-sm leading-none text-ink"><INITIAL></span>
              </span>
              <span className="font-serif text-lg leading-none"><COMPANY_NAME></span>
            </div>
            <p className="font-serif italic text-lg text-muted mt-2"><EDITORIAL_BYLINE></p>
            <p className="mt-6 text-sm leading-[1.6] max-w-xs text-ink/80">
              <SHORT_ABOUT_TWO_SENTENCES>
            </p>
            <div className="mt-6 scale-75 origin-left">
              <MastheadFlaps />
            </div>
          </div>

          <div>
            <p className="eyebrow">Contact</p>
            <ul className="mt-4 space-y-2 text-sm">
              <li><a href="tel:<PHONE_TEL>" className="font-mono text-ink hover:text-[color:var(--accent)]"><PHONE_DISPLAY></a></li>
              <li><a href="mailto:<EMAIL>" className="font-mono text-ink hover:text-[color:var(--accent)]"><EMAIL></a></li>
              <li className="font-serif text-ink/80 leading-[1.5]"><ADDRESS></li>
            </ul>
          </div>

          <div>
            <p className="eyebrow">Practice</p>
            <ul className="mt-4 space-y-2 font-serif italic text-lg">
              {SERVICES.slice(0, 4).map((s, i) => (
                <li key={i}><a href="#index" className="hover:text-[color:var(--accent)]">{s.title}</a></li>
              ))}
            </ul>
          </div>

          <div>
            <p className="eyebrow">Colophon</p>
            <ul className="mt-4 space-y-2 font-mono text-[11px] uppercase tracking-[0.28em]">
              <li><a href="<LINKEDIN>" className="hover:text-[color:var(--accent)]">LinkedIn</a></li>
              <li><Link to="/colophon" className="hover:text-[color:var(--accent)]">Privacy · Terms</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-20 pt-8 border-t border-rule text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted">
            Set in Instrument Serif · Published in <CITY> · MMXXVI · <COMPANY_NAME>
          </p>
        </div>
        <p className="mt-6 font-mono text-[10px] uppercase tracking-widest text-muted">
          © 2026 <COMPANY_NAME>. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
```

---

## Data placeholders

Every `<UPPER_TOKEN>` is substituted at build time from Phase 1 intake. Do NOT ship a page with any placeholder still visible.
