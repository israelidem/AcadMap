/** @type {import('tailwindcss').Config} */

/*
 * AcadMap — "Registry" design language.
 *
 * The subject is a student's own academic record, so the interface borrows from
 * the document it replaces: manila-grey paper, ruled rows, duplicating-ink
 * violet, and monospaced figures in every column that holds a number.
 *
 * Radii are deliberately re-mapped rather than extended. Pages across the app
 * already say `rounded-xl` / `rounded-2xl`; overriding the scale means the whole
 * product picks up the tighter, printed geometry without touching every page.
 */
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
        rule: 'rgb(var(--am-rule) / <alpha-value>)',
        fg: 'rgb(var(--am-fg) / <alpha-value>)',
        muted: 'rgb(var(--am-muted) / <alpha-value>)',
        brand: {
          DEFAULT: 'rgb(var(--am-brand) / <alpha-value>)',
          fg: 'rgb(var(--am-brand-fg) / <alpha-value>)',
          soft: 'rgb(var(--am-brand-soft) / <alpha-value>)',
          ink: 'rgb(var(--am-brand-ink) / <alpha-value>)',
        },
        accent: 'rgb(var(--am-accent) / <alpha-value>)',
        success: 'rgb(var(--am-success) / <alpha-value>)',
        warning: 'rgb(var(--am-warning) / <alpha-value>)',
        danger: 'rgb(var(--am-danger) / <alpha-value>)',
      },
      fontFamily: {
        display: ['Archivo', 'Archivo Expanded', 'Helvetica Neue', 'system-ui', 'sans-serif'],
        sans: ['IBM Plex Sans', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        micro: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.08em' }],
      },
      borderRadius: {
        none: '0',
        sm: '0.125rem',
        DEFAULT: '0.1875rem',
        md: '0.25rem',
        lg: '0.3125rem',
        xl: '0.375rem',
        '2xl': '0.5rem',
        '3xl': '0.625rem',
        full: '9999px',
      },
      boxShadow: {
        /* Printed stock sits on the page; it does not float above it. */
        card: '0 1px 0 0 rgb(var(--am-rule) / 0.9)',
        plate:
          'inset 0 0 0 1px rgb(var(--am-brand) / 0.25), 0 1px 0 0 rgb(var(--am-rule) / 0.9)',
        lift: '0 8px 24px -16px rgb(20 19 31 / 0.45)',
      },
      backgroundImage: {
        /* The ruled sheet the whole app is written on. */
        ruled:
          'repeating-linear-gradient(to bottom, transparent 0 31px, rgb(var(--am-rule) / 0.55) 31px 32px)',
        hatch:
          'repeating-linear-gradient(135deg, rgb(var(--am-brand) / 0.10) 0 2px, transparent 2px 7px)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        /* A ledger row is filled in from the left, the way a column is totalled. */
        tally: {
          from: { transform: 'scaleX(0)' },
          to: { transform: 'scaleX(1)' },
        },
        stamp: {
          from: { opacity: '0', transform: 'scale(1.06) rotate(-2.5deg)' },
          to: { opacity: '1', transform: 'scale(1) rotate(-1.5deg)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-up': 'slide-up 200ms ease-out',
        tally: 'tally 620ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        stamp: 'stamp 320ms cubic-bezier(0.2, 0.9, 0.3, 1) both',
      },
    },
  },
  plugins: [],
};
