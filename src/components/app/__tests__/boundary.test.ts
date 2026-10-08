/**
 * The Abluo App layer boundary (ADR-030): `src/components/app` is shared by the
 * client dashboard and the admin, so it may depend on neither of them.
 *
 * Tokens, primitives and the shell live here; screens and compositions live
 * with their surface. The moment a shared component imports a surface (or a
 * route, or the tenant nav registry), or reads the client's copy, a change made
 * for one dashboard silently reaches into the other. This test turns that rule
 * into a build failure.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const APP_DIR = path.join(ROOT, 'src/components/app')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sources(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

/** Every module specifier in a file: static imports/exports, dynamic import(), require(). */
function specifiers(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"]+)\1/g)) out.push(m[2])
  return out
}

const FORBIDDEN_IMPORTS: [string, (spec: string, file: string) => boolean][] = [
  ['@/app/ (routes)', (s) => s === '@/app' || s.startsWith('@/app/')],
  ['@/components/client', (s) => s === '@/components/client' || s.startsWith('@/components/client/')],
  ['@/components/admin', (s) => s === '@/components/admin' || s.startsWith('@/components/admin/')],
  ['@/lib/modules/client-navigation', (s) => s === '@/lib/modules/client-navigation'],
  // A relative path that climbs out of src/components/app reaches the same places.
  [
    'a relative path outside src/components/app',
    (s, file) => s.startsWith('.') && !path.resolve(path.dirname(file), s).startsWith(APP_DIR + path.sep),
  ],
]

const CLIENT_COPY = /\b(?:useTranslations|getTranslations)\(\s*(?:\{[^}]*namespace:\s*)?['"`]clientDashboard\b/

const files = sources(APP_DIR)

describe('src/components/app depends on no surface', () => {
  it('finds the shared sources', () => {
    expect(files.length).toBeGreaterThan(30)
  })

  for (const [label, forbidden] of FORBIDDEN_IMPORTS) {
    it(`nothing imports ${label}`, () => {
      const offenders = files.flatMap((f) =>
        specifiers(readFileSync(f, 'utf8'))
          .filter((s) => forbidden(s, f))
          .map((s) => `${path.relative(ROOT, f)}: ${s}`),
      )
      expect(offenders).toEqual([])
    })
  }

  it('no shared component reads the clientDashboard namespace (shared copy lives in `app`)', () => {
    const offenders = files.filter((f) => CLIENT_COPY.test(readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f))
    expect(offenders).toEqual([])
  })
})
