import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

// ADR-038 D8 — every live suite (*.live.test.ts) writes to real services, so it
// must refuse the production Supabase before doing anything.
function liveSuites(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...liveSuites(p))
    else if (name.endsWith('.live.test.ts')) out.push(p)
  }
  return out
}

describe('live suites cannot target production Supabase', () => {
  const root = join(process.cwd(), 'src')
  const suites = liveSuites(root)
  it('there is at least one live suite to check', () => expect(suites.length).toBeGreaterThan(0))
  for (const file of suites) {
    it(relative(process.cwd(), file), () => {
      expect(readFileSync(file, 'utf8')).toMatch(/assertSandboxSupabase\(/)
    })
  }
})
