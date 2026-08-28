'use client'

/**
 * CategoryListSection
 *
 * Reusable platform section for "what we plug into" / "what we cover" content:
 * a two-part header, a hairline grid of category columns each holding a list of
 * items, and an optional full-width callout bar underneath.
 *
 * Hairline grid pattern (same idea as MetricsSection, different mechanics):
 * the grid parent is painted with --color-border and the columns are painted
 * with the section's own surface colour, so the 1px `gap` between them reads as
 * a hairline rule. The callout sits at `marginTop: 1px` so that hairline
 * continues unbroken between the last grid row and the callout bar.
 *
 * Everything is CMS-driven — the header CTA and every string in the callout are
 * fields, never hardcoded copy. The callout is optional: when it is absent (or
 * has no content) the section renders the header + grid alone.
 *
 * 'use client' is required for the tenant-prefixed CTA hrefs (useParams), the
 * same approach MediaContentSection uses.
 */

import { useParams } from 'next/navigation'
import type { CategoryListSection as CategoryListSectionType, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { FadeIn } from '@/components/animation/FadeIn'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { resolveCta } from '@/lib/sanity/cta'
import { CtaButton } from '@/components/ui/CtaButton'
import { Icon } from '@/components/icons'

// ─── Pure helpers (unit-tested) ──────────────────────────────────────────────

/**
 * A callout only earns its bar if it carries something visible. An empty
 * `callout` object (editor opened it in Studio and left it blank) must not
 * render a stray strip below the grid.
 */
export function hasRenderableCallout(
  callout: CategoryListSectionType['callout'] | null | undefined
): boolean {
  if (!callout) return false
  return Boolean(callout.title || callout.description || callout.cta?.actionType)
}

/**
 * Columns must be painted with the section's own background so the 1px grid
 * gaps read as hairlines against the --color-border parent. Returns a CSS
 * custom-property expression — never a resolved colour — so theme switching
 * still works in RSC contexts.
 */
export function resolveColumnBackground(
  surfaceBackground: string | undefined
): string {
  return surfaceBackground ?? 'var(--color-background)'
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  section: CategoryListSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
}

export function CategoryListSection({ section, surface, designSystem }: Props) {
  const { eyebrow, title, intro, headerCta, categories, callout } = section

  const surfaceStyles = getSurfaceStyles(designSystem, surface)
  const columnBg = resolveColumnBackground(
    surfaceStyles?.backgroundColor as string | undefined
  )

  // Motion tokens — durationSlow for content sections; ms → seconds for motion/react
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  // tenantId and locale are URL params — not stored in Sanity. Internal page
  // CTAs come back from resolveCta() as a bare "/slug" and need the prefix.
  const params = useParams()
  const locale = params?.locale as string | undefined
  const tenantId = params?.tenant as string | undefined

  function withTenantPrefix(resolved: ReturnType<typeof resolveCta>) {
    if (resolved.type !== 'link' || resolved.external || !locale || !tenantId) return resolved
    const slug = resolved.href.startsWith('/') ? resolved.href.slice(1) : resolved.href
    return { ...resolved, href: `/${locale}/${tenantId}/${slug}` }
  }

  const resolvedHeaderCta = headerCta ? withTenantPrefix(resolveCta(headerCta)) : null
  const resolvedCalloutCta = callout?.cta ? withTenantPrefix(resolveCta(callout.cta)) : null

  const hasHeader = Boolean(eyebrow || title || intro || (resolvedHeaderCta && resolvedHeaderCta.type !== 'none'))
  const hasCategories = Boolean(categories && categories.length > 0)
  const showCallout = hasRenderableCallout(callout)

  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      {/* ── Header: heading left, intro + ghost CTA right ─────────────────── */}
      {hasHeader && (
        <div className="mb-14 flex flex-wrap items-end justify-between gap-8 md:mb-20">
          <SlideUp duration={duration} ease={ease} delay={0}>
            {eyebrow && (
              <p
                className="mb-5 text-xs font-semibold uppercase tracking-[0.2em]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {eyebrow}
              </p>
            )}
            {title && (
              <h2
                className="text-3xl font-semibold leading-snug tracking-tight md:text-4xl"
                style={{
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-heading)',
                }}
              >
                {title}
              </h2>
            )}
          </SlideUp>

          {(intro || (resolvedHeaderCta && resolvedHeaderCta.type !== 'none')) && (
            <SlideUp duration={duration} ease={ease} delay={0.1} className="max-w-full">
              {intro && (
                <p
                  className="text-base leading-relaxed"
                  style={{
                    color: 'var(--color-text-secondary)',
                    fontFamily: 'var(--font-body)',
                    maxWidth: '36ch',
                  }}
                >
                  {intro}
                </p>
              )}
              {resolvedHeaderCta && resolvedHeaderCta.type !== 'none' && (
                <CtaButton
                  cta={resolvedHeaderCta}
                  className="mt-6 inline-flex h-11 items-center gap-2 px-5 text-sm font-medium transition-opacity duration-150 hover:opacity-70"
                  style={{
                    color: 'var(--color-text-primary)',
                    backgroundColor: 'transparent',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-btn, var(--radius-md))',
                  }}
                >
                  <span>{resolvedHeaderCta.label}</span>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path
                      d="M2 7h10M8 3l4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </CtaButton>
              )}
            </SlideUp>
          )}
        </div>
      )}

      {/* ── Category columns — 1px gaps over --color-border read as hairlines ─ */}
      {hasCategories && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '1px',
            backgroundColor: 'var(--color-border)',
          }}
        >
          {categories!.map((category, index) => (
            <SlideUp
              key={category._key}
              duration={duration}
              ease={ease}
              delay={index * 0.05}
              className="h-full"
            >
              <div
                className="h-full px-8 py-10"
                style={{ backgroundColor: columnBg }}
              >
                {category.label && (
                  <h3
                    className="mb-6 text-xs font-bold uppercase tracking-[0.1em]"
                    style={{
                      color: 'var(--color-primary)',
                      fontFamily: 'var(--font-heading)',
                    }}
                  >
                    {category.label}
                  </h3>
                )}
                {category.items && category.items.length > 0 && (
                  <ul className="m-0 list-none p-0">
                    {category.items.map((item, itemIndex) => (
                      <li
                        key={item._key ?? `${category._key}-${itemIndex}`}
                        className="flex items-center gap-2.5 py-2.5 text-[0.9375rem] transition-colors duration-200 hover:[color:var(--color-text-primary)]"
                        style={{
                          color: 'var(--color-text-secondary)',
                          fontFamily: 'var(--font-body)',
                          borderBottom: '1px solid var(--color-border)',
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: 3,
                            height: 3,
                            borderRadius: '50%',
                            flexShrink: 0,
                            backgroundColor: 'var(--color-text-muted)',
                          }}
                        />
                        {item.text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </SlideUp>
          ))}
        </div>
      )}

      {/* ── Optional callout bar — marginTop 1px continues the hairline ────── */}
      {showCallout && (
        <FadeIn duration={duration} ease={ease} delay={0.1}>
          <div
            className="flex flex-wrap items-center justify-between gap-8 p-8 md:p-10"
            style={{
              marginTop: hasCategories ? '1px' : '2.5rem',
              backgroundColor: 'var(--color-surface, var(--color-background))',
              borderTop: hasCategories ? undefined : '1px solid var(--color-border)',
            }}
          >
            <div className="flex items-center gap-5">
              {/* Icon primitive is optional — a missing or unknown key renders no box. */}
              {callout?.icon && (
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: 44,
                    height: 44,
                    flexShrink: 0,
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--color-primary)',
                  }}
                >
                  <Icon name={callout.icon} size={20} />
                </div>
              )}
              <div>
                {callout?.title && (
                  <p
                    className="text-base font-bold tracking-tight"
                    style={{
                      color: 'var(--color-text-primary)',
                      fontFamily: 'var(--font-heading)',
                    }}
                  >
                    {callout.title}
                  </p>
                )}
                {callout?.description && (
                  <p
                    className="mt-1 text-sm leading-relaxed"
                    style={{
                      color: 'var(--color-text-secondary)',
                      fontFamily: 'var(--font-body)',
                    }}
                  >
                    {callout.description}
                  </p>
                )}
              </div>
            </div>

            {resolvedCalloutCta && resolvedCalloutCta.type !== 'none' && (
              <CtaButton
                cta={resolvedCalloutCta}
                className="inline-flex h-11 items-center gap-2 px-6 text-sm font-semibold tracking-wide transition-all duration-200 hover:opacity-90"
                style={{
                  backgroundColor: 'var(--btn-primary-bg)',
                  color: 'var(--btn-primary-text)',
                  borderRadius: 'var(--radius-btn, var(--radius-md))',
                }}
              />
            )}
          </div>
        </FadeIn>
      )}
    </SectionContainer>
  )
}
