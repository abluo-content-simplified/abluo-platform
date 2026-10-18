/**
 * The section registry (src/lib/modules/sections.ts) is bundled into the
 * Studio and other client code (sanity.config.ts → modules → sections). Nothing
 * it reaches may import `next/headers`: Next refuses to build (2026-10-18 —
 * visitor-country.ts reached through catalogue/website.ts broke every deploy).
 * Server-only values (the visitor's country) are injected by server callers.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const resolve = (from: string, spec: string): string | null => {
  const base = spec.startsWith('@/') ? path.join(ROOT, 'src', spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null
  if (!base) return null
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) if (existsSync(c) && !c.endsWith('/')) try { readFileSync(c); return c } catch { /* dir */ }
  return null
}

function reach(entry: string): { file: string; via: string[] } | null {
  const seen = new Set<string>()
  const queue: { file: string; via: string[] }[] = [{ file: entry, via: [] }]
  while (queue.length) {
    const { file, via } = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    const src = readFileSync(file, 'utf8')
    // Type-only imports never reach a bundle.
    for (const m of src.matchAll(/^\s*import\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|^\s*export\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
      const spec = m[1] ?? m[2] ?? m[3]
      if (spec === 'next/headers') return { file, via }
      const next = resolve(file, spec)
      if (next && /\.(ts|tsx)$/.test(next)) queue.push({ file: next, via: [...via, path.relative(ROOT, file)] })
    }
  }
  return null
}

describe('the client-bundled section registry stays server-free', () => {
  it('nothing reachable from src/lib/modules/sections.ts imports next/headers', () => {
    const hit = reach(path.join(ROOT, 'src/lib/modules/sections.ts'))
    expect(hit ? `${path.relative(ROOT, hit.file)} via ${hit.via.join(' → ')}` : null).toBeNull()
  })
})
