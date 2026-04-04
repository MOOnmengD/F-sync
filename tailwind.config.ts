import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: {
          bg: '#FDFCFB',
          surface: '#F7F5F2',
          text: '#4B5563',
          muted: '#6B7280',
          line: '#E7E5E4',
        },
        pastel: {
          peach: '#FAD9D2',
          mint: '#CFF3E5',
          baby: '#D7E8FF',
          butter: '#FFF1B8',
          lavender: '#E9D9FF',
        },
      },
      borderRadius: {
        xl2: '1rem',
      },
    },
  },
  plugins: [],
} satisfies Config

