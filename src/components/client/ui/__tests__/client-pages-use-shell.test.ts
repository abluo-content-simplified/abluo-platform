/**
 * Guard: every client-dashboard page uses the shared page frame (PageShell),
 * so no page can drift to its own width or centring again (Tom, 2026-10-07).
 * Wizards are full-screen flows with their own frame and are listed here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.join(process.cwd(), 'src/app/[locale]/(client)/[tenant]')
const WIZARDS = new Set(['media/add/page.tsx', 'posts/write/[id]/page.tsx', 'galleries/new/page.tsx', 'galleries/[id]/edit/page.tsx'])

function pages(dir: string, base = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    const rel = base ? `${base}/${name}` : name
    if (statSync(full).isDirectory()) return pages(full, rel)
    return name === 'page.tsx' ? [rel] : []
  })
}

describe('client dashboard pages use the shared frame', () => {
  const all = pages(ROOT)
  it('finds the pages', () => {
    expect(all.length).toBeGreaterThan(4)
  })
  for (const rel of all.filter((p) => !WIZARDS.has(p))) {
    it(`${rel} renders <PageShell> and sets no width of its own`, () => {
      const src = readFileSync(path.join(ROOT, rel), 'utf8')
      expect(src).toMatch(/<PageShell[\s>]/)
      expect(src).not.toMatch(/\bmx-auto\b/)
      expect(src).not.toMatch(/\bmax-w-(?:xs|sm|md|lg|xl|[2-7]xl)\b/)
    })
  }
})
