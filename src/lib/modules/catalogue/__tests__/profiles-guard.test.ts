// ADR-033 Amendment I (I-2.1): only the registry knows the profiles. No other
// source file may spell 'foodOrDrink' or declare an `isFood` variable.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..', '..', '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

const isTest = (rel: string) => /(^|\/)__tests__\//.test(rel) || /\.test\.tsx?$/.test(rel)

/**
 * Allowed outright: the registry itself (tests are skipped separately).
 * Nothing else: the Studio list and the module settings read PROFILE_ORDER / PROFILES.
 */
const ALLOW_FILE = new Set(['lib/modules/catalogue/profiles.ts'])
const ALLOW_LINE: Record<string, RegExp> = {}

describe('profile registry guard', () => {
  it("forbids 'foodOrDrink' and isFood outside the registry", () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/')
      if (isTest(rel) || ALLOW_FILE.has(rel)) continue
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!/foodOrDrink|\bisFood\b/.test(line)) return
          if (ALLOW_LINE[rel]?.test(line)) return
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
        })
    }
    expect(offenders).toEqual([])
  })
})
