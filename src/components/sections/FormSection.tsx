/**
 * FormSection — renders a tenant-owned formDefinition in a page section.
 *
 * ADR-018 slice 4: references a `formDefinition`, submits to the new endpoint.
 * ADR-018 slice 5: routes single-step → FormDefinitionRenderer, multi-step →
 * MultiStepFormRenderer (rotating-token flow + context-aware first step). The
 * placement's static Context (section.context) pre-fills contextMappable fields.
 *
 * Server component: data arrives via GROQ reference dereference (section.definition).
 * Signature matches all section components: ({ section, surface, designSystem, locale }).
 */

import type { FormSection, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { FormDefinitionRenderer } from '@/components/forms/FormDefinitionRenderer'
import { MultiStepFormRenderer } from '@/components/forms/MultiStepFormRenderer'
import { getFormSectionMessages } from '@/lib/i18n/form-section-messages'

interface Props {
  section: FormSection
  surface: SurfaceType
  designSystem: DesignSystem | null
  locale?: string
  /** URL tenant slug — the submission route scope; required to submit. */
  tenantSlug?: string
}

/** Turns the editor's Context key/value list into a plain map for pre-fill. */
function buildContextMap(items: FormSection['context']): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of items ?? []) {
    if (item?.key) out[item.key] = item.value ?? ''
  }
  return out
}

export function FormSection({ section, surface, designSystem, locale = 'en', tenantSlug }: Props) {
  const surfaceStyles = getSurfaceStyles(designSystem, surface)
  const messages = getFormSectionMessages(locale)

  const def = section.definition
  if (!def || !tenantSlug) return null

  const isMultiStep = (def.steps?.length ?? 0) > 1
  const context = buildContextMap(section.context)

  return (
    <section className="px-6 py-24 md:px-16 lg:px-24" style={surfaceStyles}>
      <div className="mx-auto w-full max-w-2xl">
        {def.eyebrow && (
          <p className="text-[var(--color-primary)] text-[10px] font-bold uppercase tracking-[0.14em] mb-3">{def.eyebrow}</p>
        )}
        {isMultiStep ? (
          <MultiStepFormRenderer
            definition={def}
            messages={messages}
            locale={locale}
            tenantSlug={tenantSlug}
            context={context}
            source={{ source: 'inline_section' }}
          />
        ) : (
          <FormDefinitionRenderer
            definition={def}
            messages={messages}
            locale={locale}
            tenantSlug={tenantSlug}
            source={{ source: 'inline_section' }}
          />
        )}
      </div>
    </section>
  )
}
