/**
 * FormSection — renders a tenant-owned formDefinition in a page section.
 *
 * ADR-018 slice 4: the section now references a `formDefinition` (not the legacy
 * `form`) and delegates to FormDefinitionRenderer, which submits to the new
 * `/api/forms/{tenantSlug}/{formId}/submissions` endpoint. Single-step only this
 * slice — a multi-step definition renders nothing (slice 5).
 *
 * Server component: data arrives via GROQ reference dereference (section.definition).
 * Signature matches all section components: ({ section, surface, designSystem, locale }).
 */

import type { FormSection, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { FormDefinitionRenderer } from '@/components/forms/FormDefinitionRenderer'
import { getFormSectionMessages } from '@/lib/i18n/form-section-messages'

interface Props {
  section: FormSection
  surface: SurfaceType
  designSystem: DesignSystem | null
  locale?: string
  /** URL tenant slug — the submission route scope; required to submit. */
  tenantSlug?: string
}

export function FormSection({ section, surface, designSystem, locale = 'en', tenantSlug }: Props) {
  const surfaceStyles = getSurfaceStyles(designSystem, surface)
  const messages = getFormSectionMessages(locale)

  // No definition, or no tenant scope to submit to → render nothing.
  if (!section.definition || !tenantSlug) return null

  return (
    <section className="px-6 py-24 md:px-16 lg:px-24" style={surfaceStyles}>
      <div className="mx-auto w-full max-w-2xl">
        <FormDefinitionRenderer
          definition={section.definition}
          messages={messages}
          locale={locale}
          tenantSlug={tenantSlug}
        />
      </div>
    </section>
  )
}
