import type { ReactElement, SVGProps } from 'react'

// ── Platform icon registry ────────────────────────────────────────────────────
//
// A single, hand-authored icon set for the whole platform.
//
// Rules every entry follows (enforced by src/components/icons/__tests__):
//   • 24×24 viewBox, so icons compose at any size via width/height
//   • stroke="currentColor" + fill="none" + strokeWidth 1.5 on the root <svg>
//   • no hardcoded colours — colour always comes from the surrounding text
//     colour (`color: var(--color-text-secondary)` etc.), never from the icon
//   • neutral, domain-free key names so a key never has to be renamed when the
//     section it was drawn for changes
//
// The first batch is normalised from the hand-drawn SVGs on the No!Logo site
// (grid / timer / columns / globe / target / share / connection / code /
// arrow-right / linkedin); the rest are platform staples.
//
// Do not consume ICONS directly in a section — render <Icon name="…" /> so the
// sizing and accessibility behaviour stays consistent.

export const ICONS = {
  // ── Derived from the No!Logo site ──────────────────────────────────────────
  grid: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" fill="currentColor" fillOpacity="0.2" />
    </svg>
  ),
  timer: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" strokeLinecap="round" />
      <path d="M3 12h2M19 12h2M12 3v2M12 19v2" strokeLinecap="round" />
    </svg>
  ),
  columns: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="2" y="7" width="6" height="10" rx="1" />
      <rect x="16" y="7" width="6" height="10" rx="1" />
      <rect x="9" y="3" width="6" height="18" rx="1" />
      <path d="M8 12h2M14 12h2" strokeLinecap="round" />
    </svg>
  ),
  globe: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </svg>
  ),
  target: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 12h6" strokeLinecap="round" />
      <path d="M12 9v3" strokeLinecap="round" />
    </svg>
  ),
  share: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="6" cy="12" r="2.4" />
      <circle cx="18" cy="6" r="2.4" />
      <circle cx="18" cy="18" r="2.4" />
      <path d="M8.4 10.8l7.2-3.6M8.4 13.2l7.2 3.6" strokeLinecap="round" />
    </svg>
  ),
  connection: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="2.5" y="6" width="8" height="6" rx="1.2" />
      <rect x="13.5" y="6" width="8" height="6" rx="1.2" />
      <path d="M10.5 9h3M12 12v2.5M7 17h10" strokeLinecap="round" />
    </svg>
  ),
  code: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M7.2 9.6L4.8 12l2.4 2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.8 9.6L19.2 12l-2.4 2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.2 7.2l-2.4 9.6" strokeLinecap="round" />
    </svg>
  ),
  'arrow-right': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M4 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  linkedin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="5" cy="5" r="1.6" />
      <path d="M5 9.5v9" strokeLinecap="round" />
      <path d="M10.5 18.5v-9" strokeLinecap="round" />
      <path d="M10.5 13.5a3.75 3.75 0 017.5 0v5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),

  // ── Platform staples ───────────────────────────────────────────────────────
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M4.5 12.5l5 5 10-11" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  ),
  minus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M5 12h14" strokeLinecap="round" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  ),
  menu: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </svg>
  ),
  'external-link': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M14 4h6v6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 4l-9 9" strokeLinecap="round" />
      <path
        d="M18 13.5V18a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  mail: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 7l8.5 6 8.5-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        d="M21 16.9v2.6a2 2 0 01-2.2 2 19.6 19.6 0 01-8.5-3 19.3 19.3 0 01-6-6 19.6 19.6 0 01-3-8.6A2 2 0 013.3 1.7h2.6a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L7 9.5a16 16 0 006 6l1.2-1.2a2 2 0 012.1-.4c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.4 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  'map-pin': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        d="M12 21.5c4.7-4.4 7-7.9 7-10.6a7 7 0 10-14 0c0 2.7 2.3 6.2 7 10.6z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10.5" r="2.5" />
    </svg>
  ),
  star: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        d="M12 3.5l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.8z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        d="M12 2.8l7.5 3v5.7c0 4.6-3.1 8.3-7.5 9.7-4.4-1.4-7.5-5.1-7.5-9.7V5.8z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M4 3.5V20h16" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 16v-4M12.5 16V8M17 16v-6" strokeLinecap="round" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 19.5a6.5 6.5 0 0113 0" strokeLinecap="round" />
      <path d="M16 5.2a3.5 3.5 0 010 5.6" strokeLinecap="round" />
      <path d="M18 14.4a6.5 6.5 0 013.5 5.1" strokeLinecap="round" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="3" />
      <path
        d="M19.1 14.5a1.6 1.6 0 00.3 1.8l.1.1a1.9 1.9 0 11-2.7 2.7l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5v.2a1.9 1.9 0 11-3.8 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a1.9 1.9 0 11-2.7-2.7l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1h-.2a1.9 1.9 0 110-3.8h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a1.9 1.9 0 112.7-2.7l.1.1a1.6 1.6 0 001.8.3h.1a1.6 1.6 0 001-1.5v-.2a1.9 1.9 0 113.8 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a1.9 1.9 0 112.7 2.7l-.1.1a1.6 1.6 0 00-.3 1.8v.1a1.6 1.6 0 001.5 1h.2a1.9 1.9 0 110 3.8h-.1a1.6 1.6 0 00-1.5 1z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  layers: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M12 2.5l9 4.75-9 4.75-9-4.75z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 12l9 4.75L21 12" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 16.75l9 4.75 9-4.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="4" y="10.5" width="16" height="10" rx="2" />
      <path d="M8 10.5V7a4 4 0 018 0v3.5" strokeLinecap="round" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8l4.7 4.7" strokeLinecap="round" />
    </svg>
  ),
  zap: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        d="M13 2.5L4.5 13.5H12l-1 8 8.5-11H12z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
} as const satisfies Record<string, ReactElement<SVGProps<SVGSVGElement>>>

/** Every valid icon key. */
export type IconName = keyof typeof ICONS

/** Stable, ordered list of every registered icon key. */
export const ICON_KEYS: IconName[] = Object.keys(ICONS) as IconName[]

/**
 * Options list for a Sanity `string` field:
 * `options: { list: ICON_OPTIONS }`.
 *
 * Titles are derived from the key so a new icon never needs a second edit.
 */
export const ICON_OPTIONS: { title: string; value: IconName }[] = ICON_KEYS.map((value) => ({
  title: value
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' '),
  value,
}))

/** Type guard — true when `value` is a registered icon key. */
export function isIconName(value: unknown): value is IconName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ICONS, value)
}
