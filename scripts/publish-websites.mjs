#!/usr/bin/env node
/**
 * publish-websites.mjs
 *
 * Builds every Vite React site in <repo>/websites/* and copies the
 * dist/ output into <repo>/sites/<slug>/ so GitHub Pages can serve it
 * at https://<owner>.github.io/<repo>/sites/<slug>/. Also regenerates
 * sites/index.html — a premium gallery listing every published site.
 *
 * Usage:
 *   node scripts/publish-websites.mjs             # publish all sites
 *   node scripts/publish-websites.mjs vink-...    # publish one site
 *   node scripts/publish-websites.mjs --gallery   # regenerate gallery only
 *
 * Assumptions:
 *   - Each site is a Vite React project with a package.json + "build" script.
 *   - Each site reads its subpath from import.meta.env.BASE_URL
 *     (react-router's basename should be set from BASE_URL for SPA routes).
 *   - GH Pages base path is /ruflo/ (repo name).
 */
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname)
const SITES_DIR = join(REPO_ROOT, 'sites')
const SOURCES_DIR = join(REPO_ROOT, 'websites')
const REPO_NAME = 'ruflo'
const PAGES_BASE = `/${REPO_NAME}/sites`

/* ---------------------------------------------------------------- helpers */
const log = (...args) => console.log('[publish-websites]', ...args)
const err = (...args) => console.error('[publish-websites]', ...args)

function listSiteSources() {
  if (!existsSync(SOURCES_DIR)) {
    err(`No sources directory at ${SOURCES_DIR}. Create it and add Vite projects.`)
    return []
  }
  return readdirSync(SOURCES_DIR)
    .filter((name) => {
      const p = join(SOURCES_DIR, name)
      if (!statSync(p).isDirectory()) return false
      return existsSync(join(p, 'package.json'))
    })
    .sort()
}

function readManifest(slug) {
  const src = join(SOURCES_DIR, slug)
  const pkg = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'))
  let title = pkg.name || slug
  let description = pkg.description || ''
  const indexHtml = join(src, 'index.html')
  if (existsSync(indexHtml)) {
    const html = readFileSync(indexHtml, 'utf8')
    const t = html.match(/<title>([^<]+)<\/title>/)
    if (t) title = t[1].trim()
    const d = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    if (d) description = d[1].trim()
  }
  return { slug, title, description }
}

function buildSite(slug) {
  const src = join(SOURCES_DIR, slug)
  const base = `${PAGES_BASE}/${slug}/`
  log(`Building ${slug} with base=${base}`)
  execSync(`npm run build -- --base=${base}`, {
    cwd: src,
    stdio: 'inherit',
    env: { ...process.env },
  })
  const dist = join(src, 'dist')
  if (!existsSync(dist)) {
    throw new Error(`No dist/ found for ${slug} after build`)
  }
  const dest = join(SITES_DIR, slug)
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  cpSync(dist, dest, { recursive: true })

  // SPA fallback for GitHub Pages: any unknown route falls through to 404.html
  // which is just a copy of index.html — react-router picks it up client-side.
  const indexHtml = join(dest, 'index.html')
  if (existsSync(indexHtml)) {
    cpSync(indexHtml, join(dest, '404.html'))
  }
  log(`  → ${dest.replace(REPO_ROOT, '<repo>')}`)
}

/* -------------------------------------------------------------- gallery */

