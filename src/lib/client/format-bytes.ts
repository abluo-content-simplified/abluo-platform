/** File sizes for people, not engineers. Pure (unit-tested with media-filter). */

/** "1.2 MB", "340 KB" — decimal units like the operating systems' file browsers; '' when unknown. */
export function formatBytes(bytes: number | null | undefined, locale = 'en'): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let u = 0
  while (n >= 1000 && u < units.length - 1) {
    n /= 1000
    u++
  }
  const digits = u === 0 || n >= 100 ? 0 : 1
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n)} ${units[u]}`
}
