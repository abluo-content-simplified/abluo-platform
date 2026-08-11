/**
 * Client-side submission source / attribution collector — ADR-018 §12.
 *
 * Captures marketing attribution AUTOMATICALLY at submission time so no admin
 * has to wire hidden fields per form (the §12 requirement). Reusable by every
 * form (the Early Access modal/footer today; the generic Form Section in
 * slice 4). Returns a plain object merged into the submission `source` jsonb.
 *
 * Server-side fields (device_type, country, submitter_ip) are added by the API
 * route — they are not collected here. This helper only reads what the browser
 * knows: the current page, the true referrer, and campaign parameters.
 *
 * Privacy: this is first-party lead attribution captured alongside an explicit
 * GDPR consent on the form. It deliberately does NOT collect fingerprinting
 * signals (raw user-agent, timezone, screen) — that was the "Standard +
 * technical" option, not enabled.
 */
export function collectClientSource(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  // SSR / non-browser guard — return just the caller-supplied fields.
  if (typeof window === 'undefined') return { ...extra }

  const loc = window.location
  const params = new URLSearchParams(loc.search)

  const pick = (key: string): string | null => {
    const v = params.get(key)
    return v && v.trim() ? v.trim() : null
  }

  const referrer =
    typeof document !== 'undefined' && document.referrer ? document.referrer : null
  let referrer_domain: string | null = null
  if (referrer) {
    try {
      referrer_domain = new URL(referrer).hostname
    } catch {
      referrer_domain = null
    }
  }

  // Path pattern: /{locale}/{tenant}/{pageSlug} — index [2] is the page slug
  // (null on a tenant homepage, which has no page segment).
  const pathParts = loc.pathname.split('/').filter(Boolean)

  return {
    // Landing / current page
    page_url: loc.href,
    page_path: loc.pathname,
    page_slug: pathParts.length >= 3 ? pathParts[2] : null,
    // True referrer (where the visitor came from)
    referrer,
    referrer_domain,
    // Campaign attribution
    utm_source: pick('utm_source'),
    utm_medium: pick('utm_medium'),
    utm_campaign: pick('utm_campaign'),
    utm_term: pick('utm_term'),
    utm_content: pick('utm_content'),
    // Ad click IDs
    gclid: pick('gclid'),
    fbclid: pick('fbclid'),
    // Caller-supplied (entry point, CTA attribution) — override/extend the above
    ...extra,
  }
}
