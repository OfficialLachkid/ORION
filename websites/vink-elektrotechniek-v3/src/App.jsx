import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import {
  Zap,
  Phone,
  Mail,
  MapPin,
  ArrowRight,
  ArrowUpRight,
  Clock,
  Menu,
  X,
  ShieldCheck,
  Cable,
  Lightbulb,
  Bell,
  Network,
  ChevronRight,
  Sparkles,
  CircleDot,
} from "lucide-react";

/* ============================================================
 * Constants
 * ==========================================================*/
const BRAND = {
  name: "Vink Elektrotechniek",
  promise: "Vakwerk voor huis en bedrijf",
  city: "Zaandam",
  address: "Harmoniefhof 15, 1507 TX Zaandam",
  phone1: "075 771 7667",
  phone2: "06 2286 5768",
  email: "info@vink-elektrotechniek.nl",
  hours: "Ma – Vr · 07:30 – 17:30",
};

const HERO_IMG =
  "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=2000&q=80";
const SPLIT_IMG =
  "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=1600&q=80";

/* ============================================================
 * Hooks
 * ==========================================================*/
function useInView(threshold = 0.18) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.unobserve(entry.target);
        }
      },
      { threshold, rootMargin: "0px 0px -60px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, inView];
}

function useScrollProgress() {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const scrolled = h.scrollTop || document.body.scrollTop;
      const max = h.scrollHeight - h.clientHeight;
      setPct(max > 0 ? (scrolled / max) * 100 : 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return pct;
}

/* ============================================================
 * 1. Command Nav
 * ==========================================================*/
function CommandNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const pct = useScrollProgress();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const items = [
    { label: "Werk", href: "#showcase" },
    { label: "Specialisme", href: "#capability" },
    { label: "Proces", href: "#process" },
    { label: "Vertrouwen", href: "#trust" },
    { label: "Contact", href: "#contact" },
  ];

  return (
    <>
      <div className="progress-line" style={{ width: `${pct}%` }} />
      <nav
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
          scrolled
            ? "bg-[rgba(11,13,18,0.72)] backdrop-blur-xl border-b border-white/5"
            : "bg-transparent"
        }`}
      >
        <div className="max-w-[1400px] mx-auto px-6 md:px-10 flex items-center justify-between h-16 md:h-20">
          <a href="#top" className="flex items-center gap-3 group">
            <span className="w-8 h-8 rounded-lg bg-primary text-deep flex items-center justify-center shadow-[0_10px_30px_-10px_rgba(231,169,58,0.7)]">
              <Zap size={16} strokeWidth={2.6} />
            </span>
            <span className="display text-white text-[15px] font-semibold tracking-tightest">
              Vink <span className="text-primary">·</span> Elektrotechniek
            </span>
          </a>
          <div className="hidden md:flex items-center gap-1">
            {items.map((it) => (
              <a
                key={it.href}
                href={it.href}
                className="mono text-[11px] tracking-[0.22em] uppercase text-white/70 hover:text-white px-4 py-2 transition-colors"
              >
                {it.label}
              </a>
            ))}
          </div>
          <div className="hidden md:flex items-center gap-3">
            <a
              href={`tel:${BRAND.phone1.replace(/\s/g, "")}`}
              className="mono text-[11px] tracking-[0.22em] uppercase text-white/70 hover:text-white"
            >
              {BRAND.phone1}
            </a>
            <a href="#contact" className="btn-primary text-[13px] py-2.5 px-4">
              Offerte <ArrowRight size={14} />
            </a>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="md:hidden text-white p-2"
            aria-label="Menu"
          >
            <Menu size={22} />
          </button>
        </div>
      </nav>

      {/* Mobile drawer */}
      <div
        className={`fixed inset-0 z-[60] bg-deep transition-opacity duration-300 md:hidden ${
          open
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex items-center justify-between px-6 h-16">
          <span className="display text-white font-semibold">Menu</span>
          <button
            onClick={() => setOpen(false)}
            className="text-white p-2"
            aria-label="Sluiten"
          >
            <X size={22} />
          </button>
        </div>
        <div className="px-6 pt-6 space-y-2">
          {items.map((it) => (
            <a
              key={it.href}
              href={it.href}
              onClick={() => setOpen(false)}
              className="block display text-white text-3xl py-3 border-b border-white/10"
            >
              {it.label}
            </a>
          ))}
          <a
            href={`tel:${BRAND.phone1.replace(/\s/g, "")}`}
            className="block mono text-white/70 text-sm pt-8"
          >
            {BRAND.phone1}
          </a>
          <a
            href={`mailto:${BRAND.email}`}
            className="block mono text-white/70 text-sm mt-2"
          >
            {BRAND.email}
          </a>
        </div>
      </div>
    </>
  );
}

