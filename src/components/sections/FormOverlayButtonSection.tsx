/**
 * FormOverlayButtonSection — ADR-018 slice 7b.
 *
 * A page section that renders a single button which opens a tenant-owned
 * `formDefinition` as an OVERLAY (rather than rendering the form inline like
 * FormSection). Self-contained: it mounts its own FormOverlayProvider/host
 * (via FormOverlayWrapper) seeded with just this button's dereferenced
 * definition, so no layout-level wiring is required for a page button.
 *
 * The overlay reuses the slice 4/5 renderers verbatim and the same
 * single-vs-multi routing as FormSection (see overlay.ts / FormOverlayHost).
 *
 * Server component: the definition arrives via GROQ reference dereference
 * (section.definition — same `form->` projection FormSection uses). Signature
 * matches all section components: ({ section, surface, designSystem, locale, tenantSlug }).
 */

import type { FormOverlayButtonSection as SectionType, DesignSystem, FormSectionContextItem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { FormOverlayWrapper } from '@/components/forms/FormOverlayWrapper'
import { FormOverlayTrigger } from '@/components/forms/FormOverlayTrigger'
import { overlayButtonClass, overlayButtonAlignClass, overlayButtonTextAlignClass, overlayButtonWidthClass } from '@/lib/forms/overlay-button'
import type { UrlProjectSegment } from '@/lib/tenancy/ids'

interface Props {
  section: SectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
  locale?: string
  /** URL tenant slug — the submission route scope; required to submit. */
  /** The `[tenant]` URL segment — not a tenant slug. See `@/lib/tenancy/ids`. */
  tenantSlug?: UrlProjectSegment
}

/** Turns the editor's Context key/value list into a plain map for pre-fill. */
function buildContextMap(items: FormSectionContextItem[] | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of items ?? []) {
    if (item?.key) out[item.key] = item.value ?? ''
  }
  return out
}

export function FormOverlayButtonSection({ section, surface, designSystem, locale = 'en', tenantSlug }: Props) {
  const def = section.definition
  if (!def || !tenantSlug) return null

  const surfaceStyles = getSurfaceStyles(designSystem, surface)
  const context = buildContextMap(section.context)
  const label = section.buttonLabel ?? def.title ?? 'Open form'
  const fullWidth = section.buttonFullWidth === true
  const buttonClass = `${overlayButtonClass(section.buttonStyle)} ${overlayButtonWidthClass(fullWidth)}`.trim()

  const hasLeadIn = !!(section.eyebrow || section.title || section.body)

  return (
    <section id={section.anchorId} className="px-6 py-16 md:px-16 lg:px-24" style={surfaceStyles}>
      {hasLeadIn && (
        <div className={`mx-auto mb-8 w-full max-w-2xl ${overlayButtonTextAlignClass(section.buttonAlign)}`}>
          {section.eyebrow && (
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-primary)]">{section.eyebrow}</p>
          )}
          {section.title && (
            <h2
              className="[--fs-h2:1.875rem] md:[--fs-h2:2.25rem]"
              style={{
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-heading)',
                fontSize: 'var(--font-size-h2, var(--fs-h2))',
                fontWeight: 'var(--font-weight-h2, 600)',
                lineHeight: 'var(--line-height-h2, 1.375)',
                letterSpacing: 'var(--letter-spacing-h2, -0.025em)',
              }}
            >
              {section.title}
            </h2>
          )}
          {section.body && (
            <p className="mt-3 whitespace-pre-line text-base leading-relaxed" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}>
              {section.body}
            </p>
          )}
        </div>
      )}
      <div className={`mx-auto flex w-full max-w-2xl ${overlayButtonAlignClass(section.buttonAlign)}`}>
        <FormOverlayWrapper
          tenantSlug={tenantSlug}
          locale={locale}
          forms={[{ formId: def.formId, definition: def }]}
        >
          <FormOverlayTrigger
            formId={def.formId}
            context={context}
            title={section.overlayTitle ?? undefined}
            source={{ source: 'page_button' }}
            className={buttonClass}
          >
            {label}
          </FormOverlayTrigger>
        </FormOverlayWrapper>
      </div>
    </section>
  )
}
