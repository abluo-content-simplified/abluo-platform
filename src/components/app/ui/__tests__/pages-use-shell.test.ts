/**
 * Guard: every dashboard page uses the shared page frame (PageShell), so no
 * page can drift to its own width or centring again (Tom, 2026-10-07). Since
 * ADR-030 this covers both Abluo App surfaces — the client dashboard and the
 * admin. Full-screen flows with their own frame are listed exceptions.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SURFACES = [
  {
    name: 'client dashboard',
    root: path.join(process.cwd(), 'src/app/[locale]/(client)/[tenant]'),
    // Wizards: full-screen flows with their own frame.
    exempt: new Set(['media/add/page.tsx', 'posts/write/[id]/page.tsx', 'galleries/new/page.tsx', 'galleries/[id]/edit/page.tsx']),
  },
  {
    name: 'admin',
    root: path.join(process.cwd(), 'src/app/[locale]/(admin)'),
    // Wizards: full-screen flows with their own frame.
    exempt: new Set(['media/add/page.tsx']),
  },
]

function pages(dir: string, base = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    const rel = base ? `${base}/${name}` : name
    if (statSync(full).isDirectory()) return pages(full, rel)
    return name === 'page.tsx' ? [rel] : []
  })
}

for (const surface of SURFACES) {
  describe(`${surface.name} pages use the shared frame`, () => {
    const all = pages(surface.root)
    it('finds the pages', () => {
      expect(all.length).toBeGreaterThan(4)
    })
    for (const rel of all.filter((p) => !surface.exempt.has(p))) {
      it(`${rel} renders <PageShell> and sets no width of its own`, () => {
        const src = readFileSync(path.join(surface.root, rel), 'utf8')
        expect(src).toMatch(/<PageShell[\s>]/)
        expect(src).not.toMatch(/\bmx-auto\b/)
        expect(src).not.toMatch(/\bmax-w-(?:xs|sm|md|lg|xl|[2-7]xl)\b/)
      })
    }
  })
}
