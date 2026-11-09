// ── Reservations — Sanity reads of the notification sweep ───────────────────
// Exported constants so every fetchForTenant call site names an imported query
// (fetch-for-tenant-call-sites.test.ts proves each is tenant-scoped).

/** Website Settings facts for booking emails: name, time zone, contact address, logo. */
export const RESERVATION_SITE_QUERY = /* groq */ `
  *[_type == "siteConfig" && projectSlug == $projectSlug][0] {
    siteName, timeZone, email,
    "logoUrl": logo.asset->url
  }
`
