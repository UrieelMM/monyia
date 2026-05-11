import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      backgroundImage: {
        'gradient-radial': 'radial-gradient(circle, var(--tw-gradient-stops))',
      },
      colors: {
        cr: {
          gold: '#F5C542',
          purple: '#6B21A8',
          darkpurple: '#3B0764',
          blue: '#1E3A8A',
          darkblue: '#0F172A',
          red: '#DC2626',
          green: '#16A34A',
        },
        mony: {
          violet: '#7C3AED',
          fuchsia: '#EC4899',
          cyan: '#06B6D4',
          amber: '#F59E0B',
          dark: '#080812',
        },
      },
      animation: {
        pulse_slow: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        bounce_slow: 'bounce 1.5s infinite',
        glow: 'glow 2s ease-in-out infinite',
      },
      keyframes: {
        glow: {
          '0%, 100%': { boxShadow: '0 0 10px #F5C542, 0 0 20px #F5C542' },
          '50%': { boxShadow: '0 0 20px #F5C542, 0 0 40px #F5C542, 0 0 60px #F5C542' },
        },
      },
    },
  },
  plugins: [],
}

export default config
