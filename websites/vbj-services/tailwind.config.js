/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', "system-ui", "sans-serif"],
        serif: ['"Instrument Serif"', "serif"],
        body: ['"Manrope"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      colors: {
        paper: "#F3F0EA",
        paperDark: "#EAE6DD",
        ink: "#0A0A12",
        inkSoft: "#1A1A24",
        muted: "#6B6E77",
        line: "#DAD3C4",
        primary: "#818CF8",
        primaryDeep: "#5B67E0",
        accent: "#6EE7B7",
        deep: "#08080F",
        deeper: "#050509",
      },
      boxShadow: {
        soft: "0 20px 60px -30px rgba(10,10,18,0.35)",
        deep: "0 40px 90px -40px rgba(10,10,18,0.75)",
        glow: "0 0 40px -8px rgba(129,140,248,0.6)",
      },
      letterSpacing: {
        tightest: "-0.045em",
      },
    },
  },
  plugins: [],
};
