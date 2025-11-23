import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Manrope", "sans-serif"],
      },
      colors: {
        primary: "#135bec",
        secondary: "#6c757d",
        success: "#2ecc71",
        warning: "#f1c40f",
        danger: "#e74c3c",
        dark: {
          900: "#101622",
          800: "#151c2c",
          700: "#1e273b",
          600: "#2d3748",
        },
      },
    },
  },
  plugins: [],
};
export default config;
