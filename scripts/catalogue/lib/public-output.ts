// ── C11 proof 2 `website-output.unchanged` — public output snapshot (pure part) ──
// What a visitor or crawler sees that a Catalogue data step could change:
// `<title>`, OG title/description, meta description, every JSON-LD block of an
// HTML page, and the full body of text resources (llms.txt, sitemap.xml).
// Build ids, nonces and asset hashes are not part of the snapshot, so two
// renders of unchanged data compare byte-equal.

export type PageSnapshot = { path: string; status: number; kind: 'html' | 'text'; title?: string | null; ogTitle?: string | null; ogDescription?: string | null; description?: string | null; jsonLd?: string[]; body?: string }

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')

const meta = (html: string, attr: 'property' | 'name', key: string): string | null => {
  const re = new RegExp(`<meta[^>]*${attr}="${key.replace(/[:.]/g, '\\$&')}"[^>]*>`, 'i')
  const tag = html.match(re)?.[0]
  const content = tag?.match(/content="([^"]*)"/i)?.[1]
  return content === undefined ? null : decode(content)
}

export function snapshotOf(path: string, status: number, contentType: string, body: string): PageSnapshot {
  if (!/html/i.test(contentType)) return { path, status, kind: 'text', body }
  const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const jsonLd = [...body.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim())
  return { path, status, kind: 'html', title: title === undefined ? null : decode(title.trim()), ogTitle: meta(body, 'property', 'og:title'), ogDescription: meta(body, 'property', 'og:description'), description: meta(body, 'name', 'description'), jsonLd }
}

export function compareSnapshots(before: readonly PageSnapshot[], after: readonly PageSnapshot[]): { path: string; field: string; before: unknown; after: unknown }[] {
  const diffs: { path: string; field: string; before: unknown; after: unknown }[] = []
  const a = new Map(after.map((s) => [s.path, s]))
  for (const b of before) {
    const x = a.get(b.path)
    if (!x) {
      diffs.push({ path: b.path, field: '(missing)', before: b.status, after: null })
      continue
    }
    for (const field of ['status', 'title', 'ogTitle', 'ogDescription', 'description', 'jsonLd', 'body'] as const)
      if (JSON.stringify(b[field] ?? null) !== JSON.stringify(x[field] ?? null)) diffs.push({ path: b.path, field, before: b[field] ?? null, after: x[field] ?? null })
  }
  return diffs
}
