/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--am-bg) / <alpha-value>)',
        surface: 'rgb(var(--am-surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--am-surface-2) / <alpha-value>)',
        border: 'rgb(var(--am-border) / <alpha-value>)',
        fg: 'rgb(var(--am-fg) / <alpha-value>)',
        muted: 'rgb(var(--am-muted) / <alpha-value>)',
        brand: {
          DEFAULT: 'rgb(var(--am-brand) / <alpha-value>)',
          fg: 'rgb(var(--am-brand-fg) / <alpha-value>)',
          soft: 'rgb(var(--am-brand-soft) / <alpha-value>)',
        },
        success: 'rgb(var(--am-success) / <alpha-value>)',
        warning: 'rgb(var(--am-warning) / <alpha-value>)',
        danger: 'rgb(var(--am-danger) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        serif: ['Lora', 'Georgia', 'serif'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      boxShadow: {
        card: '0 1px 2px rgb(15 23 42 / 0.04), 0 8px 24px -12px rgb(15 23 42 / 0.10)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-up': 'slide-up 200ms ease-out',
      },
    },
  },
  plugins: [],
};
