/**
 * Platform animations (ADR-046) — the small set every Abluo site may use,
 * shipped with the code (not uploaded into one tenant's Media Library) and
 * recoloured per site through named colour slots.
 *
 * Every entry records where it came from and under which licence, so the set
 * can be audited without guessing later. An animation made for one client
 * (the Freeriders rider) is NOT here: it lives in that project's Media Library.
 *
 * Adding one: the Lottie JSON beside this file + one entry; `platform.test.ts`
 * checks every file is a valid animation and declares the slots listed.
 */
import checkmark from './checkmark.json'

export type PlatformAnimation = {
  id: string
  /** The Lottie JSON. */
  data: Record<string, unknown>
  /** Colour slots it declares (set from the site's design system when played). */
  slots: string[]
  /** What it is for, in one line (admin-only English). */
  purpose: string
  source: string
  license: string
}

export const PLATFORM_ANIMATIONS: PlatformAnimation[] = [
  {
    id: 'checkmark',
    data: checkmark as Record<string, unknown>,
    slots: ['accent'],
    purpose: 'Confirmation that something was sent or saved (contact form sent, booking received): a ring draws, then a tick.',
    source: 'Abluo — drawn for the platform, 2026-11-03',
    license: 'Abluo original (no third-party rights)',
  },
]

export function platformAnimation(id: string): PlatformAnimation | null {
  return PLATFORM_ANIMATIONS.find((a) => a.id === id) ?? null
}

/** `#rrggbb` → a Lottie colour slot value (RGBA 0–1), or null. Pure. */
export function hexToLottieColor(hex: string): [number, number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex?.trim() ?? '')
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1]
}
