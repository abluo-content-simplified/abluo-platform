import type { ClientsFlowSection, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { resolveEasing } from '@/lib/motion/easing'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'
import { renderHeadline } from '@/lib/headline-accent'

interface Props {
  section: ClientsFlowSection
  surface: SurfaceType
  designSystem: DesignSystem | null
}

/**
 * Clients flow — a roster set as one continuous typographic block.
 *
 * The names wrap like prose, separated by a glyph in the accent colour. It is
 * deliberately NOT a logo wall (which needs thirty licensed assets, all of them
 * a different weight and none of them in the site's palette) and NOT a scrolling
 * marquee (which moves for no reason, cannot be read at a glance, and hides
 * half the list at any moment). Thirty names set large enough to read ARE the
 * credential; nothing needs to move for that to land.
 *
 * ── Why the names are not localized ──────────────────────────────────────────
 * They are proper nouns. "BMW Alphabet" is "BMW Alphabet" in every language, and
 * giving them a localizedString would invite a translator to render them
 * differently per locale, which is exactly wrong for a client list. The schema
 * stores plain strings and GROQ passes them through untouched.
 *
 * ── Accessibility ────────────────────────────────────────────────────────────
 * A screen reader should hear a list of thirty clients, not thirty names glued
 * together by slashes. So the markup IS a list, the separators are decorative
 * spans hidden from the accessibility tree, and the visual run-on is achieved
 * with inline layout rather than by flattening the semantics into one string.
 */
/**
 * The glyph between names.
 *
 * Falls back to '/' for unset, null (the GROQ shape for an empty field) and for
 * whitespace — an author who clears the field to a space has not chosen "no
 * separator", they have left it blank, and thirty names with nothing between
 * them is unreadable. Choosing no separator is done by typing one that reads as
 * none, not by emptying the field.
 */
export function resolveSeparator(separator: string | null | undefined): string {
  return separator?.trim() || '/'
}

export function ClientsFlowSection({ section, surface, designSystem }: Props) {
  const { eyebrow, title, intro, names } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)
  const separator = resolveSeparator(section.separator)

  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  const hasHeader = Boolean(eyebrow || title || intro)
  if (!names?.length && !hasHeader) return null

  const hasAccentFace = Boolean(designSystem?.typography?.accentFont)

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
              className="mt-6"
              style={{
                fontFamily: hasAccentFace ? 'var(--font-accent)' : 'var(--font-body)',
                fontStyle: hasAccentFace ? 'italic' : 'normal',
                fontWeight: 300,
                fontSize: 'clamp(1.15rem, 2vw, 1.6rem)',
                lineHeight: 1.5,
                color: 'var(--color-text-secondary)',
                maxWidth: '42ch',
              }}
            >
              {intro}
            </p>
          )}
        </SlideUp>
      )}

      {names && names.length > 0 && (
        <SlideUp duration={duration} ease={ease}>
          {/* One list, laid out inline. `display:inline` on the items is what
              lets the run wrap mid-line like prose instead of breaking into a
              column of rows, while the <ul>/<li> keeps the semantics honest. */}
          <ul
            className="m-0 list-none p-0"
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 400,
              fontSize: 'clamp(1.5rem, 2.5vw, 3rem)',
              lineHeight: 1.4,
              textTransform: 'uppercase',
              letterSpacing: '0.02em',
              color: 'var(--color-text-primary)',
            }}
          >
            {names.map((name, index) => (
              <li key={`${name}-${index}`} className="inline">
                <span className="whitespace-nowrap">{name}</span>
                {index < names.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="select-none"
                    style={{ color: 'var(--color-primary)', opacity: 0.3, margin: '0 0.6rem' }}
                  >
                    {separator}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </SlideUp>
      )}
    </SectionContainer>
  )
}
