import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import {
  Phone,
  Mail,
  MapPin,
  ArrowUpRight,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Award,
  Clock,
  Menu,
  X,
  Upload,
  Zap,
  Lightbulb,
  BellRing,
  Network,
  ChefHat,
  Wrench,
} from 'lucide-react'

gsap.registerPlugin(ScrollTrigger)

/* ----------------------------------------------------------------
   Constants / Content
---------------------------------------------------------------- */
const NAV_LINKS = [
  { label: 'Home', href: '#home' },
  { label: 'Diensten', href: '#diensten' },
  { label: 'Vakmanschap', href: '#vakmanschap' },
  { label: 'Werkwijze', href: '#werkwijze' },
  { label: 'Contact', href: '#contact' },
]

const SERVICES_FULL = [
  {
    icon: Zap,
    title: 'Groepenkasten',
    text: 'Levering en plaatsing van moderne groepen­kasten en meter­kasten, volgens NEN 1010. Van enkel­fasig woonhuis tot 3-fasen bedrijfsverdeling.',
  },
  {
    icon: Lightbulb,
    title: 'Verlichting',
    text: 'LED-verlichting binnen en buiten. Sfeer, functie en energie­zuinigheid, ontworpen op de plek waar het brandt.',
  },
  {
    icon: BellRing,
    title: 'Brandmelders & Alarm',
    text: 'Brandmelders en (draadloze) alarm­installaties. Bescherming voor woning en bedrijfspand — zonder gedoe met leidingen.',
  },
  {
    icon: Network,
    title: 'Datanetwerken',
    text: 'Structured cabling met CAT6/CAT7 en glasvezel. Snel, stabiel en klaar voor de komende jaren.',
  },
  {
    icon: ChefHat,
    title: 'Keukens & Apparatuur',
    text: 'Bestelling, levering en aansluiting van keuken­apparatuur. Aansluit­klaar, veilig, netjes weggewerkt.',
  },
  {
    icon: Wrench,
    title: 'Service & Onderhoud',
    text: 'Preventief onderhoud én snelle storings­dienst. Wij houden uw installatie draaiend — ook op zaterdag om vijf uur.',
  },
]

/* ----------------------------------------------------------------
   Navbar
---------------------------------------------------------------- */
function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
      <nav
        className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-500 ${
          scrolled ? 'glass shadow-lg shadow-primary/10' : 'bg-transparent'
        } rounded-full px-4 sm:px-6 py-2.5 w-[calc(100%-2rem)] max-w-5xl`}
      >
        <div className="flex items-center justify-between gap-6">
          <a href="#home" className="flex items-center gap-2 group">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-primary">
              <Zap className="h-5 w-5 text-deep" strokeWidth={2.4} fill="currentColor" />
              <span className="absolute inset-0 rounded-full ring-2 ring-primary/30 group-hover:ring-primary/50 transition" />
            </span>
            <span
              data-builder-field="navigation.brand"
              className={`font-display font-bold tracking-tight text-lg ${
                scrolled ? 'text-ink' : 'text-white'
              } transition-colors`}
            >
              Vink Elektrotechniek
            </span>
          </a>

          <div className="hidden lg:flex items-center gap-7">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={`text-sm font-medium tracking-tight lift-on-hover ${
                  scrolled ? 'text-ink/70 hover:text-primary-dark' : 'text-white/90 hover:text-white'
                } transition-colors`}
              >
                {link.label}
              </a>
            ))}
          </div>

          <a
            href="#contact"
            className="hidden lg:inline-flex magnetic-btn items-center gap-1.5 bg-primary text-deep px-4 py-2 rounded-full text-sm font-semibold shadow-lg shadow-primary/30"
          >
            <span data-builder-field="navigation.cta">Vraag offerte</span>
            <ArrowUpRight className="h-4 w-4" strokeWidth={2.5} />
          </a>

          <button
            onClick={() => setOpen(true)}
            className={`lg:hidden p-2 rounded-full ${scrolled ? 'text-ink' : 'text-white'}`}
            aria-label="Menu openen"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </nav>

      {/* Mobile menu */}
      <div
        className={`fixed inset-0 z-[60] transition-all duration-500 lg:hidden ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="absolute inset-0 bg-deep/90 backdrop-blur-2xl" onClick={() => setOpen(false)} />
        <div
          className={`absolute top-0 left-0 right-0 bg-background rounded-b-5xl px-6 pt-8 pb-12 transition-transform duration-500 ${
            open ? 'translate-y-0' : '-translate-y-full'
          }`}
        >
          <div className="flex items-center justify-between mb-10">
            <span data-builder-field="navigation.brand" className="font-display font-bold text-xl text-ink">Vink Elektrotechniek</span>
            <button onClick={() => setOpen(false)} className="p-2 rounded-full bg-divider/40">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="font-display text-3xl font-semibold text-ink py-3 border-b border-divider"
              >
                {link.label}
              </a>
            ))}
          </div>
          <a
            href="#contact"
            onClick={() => setOpen(false)}
            className="mt-8 magnetic-btn flex items-center justify-center gap-2 bg-primary text-deep px-6 py-4 rounded-full font-semibold w-full"
          >
            <span data-builder-field="navigation.cta">Vraag offerte</span>
            <ArrowUpRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </>
  )
}

