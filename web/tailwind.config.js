/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Refined dark palette — cool charcoal surfaces, layered for depth.
        ink: {
          900: '#121319', // deepest (server rail)
          800: '#171921', // channel / member sidebar
          700: '#1c1e27', // main chat background
          600: '#242734', // raised surfaces / hover
          500: '#313544', // borders / dividers
        },
        brand: {
          DEFAULT: '#7d6ff3', // one confident indigo accent
          hover: '#6d5fe6',
          hi: '#8f83f7', // brighter — active icons, focus ring
          soft: '#2c2950', // solid soft-accent surface
        },
        online: '#37d39b', // mint — presence & live
        idle: '#f4b552', // amber — away
        danger: '#f16168', // coral — destructive / alerts
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
