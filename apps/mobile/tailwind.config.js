/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Brand: deep teal (trust) + saffron (warmth, Indian context)
        brand: { 50: '#ECFDF8', 100: '#D1FAEC', 200: '#A7F3DA', 300: '#6EE7C4', 400: '#34D3A8', 500: '#10B98F', 600: '#0D9488', 700: '#0F766E', 800: '#115E59', 900: '#134E4A' },
        saffron: { 50: '#FFF8EB', 100: '#FEECC7', 200: '#FDD68A', 300: '#FCBB4D', 400: '#FBA524', 500: '#F5850B', 600: '#D96306', 700: '#B44309' },
        ink: { 900: '#0B1220', 800: '#1E293B', 700: '#334155', 600: '#475569', 500: '#64748B', 400: '#94A3B8', 300: '#CBD5E1', 200: '#E2E8F0', 100: '#F1F5F9', 50: '#F8FAFC' },
        alert: { 50: '#FEF2F2', 100: '#FEE2E2', 500: '#EF4444', 600: '#DC2626', 700: '#B91C1C' },
      },
      borderRadius: { '4xl': '2rem' },
    },
  },
  plugins: [],
};
