import type { CareerTimelineSection, CareerRow, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { resolveEasing } from '@/lib/motion/easing'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'
import { renderHeadline } from '@/lib/headline-accent'

interface Props {
  section: CareerTimelineSection
  surface: SurfaceType
  designSystem: DesignSystem | null
}

/**
 * Career timeline — a dated CV.
 *
 * The period sits in a fixed left column and everything about the role sits on
 * the right. That fixed column is what makes it read as a timeline rather than
 * a list of jobs: the dates line up, so the eye can travel down them and skip
 * the prose. It holds 200px on desktop, narrows to 140px on tablet, and only
 * collapses above the role on a phone, where 140px of gutter would cost more
 * than the alignment is worth.
 *
 * ── Why `period` is a string and not a date ──────────────────────────────────
 * Real careers do not have clean date ranges. "2019 → present", "Aug → Dec
 * 2018", "1988 → 1994" and "Nov 2023 → Mar 2024" all appear on one CV, and the
 * varying precision is honest — a date picker would force a false precision and
 * then a formatter would flatten all four into the same shape. The wording is
 * content, so it is authored and translated like content.
 */
export function CareerTimelineSection({ section, surface, designSystem }: Props) {
  const { eyebrow, title, intro, rows } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  const hasHeader = Boolean(eyebrow || title || intro)
  if (!rows?.length && !hasHeader) return null

  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      {hasHeader && (
        <SlideUp duration={duration} ease={ease} className="mb-14">
          {eyebrow && (
            <EyebrowLabel
              eyebrow={eyebrow}
              designSystem={designSystem}
              defaultAccent="none"
              weight="semibold"
              className="mb-5"
            />
          )}
          {title && (
            <h2
              className="[--fs-h2:1.875rem] md:[--fs-h2:2.25rem]"
              style={{
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-heading)',
                fontSize: 'var(--font-size-h2, var(--fs-h2))',
                fontWeight: 'var(--font-weight-h2, 600)',
                lineHeight: 'var(--line-height-h2, 1.15)',
                letterSpacing: 'var(--letter-spacing-h2, -0.02em)',
                textTransform: 'uppercase',
              }}
            >
              {renderHeadline(title, section.headlineAccent)}
            </h2>
          )}
          {intro && (
            <p
              className="mt-6 text-base leading-relaxed"
              style={{ color: 'var(--color-text-secondary)', maxWidth: '52ch' }}
            >
              {intro}
            </p>
          )}
        </SlideUp>
      )}

      {rows && rows.length > 0 && (
        <ol className="m-0 flex list-none flex-col p-0">
          {rows.map((row: CareerRow, index: number) => (
            <SlideUp
              key={row._key}
              duration={duration}
              ease={ease}
              /* 0.06s per row — the cascade reads as one movement down the
                 column rather than as rows arriving independently. */
              delay={index * 0.06}
            >
              <li
                className="grid grid-cols-1 gap-y-1 py-11 md:grid-cols-[140px_1fr] md:gap-x-8 lg:grid-cols-[200px_1fr] lg:gap-x-16"
                style={{ borderBottom: '1px solid var(--color-border)' }}
              >
                {row.period && (
                  <p
                    className="text-[0.85rem] tracking-[0.06em] md:pt-[0.35rem]"
                    style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-body)' }}
                  >
                    {row.period}
                  </p>
                )}

                <div>
                  {row.role && (
                    <h3
                      className="[--fs-h4:1.375rem] md:[--fs-h4:1.75rem]"
                      style={{
                        color: 'var(--color-text-primary)',
                        fontFamily: 'var(--font-heading)',
                        fontSize: 'var(--font-size-h4, var(--fs-h4))',
                        fontWeight: 'var(--font-weight-h4, 600)',
                        lineHeight: 'var(--line-height-h4, 1.1)',
                        letterSpacing: 'var(--letter-spacing-h4, 0.01em)',
                        textTransform: 'uppercase',
                        marginBottom: '0.35rem',
                      }}
                    >
                      {row.role}
                    </h3>
                  )}
                  {row.org && (
                    <p
                      className="mb-2 text-[0.75rem] uppercase tracking-[0.2em]"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      {row.org}
                    </p>
                  )}
                  {row.note && (
                    <p
                      className="text-base"
                      style={{ color: 'var(--color-text-muted)', lineHeight: 1.75, maxWidth: '60ch' }}
                    >
                      {row.note}
                    </p>
                  )}
                  {row.award && (
                    <p
                      className="mt-3 inline-block px-[0.65rem] py-[0.3rem] text-[0.68rem] uppercase tracking-[0.15em]"
                      style={{ color: 'var(--color-primary)', border: '1px solid var(--color-primary)' }}
                    >
                      {row.award}
                    </p>
                  )}
                </div>
              </li>
            </SlideUp>
          ))}
        </ol>
      )}
    </SectionContainer>
  )
}
