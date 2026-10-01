import type { Config } from "tailwindcss";

// Apple-style system: SF Pro (the system font on macOS/iOS, Inter elsewhere), #F5F5F7 page,
// #1D1D1F text, one purple accent for every action and highlight, large soft radii and very
// light shadows. Green/amber/red are status colors only (met, check this, fails), never decoration.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Text"',
          '"SF Pro Display"',
          "var(--font-inter)",
          '"Helvetica Neue"',
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      colors: {
        paper: "#F5F5F7",
        ink: "#1D1D1F",
        muted: "#6E6E73",
        accent: {
          DEFAULT: "#7B3FE4",
          bright: "#9A6BFF",
          soft: "#F3EEFD",
          deep: "#6630CC",
        },
        good: { DEFAULT: "#1F8A3B", soft: "#EAF6EC" },
        warn: { DEFAULT: "#9A5B00", soft: "#FFF6E5" },
        bad: { DEFAULT: "#D70015", soft: "#FDEEEE" },
      },
      borderRadius: {
        "4xl": "2rem",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0, 0, 0, 0.04)",
        lift: "0 2px 6px rgba(0, 0, 0, 0.04), 0 12px 32px -8px rgba(0, 0, 0, 0.12)",
        card: "0 8px 24px rgba(0, 0, 0, 0.06), 0 40px 80px -20px rgba(0, 0, 0, 0.28)",
        glow: "0 0 0 1px rgba(123, 63, 228, 0.08), 0 8px 24px -8px rgba(123, 63, 228, 0.45)",
      },
      letterSpacing: {
        display: "-0.022em",
      },
    },
  },
  plugins: [],
};
export default config;
