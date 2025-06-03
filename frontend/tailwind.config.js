/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        discord: {
          blurple: '#5865f2',
          dark: '#36393f',
          darker: '#2f3136',
          darkest: '#202225',
          green: '#57f287',
          red: '#ed4245',
          yellow: '#fee75c',
        },
        gray: {
          600: '#4f545c',
          700: '#40444b',
          800: '#36393f',
          900: '#2f3136',
        }
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        }
      }
    },
  },
  plugins: [],
}