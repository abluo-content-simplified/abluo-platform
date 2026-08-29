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

import type { Cta, CtaContextItem, ResolvedCta } from './types'
import { isPassThroughHref, withTenantPrefix } from './href'

/**
 * Turns the editor's Context key/value list into a plain pre-fill map — the
 * same shape FormOverlayButtonSection builds for FormOverlayTrigger.
 *
 * Returns undefined when there is nothing to pre-fill (no list, empty list, or
 * only keyless rows), so a CTA without Context resolves to exactly the object
 * it resolved to before this field existed.
 */
function buildCtaContext(
  items: CtaContextItem[] | null | undefined
): Record<string, string> | undefined {
  if (!items?.length) return undefined
  const out: Record<string, string> = {}
  for (const item of items) {
    if (item?.key) out[item.key] = item.value ?? ''
  }
  return Object.keys(out).length > 0 ? out : undefined
}

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
        href: isPassThroughHref(cta.pageSlug) || cta.pageSlug.startsWith('/')
          ? cta.pageSlug
          : `/${cta.pageSlug}`,
        external: false,
      }
    }

    case 'form': {
      if (!cta.formId) return { type: 'none', label, internalName }
      const context = buildCtaContext(cta.context)
      return {
        type: 'form',
        label,
        internalName,
        formId: cta.formId,
        // Spread, not `context: undefined` — a CTA without Context must resolve
        // to the identical object (no extra key) it did before.
        ...(context ? { context } : {}),
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
 * Apply the `/{locale}/{tenant}/` prefix to a resolved CTA's href.
 *
 * This is the single implementation every section component uses. It only
 * touches `type: 'link'` CTAs that are not flagged external, and it delegates
 * the "is this actually an internal path?" decision to withTenantPrefix() —
 * so `#anchor`, `mailto:`, `tel:`, `sms:`, `https://` and `//cdn…` hrefs are
 * returned verbatim, while `/about`, `about` and `/pricing#tiers` are
 * prefixed exactly as before.
 *
 * Non-link CTAs (form, download, none) and CTAs resolved without locale or
 * tenant URL params are returned unchanged.
 */
export function prefixCtaHref(
  resolved: ResolvedCta,
  locale: string | null | undefined,
  tenantId: string | null | undefined
): ResolvedCta {
  if (resolved.type !== 'link' || resolved.external || !locale || !tenantId) return resolved
  const href = withTenantPrefix(resolved.href, locale, tenantId)
  if (href === resolved.href) return resolved
  return { ...resolved, href }
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
