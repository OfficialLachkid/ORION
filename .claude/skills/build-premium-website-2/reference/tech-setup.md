# Tech Setup — v2 (Editorial Publication)

## package.json

```json
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "gsap": "^3.12.5",
    "lucide-react": "^0.453.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^6.28.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "vite": "^6.0.0"
  }
}
```

## tailwind.config.js

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: '#F4F1EA',
        ink: '#141414',
        muted: '#6C6A66',
        rule: '#D8D3C8',
        accent: '<ACCENT>',        // substitute at scaffold time
      },
      fontFamily: {
        // Substitute per tone (see design-system.md)
        serif: ['"Instrument Serif"', '"Fraunces"', 'serif'],
        display: ['"Instrument Serif"', '"Fraunces"', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        tight2: '-0.02em',
        wide28: '0.28em',
        wide14: '0.14em',
      },
      maxWidth: {
        editorial: '1440px',
      },
    },
  },
  plugins: [],
}
```

## postcss.config.js

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

## vite.config.js

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, open: false },
})
```

## index.html

```html
<!doctype html>
<html lang="<LANG>">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title><COMPANY_NAME> — <EDITORIAL_BYLINE></title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Fraunces:opsz,ital,wght@9..144,0,400;9..144,0,500;9..144,0,600;9..144,0,700;9..144,1,400;9..144,1,500&family=JetBrains+Mono:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

For `measured classical` and `sharp modern` tones swap the Instrument Serif link for the appropriate Fraunces / Playfair Display / Libre Caslon Google Fonts URL.

## src/main.jsx

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import Colophon from './pages/Colophon.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/colophon" element={<Colophon />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
)
```

`Colophon.jsx` hosts privacy, terms, and imprint on a single long editorial page — matching v2's minimalism (no separate legal routes).

## Favicon

Editorial monogram — one glyph, one accent dot.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#F4F1EA"/>
  <text x="32" y="46" font-family="Instrument Serif, Fraunces, serif" font-weight="700"
        font-size="44" fill="#141414" text-anchor="middle"><INITIAL></text>
  <circle cx="50" cy="18" r="3" fill="<ACCENT>"/>
</svg>
```

Substitute `<INITIAL>` (single letter, usually the first) and `<ACCENT>` (hex).