/* ----------------------------------------------------------------
   Hero
---------------------------------------------------------------- */
function Hero() {
  const heroRef = useRef(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.hero-line-1', { y: 40, opacity: 0, duration: 1, ease: 'power3.out', delay: 0.3 })
      gsap.from('.hero-line-2', { y: 60, opacity: 0, duration: 1.2, ease: 'power3.out', delay: 0.5 })
      gsap.from('.hero-cta, .hero-meta', {
        y: 24, opacity: 0, duration: 0.8, ease: 'power3.out', delay: 0.8, stagger: 0.12,
      })
    }, heroRef)
    return () => ctx.revert()
  }, [])

  return (
    <section id="home" ref={heroRef} className="relative min-h-[100dvh] w-full overflow-hidden">
      {/* Background image — modern electrical panel / architectural lighting */}
      <div className="absolute inset-0">
        <img
          data-builder-field="hero.imageUrl"
          src="https://images.unsplash.com/photo-1558449028-b53a39d100fc?auto=format&fit=crop&w=2400&q=80"
          alt="Elektrotechnisch installatiewerk"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-deep/90 via-deep/60 to-primary/20" />
        <div className="absolute inset-0 bg-gradient-to-t from-deep via-deep/40 to-transparent" />
      </div>

      {/* Floating spark particles */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 right-[18%] h-2 w-2 rounded-full bg-primary/80 animate-float shadow-[0_0_20px_rgba(245,197,24,0.8)]" style={{ animationDelay: '0s' }} />
        <div className="absolute top-[55%] right-[10%] h-1.5 w-1.5 rounded-full bg-accent/70 animate-float shadow-[0_0_18px_rgba(34,211,238,0.7)]" style={{ animationDelay: '1.5s' }} />
        <div className="absolute top-[40%] right-[26%] h-1 w-1 rounded-full bg-primary-light/80 animate-float shadow-[0_0_12px_rgba(253,230,138,0.7)]" style={{ animationDelay: '3s' }} />
        <div className="absolute top-[70%] right-[32%] h-1.5 w-1.5 rounded-full bg-primary/60 animate-float shadow-[0_0_16px_rgba(245,197,24,0.6)]" style={{ animationDelay: '2s' }} />
      </div>

      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      {/* Content */}
      <div className="relative z-10 flex min-h-[100dvh] flex-col items-center justify-center text-center">
        <div className="px-6 sm:px-10 lg:px-16 max-w-4xl">
          <p data-builder-field="hero.eyebrow" className="hero-meta font-mono text-xs uppercase tracking-[0.3em] text-primary/90 mb-6">
            ╱ Sinds decennia gevestigd in Zaandam
          </p>
          <h1 className="font-display font-extrabold text-white leading-[0.95] tracking-tight">
            <span data-builder-field="hero.titlePrimary" className="hero-line-1 block text-4xl sm:text-5xl md:text-6xl">
              Uw partner in
            </span>
            <span
              data-builder-field="hero.titleAccent"
              className="hero-line-2 block font-serif italic font-medium text-primary text-6xl sm:text-7xl md:text-8xl lg:text-9xl mt-2"
              style={{ lineHeight: '0.92' }}
            >
              elektrotechniek.
            </span>
          </h1>

          <p className="hero-meta mx-auto max-w-xl text-white/75 text-base sm:text-lg mt-8 leading-relaxed">
            <span data-builder-field="hero.description">
              Gespecialiseerd in utiliteitsbouw en renovatiewerken.
              Alles voor in en om het huis of bedrijfspand.
            </span>
            <span className="text-white"> Ook voor service en onderhoud.</span>
          </p>

          <div className="hero-cta mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="#contact"
              className="magnetic-btn group inline-flex items-center justify-center gap-2 bg-primary text-deep font-semibold px-7 py-4 rounded-full shadow-2xl shadow-primary/40"
            >
              <span data-builder-field="hero.primaryCta">Vraag een offerte aan</span>
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              data-builder-link="contact.officePhone"
              href="tel:0757717667"
              className="lift-on-hover inline-flex items-center justify-center gap-2 bg-white/10 backdrop-blur-md text-white border border-white/20 font-medium px-7 py-4 rounded-full"
            >
              <Phone className="h-4 w-4" />
              <span data-builder-field="contact.officePhone">075 - 77 17 667</span>
            </a>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 right-6 sm:right-12 hidden md:flex flex-col items-center gap-2 text-white/50">
          <span className="font-mono uppercase text-[10px] tracking-[0.3em]">Scroll</span>
          <div className="h-8 w-px bg-gradient-to-b from-white/50 to-transparent" />
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------
   Feature Card 1 — Cabinet Shuffler (Groepenkasten)
---------------------------------------------------------------- */
function CabinetShuffler() {
  const items = [
    { tag: '1-fase', label: 'Woonhuis · aardlek + 6 groepen', amps: '25A' },
    { tag: '3-fase', label: 'Bedrijfspand · verdeling 3×63A', amps: '63A' },
    { tag: 'Renovatie', label: 'Modernisering meterkast NEN 1010', amps: '40A' },
  ]
  const [stack, setStack] = useState(items)

  useEffect(() => {
    const interval = setInterval(() => {
      setStack((prev) => {
        const next = [...prev]
        next.unshift(next.pop())
        return next
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="relative h-44 w-full">
      {stack.map((item, i) => {
        const offset = i
        const total = stack.length
        return (
          <div
            key={item.tag}
            style={{
              transform: `translate(${offset * 14}px, ${offset * 14}px) scale(${1 - offset * 0.05})`,
              zIndex: total - offset,
              opacity: 1 - offset * 0.25,
              transition: 'transform 0.7s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.6s ease',
            }}
            className="absolute inset-0 bg-white border border-divider rounded-3xl p-5 shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-primary-dark bg-primary/15 px-2 py-1 rounded-full">
                {item.tag}
              </span>
              <span className="font-mono text-xs text-muted">{item.amps}</span>
            </div>
            <div className="mt-4 font-display text-lg font-semibold text-ink leading-tight">
              {item.label}
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              {Array.from({ length: 24 }).map((_, idx) => (
                <span
                  key={idx}
                  className="h-1 w-1 rounded-full"
                  style={{
                    background: idx < 24 - offset * 6 ? '#F5C518' : '#E5E7EB',
                  }}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ----------------------------------------------------------------
   Feature Card 2 — SIGNATURE ANIMATION: Storm of lightning bolts
   (Signature re-skin from water drops to electrical bolts)
---------------------------------------------------------------- */
function StormWatch() {
  const [statusIdx, setStatusIdx] = useState(0)
  const [count, setCount] = useState(12)

  const statuses = [
    { text: 'Netspanning stabiel · monitoring actief', label: 'Stabiel', tone: 'emerald' },
    { text: 'Storing gemeld · groep 4 uitgevallen', label: 'Melding', tone: 'accent' },
    { text: 'Monteur onderweg · 18 min', label: 'Onderweg', tone: 'primary' },
    { text: 'Groep hersteld · installatie weer online', label: 'Opgelost', tone: 'emerald' },
  ]

  useEffect(() => {
    const interval = setInterval(() => {
      setStatusIdx((idx) => {
        const next = (idx + 1) % statuses.length
        if (statuses[next].label === 'Opgelost') {
          setCount((c) => c + 1)
        }
        return next
      })
    }, 2300)
    return () => clearInterval(interval)
  }, [])

  // Lightning bolts falling from the busbar
  const bolts = [
    { left: '15%', delay: '0.0s', dur: '2.6s', size: 18 },
    { left: '25%', delay: '1.3s', dur: '3.0s', size: 14 },
    { left: '38%', delay: '0.6s', dur: '2.8s', size: 20 },
    { left: '50%', delay: '1.8s', dur: '2.4s', size: 16 },
    { left: '62%', delay: '0.9s', dur: '3.1s', size: 18 },
    { left: '74%', delay: '2.0s', dur: '2.7s', size: 14 },
    { left: '85%', delay: '0.4s', dur: '2.9s', size: 17 },
  ]

  // Cyan arc ripples on the ground rail
  const ripples = [
    { left: '22%', delay: '0.2s' },
    { left: '48%', delay: '1.0s' },
    { left: '76%', delay: '1.8s' },
  ]

  const status = statuses[statusIdx]
  const toneText =
    status.tone === 'emerald' ? 'text-emerald-300' :
    status.tone === 'accent' ? 'text-accent' :
    'text-primary'
  const toneDot =
    status.tone === 'emerald' ? 'bg-emerald-400' :
    status.tone === 'accent' ? 'bg-accent' :
    'bg-primary'

  return (
    <div
      className="relative h-44 w-full rounded-3xl overflow-hidden border border-primary/25"
      style={{
        background: 'radial-gradient(120% 80% at 50% -10%, #1a2540 0%, #0B0F17 65%, #05070C 100%)',
      }}
    >
      {/* Distant cloud glow / storm ambience */}
      <div className="absolute -top-8 -left-6 h-20 w-32 rounded-full bg-accent/20 blur-2xl" />
      <div className="absolute top-2 right-10 h-14 w-24 rounded-full bg-primary/15 blur-xl" />

      {/* Header strip */}
      <div className="absolute top-3 left-4 right-4 flex items-center justify-between z-20">
        <div className="flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-primary" strokeWidth={2.4} fill="currentColor" />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
            Storingsdienst
          </span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-display font-bold text-sm text-white tabular-nums">
            {String(count).padStart(2, '0')}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-widest text-white/40">
            vandaag
          </span>
        </div>
      </div>

      {/* Busbar (top rail) with insulators */}
      <svg
        className="absolute left-3 right-3 top-9 h-5"
        viewBox="0 0 400 20"
        preserveAspectRatio="none"
      >
        {/* Rail body */}
        <rect x="0" y="6" width="400" height="8" rx="4" fill="#F5C518" fillOpacity="0.28" />
        <rect x="0" y="7" width="400" height="2" fill="#F5C518" fillOpacity="0.55" />
        {/* End caps */}
        <rect x="0" y="4" width="6" height="12" rx="1.5" fill="#F5C518" fillOpacity="0.6" />
        <rect x="394" y="4" width="6" height="12" rx="1.5" fill="#F5C518" fillOpacity="0.6" />
        {/* Insulator ceramics */}
        {[60, 152, 248, 340].map((x) => (
          <g key={x}>
            <rect x={x - 3} y="2" width="6" height="6" rx="1" fill="#22D3EE" fillOpacity="0.75" />
            <rect x={x - 4} y="13" width="8" height="3" rx="1" fill="#F5C518" fillOpacity="0.85" />
          </g>
        ))}
      </svg>

      {/* Lightning bolt field */}
      <div className="absolute inset-x-0 top-14 bottom-11 overflow-hidden">
        {bolts.map((b, i) => (
          <svg
            key={i}
            className="absolute top-0"
            style={{
              left: b.left,
              width: `${b.size}px`,
              height: `${Math.round(b.size * 1.7)}px`,
              animation: `bolt-fall ${b.dur} cubic-bezier(0.55,0.05,0.7,0.45) ${b.delay} infinite`,
              filter: 'drop-shadow(0 0 4px rgba(245,197,24,0.75)) drop-shadow(0 0 10px rgba(34,211,238,0.35))',
              transform: 'translateX(-50%)',
            }}
            viewBox="0 0 24 40"
          >
            <defs>
              <linearGradient id={`bolt-${i}`} x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#FEF9C3" />
                <stop offset="45%" stopColor="#F5C518" />
                <stop offset="100%" stopColor="#B08800" />
              </linearGradient>
            </defs>
            {/* Zig-zag lightning bolt */}
            <path
              d="M13 0 L4 22 L11 22 L7 40 L20 16 L13 16 L18 0 Z"
              fill={`url(#bolt-${i})`}
              stroke="#FEF3B0"
              strokeOpacity="0.8"
              strokeWidth="0.5"
              strokeLinejoin="round"
            />
          </svg>
        ))}
      </div>

      {/* Ground rail (current line) */}
      <svg
        className="absolute bottom-9 left-3 right-3 h-3"
        viewBox="0 0 200 12"
        preserveAspectRatio="none"
      >
        <path
          d="M 0,6 Q 12.5,2 25,6 T 50,6 T 75,6 T 100,6 T 125,6 T 150,6 T 175,6 T 200,6"
          fill="none"
          stroke="#22D3EE"
          strokeOpacity="0.55"
          strokeWidth="1.2"
        />
        <path
          d="M 0,8 Q 12.5,5 25,8 T 50,8 T 75,8 T 100,8 T 125,8 T 150,8 T 175,8 T 200,8"
          fill="none"
          stroke="#F5C518"
          strokeOpacity="0.30"
          strokeWidth="0.8"
        />
      </svg>

      {/* Spark ripples on ground */}
      <div className="absolute bottom-[34px] left-3 right-3 h-2">
        {ripples.map((r, i) => (
          <span
            key={i}
            className="absolute top-0 -translate-x-1/2 rounded-full border border-accent/70"
            style={{
              left: r.left,
              width: '4px',
              height: '4px',
              animation: `spark-ripple 2.4s ease-out ${r.delay} infinite`,
            }}
          />
        ))}
      </div>

      {/* Bottom status */}
      <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between z-20">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`relative h-2 w-2 rounded-full ${toneDot}`}>
            {status.tone === 'accent' && (
              <span className={`absolute inset-0 rounded-full ${toneDot} animate-ping`} />
            )}
          </span>
          <span
            key={status.text}
            className={`font-mono text-[10px] truncate ${toneText}`}
            style={{ animation: 'bolt-fadein 0.35s ease-out' }}
          >
            {status.text}
          </span>
        </div>
        <span
          className={`font-mono text-[9px] uppercase tracking-[0.2em] whitespace-nowrap pl-2 ${toneText}`}
        >
          {status.label}
        </span>
      </div>

      <style>{`
        @keyframes bolt-fall {
          0%   { transform: translate(-50%, -12px); opacity: 0; }
          10%  { opacity: 1; }
          82%  { opacity: 1; }
          100% { transform: translate(-50%, 95px); opacity: 0; }
        }
        @keyframes spark-ripple {
          0%   { transform: translateX(-50%) scale(0.4); opacity: 0.95; }
          80%  { transform: translateX(-50%) scale(3.5); opacity: 0; }
          100% { transform: translateX(-50%) scale(3.5); opacity: 0; }
        }
        @keyframes bolt-fadein {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

/* ----------------------------------------------------------------
   Feature Card 3 — Cursor Scheduler (Renovation booking)
---------------------------------------------------------------- */
function RenovationScheduler() {
  const days = ['M', 'D', 'W', 'D', 'V', 'Z', 'Z']
  const [step, setStep] = useState(0)
  const activeDay = 2

  useEffect(() => {
    const interval = setInterval(() => {
      setStep((prev) => (prev + 1) % 5)
    }, 1400)
    return () => clearInterval(interval)
  }, [])

  const cursorPos = (() => {
    switch (step) {
      case 0: return { x: 8, y: 110, opacity: 0 }
      case 1: return { x: 60, y: 60, opacity: 1 }
      case 2: return { x: 60 + activeDay * 36, y: 60, opacity: 1 }
      case 3: return { x: 60 + activeDay * 36, y: 60, opacity: 1 }
      case 4: return { x: 130, y: 130, opacity: 1 }
      default: return { x: 8, y: 110, opacity: 0 }
    }
  })()

  return (
    <div className="relative h-44 w-full bg-white border border-divider rounded-3xl p-5 overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
          Week 14 · April
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-primary-dark bg-primary/15 px-2 py-0.5 rounded-full">
          Inplannen
        </span>
      </div>

      <div className="grid grid-cols-7 gap-2 mb-4">
        {days.map((d, idx) => (
          <div
            key={idx}
            className={`flex flex-col items-center justify-center h-9 rounded-xl text-xs font-medium transition-all duration-300 ${
              step >= 3 && idx === activeDay
                ? 'bg-primary text-deep scale-110 shadow-lg shadow-primary/30'
                : 'bg-background text-ink'
            }`}
          >
            <span className="font-mono text-[9px] text-muted">{d}</span>
            <span className="font-display font-semibold text-sm">{idx + 7}</span>
          </div>
        ))}
      </div>

      <button
        className={`w-full py-2.5 rounded-2xl font-medium text-xs transition-all duration-300 ${
          step === 4
            ? 'bg-accent text-deep scale-[1.02] shadow-md shadow-accent/30'
            : 'bg-divider/40 text-muted'
        }`}
      >
        {step >= 3 ? '✓ Afspraak bevestigd' : 'Kies een dag'}
      </button>

      <div
        className="absolute pointer-events-none transition-all duration-500 ease-out"
        style={{
          left: `${cursorPos.x}px`,
          top: `${cursorPos.y}px`,
          opacity: cursorPos.opacity,
          transform: step === 3 ? 'scale(0.85)' : 'scale(1)',
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 3L19 12L12 13L9 20L5 3Z"
            fill="#111318"
            stroke="white"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------
   Features Section
---------------------------------------------------------------- */
function Features() {
  const sectionRef = useRef(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.feature-card', {
        scrollTrigger: { trigger: sectionRef.current, start: 'top 90%', once: true },
        y: 40, opacity: 0, duration: 0.8, ease: 'power3.out', stagger: 0.15,
      })
      gsap.from('.feature-heading > *', {
        scrollTrigger: { trigger: sectionRef.current, start: 'top 95%', once: true },
        y: 30, opacity: 0, duration: 0.8, ease: 'power3.out', stagger: 0.08,
      })
    }, sectionRef)
    return () => ctx.revert()
  }, [])

  const cards = [
    {
      eyebrow: '01 / Specialisatie',
      heading: 'Groepenkasten',
      sub: 'Volgens NEN 1010',
      text: 'Van 1-fase woningaansluiting tot 3-fasen bedrijfsverdeling. We ontwerpen, leveren en installeren — netjes, meetbaar, gedocumenteerd.',
      Component: CabinetShuffler,
    },
    {
      eyebrow: '02 / Beschikbaarheid',
      heading: 'Storingsdienst',
      sub: 'Dag & nacht bereikbaar',
      text: 'Uitval, kortsluiting, brand­alarm? We rukken snel uit. Één telefoontje en de monteur is onderweg — ook in het weekend.',
      Component: StormWatch,
    },
    {
      eyebrow: '03 / Renovatie',
      heading: 'Renovatie & Nieuwbouw',
      sub: 'Van tekening tot oplevering',
      text: 'Compleet elektro­technisch installatiewerk voor renovaties en nieuwbouw. We plannen samen, leveren op tijd, ondersteunen erna.',
      Component: RenovationScheduler,
    },
  ]

  return (
    <section id="diensten" ref={sectionRef} className="relative py-28 sm:py-40 px-6 sm:px-10 lg:px-16">
      <div className="max-w-7xl mx-auto">
        <div className="feature-heading max-w-3xl mb-16 sm:mb-24">
          <span data-builder-field="services.eyebrow" className="font-mono text-xs uppercase tracking-[0.25em] text-primary-dark">
            ╱ Onze kernthema's
          </span>
          <h2 className="font-display font-extrabold text-4xl sm:text-5xl md:text-6xl text-ink mt-4 leading-[1.05] tracking-tight">
            <span data-builder-field="services.titlePrimary">Drie pijlers.</span>
            <span data-builder-field="services.titleAccent" className="block font-serif italic font-medium text-primary-dark mt-1">
              Eén ambacht.
            </span>
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {cards.map((card, idx) => (
            <article
              key={idx}
              className="feature-card group relative bg-surface border border-divider rounded-5xl p-7 hover:border-primary/50 transition-colors duration-500 shadow-sm hover:shadow-xl hover:shadow-primary/10"
            >
              <div className="flex items-center justify-between mb-6">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                  {card.eyebrow}
                </span>
                <ArrowUpRight
                  className="h-5 w-5 text-ink/30 group-hover:text-primary-dark group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all"
                  strokeWidth={1.8}
                />
              </div>

              <card.Component />

              <div className="mt-6">
                <h3 data-builder-field={`services.cards.${idx}.title`} className="font-display font-bold text-2xl text-ink leading-tight">
                  {card.heading}
                </h3>
                <p data-builder-field={`services.cards.${idx}.subtitle`} className="font-serif italic text-primary-dark text-sm mt-1">
                  {card.sub}
                </p>
                <p data-builder-field={`services.cards.${idx}.description`} className="text-muted text-[15px] mt-4 leading-relaxed">{card.text}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------
   CountUp — animated counter
---------------------------------------------------------------- */
function CountUp({ target, duration = 1800 }) {
  const [count, setCount] = useState(0)
  const elemRef = useRef(null)
  const startedRef = useRef(false)

  useEffect(() => {
    const el = elemRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !startedRef.current) {
            startedRef.current = true
            const startTime = performance.now()
            const animate = (now) => {
              const elapsed = now - startTime
              const progress = Math.min(elapsed / duration, 1)
              const eased = 1 - Math.pow(1 - progress, 3)
              setCount(Math.floor(target * eased))
              if (progress < 1) {
                requestAnimationFrame(animate)
              } else {
                setCount(target)
              }
            }
            requestAnimationFrame(animate)
          }
        })
      },
      { threshold: 0.35 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [target, duration])

  return <span ref={elemRef}>{count}</span>
}

/* ----------------------------------------------------------------
   Pillars — Three core numbers
---------------------------------------------------------------- */
function Pillars() {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const pillars = [
    {
      n: '01',
      title: 'Ervaring',
      target: 25,
      suffix: '+',
      label: 'jaar in de wijk',
      desc: 'Ruim twee decennia elektrotechnisch vakwerk in Zaanstreek. We kennen de panden, de klanten en de valkuilen — en we lossen ze op.',
    },
    {
      n: '02',
      title: 'Erkenning',
      target: 100,
      suffix: '%',
      label: 'Kenteq erkend leerbedrijf',
      desc: 'Officieel erkend leerbedrijf via Kenteq. We leiden vakmensen op naast ons eigen werk — kwaliteit begint bij scholing.',
    },
    {
      n: '03',
      title: 'Beschikbaarheid',
      target: 24,
      suffix: '/7',
      label: 'storingsdienst',
      desc: 'Kortsluiting midden in de nacht? Uitval op zaterdag? We rukken uit, ook buiten kantooruren. Één afspraak, één belofte.',
    },
  ]

  return (
    <section id="vakmanschap" ref={ref} className="relative py-28 sm:py-40 px-6 sm:px-10 lg:px-16 overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-60" />
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 h-64 w-[44rem] rounded-full bg-primary/20 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-accent/12 blur-3xl pointer-events-none" />

      <div className="relative max-w-7xl mx-auto">
        <div
          className={`flex flex-col lg:flex-row lg:items-end justify-between gap-8 mb-16 sm:mb-24 transition-all duration-1000 ease-out ${
            visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
          }`}
        >
          <div className="max-w-2xl">
            <span className="inline-block font-mono text-xs uppercase tracking-[0.3em] text-primary-dark mb-5">
              ╱ Drie pijlers
            </span>
            <h2 className="font-display font-extrabold text-4xl sm:text-5xl md:text-6xl text-ink leading-[1.05] tracking-tight">
              De cijfers achter
              <span className="block font-serif italic font-medium text-primary-dark">het vakwerk.</span>
            </h2>
          </div>
          <p className="text-muted text-lg leading-relaxed max-w-md lg:text-right">
            Geen marketingpraat — gewoon wat we elke dag waarmaken. Voor particulier én bedrijf.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-divider rounded-5xl overflow-hidden border border-divider shadow-xl shadow-primary/5">
          {pillars.map((p, i) => (
            <article
              key={i}
              style={{ transitionDelay: visible ? `${i * 150}ms` : '0ms' }}
              className={`pillar-card relative bg-surface p-9 sm:p-12 group overflow-hidden transition-all duration-1000 ease-out ${
                visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
              }`}
            >
              <div className="flex items-center justify-between mb-10">
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
                  {p.n} / {p.title}
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-primary/40 group-hover:bg-primary group-hover:scale-150 transition-all duration-500" />
              </div>

              <div className="flex items-end gap-1 leading-none">
                <span className="font-display font-extrabold text-[6rem] sm:text-[8rem] md:text-[9rem] leading-[0.85] text-ink tabular-nums tracking-tight">
                  <CountUp target={p.target} duration={1800 + i * 200} />
                </span>
                <span className="font-serif italic font-medium text-4xl sm:text-5xl md:text-6xl text-primary-dark mb-3 sm:mb-4">
                  {p.suffix}
                </span>
              </div>

              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary-dark mt-5">
                {p.label}
              </p>

              <p className="text-muted text-[15px] mt-6 leading-relaxed max-w-xs">
                {p.desc}
              </p>

              <div className="absolute bottom-0 left-9 right-9 sm:left-12 sm:right-12 h-px bg-divider overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-transparent via-primary to-transparent"
                  style={{ animation: `pillar-sweep 4s ease-in-out ${i * 0.4}s infinite` }}
                />
              </div>

              <span className="absolute top-9 right-9 sm:top-12 sm:right-12 font-mono text-[9px] uppercase tracking-widest text-primary/30">
                {p.n}.vink
              </span>
            </article>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes pillar-sweep {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </section>
  )
}

/* ----------------------------------------------------------------
   Protocol — Sticky Stacking Cards
---------------------------------------------------------------- */
function Protocol() {
  const containerRef = useRef(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      const cards = gsap.utils.toArray('.protocol-card')
      cards.forEach((card, i) => {
        if (i === cards.length - 1) return
        gsap.to(card, {
          scrollTrigger: {
            trigger: card,
            start: 'top top+=100',
            endTrigger: cards[cards.length - 1],
            end: 'top top+=120',
            scrub: 1,
          },
          scale: 0.92,
          filter: 'blur(6px) saturate(0.7)',
          opacity: 0.5,
          ease: 'none',
        })
      })
    }, containerRef)
    return () => ctx.revert()
  }, [])

  const steps = [
    {
      num: '01',
      title: 'Inventarisatie',
      tagline: 'We luisteren eerst.',
      text: 'We komen langs, kijken de situatie ter plekke en geven eerlijk advies. Vaste offerte vooraf, geen verrassingen achteraf.',
      image: 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=1200&q=80',
      alt: 'Elektromonteur bekijkt situatie',
      meta: 'Stap 1 / Luisteren',
    },
    {
      num: '02',
      title: 'Ontwerp & Installatie',
      tagline: 'Netjes uitgevoerd.',
      text: 'Ontwerp volgens NEN 1010, materialen van A-merken. We werken schoon, dichten alles af en dragen het pand netjes over.',
      image: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=1200&q=80',
      alt: 'Elektromonteur bedraadt groepenkast',
      meta: 'Stap 2 / Uitvoeren',
    },
    {
      num: '03',
      title: 'Oplevering & Nazorg',
      tagline: 'We blijven bereikbaar.',
      text: 'Meting, keuring en heldere documentatie bij oplevering. En daarna: één telefoontje en we staan klaar. Zo simpel is het.',
      image: 'https://images.unsplash.com/photo-1565608087341-404b25492fee?auto=format&fit=crop&w=1200&q=80',
      alt: 'Modern verlicht interieur',
      meta: 'Stap 3 / Ondersteunen',
    },
  ]

  return (
    <section id="werkwijze" ref={containerRef} className="relative px-4 sm:px-6 py-20">
      <div className="max-w-7xl mx-auto mb-16 px-2 sm:px-10">
        <span data-builder-field="process.eyebrow" className="font-mono text-xs uppercase tracking-[0.25em] text-primary-dark">
          ╱ Zo werken wij
        </span>
        <h2 className="font-display font-extrabold text-4xl sm:text-5xl md:text-6xl text-ink mt-4 leading-[1.05] tracking-tight max-w-3xl">
          <span data-builder-field="process.titlePrimary">Drie stappen.</span>
          <span data-builder-field="process.titleAccent" className="block font-serif italic font-medium text-primary-dark">
            Geen verrassingen.
          </span>
        </h2>
      </div>

      <div className="space-y-8">
        {steps.map((step, idx) => (
          <article
            key={idx}
            className="protocol-card sticky top-24 sm:top-28 mx-auto max-w-6xl bg-gradient-to-br from-surface to-background border border-divider rounded-6xl overflow-hidden shadow-2xl shadow-primary/5"
          >
            <div className="grid lg:grid-cols-5 gap-0 min-h-[60vh] lg:min-h-[70vh]">
              <div className="lg:col-span-3 p-8 sm:p-12 lg:p-16 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs uppercase tracking-[0.25em] text-muted">
                    {step.meta}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-primary-dark bg-primary/15 px-2.5 py-1 rounded-full">
                    Vink Werkwijze
                  </span>
                </div>

                <div className="my-12">
                  <span className="font-display font-extrabold text-[7rem] sm:text-[10rem] leading-none text-primary/20 -mb-4 block">
                    {step.num}
                  </span>
                  <h3 data-builder-field={`process.steps.${idx}.title`} className="font-display font-bold text-4xl sm:text-5xl md:text-6xl text-ink leading-[1.02] tracking-tight">
                    {step.title}
                  </h3>
                  <p data-builder-field={`process.steps.${idx}.tagline`} className="font-serif italic text-primary-dark text-2xl sm:text-3xl mt-3">
                    {step.tagline}
                  </p>
                </div>

                <p data-builder-field={`process.steps.${idx}.description`} className="text-muted text-base sm:text-lg leading-relaxed max-w-lg">
                  {step.text}
                </p>
              </div>

              <div className="lg:col-span-2 relative overflow-hidden min-h-[300px] lg:min-h-full bg-deep">
                <img
                  src={step.image}
                  alt={step.alt}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-deep/60 via-transparent to-deep/15" />
                <div className="absolute top-5 left-5 flex items-center gap-2 bg-white/90 backdrop-blur-sm rounded-full pl-3 pr-4 py-1.5 shadow-lg">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  <span className="font-mono text-[10px] uppercase tracking-widest text-ink">
                    Stap {step.num}
                  </span>
                </div>
                <div className="absolute bottom-4 right-4 font-mono text-[10px] uppercase tracking-widest text-white/70">
                  {step.num} / Vink Elektrotechniek
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------
   Services Grid
---------------------------------------------------------------- */
function ServicesGrid() {
  const ref = useRef(null)
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.svc-tile', {
        scrollTrigger: { trigger: ref.current, start: 'top 90%', once: true },
        y: 30, opacity: 0, duration: 0.7, ease: 'power3.out', stagger: 0.06,
      })
    }, ref)
    return () => ctx.revert()
  }, [])

  return (
    <section ref={ref} className="relative py-24 px-6 sm:px-10 lg:px-16 bg-deep text-white overflow-hidden rounded-t-6xl">
      <div className="absolute inset-0 grid-bg opacity-25" />
      <div className="absolute -top-20 -right-20 h-96 w-96 rounded-full bg-primary/25 blur-3xl" />
      <div className="absolute bottom-0 -left-20 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />

      <div className="relative max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-6 mb-14">
          <div>
            <span className="font-mono text-xs uppercase tracking-[0.25em] text-primary">╱ Wat wij doen</span>
            <h2 className="font-display font-extrabold text-4xl sm:text-5xl md:text-6xl mt-4 leading-[1.05] tracking-tight">
              Het complete pakket,
              <span className="block font-serif italic font-medium text-primary">
                onder één dak.
              </span>
            </h2>
          </div>
          <p className="text-white/60 max-w-md text-base leading-relaxed">
            Van kleine reparatie tot volledige nieuwbouw­installatie. Voor woonhuis en bedrijfspand — in Zaandam en omgeving.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-white/10 rounded-4xl overflow-hidden">
          {SERVICES_FULL.map((svc, i) => {
            const Icon = svc.icon
            return (
              <div
                key={i}
                className="svc-tile group bg-deep p-7 sm:p-9 hover:bg-white/[0.03] transition-colors duration-500 relative"
              >
                <div className="flex items-start justify-between mb-6">
                  <div className="h-12 w-12 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center group-hover:bg-primary group-hover:scale-110 transition-all duration-500">
                    <Icon className="h-5 w-5 text-primary group-hover:text-deep" strokeWidth={2} />
                  </div>
                  <span className="font-mono text-[10px] text-white/30 uppercase tracking-widest">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>
                <h3 className="font-display font-bold text-xl sm:text-2xl mb-3">{svc.title}</h3>
                <p className="text-white/60 text-sm leading-relaxed">{svc.text}</p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------
   Trust Signals
---------------------------------------------------------------- */
function TrustSignals() {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const badges = [
    {
      Icon: Award,
      title: 'Kenteq erkend leerbedrijf',
      text: 'Officieel geautoriseerd als leerbedrijf door Kenteq. Wij leiden vakmensen op en houden de kennis in huis.',
    },
    {
      Icon: ShieldCheck,
      title: 'NEN 1010 conform',
      text: 'Alle installaties voldoen aan de laatste normeringen. Meten, keuren en documenteren horen bij het werk.',
    },
    {
      Icon: Clock,
      title: '25+ jaar in Zaanstreek',
      text: 'Ruim twee decennia elektrotechnisch werk in Zaandam en omgeving. Een afspraak is een afspraak.',
    },
  ]

  return (
    <section id="waarom-vink" ref={ref} className="relative py-14 sm:py-20 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <span data-builder-field="trust.eyebrow" className="font-mono text-xs uppercase tracking-[0.25em] text-primary-dark">
            ╱ Waarom Vink
          </span>
          <h2 data-builder-field="trust.heading" className="font-display font-extrabold text-3xl sm:text-4xl md:text-5xl text-ink mt-3 tracking-tight">
            Meer dan een offerte.
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {badges.map(({ Icon, title, text }, i) => (
            <div
              key={i}
              style={{ transitionDelay: visible ? `${i * 120}ms` : '0ms' }}
              className={`bg-white border border-divider rounded-4xl p-6 hover:border-primary/50 transition-all duration-700 ease-out shadow-sm ${
                visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
              }`}
            >
              <Icon className="h-6 w-6 text-primary-dark mb-3" strokeWidth={1.8} />
              <h3 data-builder-field={`trust.cards.${i}.title`} className="font-display font-bold text-lg text-ink mb-1.5">{title}</h3>
              <p data-builder-field={`trust.cards.${i}.description`} className="text-muted text-sm leading-relaxed">{text}</p>
            </div>
          ))}
        </div>

        <div className="text-center">
          <a
            href="#contact"
            className="magnetic-btn inline-flex items-center gap-2 bg-primary text-deep font-semibold px-7 py-3.5 rounded-full shadow-xl shadow-primary/30"
          >
            <span data-builder-field="trust.cta">Vraag een offerte aan</span>
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------
   Contact Form
---------------------------------------------------------------- */
function Field({ label, type = 'text', required, value, onChange }) {
  return (
    <div>
      <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted mb-2 block">
        {label} {required && '*'}
      </label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-background border border-divider rounded-2xl px-4 py-3.5 text-ink placeholder-muted/60 focus:border-primary focus:ring-4 focus:ring-primary/15 outline-none transition font-body"
      />
    </div>
  )
}

function ContactForm() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', zip: '', message: '' })
  const [files, setFiles] = useState([])
  const [status, setStatus] = useState('idle')
  const dropRef = useRef(null)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.name || !form.email || !form.message) return
    setStatus('sending')
    setTimeout(() => setStatus('sent'), 1200)
  }

  const handleFiles = (newFiles) => {
    setFiles((prev) => [...prev, ...Array.from(newFiles)].slice(0, 5))
  }

  return (
    <section id="contact" className="relative py-24 sm:py-32 px-6 sm:px-10 lg:px-16 bg-background">
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-16">
          <div className="lg:col-span-5">
            <span className="font-mono text-xs uppercase tracking-[0.25em] text-primary-dark">
              ╱ Contact
            </span>
            <h2 className="font-display font-extrabold text-4xl sm:text-5xl md:text-6xl text-ink mt-4 leading-[1.05] tracking-tight">
              <span data-builder-field="contact.titlePrimary">Waarmee kunnen</span>
              <span data-builder-field="contact.titleAccent" className="block font-serif italic font-medium text-primary-dark">
                we u helpen?
              </span>
            </h2>
            <p data-builder-field="contact.description" className="text-muted text-lg mt-6 leading-relaxed max-w-md">
              Laat uw gegevens achter en we nemen zo snel mogelijk contact op om uw wensen te bespreken.
            </p>

            <div className="mt-10 space-y-4">
              <a data-builder-link="contact.officePhone" href="tel:0757717667" className="lift-on-hover flex items-center gap-4 group">
                <span className="h-12 w-12 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center group-hover:bg-primary transition">
                  <Phone className="h-5 w-5 text-primary-dark group-hover:text-deep" />
                </span>
                <span>
                  <span className="block font-mono text-[10px] uppercase tracking-widest text-muted">
                    Kantoor
                  </span>
                  <span data-builder-field="contact.officePhone" className="font-display font-semibold text-ink text-lg">
                    075 - 77 17 667
                  </span>
                </span>
              </a>

              <a data-builder-link="contact.mobilePhone" href="tel:0622865768" className="lift-on-hover flex items-center gap-4 group">
                <span className="h-12 w-12 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center group-hover:bg-primary transition">
                  <Phone className="h-5 w-5 text-primary-dark group-hover:text-deep" />
                </span>
                <span>
                  <span className="block font-mono text-[10px] uppercase tracking-widest text-muted">
                    Mobiel · Storingsdienst
                  </span>
                  <span data-builder-field="contact.mobilePhone" className="font-display font-semibold text-ink text-lg">
                    06 - 22 86 57 68
                  </span>
                </span>
              </a>

              <a data-builder-link="contact.email" href="mailto:info@vink-elektrotechniek.nl" className="lift-on-hover flex items-center gap-4 group">
                <span className="h-12 w-12 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center group-hover:bg-primary transition">
                  <Mail className="h-5 w-5 text-primary-dark group-hover:text-deep" />
                </span>
                <span>
                  <span className="block font-mono text-[10px] uppercase tracking-widest text-muted">
                    Email
                  </span>
                  <span data-builder-field="contact.email" className="font-display font-semibold text-ink text-lg break-all">
                    info@vink-elektrotechniek.nl
                  </span>
                </span>
              </a>

              <div className="flex items-center gap-4">
                <span className="h-12 w-12 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center">
                  <MapPin className="h-5 w-5 text-primary-dark" />
                </span>
                <span>
                  <span className="block font-mono text-[10px] uppercase tracking-widest text-muted">
                    Werkgebied
                  </span>
                  <span data-builder-field="contact.address" className="font-display font-semibold text-ink text-lg">
                    Harmoniehof 15, 1507 TX Zaandam
                  </span>
                </span>
              </div>
            </div>

            <div className="mt-10 p-5 rounded-3xl bg-primary/10 border border-primary/25">
              <p className="font-mono text-[10px] uppercase tracking-widest text-primary-dark mb-2">
                Uw gegevens
              </p>
              <p className="text-sm text-muted leading-relaxed">
                Uw gegevens zijn bij ons veilig. We nemen alleen contact op over uw aanvraag
                en verkopen niets door — nooit.
              </p>
            </div>
          </div>

          <div className="lg:col-span-7">
            <form
              onSubmit={handleSubmit}
              className="bg-surface border border-divider rounded-5xl p-7 sm:p-10 shadow-xl shadow-primary/5"
            >
              {status !== 'sent' ? (
                <>
                  <div className="grid sm:grid-cols-2 gap-5">
                    <Field label="Naam" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
                    <Field label="Emailadres" type="email" required value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
                    <Field label="Telefoonnummer" type="tel" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
                    <Field label="Postcode" value={form.zip} onChange={(v) => setForm({ ...form, zip: v })} />
                  </div>

                  <div className="mt-5">
                    <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted mb-2 block">
                      Uw bericht *
                    </label>
                    <textarea
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: e.target.value })}
                      required
                      rows={5}
                      placeholder="Beschrijf kort de opgave of uw wensen..."
                      className="w-full bg-background border border-divider rounded-2xl px-4 py-3.5 text-ink placeholder-muted/60 focus:border-primary focus:ring-4 focus:ring-primary/15 outline-none transition resize-none font-body"
                    />
                  </div>

                  <div
                    ref={dropRef}
                    onDragOver={(e) => {
                      e.preventDefault()
                      dropRef.current?.classList.add('!border-primary', '!bg-primary/5')
                    }}
                    onDragLeave={() => {
                      dropRef.current?.classList.remove('!border-primary', '!bg-primary/5')
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      dropRef.current?.classList.remove('!border-primary', '!bg-primary/5')
                      handleFiles(e.dataTransfer.files)
                    }}
                    className="mt-5 border-2 border-dashed border-divider rounded-3xl p-6 text-center hover:border-primary/60 transition-colors cursor-pointer"
                  >
                    <input
                      type="file"
                      multiple
                      id="file-up"
                      className="hidden"
                      onChange={(e) => handleFiles(e.target.files)}
                      accept="image/*"
                    />
                    <label htmlFor="file-up" className="cursor-pointer block">
                      <Upload className="h-6 w-6 mx-auto text-primary-dark mb-2" />
                      <p className="font-display font-semibold text-ink text-sm">
                        Voeg foto's toe van de situatie
                      </p>
                      <p className="text-xs text-muted mt-1">
                        Klik of sleep bestanden hierheen (max 5 foto's)
                      </p>
                      {files.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2 justify-center">
                          {files.map((f, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1.5 bg-primary/15 text-primary-dark text-xs px-3 py-1.5 rounded-full font-mono"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              {f.name.length > 22 ? f.name.slice(0, 22) + '…' : f.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </label>
                  </div>

                  <div className="mt-7 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <p className="text-xs text-muted">
                      We nemen zo snel mogelijk contact op. Velden met * zijn verplicht.
                    </p>
                    <button
                      type="submit"
                      disabled={status === 'sending'}
                      className="magnetic-btn inline-flex items-center gap-2 bg-primary text-deep font-semibold px-7 py-3.5 rounded-full shadow-lg shadow-primary/30 disabled:opacity-50"
                    >
                      {status === 'sending' ? 'Verzenden...' : 'Verstuur aanvraag'}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center py-12">
                  <div className="h-16 w-16 mx-auto rounded-full bg-primary/20 flex items-center justify-center mb-6">
                    <CheckCircle2 className="h-8 w-8 text-primary-dark" />
                  </div>
                  <h3 className="font-display font-bold text-2xl text-ink mb-3">
                    Bedankt voor uw bericht
                  </h3>
                  <p className="text-muted max-w-md mx-auto">
                    We nemen zo snel mogelijk contact met u op om uw wensen te bespreken.
                  </p>
                </div>
              )}
            </form>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------
   Footer
---------------------------------------------------------------- */
function Footer() {
  return (
    <footer id="footer" className="relative bg-deep text-white rounded-t-6xl mt-12 overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-15" />
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 h-64 w-[40rem] rounded-full bg-primary/25 blur-3xl" />

      <div className="relative px-6 sm:px-10 lg:px-16 pt-20 pb-10 max-w-7xl mx-auto">
        <div className="border-b border-white/10 pb-12 mb-12">
          <h2 className="font-display font-extrabold text-5xl sm:text-7xl md:text-8xl leading-[0.92] tracking-tight">
            <span data-builder-field="footer.titlePrimary">Vakwerk met</span>
            <span data-builder-field="footer.titleAccent" className="font-serif italic font-medium text-primary block">
              spanning erop.
            </span>
          </h2>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between mt-8 gap-6">
            <p data-builder-field="footer.description" className="text-white/50 max-w-md">
              Vink Elektrotechniek — thuis in Zaandam, actief in de hele Zaanstreek en omgeving.
            </p>
            <a
              href="#contact"
              className="magnetic-btn inline-flex items-center gap-2 bg-primary text-deep font-semibold px-7 py-3.5 rounded-full self-start sm:self-auto"
            >
              <span data-builder-field="footer.cta">Vraag offerte</span>
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-10">
          <div className="col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <span className="h-9 w-9 rounded-full bg-primary flex items-center justify-center">
                <Zap className="h-5 w-5 text-deep" strokeWidth={2.4} fill="currentColor" />
              </span>
              <span data-builder-field="footer.brand" className="font-display font-bold text-lg">Vink Elektrotechniek</span>
            </div>
            <p data-builder-field="footer.summary" className="text-white/50 text-sm leading-relaxed max-w-xs">
              Gespecialiseerd in utiliteitsbouw en renovatie­werken. Ook voor service en onderhoud van installaties.
            </p>
            <p className="font-mono text-[10px] uppercase tracking-widest text-white/30 mt-6">
              Kenteq erkend leerbedrijf
            </p>
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary mb-4">
              Diensten
            </p>
            <ul className="space-y-2.5">
              {SERVICES_FULL.slice(0, 4).map((s, i) => (
                <li key={i}>
                  <a href="#diensten" className="text-white/65 hover:text-primary transition text-sm">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary mb-4">
              Bedrijf
            </p>
            <ul className="space-y-2.5">
              <li><a href="#vakmanschap" className="text-white/65 hover:text-primary transition text-sm">Vakmanschap</a></li>
              <li><a href="#werkwijze" className="text-white/65 hover:text-primary transition text-sm">Werkwijze</a></li>
              <li><a href="#contact" className="text-white/65 hover:text-primary transition text-sm">Contact</a></li>
            </ul>
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary mb-4">
              Contact
            </p>
            <ul className="space-y-2.5">
              <li>
                <a href="tel:0757717667" className="text-white/65 hover:text-primary transition text-sm">
                  075 - 77 17 667
                </a>
              </li>
              <li>
                <a href="tel:0622865768" className="text-white/65 hover:text-primary transition text-sm">
                  06 - 22 86 57 68
                </a>
              </li>
              <li>
                <a href="mailto:info@vink-elektrotechniek.nl" className="text-white/65 hover:text-primary transition text-sm break-all">
                  info@vink-elektrotechniek.nl
                </a>
              </li>
              <li className="text-white/65 text-sm">Harmoniehof 15, Zaandam</li>
            </ul>
          </div>
        </div>

        <div className="mt-14 pt-8 border-t border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping" />
              <span className="relative h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/60">
              Storingsdienst actief · dag & nacht bereikbaar
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-white/50 text-xs font-mono">
            <Link to="/privacy" className="hover:text-primary transition">
              Privacybeleid
            </Link>
            <Link to="/voorwaarden" className="hover:text-primary transition">
              Voorwaarden
            </Link>
            <span>© {new Date().getFullYear()} Vink Elektrotechniek</span>
          </div>
        </div>
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
    <div className="relative">
      <div className="noise-overlay" />
      <Navbar />
      <main>
        <Hero />
        <Features />
        <Pillars />
        <Protocol />
        <ServicesGrid />
        <TrustSignals />
        <ContactForm />
      </main>
      <Footer />
    </div>
  )
}
