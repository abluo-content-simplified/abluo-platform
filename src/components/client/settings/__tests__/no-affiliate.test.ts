/**
 * Settings shows no affiliate content (2026-10-28): the affiliate programs live
 * only in Connected Apps. Follows the Settings page's local imports (the page,
 * its form, its actions, and the modules they pull in) and fails when any of
 * them reaches affiliate / Amazon / Awin / disclosure code.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')
const ENTRY = 'app/[locale]/(client)/[tenant]/settings/page.tsx'
const FORBIDDEN = /lib\/settings\/|lib\/affiliate\/|AffiliatePrograms|affiliate-actions|catalogue\/messages/

function resolve(spec: string): string | null {
  if (!spec.startsWith('@/')) return null
  const base = join(SRC, spec.slice(2))
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(c) && statSync(c).isFile()) return c
  return null
}
const rel = (p: string) => p.slice(SRC.length + 1)

/** The Settings route's own code: entry + the client/settings components + the notifications modules it uses (stops at shared UI/lib). */
function graph(): Map<string, string[]> {
  const seen = new Map<string, string[]>()
  const queue = [join(SRC, ENTRY)]
  while (queue.length) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    const src = readFileSync(file, 'utf8')
    const specs = [...src.matchAll(/(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
    const local = specs.map((s) => (s.startsWith('./') ? `@/${rel(join(file, '..', s))}` : s))
    seen.set(file, local)
    for (const s of local) {
      if (!/^@\/(app\/\[locale\]\/\(client\)\/\[tenant\]\/settings|components\/client\/settings|lib\/notifications)\//.test(s)) continue
      const r = resolve(s)
      if (r) queue.push(r)
    }
  }
  return seen
}

describe('Settings no longer imports affiliate code', () => {
  const g = graph()
  it('walks the Settings page, form and actions', () => {
    const files = [...g.keys()].map(rel)
    expect(files).toEqual(expect.arrayContaining([ENTRY, 'components/client/settings/SettingsForm.tsx', 'components/client/settings/FormNotifications.tsx', 'app/[locale]/(client)/[tenant]/settings/actions.ts']))
  })
  for (const [file, specs] of g) {
    it(`${rel(file)} imports nothing affiliate`, () => {
      expect(specs.filter((s) => FORBIDDEN.test(s))).toEqual([])
      expect(readFileSync(file, 'utf8')).not.toMatch(/amazonTrackingIds|awinPublisherId|affiliateDisclosure|affiliateShops/)
    })
  }
  it('Connected Apps still has the affiliate programs and their save action', () => {
    const apps = readFileSync(join(SRC, 'app/[locale]/(client)/[tenant]/apps/page.tsx'), 'utf8')
    expect(apps).toMatch(/AffiliatePrograms/)
    const comp = readFileSync(join(SRC, 'components/client/connections/AffiliatePrograms.tsx'), 'utf8')
    expect(comp).toMatch(/from '@\/app\/\[locale\]\/\(client\)\/\[tenant\]\/apps\/affiliate-actions'/)
  })
})
