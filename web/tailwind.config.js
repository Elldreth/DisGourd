/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // A calm, Discord-adjacent dark palette.
        ink: {
          900: '#1b1d24', // deepest (server rail)
          800: '#22252e', // channel sidebar
          700: '#2b2f3a', // main chat bg
          600: '#353a47', // raised surfaces / hover
          500: '#434a5a', // borders
        },
        brand: {
          DEFAULT: '#5b6ef5',
          hover: '#4a5be0',
          soft: '#3a3f66',
        },
        online: '#3ba55d',
        idle: '#faa61a',
        danger: '#ed4245',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
