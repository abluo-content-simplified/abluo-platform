/**
 * Easing resolution for `motion/react`.
 *
 * The design-system `motion` schema stores easings as CSS strings
 * (`cubic-bezier(0, 0, 0.2, 1)`) because that is what editors know. Framer
 * Motion (`motion/react`) does NOT accept that syntax — it throws
 * `Invalid easing type 'cubic-bezier(...)'`, which unmounts the animation
 * wrapper and renders the whole section blank.
 *
 * `resolveEasing()` is the single conversion point between the two worlds.
 * It never throws: anything it cannot understand degrades to the fallback.
 */

/** Named easings accepted by motion (see `EasingDefinition` in motion-utils). */
export const NAMED_EASINGS = [
  'linear',
  'easeIn',
  'easeOut',
  'easeInOut',
  'circIn',
  'circOut',
  'circInOut',
  'backIn',
  'backOut',
  'backInOut',
  'anticipate',
] as const

export type NamedEasing = (typeof NAMED_EASINGS)[number]

/** A value that `motion/react` accepts as `transition.ease`. */
export type ResolvedEasing = number[] | NamedEasing

const NAMED_EASING_SET: ReadonlySet<string> = new Set<string>(NAMED_EASINGS)

/** `cubic-bezier( a , b , c , d )` — any whitespace, ints/decimals, optional sign, optional exponent. */
const CUBIC_BEZIER_RE =
  /^cubic-bezier\(\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)\s*,\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)\s*,\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)\s*,\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)\s*\)$/i

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Normalise a design-system easing token into something `motion/react` accepts.
 *
 * Accepts:
 *  - a CSS `cubic-bezier(a, b, c, d)` string  → `[a, b, c, d]`
 *  - an existing `number[]` of length 4       → returned unchanged
 *  - one of motion's named easings            → returned unchanged
 *
 * Anything else (null, undefined, malformed string, wrong-length or
 * non-numeric array, objects, functions) returns `fallback`.
 *
 * This function never throws.
 */
export function resolveEasing(value: unknown, fallback: ResolvedEasing): ResolvedEasing {
  if (Array.isArray(value)) {
    return value.length === 4 && value.every(isFiniteNumber) ? (value as number[]) : fallback
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()

    if (NAMED_EASING_SET.has(trimmed)) return trimmed as NamedEasing

    const match = CUBIC_BEZIER_RE.exec(trimmed)
    if (match) {
      const points = [
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
        Number(match[4]),
      ]
      if (points.every(isFiniteNumber)) return points
    }
  }

  return fallback
}
