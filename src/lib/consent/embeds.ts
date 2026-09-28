// ─── Cookie consent — embed vendors (ADR-021) ────────────────────────────────
//
// Third-party embeds consented at the point of use (click-to-load). The id is
// what the consent cookie stores; the name is a proper noun shown to visitors.

export const EMBED_VENDORS: Record<string, { name: string }> = {
  'google-maps': { name: 'Google Maps' },
}

export function embedVendorName(id: string): string {
  return EMBED_VENDORS[id]?.name ?? id
}
