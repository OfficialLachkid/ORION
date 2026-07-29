# Animations — v2 (Editorial Publication)

Restrained. Five motion patterns total; use only these.

## 1. `fade-in-up`

Section entry.

```js
gsap.from('.reveal', {
  scrollTrigger: { trigger: sectionRef.current, start: 'top 85%', once: true },
  y: 24, opacity: 0, duration: 0.9, ease: 'power2.out', stagger: 0.08,
})
```

Apply `.reveal` to elements you want revealed one-by-one on section entry.

## 2. `parallax-image` (feature splits only)

Image drifts up as the section scrolls past. Text drifts down slightly.

```js
gsap.to(imgRef.current, {
  yPercent: -8,
  ease: 'none',
  scrollTrigger: {
    trigger: rowRef.current,
    start: 'top bottom',
    end: 'bottom top',
    scrub: true,
  },
})
gsap.to(textRef.current, {
  yPercent: 3,
  ease: 'none',
  scrollTrigger: {
    trigger: rowRef.current,
    start: 'top bottom',
    end: 'bottom top',
    scrub: true,
  },
})
```

Keep magnitudes small — this is editorial, not parallax-porn.

## 3. `underline-draw`

Manifesto keyword + Services Index row hover.

CSS:
```css
.underline-path {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  transition: stroke-dashoffset 1.4s cubic-bezier(0.65, 0, 0.35, 1);
  vector-effect: non-scaling-stroke;
}
.underline-active .underline-path { stroke-dashoffset: 0; }
```

For Manifesto, toggle `.underline-active` when the section enters the viewport (IntersectionObserver at threshold 0.4).

For Services Index rows, apply `.underline-active` on `:hover` of the row.

Use `pathLength="1"` on the SVG path so the dasharray works consistently.

## 4. `marquee-loop`

Infinite horizontal marquee.

CSS:
```css
@keyframes marquee-scroll {
  from { transform: translate3d(0, 0, 0); }
  to { transform: translate3d(-50%, 0, 0); }
}
.marquee-track {
  display: inline-flex;
  animation: marquee-scroll 40s linear infinite;
  will-change: transform;
}
.marquee:hover .marquee-track {
  animation-direction: reverse;
}
```

Duplicate the token list inside `.marquee-track` so the loop from `0` to `-50%` is seamless.

## 5. `split-flap` (THE SIGNATURE)

This is v2's defining animation — the visual counterpart to v1's water-drops. A small horizontal panel that mimics a train-station split-flap display.

### Structure

Four labelled columns. Each column has:
- A tiny mono label (top): e.g. `VOL`, `ISSUE`, `SECTION`, `STATUS`
- A row of monospaced characters (bottom): e.g. `X V I I I`

### Mechanism (React)

```jsx
function SplitFlap({ label, value }) {
  const chars = value.padEnd(6, ' ').split('')
  return (
    <div className="flex flex-col items-start gap-2">
      <span className="font-mono text-[9px] tracking-[0.32em] uppercase text-muted">
        {label}
      </span>
      <div className="flex items-center gap-0.5">
        {chars.map((c, i) => <FlapChar key={i} char={c} delay={i * 60} />)}
      </div>
    </div>
  )
}

function FlapChar({ char, delay }) {
  const [display, setDisplay] = useState(char)
  const [flipping, setFlipping] = useState(false)
  useEffect(() => {
    if (display === char) return
    setFlipping(true)
    const t = setTimeout(() => {
      setDisplay(char)
      setFlipping(false)
    }, 200 + delay)
    return () => clearTimeout(t)
  }, [char, display, delay])
  return (
    <span
      className={`inline-flex items-center justify-center h-6 w-4 sm:w-5 border border-rule bg-paper font-mono text-[13px] sm:text-[15px] font-medium text-ink transition-transform duration-150 ${
        flipping ? 'scale-y-0' : 'scale-y-100'
      }`}
      style={{ transformOrigin: 'center' }}
    >
      {display}
    </span>
  )
}
```

### Panel usage

```jsx
function MastheadFlaps() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const i = setInterval(() => setTick(t => t + 1), 2300)
    return () => clearInterval(i)
  }, [])
  // Cycle values per industry (see industry-themes.md)
  const cycle = [
    ['XII', '04', 'PRACT', 'OPEN'],
    ['XII', '04', 'BRIEF', 'ACT'],
    ['XII', '05', 'MATCH', 'WARM'],
    ['XII', '05', 'PLACE', 'CLOSE'],
  ]
  const values = cycle[tick % cycle.length]
  return (
    <div className="flex items-end justify-center gap-6 sm:gap-10">
      <SplitFlap label="Vol"     value={values[0]} />
      <SplitFlap label="Issue"   value={values[1]} />
      <SplitFlap label="Section" value={values[2]} />
      <SplitFlap label="Status"  value={values[3]} />
    </div>
  )
}
```

The value at each tick is a full 4-tuple; the per-character `useEffect` handles the staggered flip so it looks like they're being independently updated.

Uppercase values, 6 chars max per cell (fewer chars just render as trailing spaces).

### Sizing

- Panel height: 56–72px (h-14 sm:h-16)
- Each flap character: 24×16px on mobile, 24×20px on desktop
- Full panel width auto-fits — no fixed constraint

### Placement

Two spots only:
1. **Editorial Hero byline row** (primary) — full-size
2. **Colophon Footer Column 1** (echo) — half-scale (`scale-75 origin-left`)

Do not place it elsewhere. Do not decorate it. Do not add gradients or shadows.

---

## What NOT to do (v2 discipline)

- No sticky-stack
- No count-ups
- No hero staggered display type
- No floating particles
- No interactive feature cards with cursors and calendars
- No gold/accent flourish italic hero line (that's v1)
- No glass-blur pills
- No `magnetic-btn` hover scale

If motion is not in this file, don't add it.
