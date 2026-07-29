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
        accent: '#1F3A5F',
      },
      fontFamily: {
        serif: ['"Instrument Serif"', '"Fraunces"', 'Georgia', 'serif'],
        display: ['"Instrument Serif"', '"Fraunces"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        tight2: '-0.02em',
        wide28: '0.28em',
        wide14: '0.14em',
        wide32: '0.32em',
      },
      maxWidth: {
        editorial: '1440px',
      },
    },
  },
  plugins: [],
}
