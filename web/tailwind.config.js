/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // "Neon Calabash" — deep violet-black surfaces, layered for depth.
        ink: {
          900: '#0E0B1A', // deepest (server rail, inputs)
          800: '#151129', // channel / member sidebar
          700: '#1D1838', // main chat background
          600: '#252047', // raised surfaces / hover
          500: '#2C2550', // borders / dividers
        },
        // Violet-tinted greys replace Tailwind's neutral ones so existing
        // text-gray-* classes pick up the palette. 500 and up stay >= 4.5:1
        // on ink-700 and ink-600, so hints and timestamps pass WCAG AA.
        gray: {
          100: '#F2EEFF', // primary text
          200: '#E2DCF7',
          300: '#CEC6EC',
          400: '#B7AEDB', // muted text
          500: '#9A90C2', // hints, timestamps
          600: '#6E6596', // decorative only — not for text
          700: '#4A4370',
          800: '#2C2550',
          900: '#1D1838',
        },
        brand: {
          DEFAULT: '#7444F0', // violet fill; white text on it is 5.5:1
          hover: '#6535DE',
          hi: '#A684FF', // violet as text / icons / focus ring on dark (5.9:1)
          logo: '#9466FF', // the gourd body
          soft: '#2A2160', // solid soft-accent surface
        },
        lime: '#B8F34A', // highlight accent; pair with ink-900 text
        pink: '#FF5FA2', // hot accent; pair with ink-900 text
        online: '#B8F34A', // lime — presence & live
        idle: '#FFC24A', // amber — away
        danger: '#FF5FA2', // hot pink — destructive / alerts; ink-900 text on fills
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Space Grotesk Variable"', '"Space Grotesk"', '"Inter Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
