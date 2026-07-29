import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import {
  Bot,
  Workflow,
  PhoneCall,
  LayoutTemplate,
  Cpu,
  ArrowRight,
  ArrowUpRight,
  Menu,
  X,
  Zap,
  ChevronRight,
  Sparkles,
  Code2,
  MessageSquare,
  Mail,
  MapPin,
  Radio,
} from "lucide-react";

const BRAND = {
  name: "VBJ Services",
  byline: "Digital products · AI agents · Automation",
  city: "Amsterdam",
  email: "hello@vbjservices.com",
  hours: "Mon – Fri · 09:00 – 18:00",
  vault: "Vol. 26 · Edition IV",
};

const HERO_IMG =
  "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=2000&q=80";
const SPLIT_IMG =
  "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=1600&q=80";

function useInView(threshold = 0.2) {
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

function useCountUp(target, inView, duration = 1400) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setN(Math.floor(eased * target));
      if (t < 1) raf = requestAnimationFrame(tick);
      else setN(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, target, duration]);
  return n;
}

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
    { label: "Manifesto", href: "#manifesto" },
    { label: "Products", href: "#products" },
    { label: "Work", href: "#showcase" },
    { label: "Services", href: "#index" },
    { label: "Process", href: "#process" },
  ];

  return (
    <>
      <div className="progress-line" style={{ width: `${pct}%` }} />
      <nav
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
          scrolled
            ? "bg-[rgba(8,8,15,0.72)] backdrop-blur-xl border-b border-white/5"
            : "bg-transparent"
        }`}
      >
        <div className="max-w-[1400px] mx-auto px-6 md:px-10 flex items-center justify-between h-16 md:h-20">
          <a href="#top" className="flex items-center gap-3 group">
            <span className="w-8 h-8 rounded-lg bg-primary text-ink flex items-center justify-center shadow-glow">
              <Zap size={16} strokeWidth={2.6} />
            </span>
            <span className="font-display text-white text-[15px] font-semibold tracking-tightest">
              VBJ <span className="text-primary">·</span> Services
            </span>
          </a>
          <div className="hidden md:flex items-center gap-1">
            {items.map((it) => (
              <a
                key={it.href}
                href={it.href}
                className="font-mono text-[11px] tracking-[0.22em] uppercase text-white/70 hover:text-white px-4 py-2 transition-colors"
              >
                {it.label}
              </a>
            ))}
          </div>
          <div className="hidden md:flex items-center gap-3">
            <a href="#contact" className="btn-primary text-[13px] py-2.5 px-4">
              Book a call <ArrowRight size={14} />
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

      <div
        className={`fixed inset-0 z-[60] bg-deep transition-opacity duration-300 md:hidden ${
          open
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex items-center justify-between px-6 h-16">
          <span className="font-display text-white font-semibold">Menu</span>
          <button
            onClick={() => setOpen(false)}
            className="text-white p-2"
            aria-label="Close"
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
              className="block font-serif italic text-white text-4xl py-3 border-b border-white/10"
            >
              {it.label}
            </a>
          ))}
          <a
            href="#contact"
            onClick={() => setOpen(false)}
            className="btn-primary mt-8 justify-center"
          >
            Book a call <ArrowRight size={14} />
          </a>
        </div>
      </div>
    </>
  );
}

