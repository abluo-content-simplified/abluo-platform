/**
 * CTA resolution utilities for the Abluo platform.
 *
 * resolveCta() converts a raw Sanity Cta object (after GROQ projection with
 * CTA_FIELDS) into a ResolvedCta discriminated union. Consuming components
 * switch on `type` to render the right HTML element — Link, <a download>,
 * or a form-trigger button.
 *
 * This file is intentionally free of React or Next.js imports.
 * It can be used in both server and client components.
 */

import type { Cta, ResolvedCta } from './types'

/**
 * Resolve a raw Sanity CTA object into a typed action descriptor.
 *
 * Returns `{ type: 'none' }` when:
 * - The CTA object is null/undefined
 * - The actionType is set but the required target is missing
 *   (e.g. page CTA with no pageSlug yet — editor hasn't finished filling it in)
 *
 * The consuming component should handle `type: 'none'` gracefully
 * (render nothing, or render a disabled button) rather than crashing.
 */
export function resolveCta(cta: Cta | null | undefined): ResolvedCta {
  const label = cta?.label ?? ''
  const internalName = cta?.internalName ?? ''

  if (!cta || !cta.actionType) {
    return { type: 'none', label, internalName }
  }

  switch (cta.actionType) {
    case 'page': {
      if (!cta.pageSlug) return { type: 'none', label, internalName }
      // Return just the slug — components prepend /${locale}/${tenant}/ at render time
      // using useParams() since tenantId is a URL param, not stored in Sanity.
      return {
        type: 'link',
        label,
        internalName,
        href: cta.pageSlug.startsWith('/') ? cta.pageSlug : `/${cta.pageSlug}`,
        external: false,
      }
    }

    case 'form': {
      if (!cta.formId) return { type: 'none', label, internalName }
      return {
        type: 'form',
        label,
        internalName,
        formId: cta.formId,
        formInquiryType: cta.formInquiryType,
      }
    }

    case 'fileDownload': {
      if (!cta.fileUrl) return { type: 'none', label, internalName }
      return {
        type: 'download',
        label,
        internalName,
        href: cta.fileUrl,
        fileName: cta.fileName,
      }
    }

    case 'externalUrl': {
      if (!cta.externalUrl) return { type: 'none', label, internalName }
      return {
        type: 'link',
        label,
        internalName,
        href: cta.externalUrl,
        external: cta.openInNewTab ?? true,
      }
    }

    default:
      return { type: 'none', label, internalName }
  }
}

/**
 * Resolve an array of raw CTAs. Filters out unresolvable ones (type: 'none').
 * Useful when a section has an array of CTAs (e.g. primary + secondary).
 */
export function resolveCtaList(
  ctas: (Cta | null | undefined)[] | null | undefined
): ResolvedCta[] {
  if (!ctas?.length) return []
  return ctas
    .map(resolveCta)
    .filter((c): c is Exclude<ResolvedCta, { type: 'none' }> => c.type !== 'none')
}
