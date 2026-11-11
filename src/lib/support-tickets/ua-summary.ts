/**
 * One short line for a ticket's browser context (Tom, 2026-11-11): the full
 * user-agent string took 6–8 lines of the side panel. "Chrome 142 · macOS ·
 * 1440×900" says what matters; the full string stays one click away. Pure.
 */
export function browserSummary(userAgent: string | null | undefined, viewport?: string | null): string {
  const ua = (userAgent ?? '').trim()
  const parts: string[] = []
  const browser = browserOf(ua)
  if (browser) parts.push(browser)
  const os = osOf(ua)
  if (os) parts.push(os)
  const v = (viewport ?? '').trim()
  if (v) parts.push(v.replace(/\s*x\s*/i, '×'))
  return parts.join(' · ')
}

function major(ua: string, re: RegExp): string {
  const m = ua.match(re)
  return m ? ` ${m[1].split('.')[0]}` : ''
}

function browserOf(ua: string): string {
  if (!ua) return ''
  // Order matters: Edge and Opera also say "Chrome", Chrome also says "Safari".
  if (/Edg(?:A|iOS)?\//.test(ua)) return `Edge${major(ua, /Edg(?:A|iOS)?\/([\d.]+)/)}`
  if (/OPR\/|Opera/.test(ua)) return `Opera${major(ua, /OPR\/([\d.]+)/)}`
  if (/SamsungBrowser\//.test(ua)) return `Samsung Internet${major(ua, /SamsungBrowser\/([\d.]+)/)}`
  if (/Firefox\/|FxiOS\//.test(ua)) return `Firefox${major(ua, /(?:Firefox|FxiOS)\/([\d.]+)/)}`
  if (/CriOS\//.test(ua)) return `Chrome${major(ua, /CriOS\/([\d.]+)/)}`
  if (/Chrome\//.test(ua)) return `Chrome${major(ua, /Chrome\/([\d.]+)/)}`
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return `Safari${major(ua, /Version\/([\d.]+)/)}`
  return ''
}

function osOf(ua: string): string {
  if (!ua) return ''
  if (/iPhone|iPod/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS'
  if (/Windows/.test(ua)) return 'Windows'
  if (/CrOS/.test(ua)) return 'ChromeOS'
  if (/Linux/.test(ua)) return 'Linux'
  return ''
}
