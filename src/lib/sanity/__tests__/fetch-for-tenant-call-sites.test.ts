/**
 * Every `fetchForTenant(...)` CALL SITE in `src/` passes a tenant-scoped query.
 *
 * `fetchForTenant` now refuses an unscoped query in every environment,
 * production included (see `tenantScopeEnforcement` in `../client.ts`). That
 * makes a false positive a blank client website, so it must be impossible to
 * MERGE one. `website-tenant-scope-guard.test.ts` already runs the exported
 * `queries.ts` catalogue through the detector; this suite closes the remaining
 * gap — a call site that passes something OTHER than a catalogue query (an
 * inline string, a locally-built query, a query from another module).
 *
 * Method: textual scan of every non-test source file for a direct call
 * (`fetchForTenant(` / `fetchForTenant<…>(`), take the first argument, and
 * RESOLVE it to the actual string the call would send:
 *   - a string literal                      → checked as-is
 *   - an identifier imported from a module  → that module's export
 *   - `query` bound by `const query = c ? A : B` in the same file → A and B
 * Anything that cannot be resolved FAILS the test — an unresolvable call site
 * is exactly the thing this suite exists to stop.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'
import { findTenantScopeViolation } from '@/lib/sanity/client'

const ROOT = resolve(__dirname, '../../../..')
const SRC = join(ROOT, 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      walk(p, out)
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

/** First argument (raw text, trimmed) of every direct fetchForTenant call. */
function callSiteArgs(source: string): string[] {
  const args: string[] = []
  const re = /\bfetchForTenant\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    let i = m.index + m[0].length
    while (/\s/.test(source[i] ?? '')) i++
    if (source[i] === '<') {
      // Skip a (possibly nested, possibly multi-line) generic argument list.
      let depth = 0
      for (; i < source.length; i++) {
        if (source[i] === '<') depth++
        else if (source[i] === '>' && source[i - 1] !== '=') {
          depth--
          if (depth === 0) {
            i++
            break
          }
        }
      }
      while (/\s/.test(source[i] ?? '')) i++
    }
    if (source[i] !== '(') continue // a destructure, a type, a property name — not a call
    i++
    const rest = source.slice(i)
    const arg = rest.match(/^\s*(`[^`]*`|'[^']*'|"[^"]*"|[A-Za-z_$][\w$]*)/)
    args.push(arg ? arg[1] : rest.slice(0, 40))
  }
  return args
}

function importSource(source: string, ident: string): string | null {
  const re = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    const names = m[1].split(',').map((n) => n.trim().split(/\s+as\s+/).pop())
    if (names.includes(ident)) return m[2]
  }
  return null
}

async function resolveModule(spec: string, fromFile: string): Promise<Record<string, unknown>> {
  const path = spec.startsWith('@/')
    ? join(SRC, spec.slice(2))
    : spec.startsWith('.')
      ? resolve(fromFile, '..', spec)
      : spec
  return (await import(/* @vite-ignore */ path)) as Record<string, unknown>
}

interface Resolved {
  site: string
  query: string | null
  why?: string
}

async function resolveArg(file: string, source: string, arg: string): Promise<Resolved[]> {
  const site = `${relative(ROOT, file)} → ${arg}`
  if (/^[`'"]/.test(arg)) return [{ site, query: arg.slice(1, -1) }]

  // `const query = cond ? A : B` (the listing hydrators) — resolve both arms.
  const local = source.match(new RegExp(`const\\s+${arg}\\s*=\\s*([^\\n;]+)`))
  if (local) {
    const arms = local[1].split(/[?:]/).slice(1).map((s) => s.trim()).filter(Boolean)
    if (arms.length > 0 && arms.every((a) => /^[A-Za-z_$][\w$]*$/.test(a))) {
      return (await Promise.all(arms.map((a) => resolveArg(file, source, a)))).flat()
    }
    return [{ site, query: null, why: `locally-built query: ${local[1].trim()}` }]
  }

  const spec = importSource(source, arg)
  if (!spec) return [{ site, query: null, why: 'not imported and not a literal' }]
  const mod = await resolveModule(spec, file)
  const value = mod[arg]
  if (typeof value !== 'string') return [{ site, query: null, why: `${spec} does not export a string ${arg}` }]
  return [{ site, query: value }]
}

describe('every fetchForTenant call site passes a tenant-scoped query', () => {
  it('resolves and passes the runtime detector', async () => {
    const files = walk(SRC).filter((f) => !f.endsWith(join('lib', 'sanity', 'client.ts')))
    const resolved: Resolved[] = []
    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf-8'))
      for (const arg of callSiteArgs(source)) resolved.push(...(await resolveArg(file, source, arg)))
    }

    // The scan must actually be finding the call sites — a regex that
    // silently matches nothing would pass vacuously.
    expect(resolved.length).toBeGreaterThan(80)

    const unresolved = resolved.filter((r) => r.query === null).map((r) => `${r.site} (${r.why})`)
    expect(unresolved).toEqual([])

    const unscoped = resolved
      .filter((r) => r.query !== null && findTenantScopeViolation(r.query, 'call-site') !== null)
      .map((r) => r.site)
    expect(unscoped).toEqual([])
  }, 60_000)
})
