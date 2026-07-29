# Code Snippets

## CSS token idea

```css
:root {
  --bg: #f5f3ee;
  --surface: rgba(255, 255, 255, 0.62);
  --surface-strong: #ffffff;
  --primary: #111827;
  --accent: #c58b2a;
  --ink: #121417;
  --muted: #6b7280;
  --deep: #0f1720;
}
```

## App shell idea

```jsx
export default function App() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
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
  )
}
```

## Motion rule

Keep GSAP setup local to each section or grouped in small helper functions. Do not let the app devolve into one giant motion blob.
