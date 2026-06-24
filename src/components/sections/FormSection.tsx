/**
 * FormSection — renders a form from the Form System in a page section.
 *
 * Server component: fetches nothing (data comes via GROQ reference dereference).
 * Delegates rendering to FormRenderer (client component).
 *
 * Signature matches all section components:
 *   ({ section, surface, designSystem, locale })
 */

import type { FormSection, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { FormRenderer } from '@/components/forms/FormRenderer'
import { getFormSectionMessages } from '@/lib/i18n/form-section-messages'

interface Props {
  section: FormSection
  surface: SurfaceType
  designSystem: DesignSystem | null
  locale?: string
  /** URL tenant slug — passed to FormRenderer for tenant_id resolution */
  tenantSlug?: string
}

export function FormSection({ section, surface, designSystem, locale = 'en', tenantSlug }: Props) {
  const surfaceStyles = getSurfaceStyles(designSystem, surface)
  const messages = getFormSectionMessages(locale)

  if (!section.form) return null

  return (
    <section
      className="px-6 py-24 md:px-16 lg:px-24"
      style={surfaceStyles}
    >
      <div className="mx-auto w-full max-w-2xl">
        <FormRenderer
          form={section.form}
          messages={messages}
          locale={locale}
          tenantSlug={tenantSlug}
        />
      </div>
    </section>
  )
}