function renderGallery(sites) {
  const cards = sites
    .map((s) => {
      const href = `./${s.slug}/`
      const desc = escapeHtml(s.description || 'Website')
      const title = escapeHtml(s.title)
      const initials = escapeHtml(s.title.split(/[\s—-]+/).slice(0, 2).map(w => w[0]).join('').toUpperCase())
      return `
      <a class="card" href="${href}">
        <div class="thumb"><span>${initials}</span></div>
        <div class="body">
          <span class="tag">Live</span>
          <h3>${title}</h3>
          <p>${desc}</p>
          <span class="cta">
            Bekijk site
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>
          </span>
        </div>
      </a>`
    })
    .join('\n')

  const count = sites.length
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VBJ Services — Website Gallery</title>
  <meta name="description" content="Premium marketing websites built by VBJ Services." />
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%23F5C518'/%3E%3Cpath d='M18 4 L8 18 L15 18 L12 28 L24 12 L16 12 L20 4 Z' fill='%230B0F17'/%3E%3C/svg%3E" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Cormorant+Garamond:ital,wght@1,500;1,600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --primary: #F5C518;
      --primary-dark: #B08800;
      --accent: #22D3EE;
      --deep: #0B0F17;
      --ink: #111318;
      --muted: #6A6A6A;
      --divider: #E5E7EB;
      --bg: #F7F7F5;
      --surface: #FFFFFF;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'Inter', system-ui, sans-serif;
      background: var(--bg);
      color: var(--ink);
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }
    a { color: inherit; text-decoration: none; }
    .display { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; letter-spacing: -0.02em; }
    .serif { font-family: 'Cormorant Garamond', serif; font-style: italic; font-weight: 500; }
    .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }

    /* Hero */
    header.hero {
      position: relative;
      background: radial-gradient(120% 80% at 50% -10%, #1a2540 0%, var(--deep) 65%, #05070C 100%);
      color: #fff;
      padding: 96px 24px 120px;
      overflow: hidden;
    }
    header.hero::before {
      content: '';
      position: absolute; inset: 0;
      background-image:
        linear-gradient(rgba(245,197,24,0.08) 1px, transparent 1px),
        linear-gradient(90deg, rgba(245,197,24,0.08) 1px, transparent 1px);
      background-size: 40px 40px;
      opacity: 0.4;
      pointer-events: none;
    }
    header.hero::after {
      content: '';
      position: absolute; left: 50%; top: -140px; transform: translateX(-50%);
      width: 700px; height: 280px; border-radius: 50%;
      background: rgba(245,197,24,0.25); filter: blur(80px);
      pointer-events: none;
    }
    .hero-inner {
      position: relative;
      max-width: 960px; margin: 0 auto;
      text-align: center;
    }
    .badge {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 14px;
      border-radius: 999px;
      background: rgba(245,197,24,0.12);
      border: 1px solid rgba(245,197,24,0.35);
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      letter-spacing: 0.25em;
      color: var(--primary);
      text-transform: uppercase;
      margin-bottom: 32px;
    }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--primary); box-shadow: 0 0 12px var(--primary); }
    h1 {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-weight: 800;
      font-size: clamp(44px, 6vw, 84px);
      line-height: 0.98;
      letter-spacing: -0.03em;
      margin: 0 0 12px;
    }
    h1 .accent {
      display: block;
      font-family: 'Cormorant Garamond', serif;
      font-style: italic;
      font-weight: 500;
      color: var(--primary);
      font-size: clamp(48px, 7vw, 96px);
      margin-top: 6px;
    }
    .lede {
      max-width: 620px; margin: 24px auto 0;
      color: rgba(255,255,255,0.72);
      font-size: 18px; line-height: 1.6;
    }
    .stat-row {
      display: flex; justify-content: center; gap: 40px;
      margin-top: 44px; flex-wrap: wrap;
    }
    .stat { text-align: left; }
    .stat .num {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 40px; font-weight: 800;
      color: #fff; letter-spacing: -0.02em; line-height: 1;
    }
    .stat .num em {
      font-family: 'Cormorant Garamond', serif;
      color: var(--primary);
      font-style: italic; font-weight: 500;
    }
    .stat .lbl {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      letter-spacing: 0.25em;
      color: rgba(255,255,255,0.5);
      text-transform: uppercase;
      margin-top: 8px;
    }

    /* Gallery */
    main {
      max-width: 1200px; margin: -60px auto 0;
      padding: 0 24px 96px;
      position: relative; z-index: 2;
    }
    .section-head {
      display: flex; align-items: flex-end; justify-content: space-between;
      gap: 20px; margin: 40px 0 32px;
      flex-wrap: wrap;
    }
    .section-head .eyebrow {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px; letter-spacing: 0.3em; text-transform: uppercase;
      color: var(--primary-dark);
    }
    .section-head h2 {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-weight: 800; font-size: clamp(32px, 3.5vw, 44px);
      letter-spacing: -0.02em; margin: 8px 0 0; color: var(--ink);
    }
    .section-head p {
      color: var(--muted); max-width: 380px; margin: 0;
      font-size: 15px; line-height: 1.6;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 24px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--divider);
      border-radius: 28px;
      overflow: hidden;
      display: flex; flex-direction: column;
      transition: transform 0.35s cubic-bezier(0.25,0.46,0.45,0.94),
                  box-shadow 0.35s cubic-bezier(0.25,0.46,0.45,0.94),
                  border-color 0.3s;
    }
    .card:hover {
      transform: translateY(-4px);
      box-shadow: 0 18px 40px -20px rgba(245,197,24,0.35);
      border-color: rgba(245,197,24,0.5);
    }
    .thumb {
      position: relative;
      height: 200px;
      background:
        radial-gradient(60% 60% at 20% 20%, rgba(34,211,238,0.25), transparent 65%),
        radial-gradient(80% 80% at 80% 90%, rgba(245,197,24,0.35), transparent 65%),
        linear-gradient(135deg, #131B2E 0%, var(--deep) 100%);
      display: flex; align-items: center; justify-content: center;
      overflow: hidden;
    }
    .thumb::before {
      content: '';
      position: absolute; inset: 0;
      background-image:
        linear-gradient(rgba(245,197,24,0.10) 1px, transparent 1px),
        linear-gradient(90deg, rgba(245,197,24,0.10) 1px, transparent 1px);
      background-size: 28px 28px;
      opacity: 0.6;
    }
    .thumb span {
      position: relative;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-weight: 800;
      font-size: 56px;
      letter-spacing: -0.03em;
      color: var(--primary);
      text-shadow: 0 0 30px rgba(245,197,24,0.5);
    }
    .body { padding: 22px 24px 26px; }
    .tag {
      display: inline-flex; align-items: center; gap: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px; letter-spacing: 0.24em;
      color: var(--primary-dark);
      background: rgba(245,197,24,0.14);
      padding: 4px 10px; border-radius: 999px;
      text-transform: uppercase;
    }
    .tag::before {
      content: ''; width: 5px; height: 5px; border-radius: 50%;
      background: #22c55e; box-shadow: 0 0 8px #22c55e;
      animation: pulse 2s ease-in-out infinite;
    }
    .card h3 {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-weight: 700; font-size: 22px;
      letter-spacing: -0.01em;
      color: var(--ink); margin: 12px 0 8px;
    }
    .card p {
      color: var(--muted);
      font-size: 14px; line-height: 1.55;
      margin: 0 0 18px;
      /* clamp to 3 lines */
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .cta {
      display: inline-flex; align-items: center; gap: 6px;
      font-weight: 600; font-size: 14px;
      color: var(--primary-dark);
      transition: gap 0.25s;
    }
    .card:hover .cta { gap: 10px; }

    /* Empty state */
    .empty {
      text-align: center; padding: 80px 20px;
      background: var(--surface);
      border: 1px dashed var(--divider);
      border-radius: 28px;
      color: var(--muted);
    }
    .empty h3 { color: var(--ink); font-family: 'Plus Jakarta Sans', sans-serif; }
    .empty code {
      background: rgba(245,197,24,0.15);
      color: var(--primary-dark);
      padding: 3px 8px; border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
    }

    /* Footer */
    footer {
      max-width: 1200px; margin: 0 auto;
      padding: 40px 24px 60px;
      display: flex; justify-content: space-between; align-items: center;
      gap: 20px; flex-wrap: wrap;
      color: var(--muted);
      font-size: 13px;
      border-top: 1px solid var(--divider);
    }
    footer .brand { display: inline-flex; align-items: center; gap: 10px; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; color: var(--ink); }
    footer .brand span.spark {
      width: 26px; height: 26px; border-radius: 50%;
      background: var(--primary);
      display: inline-flex; align-items: center; justify-content: center;
    }
    footer nav { display: flex; gap: 20px; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; }
    footer nav a:hover { color: var(--primary-dark); }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }

    @media (max-width: 640px) {
      header.hero { padding: 72px 20px 100px; }
      .stat-row { gap: 24px; }
      main { padding: 0 16px 60px; }
    }
  </style>
</head>
<body>
  <header class="hero">
    <div class="hero-inner">
      <span class="badge"><span class="dot"></span> VBJ Services Website Gallery</span>
      <h1>
        Premium sites,
        <span class="accent">built by VBJ Services.</span>
      </h1>
      <p class="lede">
        A living gallery of marketing websites scaffolded with the
        <span class="mono" style="color:var(--primary)">/build-premium-website</span>
        skill. Every site here is production-quality — animated, responsive, and shipped as a single-page Vite app.
      </p>

      <div class="stat-row">
        <div class="stat">
          <div class="num">${count}<em>+</em></div>
          <div class="lbl">Published sites</div>
        </div>
        <div class="stat">
          <div class="num">100<em>%</em></div>
          <div class="lbl">Static / edge served</div>
        </div>
        <div class="stat">
          <div class="num">1<em>&nbsp;msg</em></div>
          <div class="lbl">To add another</div>
        </div>
      </div>
    </div>
  </header>

  <main>
    <div class="section-head">
      <div>
        <span class="eyebrow">╱ The catalogue</span>
        <h2>Live sites</h2>
      </div>
      <p>Click any card to open the site. Each one is a full Vite React app — GSAP animations, sticky-stack process, contact form, the works.</p>
    </div>

    ${count === 0
      ? `<div class="empty">
          <h3>No sites published yet</h3>
          <p>Build a site with <code>/build-premium-website</code>, then run <code>node scripts/publish-websites.mjs</code>.</p>
        </div>`
      : `<div class="grid">${cards}\n</div>`
    }
  </main>

  <footer>
    <span class="brand">
      <span class="spark">
        <svg width="14" height="14" viewBox="0 0 32 32"><path d="M18 4 L8 18 L15 18 L12 28 L24 12 L16 12 L20 4 Z" fill="#0B0F17"/></svg>
      </span>
      VBJ Services · Website gallery
    </span>
    <nav>
      <a href="https://github.com/ruvnet/ruflo">GitHub</a>
      <a href="../">Docs</a>
    </nav>
  </footer>
</body>
</html>
`
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function publishedSlugs() {
  if (!existsSync(SITES_DIR)) return []
  return readdirSync(SITES_DIR)
    .filter((n) => statSync(join(SITES_DIR, n)).isDirectory())
    .filter((n) => existsSync(join(SITES_DIR, n, 'index.html')))
    .sort()
}

function writeGallery() {
  mkdirSync(SITES_DIR, { recursive: true })
  const slugs = publishedSlugs()
  const sites = slugs
    .filter((slug) => existsSync(join(SOURCES_DIR, slug))) // only include those whose source we can read metadata from
    .map(readManifest)
  const html = renderGallery(sites)
  writeFileSync(join(SITES_DIR, 'index.html'), html)
  log(`Gallery written with ${sites.length} site(s)`)
}

/* ---------------------------------------------------------------- main */
function main() {
  const args = process.argv.slice(2)
  const galleryOnly = args.includes('--gallery')
  const only = args.filter((a) => !a.startsWith('--'))

  if (!galleryOnly) {
    const targets = only.length > 0 ? only : listSiteSources()
    if (targets.length === 0) {
      err('No sites to publish.')
      process.exit(1)
    }
    log(`Publishing ${targets.length} site(s): ${targets.join(', ')}`)
    for (const slug of targets) {
      try {
        buildSite(slug)
      } catch (e) {
        err(`Failed to publish ${slug}:`, e.message)
        process.exit(1)
      }
    }
  }

  writeGallery()
  log('Done.')
  log(`Local preview: npx serve sites  →  http://localhost:3000/`)
  log(`Live URL: https://<owner>.github.io/${REPO_NAME}/sites/`)
}

main()
