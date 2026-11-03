/**
 * Where a term picker's "Manage" link leads. The Catalogue keeps its categories and tags in
 * Catalogue → Setup → Categories & Tags (ADR-042; the tags tab for tags); every other module
 * keeps them in Categories & Tags. Pure.
 */
export function manageHref(projectSlug: string, module: string, kind: string): string {
  if (module === 'catalogue') return `/${projectSlug}/catalogue/setup/categories${kind === 'tag' ? '?tab=tags' : ''}`
  return `/${projectSlug}/taxonomy?module=${encodeURIComponent(module)}&kind=${encodeURIComponent(kind)}`
}
