/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', "system-ui", "sans-serif"],
        body: ['"Manrope"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      colors: {
        bg: "#EFEBE3",
        surface: "#FFFFFF",
        panel: "#F6F2EA",
        ink: "#141519",
        muted: "#6B6E77",
        deep: "#0B0D12",
        deeper: "#05070B",
        primary: "#E7A93A",
        accent: "#7DD3FC",
        line: "#DAD3C4",
      },
      boxShadow: {
        soft: "0 20px 60px -30px rgba(11,13,18,0.35)",
        deep: "0 40px 90px -40px rgba(11,13,18,0.55)",
      },
      letterSpacing: {
        tightest: "-0.045em",
      },
    },
  },
  plugins: [],
};
