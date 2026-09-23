/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'hsl(222.2 84% 6.1%)',
        foreground: 'hsl(0 0% 100%)',
        card: {
          DEFAULT: 'hsl(223 47% 11.2%)',
          foreground: 'hsl(0 0% 100%)',
        },
        primary: {
          DEFAULT: 'hsl(222.2 84% 53.9%)',
          foreground: 'hsl(210 40% 98.0%)',
          50: '#f0f6ff',
          100: '#e0efff',
          200: '#b9d4fe',
          300: '#7db1ff',
          400: '#3a99ff',
          500: '#1e88e2',
          600: '#0f73e6',
          700: '#0a5bb5',
          800: '#084285',
          900: '#052a59',
        },
        muted: {
          DEFAULT: 'hsl(217.2 32.6% 17.5%)',
          foreground: 'hsl(0 0% 95.0%)',
        },
        border: 'hsl(217.2 32.6% 17.5%)',
        input: 'hsl(217.2 32.6% 17.5%)',
        ring: 'hsl(222.2 84% 53.9%)',
      },
      borderRadius: {
        lg: `var(--radius)`,
        md: `calc(var(--radius) - 2px)`,
        sm: '0.5rem',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};