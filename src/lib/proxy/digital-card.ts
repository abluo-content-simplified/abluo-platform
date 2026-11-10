/**
 * Digital Cards website paths (ADR-049 D10) — shared by the proxy (which marks
 * the responses) and the website layout (which reads the marker and renders
 * the bare card layout: design-system CSS only, no header, footer, consent
 * banner, tracking scripts or first-touch recorder).
 *
 * Matches, each with an optional `/{locale}` and an optional `/{project}`
 * prefix (the project segment is part of the URL on platform hosts —
 * `preview.abluo.app/hoffmann/card` — and of the internal rewrite target):
 *
 *   /card                     the site card
 *   /card/<name>              a person card
 *   /card/contact.vcf         the site card's Save contact
 *   /card/<name>/contact.vcf  a person card's Save contact
 *
 * `<name>` uses the URL-name shape of model.ts (lower-case words joined by
 * hyphens), so `contact.vcf` can never be read as a name.
 */
export const DIGITAL_CARD_HEADER = 'x-abluo-card'

const DIGITAL_CARD_PATH = /^(?:\/[a-z]{2})?(?:\/[a-z0-9][a-z0-9-]*)?\/card(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?(?:\/contact\.vcf)?\/?$/

export function isDigitalCardPath(pathname: string): boolean {
  return typeof pathname === 'string' && pathname.length <= 200 && DIGITAL_CARD_PATH.test(pathname)
}
