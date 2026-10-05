/**
 * src/lib/ai is server-only (it reads ANTHROPIC_API_KEY). The repo has no
 * `server-only` package, so — like private-dataset-readiness.test.ts — walk
 * the import graph from every 'use client' module and prove none reaches it.
 * 'use server' modules are a Server Action boundary: the walk stops there.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'

const ROOT = resolve(__dirname, '../../../..')
const SRC = join(ROOT, 'src')
const AI_DIR = join(SRC, 'lib', 'ai') + '/'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue
      walk(p, out)
    } else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const directive = (f: string, d: string) =>
  new RegExp(`^\\s*(?:\\/\\/[^\\n]*\\n|\\/\\*[\\s\\S]*?\\*\\/\\s*)*\\s*['"]use ${d}['"]`).test(readFileSync(f, 'utf-8'))

function imports(source: string): string[] {
  const s = strip(source)
  const out: string[] = []
  let m: RegExpExecArray | null
  const re = /(?:^|[;\n])\s*(?:import|export)\s+(?!type\b)([^'"]*?)\s+from\s*['"]([^'"]+)['"]/g
  while ((m = re.exec(s))) out.push(m[2])
  const dyn = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((m = dyn.exec(s))) out.push(m[1])
  return out
}
function resolveSpec(spec: string, from: string): string | null {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
  if (!base) return null
  for (const ext of ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx']) {
    const p = base + ext
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  return null
}

describe('src/lib/ai never reaches a browser bundle', () => {
  const entries = walk(SRC).filter((f) => directive(f, 'client'))

  it('finds client entry points (non-vacuous)', () => {
    expect(entries.length).toBeGreaterThan(20)
  })

  it('no client module imports src/lib/ai, directly or transitively', () => {
    const violations: string[] = []
    for (const entry of entries) {
      const seen = new Set<string>()
      const stack = [{ file: entry, chain: [relative(ROOT, entry)] }]
      while (stack.length) {
        const { file, chain } = stack.pop()!
        if (seen.has(file)) continue
        seen.add(file)
        if (file !== entry && directive(file, 'server')) continue
        if (file.startsWith(AI_DIR)) {
          violations.push(chain.join(' → '))
          continue
        }
        for (const spec of imports(readFileSync(file, 'utf-8'))) {
          const next = resolveSpec(spec, file)
          if (next) stack.push({ file: next, chain: [...chain, relative(ROOT, next)] })
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('no file outside src/lib/ai reads ANTHROPIC_API_KEY except the translate adapter', () => {
    const readers = walk(SRC)
      .filter((f) => /process\.env\.ANTHROPIC_API_KEY/.test(strip(readFileSync(f, 'utf-8'))))
      .map((f) => relative(ROOT, f))
      .filter((f) => !f.startsWith('src/lib/ai/'))
    expect(readers).toEqual(['src/lib/translate/providers/claude.ts'])
  })
})
