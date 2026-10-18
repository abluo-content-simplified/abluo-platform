/**
 * Pure: the Sanity patch that changes the Catalogue's affiliate disclosure for
 * some languages and nothing else. Key-level, addressed by the installation's
 * `_key`, so other config keys and other languages are never rewritten (the
 * Studio Modules pane and this page can both edit the same config safely).
 * A missing container is created in the same `set` (Sanity applies the
 * operations of one patch in a fixed order, so no setIfMissing is relied on).
 */
export type CatalogueInstallationRef = {
  _key?: string | null
  /** The stored `config` object exists. */
  hasConfig: boolean
  /** The stored `affiliateDisclosure` object, when there is one. */
  disclosure: Record<string, unknown> | null
}

export function installationBase(ref: Pick<CatalogueInstallationRef, '_key'>): string {
  return ref._key ? `moduleInstallations[_key=="${ref._key}"]` : `moduleInstallations[moduleId=="catalogue"]`
}

export function buildDisclosurePatch(
  ref: CatalogueInstallationRef,
  edits: Readonly<Record<string, string>>,
  configTypeName: string,
): { set: Record<string, unknown>; unset: string[] } {
  const base = installationBase(ref)
  const set: Record<string, unknown> = {}
  const unset: string[] = []
  const filled = Object.entries(edits).filter(([, t]) => t !== '')
  const cleared = Object.entries(edits).filter(([, t]) => t === '')

  if (!ref.hasConfig) {
    // Nothing stored yet: create the container with the new texts (clearing needs nothing).
    if (filled.length) set[`${base}.config`] = { _type: configTypeName, affiliateDisclosure: { _type: 'localizedString', ...Object.fromEntries(filled) } }
    return { set, unset }
  }
  if (!ref.disclosure) {
    if (filled.length) set[`${base}.config.affiliateDisclosure`] = { _type: 'localizedString', ...Object.fromEntries(filled) }
    return { set, unset }
  }
  for (const [locale, text] of filled) set[`${base}.config.affiliateDisclosure.${locale}`] = text
  for (const [locale] of cleared) unset.push(`${base}.config.affiliateDisclosure.${locale}`)
  return { set, unset }
}