/* ============================================================
 * Signal-map (Circuit signature)
 * ==========================================================*/
function SignalMap({ compact = false }) {
  const dotRef = useRef(null);
  const pathRef = useRef(null);
  const [activeIdx, setActiveIdx] = useState(-1);

  const nodes = [
    { x: 40, y: 220, label: "Meterkast" },
    { x: 170, y: 220, label: "Groep" },
    { x: 170, y: 90, label: "Verdieping" },
    { x: 320, y: 90, label: "Verlichting" },
    { x: 320, y: 220, label: "Data" },
    { x: 480, y: 220, label: "Alarm" },
    { x: 560, y: 130, label: "Oplever" },
  ];

  useEffect(() => {
    const path = pathRef.current;
    const dot = dotRef.current;
    if (!path || !dot) return;
    const len = path.getTotalLength();

    const tick = (t) => {
      const p = path.getPointAtLength(((t % 3200) / 3200) * len);
      dot.setAttribute("cx", p.x);
      dot.setAttribute("cy", p.y);

      let best = -1;
      let bestDist = 60;
      nodes.forEach((n, i) => {
        const d = Math.hypot(n.x - p.x, n.y - p.y);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      setActiveIdx((prev) => (prev === best ? prev : best));
    };

    let raf;
    const start = performance.now();
    const loop = (now) => {
      tick(now - start);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`relative w-full ${
        compact ? "aspect-[16/6]" : "aspect-[16/9]"
      }`}
    >
      <svg
        viewBox="0 0 620 320"
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="grd" x1="0" x2="1">
            <stop offset="0" stopColor="#E7A93A" stopOpacity="0.9" />
            <stop offset="1" stopColor="#7DD3FC" stopOpacity="0.9" />
          </linearGradient>
          <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
        </defs>

        {Array.from({ length: 12 }).map((_, r) =>
          Array.from({ length: 24 }).map((_, c) => (
            <circle
              key={`${r}-${c}`}
              cx={20 + c * 26}
              cy={20 + r * 26}
              r="0.9"
              fill="#E7A93A"
              opacity="0.16"
            />
          ))
        )}

        <path
          d="M 40 220 L 170 220 L 170 90 L 320 90 L 320 220 L 480 220 L 560 130"
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="2"
          strokeLinecap="square"
        />

        <path
          ref={pathRef}
          className="route-active"
          d="M 40 220 L 170 220 L 170 90 L 320 90 L 320 220 L 480 220 L 560 130"
          fill="none"
          stroke="url(#grd)"
          strokeWidth="2.4"
          strokeLinecap="square"
        />

        {nodes.map((n, i) => {
          const isActive = i === activeIdx;
          return (
            <g key={i}>
              <circle
                cx={n.x}
                cy={n.y}
                r={isActive ? 8 : 5}
                fill={isActive ? "#E7A93A" : "#0B0D12"}
                stroke="#E7A93A"
                strokeWidth="1.6"
                className={`node-glow ${isActive ? "active" : ""}`}
              />
              <text
                x={n.x}
                y={n.y - 16}
                fill={isActive ? "#F7F5F0" : "rgba(247,245,240,0.55)"}
                fontSize="10"
                textAnchor="middle"
                fontFamily="IBM Plex Mono"
                letterSpacing="1.2"
              >
                {n.label.toUpperCase()}
              </text>
            </g>
          );
        })}

        <circle
          ref={dotRef}
          cx="40"
          cy="220"
          r="4.5"
          fill="#FFD37A"
          className="pulse-dot"
          filter="url(#soft)"
        />

        <text
          x="20"
          y="300"
          fill="rgba(247,245,240,0.42)"
          fontSize="9"
          fontFamily="IBM Plex Mono"
          letterSpacing="2"
        >
          ╱ CIRCUIT MAP · GROEP 1 → OPLEVERING
        </text>
      </svg>
    </div>
  );
}

/* ============================================================
 * 2. Scene Hero
 * ==========================================================*/
function SceneHero() {
  const heroRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(".hero-stagger > *", {
        y: 26,
        opacity: 0,
        stagger: 0.09,
        duration: 1.1,
        ease: "power3.out",
        delay: 0.15,
      });
      gsap.from(".signal-shell", {
        y: 40,
        opacity: 0,
        duration: 1.4,
        ease: "power3.out",
        delay: 0.6,
      });
    }, heroRef);
    return () => ctx.revert();
  }, []);

  return (
    <section
      id="top"
      ref={heroRef}
      className="relative min-h-screen flex flex-col justify-between overflow-hidden bg-deep noise"
    >
      <div className="absolute inset-0">
        <img
          src={HERO_IMG}
          alt=""
          className="w-full h-full object-cover opacity-30"
          loading="eager"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-deep/40 via-deep/70 to-deep" />
        <div className="absolute inset-0 grid-lines opacity-70" />
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[400px] rounded-full bg-primary/20 blur-[120px]" />
      </div>

      <div className="relative z-10 pt-32 md:pt-40 px-6 md:px-10">
        <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16 items-start">
          <div className="lg:col-span-7 hero-stagger">
            <div className="flex items-center gap-3 mb-6">
              <span className="mono text-[11px] tracking-[0.22em] uppercase text-primary">
                ╱ Vol. 26 · Editie IV
              </span>
              <span className="hidden md:block w-8 h-px bg-white/20" />
              <span className="hidden md:block mono text-[11px] tracking-[0.22em] uppercase text-white/50">
                Zaandam · sinds 1997
              </span>
            </div>

            <h1 className="display display-xl text-white text-[64px] md:text-[92px] lg:text-[108px] leading-[0.94] font-semibold tracking-tightest mb-8">
              Stroom die
              <br />
              <span className="italic font-normal text-primary">stil</span>{" "}
              werkt.
              <br />
              Vakwerk dat{" "}
              <span className="italic font-normal text-white/70">
                blijft.
              </span>
            </h1>

            <p className="text-white/70 text-lg md:text-xl leading-relaxed max-w-xl mb-10">
              Gespecialiseerd in utiliteitsbouw, renovatie en service —
              van meterkast tot laatste stopcontact. Persoonlijk gesprek,
              opmaat offerte, nette oplevering. Zonder ruis.
            </p>

            <div className="flex flex-wrap gap-3 mb-10">
              <span className="chip">
                <CircleDot size={12} className="text-primary" /> NEN 1010
              </span>
              <span className="chip">
                <ShieldCheck size={12} className="text-primary" /> Erkend leerbedrijf · Kenteq
              </span>
              <span className="chip">
                <Clock size={12} className="text-primary" /> 27 jaar in Zaandam
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <a href="#contact" className="btn-primary">
                Vraag offerte aan <ArrowRight size={16} />
              </a>
              <a href="#capability" className="btn-ghost">
                Bekijk specialisme
              </a>
            </div>
          </div>

          <div className="lg:col-span-5 signal-shell">
            <div className="panel-dark p-4 md:p-6 relative overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <span className="mono text-[10px] tracking-[0.22em] uppercase text-white/50">
                  ╱ Live circuit
                </span>
                <span className="mono text-[10px] tracking-[0.22em] uppercase text-primary flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  actief
                </span>
              </div>
              <SignalMap />
              <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-white/10">
                {[
                  { k: "23A", l: "Groep" },
                  { k: "230V", l: "Fase" },
                  { k: "50Hz", l: "Stabiel" },
                ].map((s) => (
                  <div key={s.k}>
                    <div className="display text-white text-2xl font-semibold">
                      {s.k}
                    </div>
                    <div className="mono text-[10px] tracking-[0.22em] uppercase text-white/50 mt-1">
                      {s.l}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-10 pb-8 md:pb-12 px-6 md:px-10">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between">
          <span className="mono text-[10px] tracking-[0.22em] uppercase text-white/40">
            ╱ scroll om verder te lezen
          </span>
          <div className="w-16 h-px bg-white/30 relative overflow-hidden">
            <div
              className="absolute inset-y-0 bg-primary"
              style={{
                width: "40%",
                animation: "marquee 3.6s linear infinite",
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * 3. Proof Ribbon
 * ==========================================================*/
function ProofRibbon() {
  const items = [
    "27 JAAR IN ZAANDAM",
    "NEN 1010 KEURING",
    "ERKEND LEERBEDRIJF",
    "SERVICE & ONDERHOUD",
    "BEDRIJF & PARTICULIER",
    "OPMAAT OFFERTE",
    "230/400V INSTALLATIES",
    "SNELLE STORINGSDIENST",
  ];
  const doubled = [...items, ...items];

  return (
    <section className="relative bg-deeper py-10 border-y border-white/5 overflow-hidden">
      <div className="marquee-track">
        {doubled.map((t, i) => (
          <div
            key={i}
            className="flex items-center gap-6 shrink-0 mono text-[11px] tracking-[0.28em] uppercase text-white/50"
          >
            <Sparkles size={12} className="text-primary" />
            {t}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ============================================================
 * 4. Perspective Split
 * ==========================================================*/
function PerspectiveSplit() {
  const [copyRef, copyIn] = useInView();
  const [imgRef, imgIn] = useInView();

  return (
    <section className="relative bg-bg py-24 md:py-36 px-6 md:px-10">
      <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div
          ref={copyRef}
          className="lg:col-span-6 lg:sticky lg:top-24 self-start"
        >
          <span className={`eyebrow fade-up ${copyIn ? "is-in" : ""}`}>
            ╱ 01 · Filosofie
          </span>
          <h2
            className={`display text-5xl md:text-6xl lg:text-7xl mt-6 mb-8 tracking-tightest leading-[0.98] fade-up ${
              copyIn ? "is-in" : ""
            }`}
            style={{ transitionDelay: "80ms" }}
          >
            Elk huis, elk pand,
            <br />
            <span className="italic font-normal text-muted">
              een eigen ritme.
            </span>
          </h2>
          <div
            className={`space-y-6 text-lg leading-relaxed text-muted fade-up ${
              copyIn ? "is-in" : ""
            }`}
            style={{ transitionDelay: "180ms" }}
          >
            <p>
              Wij beginnen niet met een offerte. Wij beginnen met een rustig
              gesprek. Wat wilt u werkelijk oplossen — een dwalende storing,
              een verbouwing, of een volledige renovatie van de installatie?
            </p>
            <p>
              Daarna volgt een opmaat voorstel. Duidelijk. Zonder onnodige
              regels. En daarna vakwerk — nette leidingen, strakke
              groepenkasten, gedocumenteerde oplevering.
            </p>
            <p className="text-ink font-medium">
              Zo werken wij al 27 jaar in Zaandam en omgeving.
            </p>
          </div>
          <div
            className={`mt-10 flex items-center gap-4 fade-up ${
              copyIn ? "is-in" : ""
            }`}
            style={{ transitionDelay: "260ms" }}
          >
            <a
              href="#contact"
              className="inline-flex items-center gap-2 text-ink font-semibold border-b border-primary pb-1 hover:gap-3 transition-all"
            >
              Plan een gesprek <ArrowUpRight size={16} />
            </a>
          </div>
        </div>

        <div ref={imgRef} className="lg:col-span-6 relative">
          <div className="grid grid-cols-6 gap-4">
            <div className={`col-span-6 up-mask ${imgIn ? "is-in" : ""}`}>
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl">
                <img
                  src={SPLIT_IMG}
                  alt="Vakmanschap in de meterkast"
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between text-white">
                  <span className="mono text-[10px] tracking-[0.22em] uppercase bg-black/40 backdrop-blur px-2 py-1">
                    Fig. 01 · Groepenkast · renovatie
                  </span>
                </div>
              </div>
            </div>
            <div
              className={`col-span-3 up-mask ${imgIn ? "is-in" : ""}`}
              style={{ transitionDelay: "160ms" }}
            >
              <div className="panel p-6 h-full">
                <span className="eyebrow">╱ Meterkast</span>
                <div className="display text-3xl font-semibold mt-2 mb-2">
                  1 dag
                </div>
                <p className="text-sm text-muted">
                  Gemiddelde ombouw meterkast, incl. NEN keuring.
                </p>
              </div>
            </div>
            <div
              className={`col-span-3 up-mask ${imgIn ? "is-in" : ""}`}
              style={{ transitionDelay: "260ms" }}
            >
              <div className="panel-dark p-6 h-full">
                <span
                  className="eyebrow"
                  style={{ color: "rgba(255,255,255,0.5)" }}
                >
                  ╱ Documentatie
                </span>
                <div className="display text-3xl font-semibold mt-2 mb-2 text-white">
                  100%
                </div>
                <p className="text-sm text-white/60">
                  Elk project met oplevercertificaat en groepenschema.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * 5. Capability Stack
 * ==========================================================*/
function CapabilityStack() {
  const [active, setActive] = useState(0);
  const [ref, inView] = useInView();

  const chapters = [
    {
      Icon: Cable,
      label: "Elektra & groepenkasten",
      copy: "Leveren en plaatsen van groepenkasten, aardlekautomaten, en volledige elektra-aanleg. Gecertificeerd volgens NEN 1010.",
      bullets: [
        "Groepenkasten",
        "Aardlekautomaten",
        "Krachtstroom",
        "Meterkast renovatie",
      ],
    },
    {
      Icon: Lightbulb,
      label: "Verlichting binnen & buiten",
      copy: "Van sfeerverlichting in de woonkamer tot tuin- en gevelverlichting. Dimbaar, geïntegreerd, energiezuinig.",
      bullets: [
        "Inbouw & spots",
        "Tuinverlichting",
        "Gevel & terras",
        "Smart lighting",
      ],
    },
    {
      Icon: Bell,
      label: "Alarm, brandmeld & beveiliging",
      copy: "Bekabelde en draadloze alarminstallaties, brandmelders en videofoons. Voor woning en bedrijfspand.",
      bullets: [
        "Alarminstallaties",
        "Brandmelders",
        "Camera's",
        "Toegang & videofoon",
      ],
    },
    {
      Icon: Network,
      label: "Data, netwerk & keuken",
      copy: "Bekabelde datanetwerken, patchkasten, en installatie van keukenapparatuur — alles nette afwerking.",
      bullets: [
        "CAT6 bekabeling",
        "Patchkasten",
        "Wifi punten",
        "Keukenapparatuur",
      ],
    },
  ];

  return (
    <section
      id="capability"
      ref={ref}
      className="relative bg-deep text-white py-24 md:py-36 px-6 md:px-10 overflow-hidden"
    >
      <div className="absolute inset-0 grid-lines opacity-40" />
      <div className="absolute top-40 -right-40 w-[600px] h-[600px] rounded-full bg-primary/15 blur-[140px]" />

      <div className="relative max-w-[1400px] mx-auto">
        <div className={`fade-up ${inView ? "is-in" : ""}`}>
          <span className="mono text-[11px] tracking-[0.22em] uppercase text-primary">
            ╱ 02 · Specialisme
          </span>
          <h2 className="display text-5xl md:text-6xl lg:text-7xl mt-6 mb-4 tracking-tightest leading-[0.98]">
            Vier disciplines,
            <br />
            <span className="italic font-normal text-white/60">
              een vakman.
            </span>
          </h2>
          <p className="text-white/60 text-lg max-w-2xl mb-16">
            Elke opdracht past in een van deze vier hoofdstukken. Klik om te
            openen — of neem gewoon contact op als u niet zeker weet waar uw
            wens hoort.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-5 space-y-3">
            {chapters.map((c, i) => {
              const isActive = i === active;
              const Icon = c.Icon;
              return (
                <button
                  key={i}
                  onClick={() => setActive(i)}
                  className={`w-full text-left flex items-start gap-4 p-6 rounded-xl border transition-all duration-500 ${
                    isActive
                      ? "bg-white/[0.04] border-primary/60 shadow-[0_20px_60px_-30px_rgba(231,169,58,0.5)]"
                      : "bg-transparent border-white/10 hover:border-white/25"
                  }`}
                >
                  <span
                    className={`shrink-0 w-11 h-11 rounded-lg flex items-center justify-center transition-colors ${
                      isActive
                        ? "bg-primary text-deep"
                        : "bg-white/[0.06] text-white/70"
                    }`}
                  >
                    <Icon size={18} strokeWidth={2.2} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="mono text-[10px] tracking-[0.22em] uppercase text-white/40 block">
                      Hoofdstuk 0{i + 1}
                    </span>
                    <span className="display text-xl md:text-2xl font-semibold text-white block mt-1">
                      {c.label}
                    </span>
                  </span>
                  <ChevronRight
                    size={18}
                    className={`shrink-0 mt-2 transition-transform ${
                      isActive ? "rotate-90 text-primary" : "text-white/30"
                    }`}
                  />
                </button>
              );
            })}
          </div>

          <div className="lg:col-span-7 lg:pl-8">
            <div
              key={active}
              className="panel-dark p-8 md:p-10 relative overflow-hidden"
              style={{ animation: "fadeUp .5s ease" }}
            >
              <div
                className="absolute top-0 left-0 h-1 bg-primary transition-all duration-700"
                style={{
                  width: `${((active + 1) / chapters.length) * 100}%`,
                }}
              />
              <div className="mono text-[10px] tracking-[0.22em] uppercase text-primary mb-4">
                ╱ Actief hoofdstuk · 0{active + 1} / 0{chapters.length}
              </div>
              <h3 className="display text-3xl md:text-4xl font-semibold text-white mb-6 leading-tight">
                {chapters[active].label}
              </h3>
              <p className="text-white/70 text-lg leading-relaxed mb-8">
                {chapters[active].copy}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {chapters[active].bullets.map((b) => (
                  <div
                    key={b}
                    className="flex items-center gap-3 p-3 border border-white/10 rounded-lg bg-white/[0.02]"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                    <span className="text-sm text-white/85">{b}</span>
                  </div>
                ))}
              </div>
              <div className="mt-8 pt-6 border-t border-white/10 flex items-center justify-between">
                <span className="mono text-[10px] tracking-[0.22em] uppercase text-white/40">
                  Vraag naar deze dienst
                </span>
                <a
                  href="#contact"
                  className="inline-flex items-center gap-2 text-primary font-medium hover:gap-3 transition-all"
                >
                  Offerte aanvragen <ArrowUpRight size={16} />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(12px);} to { opacity: 1; transform: translateY(0);} }
      `}</style>
    </section>
  );
}

/* ============================================================
 * 6. Showcase Frames
 * ==========================================================*/
function ShowcaseFrames() {
  const [ref, inView] = useInView();

  const items = [
    {
      tag: "Utiliteit · Getsewoud",
      title: "Complete elektra voor nieuw bedrijfspand",
      summary:
        "Aanleg van hoofdverdeling, subgroepen, data en verlichting voor een utilitair pand — inclusief buitenverlichting en camera-infrastructuur.",
      metric: "1200m²",
      metricLabel: "totaal aangelegd",
      img: "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1400&q=80",
    },
    {
      tag: "Renovatie · Woonhuis",
      title: "Groepenkast vervangen, alles gedocumenteerd",
      summary:
        "Oude installatie vervangen door moderne groepenkast met aardlekautomaten. Volledig groepenschema en oplevercertificaat.",
      metric: "1 dag",
      metricLabel: "van storing tot oplevering",
      img: "https://images.unsplash.com/photo-1585909695284-32d2985ac9c0?auto=format&fit=crop&w=1400&q=80",
    },
    {
      tag: "Particulier · Tuin",
      title: "Sfeerverlichting die de tuin ademt",
      summary:
        "Waterdichte grondspots, dimbaar tuinlicht en gevelverlichting — bediend met één schakelaar of app.",
      metric: "24 punten",
      metricLabel: "geïntegreerd geplaatst",
      img: "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1400&q=80",
    },
  ];

  return (
    <section
      id="showcase"
      ref={ref}
      className="relative bg-bg py-24 md:py-36 px-6 md:px-10"
    >
      <div className="max-w-[1400px] mx-auto">
        <div
          className={`flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-16 fade-up ${
            inView ? "is-in" : ""
          }`}
        >
          <div>
            <span className="mono text-[11px] tracking-[0.22em] uppercase text-muted">
              ╱ 03 · Werk uit de praktijk
            </span>
            <h2 className="display text-5xl md:text-6xl mt-6 tracking-tightest leading-[0.98]">
              Drie projecten,
              <br />
              <span className="italic font-normal text-muted">
                een aanpak.
              </span>
            </h2>
          </div>
          <a
            href="#contact"
            className="inline-flex items-center gap-2 mono text-[11px] tracking-[0.22em] uppercase text-ink border-b border-primary pb-1 hover:gap-3 transition-all self-start md:self-end"
          >
            Zie meer op aanvraag <ArrowUpRight size={14} />
          </a>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          {items.map((it, i) => (
            <div
              key={i}
              className={`up-mask ${inView ? "is-in" : ""}`}
              style={{ transitionDelay: `${i * 140}ms` }}
            >
              <div className="showcase-frame group cursor-default">
                <div className="showcase-chrome">
                  <span />
                  <span />
                  <span />
                  <span className="ml-auto mono text-[10px] text-white/40 tracking-[0.18em] uppercase">
                    {it.tag}
                  </span>
                </div>
                <div className="relative aspect-[4/3] overflow-hidden">
                  <img
                    src={it.img}
                    alt={it.title}
                    className="w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-deep via-deep/30 to-transparent" />
                  <div className="absolute bottom-4 left-4 right-4 text-white">
                    <div className="display text-2xl md:text-[26px] font-semibold leading-tight mb-2">
                      {it.title}
                    </div>
                  </div>
                </div>
                <div className="p-6 text-white/80">
                  <p className="text-sm leading-relaxed mb-6">{it.summary}</p>
                  <div className="flex items-end justify-between pt-4 border-t border-white/10">
                    <div>
                      <div className="display text-primary text-3xl font-semibold">
                        {it.metric}
                      </div>
                      <div className="mono text-[10px] tracking-[0.22em] uppercase text-white/40 mt-1">
                        {it.metricLabel}
                      </div>
                    </div>
                    <ArrowUpRight
                      size={20}
                      className="text-white/40 group-hover:text-primary transition-colors"
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * 7. Process Timeline
 * ==========================================================*/
function ProcessTimeline() {
  const [ref, inView] = useInView(0.2);
  const steps = [
    {
      no: "01",
      title: "Rustig gesprek",
      copy: "Wij komen langs, luisteren, kijken. Geen verkooppraatje — alleen begrip van wat u wilt.",
    },
    {
      no: "02",
      title: "Opmaat offerte",
      copy: "Duidelijk voorstel, uitgesplitst per onderdeel. Geen verrassingen achteraf.",
    },
    {
      no: "03",
      title: "Vakwerk uitvoeren",
      copy: "Nette werkwijze, opgeruimd achterlaten, tussentijds contact zoals afgesproken.",
    },
    {
      no: "04",
      title: "Nette oplevering",
      copy: "Groepenschema, NEN keuring en documentatie. Klaar om jaren mee te gaan.",
    },
  ];

  return (
    <section
      id="process"
      ref={ref}
      className="relative bg-panel py-24 md:py-36 px-6 md:px-10 overflow-hidden"
    >
      <div className="max-w-[1400px] mx-auto">
        <div
          className={`fade-up ${inView ? "is-in" : ""} max-w-2xl mb-16`}
        >
          <span className="eyebrow">╱ 04 · Werkwijze</span>
          <h2 className="display text-5xl md:text-6xl mt-6 mb-4 tracking-tightest leading-[0.98]">
            Vier stappen,
            <br />
            <span className="italic font-normal text-muted">
              zonder ruis.
            </span>
          </h2>
          <p className="text-muted text-lg">
            De weg van uw eerste telefoontje tot een gedocumenteerde
            oplevering — helder en persoonlijk.
          </p>
        </div>

        <div className="relative">
          <svg
            className="hidden lg:block absolute top-8 left-0 right-0 h-4 w-full"
            viewBox="0 0 1200 20"
            preserveAspectRatio="none"
          >
            <line
              x1="0"
              y1="10"
              x2="1200"
              y2="10"
              stroke="var(--line)"
              strokeWidth="2"
            />
            <line
              x1="0"
              y1="10"
              x2="1200"
              y2="10"
              stroke="var(--primary)"
              strokeWidth="2"
              className={`step-line ${inView ? "is-in" : ""}`}
            />
          </svg>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
            {steps.map((s, i) => (
              <div
                key={s.no}
                className={`fade-up ${inView ? "is-in" : ""} relative`}
                style={{ transitionDelay: `${i * 180}ms` }}
              >
                <div className="hidden lg:flex items-center justify-center w-4 h-4 rounded-full bg-bg border-2 border-primary relative -top-4 mb-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                </div>
                <div className="mono text-[10px] tracking-[0.22em] uppercase text-primary mb-3">
                  Stap {s.no}
                </div>
                <div className="display text-2xl md:text-[26px] font-semibold text-ink mb-3 leading-tight">
                  {s.title}
                </div>
                <p className="text-muted text-sm leading-relaxed">{s.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * 8. Trust Matrix
 * ==========================================================*/
function TrustMatrix() {
  const [ref, inView] = useInView();

  const matrix = [
    { k: "27 jr", l: "Vakervaring in Zaandam" },
    { k: "NEN 1010", l: "Werken volgens norm" },
    { k: "Kenteq", l: "Erkend leerbedrijf" },
    { k: "24u", l: "Reactie storingsdienst" },
    { k: "100%", l: "Opgeleverd met documentatie" },
    { k: "Opmaat", l: "Elke offerte, elk pand" },
  ];

  return (
    <section
      id="trust"
      ref={ref}
      className="relative bg-bg py-24 md:py-36 px-6 md:px-10"
    >
      <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className={`lg:col-span-5 fade-up ${inView ? "is-in" : ""}`}>
          <span className="eyebrow">╱ 05 · Vertrouwen</span>
          <h2 className="display text-5xl md:text-6xl mt-6 mb-8 tracking-tightest leading-[0.98]">
            Wat er
            <br />
            <span className="italic font-normal text-muted">
              onder afwerking
            </span>{" "}
            zit.
          </h2>

          <blockquote className="panel p-8 relative">
            <span
              className="display text-6xl text-primary leading-none absolute -top-2 left-6"
              aria-hidden
            >
              &ldquo;
            </span>
            <p className="text-lg italic text-ink leading-relaxed pl-6 mb-6">
              Vink kwam langs, luisterde, en loste in één dag op wat drie
              andere partijen niet konden. Nette groepenkast, papieren op
              orde, alles werkt.
            </p>
            <div className="pl-6 flex items-center gap-3 mono text-[11px] tracking-[0.22em] uppercase text-muted">
              <span className="w-6 h-px bg-primary" /> Familie de Vries · Zaandam
            </div>
          </blockquote>
        </div>

        <div className="lg:col-span-7 grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
          {matrix.map((m, i) => (
            <div
              key={m.k}
              className={`panel p-6 fade-up ${inView ? "is-in" : ""}`}
              style={{ transitionDelay: `${i * 90}ms` }}
            >
              <div className="display text-3xl md:text-4xl font-semibold text-ink mb-2">
                {m.k}
              </div>
              <div className="mono text-[10px] tracking-[0.22em] uppercase text-muted leading-relaxed">
                {m.l}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * 9. Contact Dock + Footer
 * ==========================================================*/
function ContactDock() {
  return (
    <section
      id="contact"
      className="relative bg-deep text-white py-24 md:py-36 px-6 md:px-10 overflow-hidden noise"
    >
      <div className="absolute inset-0 grid-lines opacity-40" />
      <div className="absolute -top-40 right-0 w-[700px] h-[400px] rounded-full bg-primary/20 blur-[140px]" />

      <div className="relative max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-7">
          <span className="mono text-[11px] tracking-[0.22em] uppercase text-primary">
            ╱ 06 · Neem contact op
          </span>
          <h2 className="display text-5xl md:text-7xl mt-6 mb-8 tracking-tightest leading-[0.94]">
            Klaar voor
            <br />
            <span className="italic font-normal text-white/60">
              een rustig gesprek?
            </span>
          </h2>
          <p className="text-white/70 text-lg max-w-xl mb-10">
            Bel, mail of loop binnen. Wij plannen een gratis kennismaking en
            komen langs voor een opmaat offerte.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mb-10">
            <a
              href={`tel:${BRAND.phone1.replace(/\s/g, "")}`}
              className="btn-primary justify-center"
            >
              <Phone size={16} /> Bel direct
            </a>
            <a
              href={`mailto:${BRAND.email}`}
              className="btn-ghost justify-center"
            >
              <Mail size={16} /> Stuur mail
            </a>
          </div>

          <div className="mt-4 signal-shell max-w-lg">
            <div className="panel-dark p-4">
              <SignalMap compact />
            </div>
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="panel-dark p-8 md:p-10">
            <h3 className="display text-2xl font-semibold text-white mb-6">
              Contactgegevens
            </h3>
            <div className="space-y-5">
              <ContactRow Icon={Phone} label="Telefoon">
                <a href={`tel:${BRAND.phone1.replace(/\s/g, "")}`}>
                  {BRAND.phone1}
                </a>
                <span className="text-white/40"> · </span>
                <a href={`tel:${BRAND.phone2.replace(/\s/g, "")}`}>
                  {BRAND.phone2}
                </a>
              </ContactRow>
              <ContactRow Icon={Mail} label="E-mail">
                <a href={`mailto:${BRAND.email}`} className="break-all">
                  {BRAND.email}
                </a>
              </ContactRow>
              <ContactRow Icon={MapPin} label="Adres">
                {BRAND.address}
              </ContactRow>
              <ContactRow Icon={Clock} label="Openingstijden">
                {BRAND.hours}
              </ContactRow>
            </div>

            <div className="mt-8 pt-6 border-t border-white/10">
              <div className="mono text-[10px] tracking-[0.22em] uppercase text-white/40 mb-3">
                ╱ Werkgebied
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  "Zaandam",
                  "Wormerveer",
                  "Koog aan de Zaan",
                  "Amsterdam-Noord",
                  "Purmerend",
                  "Assendelft",
                ].map((c) => (
                  <span
                    key={c}
                    className="mono text-[10px] tracking-[0.18em] uppercase px-2.5 py-1 border border-white/15 rounded-full text-white/70"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ContactRow({ Icon, label, children }) {
  return (
    <div className="flex items-start gap-4">
      <span className="shrink-0 w-9 h-9 rounded-lg bg-white/[0.06] flex items-center justify-center text-primary">
        <Icon size={16} strokeWidth={2.2} />
      </span>
      <div className="min-w-0">
        <div className="mono text-[10px] tracking-[0.22em] uppercase text-white/40 mb-1">
          {label}
        </div>
        <div className="text-white/90 text-base leading-snug">{children}</div>
      </div>
    </div>
  );
}

function ColophonFooter() {
  return (
    <footer className="bg-deeper text-white/60 py-14 px-6 md:px-10 border-t border-white/5">
      <div className="max-w-[1400px] mx-auto flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div>
          <div className="flex items-center gap-3 mb-4">
            <span className="w-7 h-7 rounded-md bg-primary text-deep flex items-center justify-center">
              <Zap size={14} strokeWidth={2.6} />
            </span>
            <span className="display text-white font-semibold text-sm">
              Vink Elektrotechniek
            </span>
          </div>
          <p className="text-sm max-w-md leading-relaxed">
            Cinematisch vakmanschap voor huis en bedrijf. Sinds 1997 in
            Zaandam en omgeving.
          </p>
        </div>
        <div className="flex flex-col md:items-end gap-3">
          <div className="flex gap-6 mono text-[10px] tracking-[0.22em] uppercase">
            <a
              href="#/privacy"
              className="hover:text-white transition-colors"
            >
              Privacy
            </a>
            <a
              href="#/terms"
              className="hover:text-white transition-colors"
            >
              Voorwaarden
            </a>
            <a href="#contact" className="hover:text-white transition-colors">
              Contact
            </a>
          </div>
          <div className="mono text-[10px] tracking-[0.22em] uppercase text-white/40">
            © {new Date().getFullYear()} Vink Elektrotechniek · KvK Zaandam
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ============================================================
 * App shell
 * ==========================================================*/
export default function App() {
  return (
    <div className="min-h-screen bg-bg text-ink font-body">
      <CommandNav />
      <main>
        <SceneHero />
        <ProofRibbon />
        <PerspectiveSplit />
        <CapabilityStack />
        <ShowcaseFrames />
        <ProcessTimeline />
        <TrustMatrix />
        <ContactDock />
      </main>
      <ColophonFooter />
    </div>
  );
}
