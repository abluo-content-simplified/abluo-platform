// ── Lightbox deep links (ADR-022 §5) ──────────────────────────────────────────
// Opening the third photo changes the address to …#photo-3, so a copied link
// opens straight on that photo. A hash, not a query parameter: it never reaches
// the server, never changes the canonical URL, and never creates a new page for
// search engines.
//
// A section with an authored anchor id namespaces its photos (#studio-photo-3)
// so two galleries on one page do not answer the same link. Numbers are
// 1-based and count the photos of the placement's combined set — the "All"
// view — so a link keeps pointing at the same photo whichever tab was open.

export function hashPrefix(anchorId?: string | null): string {
  const clean = (anchorId ?? '').trim().replace(/^#/, '')
  return clean ? `${clean}-photo-` : 'photo-'
}

export function photoHash(prefix: string, index: number): string {
  return `#${prefix}${index + 1}`
}

/** 0-based index for a hash this placement owns, or null. */
export function parsePhotoHash(hash: string | null | undefined, prefix: string): number | null {
  if (!hash) return null
  const h = hash.startsWith('#') ? hash.slice(1) : hash
  if (!h.startsWith(prefix)) return null
  const rest = h.slice(prefix.length)
  if (!/^[1-9][0-9]{0,3}$/.test(rest)) return null
  return Number(rest) - 1
}
