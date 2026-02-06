import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)']
      },
      boxShadow: {
        glow: '0 0 40px rgba(56, 189, 248, 0.15)'
      }
    }
  },
  plugins: []
};

export default config;
