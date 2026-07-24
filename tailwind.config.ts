import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        term: {
          bg: "#0b0e14",
          panel: "#151922",
          panel2: "#1a1f2b",
          line: "#232a38",
          text: "#d5dbe6",
          dim: "#7a8499",
          up: "#00c805",
          down: "#ff3b30",
          cyan: "#22d3ee",
          gold: "#fbbf24",
          blue: "#3b82f6",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      fontSize: {
        xxs: ["0.68rem", "0.9rem"],
      },
    },
  },
  plugins: [],
};
export default config;
