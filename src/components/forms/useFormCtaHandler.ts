'use client'

/**
 * One place that turns a resolved form CTA into its click handler.
 *
 * Every section that renders a `CtaButton` must pass `onFormClick`, or a form
 * CTA renders as a button that does nothing — which is exactly what happened to
 * the Steps section's closing CTA (QA 2026-10-02): Hero and CtaBanner had the
 * bridge, Steps, MediaContent, MediaFeature and CategoryList did not. Each
 * section had its own copy of the bridge, so a new section had to remember to
 * copy it. It now calls this hook instead.
 */

import { useCallback } from 'react'
import type { ResolvedCta } from '@/lib/sanity/types'
import { useFormOverlaySafe } from './FormOverlayContext'

type Overlay = ReturnType<typeof useFormOverlaySafe>

/**
 * Pure core: the handler that opens `cta`'s form in the overlay, or undefined
 * when `cta` is not a form CTA or no overlay is mounted on this page (the
 * button still renders, with no handler — the pre-existing behaviour).
 *
 * `source` names the entry point for lead attribution (e.g. 'steps_section').
 */
export function buildFormCtaHandler(
  cta: ResolvedCta | null | undefined,
  overlay: Overlay,
  source: string,
): (() => void) | undefined {
  if (!cta || cta.type !== 'form' || !cta.formId || !overlay) return undefined
  const formId = cta.formId
  // Optional authored pre-fill. Omitted entirely when the CTA has none.
  const context = cta.context
  return () =>
    overlay.open({
      formId,
      ...(context ? { context } : {}),
      source: {
        source,
        cta_internal_name: cta.internalName ?? null,
        cta_label_snapshot: cta.label ?? null,
      },
    })
}

/** Hook form: `const formHandler = useFormCtaHandler('steps_section')`. */
export function useFormCtaHandler(source: string) {
  const overlay = useFormOverlaySafe()
  return useCallback(
    (cta: ResolvedCta | null | undefined) => buildFormCtaHandler(cta, overlay, source),
    [overlay, source],
  )
}
