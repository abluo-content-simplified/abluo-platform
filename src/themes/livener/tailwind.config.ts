/**
 * Livener Tailwind Theme Extension
 * Drop into the main tailwind.config.ts as a preset or theme extension.
 */

const livenerTheme = {
  colors: {
    // Backgrounds
    'bg-dark':       '#161d2b',
    'bg-dark-2':     '#282a33',
    'bg-purple':     '#363366',
    'bg-orange':     '#f8a52a',
    'bg-black':      '#080808',

    // Brand accents
    orange:   '#f8a52a',
    'orange-2': '#ffa22a',
    red:      '#ee2139',
    'red-2':  '#ea384c',
    cyan:     '#00ccde',
    blue:     '#2895f7',
    'blue-2': '#0082f3',
    indigo:   '#4255bd',
    green:    '#47dca5',

    // Text
    white:   '#ffffff',
    light:   '#e6e6e6',
    muted:   '#758696',
    dark:    '#1a1a1a',
    mid:     '#5d6c7b',

    // UI
    border:       '#353b41',
    'border-light': '#e2e2e2',
  },

  fontFamily: {
    heading: ['Barlow Condensed', 'sans-serif'],
    body:    ['Poppins', 'sans-serif'],
    sans:    ['Poppins', 'sans-serif'],
  },

  fontSize: {
    xs:   ['0.75rem',  { lineHeight: '1rem' }],
    sm:   ['0.875rem', { lineHeight: '1.25rem' }],
    base: ['1rem',     { lineHeight: '1.5rem' }],
    md:   ['1.125rem', { lineHeight: '1.75rem' }],
    lg:   ['1.25rem',  { lineHeight: '1.875rem' }],
    xl:   ['1.5rem',   { lineHeight: '2rem' }],
    '2xl': ['2rem',    { lineHeight: '2.25rem' }],
    '3xl': ['2.5rem',  { lineHeight: '2.75rem' }],
    '4xl': ['3.5rem',  { lineHeight: '1.1' }],
    '5xl': ['5rem',    { lineHeight: '1' }],
  },

  fontWeight: {
    light:    '300',
    normal:   '400',
    medium:   '500',
    semibold: '600',
    bold:     '700',
  },

  borderRadius: {
    sm:   '4px',
    DEFAULT: '8px',
    md:   '8px',
    lg:   '16px',
    xl:   '24px',
    full: '9999px',
  },

  spacing: {
    // Standard Tailwind scale preserved, key values:
    px: '1px',
    0: '0',
    1: '0.25rem',
    2: '0.5rem',
    3: '0.75rem',
    4: '1rem',
    5: '1.25rem',
    6: '1.5rem',
    8: '2rem',
    10: '2.5rem',
    12: '3rem',
    16: '4rem',
    20: '5rem',
    24: '6rem',
    32: '8rem',
    40: '10rem',
    48: '12rem',
    64: '16rem',
  },

  maxWidth: {
    sm:  '640px',
    md:  '768px',
    lg:  '1024px',
    xl:  '1280px',
    '2xl': '1440px',
  },

  boxShadow: {
    sm:  '0 1px 3px rgba(0,0,0,0.3)',
    md:  '0 4px 16px rgba(0,0,0,0.4)',
    lg:  '0 8px 32px rgba(0,0,0,0.5)',
    'glow-orange': '0 0 24px rgba(248,165,42,0.4)',
    'glow-cyan':   '0 0 24px rgba(0,204,222,0.35)',
  },

  transitionTimingFunction: {
    default: 'cubic-bezier(0.4, 0, 0.2, 1)',
    spring:  'cubic-bezier(0.34, 1.56, 0.64, 1)',
    'ease-out': 'cubic-bezier(0, 0, 0.2, 1)',
  },

  transitionDuration: {
    fast:   '150ms',
    normal: '300ms',
    slow:   '500ms',
    enter:  '400ms',
  },
} as const;

export default livenerTheme;