function SignalMap() {
  const dotRef = useRef(null);
  const pathRef = useRef(null);
  const [activeIdx, setActiveIdx] = useState(-1);

  const nodes = useMemo(
    () => [
      { x: 40, y: 220, label: "Intake" },
      { x: 160, y: 220, label: "Design" },
      { x: 160, y: 90, label: "Agent" },
      { x: 320, y: 90, label: "Deploy" },
      { x: 320, y: 220, label: "Learn" },
      { x: 480, y: 220, label: "Iterate" },
      { x: 560, y: 130, label: "Ship" },
    ],
    []
  );

  useEffect(() => {
    const path = pathRef.current;
    const dot = dotRef.current;
    if (!path || !dot) return;
    const len = path.getTotalLength();
    let raf;
    const start = performance.now();
    const loop = (now) => {
      const t = ((now - start) % 3400) / 3400;
      const p = path.getPointAtLength(t * len);
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
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [nodes]);

  return (
    <div className="relative w-full aspect-[16/9]">
      <svg
        viewBox="0 0 620 320"
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="grdVBJ" x1="0" x2="1">
            <stop offset="0" stopColor="#818CF8" stopOpacity="0.95" />
            <stop offset="1" stopColor="#6EE7B7" stopOpacity="0.95" />
          </linearGradient>
          <filter id="softVBJ" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.4" />
          </filter>
        </defs>

        {Array.from({ length: 12 }).map((_, r) =>
          Array.from({ length: 24 }).map((_, c) => (
            <circle
              key={`${r}-${c}`}
              cx={20 + c * 26}
              cy={20 + r * 26}
              r="0.9"
              fill="#818CF8"
              opacity="0.14"
            />
          ))
        )}

        <path
          d="M 40 220 L 160 220 L 160 90 L 320 90 L 320 220 L 480 220 L 560 130"
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="2"
          strokeLinecap="round"
        />

        <path
          ref={pathRef}
          className="route-active"
          d="M 40 220 L 160 220 L 160 90 L 320 90 L 320 220 L 480 220 L 560 130"
          fill="none"
          stroke="url(#grdVBJ)"
          strokeWidth="2.4"
          strokeLinecap="round"
        />

        {nodes.map((n, i) => {
          const isActive = i === activeIdx;
          return (
            <g key={i}>
              <circle
                cx={n.x}
                cy={n.y}
                r={isActive ? 8 : 5}
                fill={isActive ? "#818CF8" : "#0A0A12"}
                stroke="#818CF8"
                strokeWidth="1.6"
                className={`node-glow ${isActive ? "active" : ""}`}
              />
              <text
                x={n.x}
                y={n.y - 16}
                fill={isActive ? "#F7F5F0" : "rgba(247,245,240,0.55)"}
                fontSize="10"
                textAnchor="middle"
                fontFamily="JetBrains Mono"
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
          fill="#A5B4FC"
          className="pulse-dot"
          filter="url(#softVBJ)"
        />

        <text
          x="20"
          y="300"
          fill="rgba(247,245,240,0.42)"
          fontSize="9"
          fontFamily="JetBrains Mono"
          letterSpacing="2"
        >
          ╱ AGENT LOOP · INTAKE → SHIP
        </text>
      </svg>
    </div>
  );
}

const FLAP_STATES = [
  [
    { label: "Vol", value: "26 · IV" },
    { label: "Section", value: "AGENTS" },
    { label: "Shipping", value: "CHATBOT v2" },
    { label: "Status", value: "OPEN BRIEFS" },
  ],
  [
    { label: "Vol", value: "26 · IV" },
    { label: "Section", value: "WEB" },
    { label: "Shipping", value: "TEMPLATE 03" },
    { label: "Status", value: "2 SLOTS" },
  ],
  [
    { label: "Vol", value: "26 · IV" },
    { label: "Section", value: "VOICE" },
    { label: "Shipping", value: "VAPI ALPHA" },
    { label: "Status", value: "PILOTING" },
  ],
  [
    { label: "Vol", value: "26 · IV" },
    { label: "Section", value: "N8N" },
    { label: "Shipping", value: "SELF-HOST" },
    { label: "Status", value: "AVAILABLE" },
  ],
];

function FlapChar({ char, flipping }) {
  return (
    <span className={`flap-char ${flipping ? "flipping" : ""}`}>{char}</span>
  );
}

function SplitFlap() {
  const [idx, setIdx] = useState(0);
  const [flipCol, setFlipCol] = useState(-1);

  useEffect(() => {
    let t;
    const cycle = () => {
      const nextIdx = (idx + 1) % FLAP_STATES.length;
      const cols = FLAP_STATES[idx]
        .map((c, i) =>
          c.value !== FLAP_STATES[nextIdx][i].value ? i : -1
        )
        .filter((i) => i >= 0);
      const col = cols.length
        ? cols[Math.floor(Math.random() * cols.length)]
        : Math.floor(Math.random() * 4);
      setFlipCol(col);
      t = setTimeout(() => {
        setIdx(nextIdx);
        setFlipCol(-1);
      }, 380);
    };
    const interval = setInterval(cycle, 2300);
    return () => {
      clearInterval(interval);
      clearTimeout(t);
    };
  }, [idx]);

  const state = FLAP_STATES[idx];

  return (
    <div className="flap-row">
      {state.map((cell, i) => (
        <div key={i} className="flap-cell">
          <span className="flap-label">{cell.label}</span>
          <span className="flap-value">
            {cell.value.split("").map((ch, ci) => (
              <FlapChar
                key={`${i}-${ci}-${ch}`}
                char={ch === " " ? " " : ch}
                flipping={flipCol === i}
              />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function SceneHero() {
  const heroRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(".hero-stagger > *", {
        y: 28,
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
      gsap.from(".flap-shell", {
        y: 20,
        opacity: 0,
        duration: 1,
        ease: "power3.out",
        delay: 1.1,
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
          className="w-full h-full object-cover opacity-20"
          loading="eager"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-deep/40 via-deep/75 to-deep" />
        <div className="absolute inset-0 grid-lines opacity-70" />
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[400px] rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute top-1/3 right-0 w-[500px] h-[500px] rounded-full bg-accent/15 blur-[140px]" />
      </div>

      <div className="relative z-10 pt-32 md:pt-40 px-6 md:px-10">
        <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16 items-start">
          <div className="lg:col-span-7 hero-stagger">
            <div className="flex items-center gap-3 mb-6">
              <span className="font-mono text-[11px] tracking-[0.22em] uppercase text-primary">
                ╱ {BRAND.vault}
              </span>
              <span className="hidden md:block w-8 h-px bg-white/20" />
              <span className="hidden md:block font-mono text-[11px] tracking-[0.22em] uppercase text-white/50">
                {BRAND.byline}
              </span>
            </div>

            <h1 className="font-display display-xl text-white text-[64px] md:text-[92px] lg:text-[108px] leading-[0.94] font-semibold tracking-tightest mb-8">
              Digital tools that{" "}
              <span className="font-serif italic font-normal text-primary">
                keep working
              </span>
              <br />
              when you{" "}
              <span className="font-serif italic font-normal text-white/70">
                aren't looking.
              </span>
            </h1>

            <p className="text-white/70 text-lg md:text-xl leading-relaxed max-w-xl mb-10 font-body">
              We build websites, chatbots, voice agents and workflow
              automation — then wire them into an AI operating system that
              actually stays useful.
            </p>

            <div className="flex flex-wrap gap-3 mb-10">
              <span className="chip">
                <Bot size={12} className="text-primary" /> Chatbots
              </span>
              <span className="chip">
                <Workflow size={12} className="text-primary" /> n8n Automation
              </span>
              <span className="chip">
                <PhoneCall size={12} className="text-primary" /> Voice Agents
              </span>
              <span className="chip">
                <LayoutTemplate size={12} className="text-primary" /> Websites
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <a href="#contact" className="btn-primary">
                Start a project <ArrowRight size={16} />
              </a>
              <a href="#products" className="btn-ghost">
                See what we ship
              </a>
            </div>
          </div>

          <div className="lg:col-span-5 signal-shell">
            <div className="panel-dark p-4 md:p-6 relative overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-white/50">
                  ╱ Live agent loop
                </span>
                <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-accent flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                  active
                </span>
              </div>
              <SignalMap />
              <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-white/10">
                {[
                  { k: "4", l: "Products" },
                  { k: "n8n", l: "Runtime" },
                  { k: "24/7", l: "Uptime" },
                ].map((s) => (
                  <div key={s.k}>
                    <div className="font-display text-white text-2xl font-semibold">
                      {s.k}
                    </div>
                    <div className="font-mono text-[10px] tracking-[0.22em] uppercase text-white/50 mt-1">
                      {s.l}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto mt-12 md:mt-16 flap-shell">
          <div className="flex items-end justify-between mb-3">
            <span className="font-mono text-[10px] tracking-[0.24em] uppercase text-white/40">
              ╱ Masthead · Now shipping
            </span>
            <span className="hidden md:block font-serif italic text-white/50 text-base">
              a working masthead, not a static logo
            </span>
          </div>
          <SplitFlap />
        </div>
      </div>

      <div className="relative z-10 pb-8 md:pb-12 mt-8 px-6 md:px-10">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between">
          <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-white/40">
            ╱ scroll to continue
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

function MarqueeBand() {
  const items = [
    "WEBSITE CHATBOTS",
    "N8N AUTOMATION",
    "VOICE RECEPTIONISTS",
    "WEBSITE BUILDER",
    "AI AGENT INFRASTRUCTURE",
    "DASHBOARDS",
    "SELF-HOSTED",
    "MAC MINI CLUSTER",
    "LOCAL + CLOUD LLMS",
    "MODULAR STACK",
  ];
  const doubled = [...items, ...items];

  return (
    <section className="relative bg-deeper py-10 border-y border-white/5 overflow-hidden">
      <div className="marquee-track">
        {doubled.map((t, i) => (
          <div
            key={i}
            className="flex items-center gap-6 shrink-0 font-mono text-[11px] tracking-[0.28em] uppercase text-white/55"
          >
            <span className="text-primary">●</span>
            {t}
          </div>
        ))}
      </div>
    </section>
  );
}

function Manifesto() {
  const [ref, inView] = useInView(0.35);

  return (
    <section
      id="manifesto"
      ref={ref}
      className="relative bg-paper py-32 md:py-44 px-6 md:px-10 overflow-hidden"
    >
      <div className="absolute inset-0 grid-lines-light opacity-70" />
      <div className="relative max-w-[1200px] mx-auto text-center">
        <span className={`eyebrow fade-up ${inView ? "is-in" : ""}`}>
          ╱ 01 · Manifesto
        </span>
        <p
          className={`font-serif italic text-4xl md:text-6xl lg:text-7xl mt-8 leading-[1.1] tracking-tightest fade-up ${
            inView ? "is-in" : ""
          }`}
          style={{ transitionDelay: "120ms" }}
        >
          We don't ship demos. We ship{" "}
          <span
            className={`underline-draw not-italic font-display font-semibold text-ink ${
              inView ? "is-in" : ""
            }`}
            style={{ transitionDelay: "600ms" }}
          >
            coworkers
          </span>{" "}
          — small, specific pieces of software that keep doing the work 24/7.
        </p>
        <div
          className={`mt-10 fade-up ${inView ? "is-in" : ""}`}
          style={{ transitionDelay: "480ms" }}
        >
          <span className="font-mono text-[11px] tracking-[0.22em] uppercase text-muted">
            — VBJ operating principle
          </span>
        </div>
      </div>
    </section>
  );
}

const PRODUCTS = [
  {
    Icon: Bot,
    tag: "01 · Ready to sell",
    title: "Website Chatbot",
    copy: "Embedded chat widget wired to n8n and an LLM — answers repetitive questions, recommends products, and hands off to humans when it should.",
    stack: ["n8n", "OpenAI gpt-4o-mini", "Supabase", "Widget SDK"],
    accent: "#818CF8",
  },
  {
    Icon: Workflow,
    tag: "02 · Sellable w/ setup",
    title: "n8n Self-Hosted Automation",
    copy: "Own your automation stack. Docker-based n8n with Cloudflare Tunnel — no more recurring SaaS bill for workflows you could run yourself.",
    stack: ["Docker", "Cloudflare Tunnel", "PostgreSQL", "n8n"],
    accent: "#6EE7B7",
  },
  {
    Icon: PhoneCall,
    tag: "03 · Piloting",
    title: "Voice Receptionist",
    copy: "Dutch-speaking voice AI that answers calls, handles routine questions, and books appointments straight into your calendar via n8n.",
    stack: ["VAPI", "n8n", "Google Calendar", "Deepgram"],
    accent: "#F59E0B",
  },
  {
    Icon: LayoutTemplate,
    tag: "04 · Live",
    title: "Website Builder",
    copy: "Template-driven website delivery for small businesses. Fast turnaround, structured builder flow, publish/unpublish lifecycle.",
    stack: ["React", "Vite", "Supabase", "Tailwind"],
    accent: "#F472B6",
  },
  {
    Icon: Cpu,
    tag: "05 · Vision",
    title: "AI Agent Infrastructure",
    copy: "The operating system behind it all — a Mac mini orchestrator scaling into a local AI cluster. Agents that coordinate, remember, and keep working.",
    stack: ["Ruflo", "Claude Code", "Discord ops", "Obsidian vault"],
    accent: "#7DD3FC",
  },
];

function ProductStack() {
  const [active, setActive] = useState(0);
  const [ref, inView] = useInView(0.15);

  useEffect(() => {
    if (!inView) return;
    const int = setInterval(() => {
      setActive((a) => (a + 1) % PRODUCTS.length);
    }, 4500);
    return () => clearInterval(int);
  }, [inView]);

  return (
    <section
      id="products"
      ref={ref}
      className="relative bg-paper py-24 md:py-36 px-6 md:px-10"
    >
      <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-5 lg:sticky lg:top-24 self-start">
          <span className={`eyebrow fade-up ${inView ? "is-in" : ""}`}>
            ╱ 02 · The stack
          </span>
          <h2
            className={`font-display text-5xl md:text-6xl lg:text-7xl mt-6 mb-8 tracking-tightest leading-[0.98] fade-up ${
              inView ? "is-in" : ""
            }`}
            style={{ transitionDelay: "80ms" }}
          >
            What
            <br />
            <span className="font-serif italic font-normal text-muted">
              we offer.
            </span>
          </h2>
          <div
            className={`space-y-4 text-lg leading-relaxed text-muted fade-up ${
              inView ? "is-in" : ""
            }`}
            style={{ transitionDelay: "180ms" }}
          >
            <p>
              Each product stands alone — but they compound. A chatbot leads
              to workflow automation. Automation leads to voice. Voice leads
              to a full agent infrastructure. Same runtime underneath.
            </p>
          </div>

          <div className="mt-10 flex flex-wrap gap-2">
            {PRODUCTS.map((p, i) => (
              <button
                key={p.title}
                onClick={() => setActive(i)}
                className={`font-mono text-[10px] tracking-[0.22em] uppercase px-3 py-2 rounded-full border transition-all ${
                  i === active
                    ? "bg-ink text-paper border-ink"
                    : "bg-transparent text-muted border-line hover:border-ink hover:text-ink"
                }`}
              >
                {String(i + 1).padStart(2, "0")} · {p.title.split(" ")[0]}
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-7">
          <div className="stack-wrap relative" style={{ height: "560px" }}>
            {PRODUCTS.map((p, i) => {
              const offset = (i - active + PRODUCTS.length) % PRODUCTS.length;
              const isTop = offset === 0;
              const behind = offset > 0 && offset < 3;
              const Icon = p.Icon;
              return (
                <div
                  key={p.title}
                  className="stack-card"
                  style={{
                    transform: isTop
                      ? "translate3d(0,0,0) scale(1)"
                      : behind
                      ? `translate3d(0,${offset * 22}px,0) scale(${
                          1 - offset * 0.035
                        })`
                      : "translate3d(0,90px,0) scale(0.9)",
                    opacity: isTop ? 1 : behind ? 0.55 : 0,
                    filter: isTop ? "none" : "blur(0.6px)",
                    zIndex: PRODUCTS.length - offset,
                  }}
                >
                  <div className="panel-dark h-full flex flex-col justify-between p-8 md:p-10 relative overflow-hidden">
                    <div
                      className="absolute inset-0 opacity-70"
                      style={{
                        background: `radial-gradient(90% 60% at 90% 0%, ${p.accent}22, transparent 70%)`,
                      }}
                    />
                    <div className="relative">
                      <div className="mb-8">
                        <span
                          className="w-14 h-14 rounded-xl flex items-center justify-center"
                          style={{
                            background: `${p.accent}22`,
                            color: p.accent,
                          }}
                        >
                          <Icon size={22} strokeWidth={2.2} />
                        </span>
                      </div>
                      <h3 className="font-display text-4xl md:text-5xl font-semibold text-white leading-tight mb-6 tracking-tightest">
                        {p.title}
                      </h3>
                      <p className="text-white/70 text-lg leading-relaxed max-w-md">
                        {p.copy}
                      </p>
                    </div>

                    <div className="relative pt-8 mt-8 border-t border-white/10">
                      <div className="font-mono text-[10px] tracking-[0.22em] uppercase text-white/40 mb-3">
                        Stack
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {p.stack.map((s) => (
                          <span
                            key={s}
                            className="font-mono text-[11px] px-2.5 py-1 border border-white/15 rounded-full text-white/80"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-6 flex items-center justify-between">
            <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted">
              Card {String(active + 1).padStart(2, "0")} of{" "}
              {String(PRODUCTS.length).padStart(2, "0")}
            </span>
            <button
              onClick={() => setActive((a) => (a + 1) % PRODUCTS.length)}
              className="font-mono text-[10px] tracking-[0.22em] uppercase text-ink hover:text-primary transition-colors inline-flex items-center gap-2"
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ShowcaseFrames() {
  const [ref, inView] = useInView();

  const items = [
    {
      tag: "Chatbot · Zakkenspecialist",
      title: "Product-discovery bot on a live e-commerce site",
      summary:
        "Widget embedded on the Zakkenspecialist site — n8n routes visitor questions to gpt-4o-mini, returns structured JSON with up to three product recommendations.",
      metric: "3s",
      metricLabel: "median response",
      img: "https://images.unsplash.com/photo-1587560699334-cc4ff634909a?auto=format&fit=crop&w=1400&q=80",
    },
    {
      tag: "Website Builder · Domits",
      title: "Direct-booking website builder for hosts",
      summary:
        "Template selection, saved drafts, dedicated editor, publish/unpublish lifecycle. Per-property standalone published snapshots.",
      metric: "1 day",
      metricLabel: "template to published",
      img: "https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=1400&q=80",
    },
    {
      tag: "Infrastructure · Ruflo",
      title: "Mac-mini orchestrator running background agents",
      summary:
        "Ruflo + Claude Code + Discord ops surface. Agents keep working through token windows, memory persists across sessions, humans stay in the loop.",
      metric: "24/7",
      metricLabel: "orchestrator uptime",
      img: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1400&q=80",
    },
  ];

  return (
    <section
      id="showcase"
      ref={ref}
      className="relative bg-paperDark py-24 md:py-36 px-6 md:px-10"
    >
      <div className="max-w-[1400px] mx-auto">
        <div
          className={`flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-16 fade-up ${
            inView ? "is-in" : ""
          }`}
        >
          <div>
            <span className="font-mono text-[11px] tracking-[0.22em] uppercase text-muted">
              ╱ 03 · Work in the wild
            </span>
            <h2 className="font-display text-5xl md:text-6xl mt-6 tracking-tightest leading-[0.98]">
              Three shipped,
              <br />
              <span className="font-serif italic font-normal text-muted">
                one still running.
              </span>
            </h2>
          </div>
          <a
            href="#contact"
            className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.22em] uppercase text-ink border-b border-primary pb-1 hover:gap-3 transition-all self-start md:self-end"
          >
            Case studies on request <ArrowUpRight size={14} />
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
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                  <span className="ml-auto font-mono text-[10px] text-white/40 tracking-[0.18em] uppercase">
                    {it.tag}
                  </span>
                </div>
                <div className="relative aspect-[4/3] overflow-hidden">
                  <img
                    src={it.img}
                    alt={it.title}
                    className="w-full h-full object-cover opacity-85 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-deep via-deep/40 to-transparent" />
                  <div className="absolute bottom-4 left-4 right-4 text-white">
                    <div className="font-display text-2xl md:text-[26px] font-semibold leading-tight mb-2">
                      {it.title}
                    </div>
                  </div>
                </div>
                <div className="p-6 text-white/80">
                  <p className="text-sm leading-relaxed mb-6">{it.summary}</p>
                  <div className="flex items-end justify-between pt-4 border-t border-white/10">
                    <div>
                      <div className="font-display text-primary text-3xl font-semibold">
                        {it.metric}
                      </div>
                      <div className="font-mono text-[10px] tracking-[0.22em] uppercase text-white/40 mt-1">
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

function ServicesIndex() {
  const [ref, inView] = useInView();

  const rows = [
    {
      title: "Website chatbots",
      sub: "n8n + LLM, embedded, learns your catalogue.",
      note: "Ready to sell",
    },
    {
      title: "Voice receptionists",
      sub: "Dutch-first VAPI agents that book straight into your calendar.",
      note: "Piloting",
    },
    {
      title: "n8n self-hosted setup",
      sub: "Docker + Cloudflare Tunnel — you own the runtime.",
      note: "Available",
    },
    {
      title: "Custom websites",
      sub: "React/Vite marketing sites and template-driven builders.",
      note: "Live",
    },
    {
      title: "AI-agent infrastructure",
      sub: "Mac-mini orchestrator, memory that persists, Discord ops surface.",
      note: "Vision",
    },
    {
      title: "Prototypes & automation",
      sub: "Fast, scoped experiments — usually a week, sometimes a weekend.",
      note: "Always",
    },
  ];

  return (
    <section
      id="index"
      ref={ref}
      className="relative bg-paper py-24 md:py-36 px-6 md:px-10"
    >
      <div className="max-w-[1200px] mx-auto">
        <div className={`fade-up ${inView ? "is-in" : ""} mb-14 max-w-2xl`}>
          <span className="eyebrow">╱ 04 · Index of services</span>
          <h2 className="font-display text-5xl md:text-6xl lg:text-7xl mt-6 mb-4 tracking-tightest leading-[0.98]">
            An
            <br />
            <span className="font-serif italic font-normal text-muted">
              opinionated
            </span>{" "}
            list.
          </h2>
          <p className="text-muted text-lg">
            If your problem is in this list, we have a shape for it. If it's
            not — bring it anyway; new shapes are how the list grows.
          </p>
        </div>

        <div className="hairline" />
        {rows.map((r, i) => (
          <div
            key={r.title}
            className={`index-row fade-up ${inView ? "is-in" : ""}`}
            style={{ transitionDelay: `${i * 80}ms` }}
          >
            <span className="font-serif text-3xl md:text-5xl italic text-primary">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span>
              <span className="idx-title font-display text-2xl md:text-3xl font-semibold tracking-tightest">
                {r.title}
              </span>
              <br />
              <span className="font-serif italic text-muted text-lg mt-1 inline-block">
                {r.sub}
              </span>
            </span>
            <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted whitespace-nowrap">
              {r.note}
              <ChevronRight
                size={12}
                className="inline-block ml-1.5 -mt-0.5"
              />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function PerspectiveSplit() {
  const [copyRef, copyIn] = useInView();
  const [imgRef, imgIn] = useInView();

  return (
    <section className="relative bg-paperDark py-24 md:py-36 px-6 md:px-10">
      <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div
          ref={copyRef}
          className="lg:col-span-6 lg:sticky lg:top-24 self-start"
        >
          <span className={`eyebrow fade-up ${copyIn ? "is-in" : ""}`}>
            ╱ 05 · How we build
          </span>
          <h2
            className={`font-display text-5xl md:text-6xl lg:text-7xl mt-6 mb-8 tracking-tightest leading-[0.98] fade-up ${
              copyIn ? "is-in" : ""
            }`}
            style={{ transitionDelay: "80ms" }}
          >
            Modular. Local.
            <br />
            <span className="font-serif italic font-normal text-muted">
              Provider-independent.
            </span>
          </h2>
          <div
            className={`space-y-6 text-lg leading-relaxed text-muted fade-up ${
              copyIn ? "is-in" : ""
            }`}
            style={{ transitionDelay: "180ms" }}
          >
            <p>
              We prefer stacks you can move. n8n over vendor-locked Zapier
              workflows. Self-hosted runtimes over recurring SaaS bills.
              Local models where they beat the cloud on cost or latency.
            </p>
            <p>
              Ownership is the point. When we hand over an engagement you
              can walk away with the whole thing — workflows, keys,
              containers — and keep running it yourself.
            </p>
            <p className="text-ink font-medium">
              That's the operating principle we build against.
            </p>
          </div>
        </div>

        <div ref={imgRef} className="lg:col-span-6 relative">
          <div className="grid grid-cols-6 gap-4">
            <div className={`col-span-6 up-mask ${imgIn ? "is-in" : ""}`}>
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl">
                <img
                  src={SPLIT_IMG}
                  alt="A local runtime"
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between text-white">
                  <span className="font-mono text-[10px] tracking-[0.22em] uppercase bg-black/40 backdrop-blur px-2 py-1">
                    Fig. 01 · Mac mini orchestrator
                  </span>
                </div>
              </div>
            </div>
            <div
              className={`col-span-3 up-mask ${imgIn ? "is-in" : ""}`}
              style={{ transitionDelay: "160ms" }}
            >
              <div className="panel p-6 h-full">
                <span className="eyebrow">╱ Runtime</span>
                <div className="font-display text-3xl font-semibold mt-2 mb-2">
                  n8n
                </div>
                <p className="text-sm text-muted">
                  Docker + Cloudflare Tunnel. You own it, we tune it.
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
                  style={{ color: "rgba(255,255,255,0.55)" }}
                >
                  ╱ Handover
                </span>
                <div className="font-display text-3xl font-semibold mt-2 mb-2 text-white">
                  Yours
                </div>
                <p className="text-sm text-white/60">
                  Full source, workflows, credentials — no vendor lock.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProcessTimeline() {
  const [ref, inView] = useInView(0.2);
  const steps = [
    {
      no: "01",
      title: "Discovery call",
      copy: "30 minutes. What are you actually trying to move? What's the current pain, what's the ideal end state?",
    },
    {
      no: "02",
      title: "Written proposal",
      copy: "Scope, timeline, price, and what handover looks like. No verbal handshakes — always in writing.",
    },
    {
      no: "03",
      title: "Build in the open",
      copy: "Short sprints with visible progress. Discord for daily signal. You see the work as it takes shape.",
    },
    {
      no: "04",
      title: "Handover + care",
      copy: "You own the source, the runtime, and the docs. Optional monthly care for updates and monitoring.",
    },
  ];

  return (
    <section
      id="process"
      ref={ref}
      className="relative bg-paper py-24 md:py-36 px-6 md:px-10 overflow-hidden"
    >
      <div className="max-w-[1400px] mx-auto">
        <div className={`fade-up ${inView ? "is-in" : ""} max-w-2xl mb-16`}>
          <span className="eyebrow">╱ 06 · Engagement</span>
          <h2 className="font-display text-5xl md:text-6xl mt-6 mb-4 tracking-tightest leading-[0.98]">
            Four steps,
            <br />
            <span className="font-serif italic font-normal text-muted">
              nothing hidden.
            </span>
          </h2>
          <p className="text-muted text-lg">
            From the first call to a working system. No surprises, no vendor
            traps.
          </p>
        </div>

        <div>
          {/* Marker row: horizontal rail with 4 dots — desktop only */}
          <div className="hidden lg:block relative h-4 mb-10">
            <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-px bg-line" />
            <div
              className={`absolute top-1/2 -translate-y-1/2 left-0 h-px bg-primary origin-left transition-transform duration-[1800ms] ease-[cubic-bezier(.7,0,.2,1)] ${
                inView ? "scale-x-100" : "scale-x-0"
              }`}
              style={{ width: "100%" }}
            />
            <div className="grid grid-cols-4 h-full relative">
              {steps.map((_, i) => (
                <div key={i} className="flex items-center justify-start">
                  <div
                    className={`w-4 h-4 rounded-full bg-paper border-2 border-primary flex items-center justify-center transition-all duration-500 ${
                      inView ? "opacity-100 scale-100" : "opacity-0 scale-75"
                    }`}
                    style={{ transitionDelay: `${400 + i * 180}ms` }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Content row */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
            {steps.map((s, i) => (
              <div
                key={s.no}
                className={`fade-up ${inView ? "is-in" : ""}`}
                style={{ transitionDelay: `${i * 180}ms` }}
              >
                <div className="font-mono text-[10px] tracking-[0.22em] uppercase text-primary mb-3">
                  Step {s.no}
                </div>
                <div className="font-display text-2xl md:text-[26px] font-semibold text-ink mb-3 leading-tight tracking-tightest">
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

function Pillars() {
  const [ref, inView] = useInView(0.3);
  const stats = [
    { end: 4, suffix: "", label: "Shipped products" },
    { end: 100, suffix: "%", label: "Handover · you own it" },
    { end: 24, suffix: "/7", label: "Orchestrator uptime" },
  ];
  const v0 = useCountUp(stats[0].end, inView);
  const v1 = useCountUp(stats[1].end, inView);
  const v2 = useCountUp(stats[2].end, inView);
  const values = [v0, v1, v2];

  return (
    <section
      ref={ref}
      className="relative bg-deep text-white py-20 md:py-28 px-6 md:px-10 overflow-hidden"
    >
      <div className="absolute inset-0 grid-lines opacity-30" />
      <div className="absolute -top-40 left-1/4 w-[500px] h-[400px] rounded-full bg-primary/20 blur-[140px]" />

      <div className="relative max-w-[1200px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-16">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={`fade-up ${inView ? "is-in" : ""}`}
            style={{ transitionDelay: `${i * 140}ms` }}
          >
            <div className="font-display count-up text-6xl md:text-7xl font-semibold text-primary mb-2 tracking-tightest">
              {values[i]}
              {s.suffix}
            </div>
            <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-white/60">
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ContactDock() {
  return (
    <section
      id="contact"
      className="relative bg-deep text-white py-24 md:py-36 px-6 md:px-10 overflow-hidden noise"
    >
      <div className="absolute inset-0 grid-lines opacity-40" />
      <div className="absolute -top-40 right-0 w-[700px] h-[400px] rounded-full bg-primary/25 blur-[140px]" />
      <div className="absolute bottom-0 left-0 w-[600px] h-[400px] rounded-full bg-accent/15 blur-[140px]" />

      <div className="relative max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-7">
          <span className="font-mono text-[11px] tracking-[0.22em] uppercase text-primary">
            ╱ 07 · Get in touch
          </span>
          <h2 className="font-display text-5xl md:text-7xl mt-6 mb-8 tracking-tightest leading-[0.94]">
            Bring us a
            <br />
            <span className="font-serif italic font-normal text-white/60">
              problem worth solving.
            </span>
          </h2>
          <p className="text-white/70 text-lg max-w-xl mb-10">
            Every engagement starts with a free discovery call. Tell us where
            you're stuck and we'll tell you honestly whether we're the right
            fit.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mb-10">
            <a
              href={`mailto:${BRAND.email}`}
              className="btn-primary justify-center"
            >
              <Mail size={16} /> Email us
            </a>
            <a href="#products" className="btn-ghost justify-center">
              <Sparkles size={16} /> See products
            </a>
          </div>

          <div className="flex items-center gap-4 pt-6 border-t border-white/10">
            <a
              href="https://github.com/vbjservices"
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[11px] tracking-[0.22em] uppercase text-white/60 hover:text-white inline-flex items-center gap-2 transition-colors"
            >
              <Code2 size={14} /> vbjservices
            </a>
            <span className="w-px h-4 bg-white/15" />
            <a
              href="#/colophon"
              className="font-mono text-[11px] tracking-[0.22em] uppercase text-white/60 hover:text-white inline-flex items-center gap-2 transition-colors"
            >
              <MessageSquare size={14} /> Colophon
            </a>
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="panel-dark p-8 md:p-10">
            <h3 className="font-display text-2xl font-semibold text-white mb-6">
              How to reach us
            </h3>
            <div className="space-y-5">
              <ContactRow Icon={Mail} label="Email">
                <a href={`mailto:${BRAND.email}`} className="break-all">
                  {BRAND.email}
                </a>
              </ContactRow>
              <ContactRow Icon={MapPin} label="Based">
                {BRAND.city}, NL · Working remotely across NL / EU
              </ContactRow>
              <ContactRow Icon={Radio} label="Ops surface">
                Discord ops channel — invite on request
              </ContactRow>
            </div>

            <div className="mt-8 pt-6 border-t border-white/10">
              <div className="font-mono text-[10px] tracking-[0.22em] uppercase text-white/40 mb-3">
                ╱ Now booking
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  "Chatbot",
                  "Voice pilot",
                  "n8n setup",
                  "Website",
                  "Automation audit",
                ].map((c) => (
                  <span
                    key={c}
                    className="font-mono text-[10px] tracking-[0.18em] uppercase px-2.5 py-1 border border-white/15 rounded-full text-white/70"
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
        <div className="font-mono text-[10px] tracking-[0.22em] uppercase text-white/40 mb-1">
          {label}
        </div>
        <div className="text-white/90 text-base leading-snug">{children}</div>
      </div>
    </div>
  );
}

function ColophonFooter() {
  return (
    <footer className="bg-deeper text-white/60 py-16 px-6 md:px-10 border-t border-white/5">
      <div className="max-w-[1400px] mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-14">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-3 mb-4">
              <span className="w-8 h-8 rounded-lg bg-primary text-ink flex items-center justify-center">
                <Zap size={16} strokeWidth={2.6} />
              </span>
              <span className="font-display text-white font-semibold">
                VBJ Services
              </span>
            </div>
            <p className="text-sm max-w-xs leading-relaxed">
              {BRAND.byline}. Built from a Mac mini in {BRAND.city}.
            </p>
          </div>
          <div>
            <div className="font-mono text-[10px] tracking-[0.22em] uppercase text-white/40 mb-4">
              Products
            </div>
            <ul className="space-y-2 text-sm">
              <li><a href="#products" className="hover:text-white">Chatbot</a></li>
              <li><a href="#products" className="hover:text-white">Voice agent</a></li>
              <li><a href="#products" className="hover:text-white">n8n setup</a></li>
              <li><a href="#products" className="hover:text-white">Website</a></li>
            </ul>
          </div>
          <div>
            <div className="font-mono text-[10px] tracking-[0.22em] uppercase text-white/40 mb-4">
              Company
            </div>
            <ul className="space-y-2 text-sm">
              <li><a href="#manifesto" className="hover:text-white">Manifesto</a></li>
              <li><a href="#showcase" className="hover:text-white">Work</a></li>
              <li><a href="#process" className="hover:text-white">Process</a></li>
              <li><a href="#/colophon" className="hover:text-white">Colophon</a></li>
            </ul>
          </div>
          <div>
            <div className="font-mono text-[10px] tracking-[0.22em] uppercase text-white/40 mb-4">
              Contact
            </div>
            <ul className="space-y-2 text-sm">
              <li>
                <a href={`mailto:${BRAND.email}`} className="hover:text-white">
                  {BRAND.email}
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/vbjservices"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-white inline-flex items-center gap-2"
                >
                  <Code2 size={12} /> vbjservices
                </a>
              </li>
              <li>{BRAND.city}, NL</li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/10 pt-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <p className="font-serif italic text-white/50 text-sm">
            Set in Instrument Serif, Space Grotesk and JetBrains Mono ·
            Published from the orchestrator · MMXXVI
          </p>
          <div className="font-mono text-[10px] tracking-[0.22em] uppercase text-white/40">
            © {new Date().getFullYear()} VBJ Services · All rights reserved
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-paper text-ink font-body">
      <CommandNav />
      <main>
        <SceneHero />
        <MarqueeBand />
        <Manifesto />
        <ProductStack />
        <ShowcaseFrames />
        <ServicesIndex />
        <PerspectiveSplit />
        <ProcessTimeline />
        <Pillars />
        <ContactDock />
      </main>
      <ColophonFooter />
    </div>
  );
}
