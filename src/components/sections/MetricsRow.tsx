'use client'

import { useEffect, useRef, useState } from 'react'
import type { MetricItem } from '@/lib/sanity/types'

/**
 * MetricsRow — the hairline treatment, with the sequence that makes it land.
 *
 * ── Why not a count-up ───────────────────────────────────────────────────────
 * Three of tmz.it's four figures cannot be counted to. "4½" is not a number a
 * ticker reaches; "30+" would climb to 30 and then have a "+" appear from
 * nowhere; "25+" the same. Beyond the mechanics, a count-up is dashboard
 * language — it frames a figure as a measurement being proved. These are
 * identity marks, and the ½ is a joke about Dutch rather than a data point.
 * The source design turned it off deliberately (`metrics_countup: false`).
 *
 * ── What happens instead ─────────────────────────────────────────────────────
 * 1. The dividers DRAW, top-down, 0.06s apart. The grid builds itself.
 * 2. Each figure RISES out from behind its own top rule — the rule is the mask
 *    edge, so the numeral emerges from the line rather than fading in over it.
 *    Columns stagger 0.08s apart, the cadence the source already uses on
 *    `.stat` (transition-delay 0.08 / 0.16 / 0.24).
 * 3. The accent fragment inside a figure — the ½ in "4½" — arrives one beat
 *    after the digit it belongs to, so the distinctive part is the punchline
 *    rather than something you have already read past.
 *
 * The whole sequence runs once and never replays, matching the site's other
 * reveals (IntersectionObserver, unobserve after firing).
 *
 * Under `prefers-reduced-motion` every step is skipped and the row is simply
 * present — no fade, no rise, no drawn rules.
 */

/** Interval between divider draws. */
const RULE_STEP = 0.06
/** Interval between figure reveals. Matches the source's .stat stagger. */
const FIGURE_STEP = 0.08
/** How long after its digit the accent fragment lands. */
const ACCENT_LAG = 0.18
/** The dividers finish before the first figure begins to rise. */
const FIGURE_OFFSET = 0.28

/**
 * Split a figure into its plain body and its trailing accent fragment.
 *
 * The source paints a fragment INSIDE an otherwise plain string — the ½ of
 * "4½", not a separate field — so the split happens here rather than asking an
 * editor to mark it up. Vulgar fractions and a trailing "+" are the two shapes
 * that occur; anything else returns no accent and renders as one piece, which
 * is the safe default for a value nobody anticipated.
 */
export function splitAccentFragment(value: string): { body: string; accent: string } {
  const m = /^(.*?)([½¼¾⅓⅔⅛+])$/u.exec(value)
  if (!m || m[1] === '') return { body: value, accent: '' }
  return { body: m[1], accent: m[2] }
}

export function MetricsRow({ metrics }: { metrics: MetricItem[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true)
            io.unobserve(e.target) // fires once — reveals never replay
          }
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className="grid grid-cols-2 md:grid-cols-4"
      style={{ borderTop: '1px solid var(--color-border)' }}
    >
      {metrics.map((metric, i) => {
        const { body, accent } = splitAccentFragment(metric.value ?? '')
        const isLast = i === metrics.length - 1
        return (
          <div key={metric._key} className="relative py-8 pr-8 md:pr-12">
            {/* The divider. Drawn with scaleY from the top so it grows down the
                column, and skipped on the last one — a trailing rule at the end
                of a row fences nothing. */}
            {!isLast && (
              <span
                aria-hidden="true"
                className="absolute right-0 top-0 hidden h-full w-px origin-top md:block"
                style={{
                  backgroundColor: 'var(--color-border)',
                  transform: shown ? 'scaleY(1)' : 'scaleY(0)',
                  transition: `transform 0.5s cubic-bezier(0.16,1,0.3,1) ${i * RULE_STEP}s`,
                }}
              />
            )}

            {/* The mask. `overflow: hidden` on a box whose top edge sits on the
                section rule is what makes the figure emerge FROM the line. */}
            <div className="overflow-hidden">
              <p
                className="whitespace-nowrap leading-none"
                style={{
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-heading)',
                  fontWeight: 700,
                  fontSize: 'var(--font-size-h3, clamp(3.5rem, 6vw, 7rem))',
                  letterSpacing: '-0.02em',
                  transform: shown ? 'translateY(0)' : 'translateY(110%)',
                  transition: `transform 0.9s cubic-bezier(0.16,1,0.3,1) ${
                    FIGURE_OFFSET + i * FIGURE_STEP
                  }s`,
                }}
              >
                {body}
                {accent && (
                  <span
                    style={{
                      color: 'var(--color-primary)',
                      opacity: shown ? 1 : 0,
                      transition: `opacity 0.5s ease ${
                        FIGURE_OFFSET + i * FIGURE_STEP + ACCENT_LAG
                      }s`,
                    }}
                  >
                    {accent}
                  </span>
                )}
              </p>
            </div>

            {metric.label && (
              <p
                className="mt-4 text-[0.75rem] uppercase tracking-[0.2em]"
                style={{
                  color: 'var(--color-text-muted)',
                  fontFamily: 'var(--font-body)',
                  opacity: shown ? 1 : 0,
                  transition: `opacity 0.6s ease ${FIGURE_OFFSET + i * FIGURE_STEP + 0.1}s`,
                }}
              >
                {metric.label}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
