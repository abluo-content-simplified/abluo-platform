/**
 * Component Lab guards (Phase 1).
 *
 * 1. Every registry entry points at a real file that exports what it claims,
 *    and every entry has a demo file.
 * 2. Every component file in src/components/app is in the Lab or in
 *    NOT_IN_LAB with a reason — a new shared component cannot be added
 *    without being listed, and the list is what Claude reads before building.
 * 3. Lab code cannot reach a backend: no server actions, Supabase, Sanity
 *    server clients, media-api or fetch() — so a demo can never change data.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LAB_GROUPS, LAB_REGISTRY, NOT_IN_LAB } from '../registry'

const ROOT = process.cwd()

function files(dir: string, ext = /\.(ts|tsx)$/): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : files(full, ext)
    return ext.test(name) ? [full] : []
  })
}

describe('Lab registry', () => {
  it('ids are unique and URL-safe', () => {
    const ids = LAB_REGISTRY.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/)
  })

  for (const e of LAB_REGISTRY) {
    it(`${e.id}: ${e.source} exists and exports ${e.exports.join(', ')}`, () => {
      const file = path.join(ROOT, e.source)
      expect(existsSync(file)).toBe(true)
      const src = readFileSync(file, 'utf8')
      for (const name of e.exports) expect(src).toMatch(new RegExp(`export (?:async )?(?:function|const) ${name}\\b`))
    })
  }

  it('every entry has an existing demo file and a known group', () => {
    const reg = readFileSync(path.join(ROOT, 'src/lab/registry.ts'), 'utf8')
    const demos = [...reg.matchAll(/demo: \(\) => import\('\.\/demos\/([^']+)'\)/g)].map((m) => m[1])
    expect(demos.length).toBe(LAB_REGISTRY.length)
    for (const d of demos) expect(existsSync(path.join(ROOT, 'src/lab/demos', `${d}.tsx`)), d).toBe(true)
    for (const e of LAB_REGISTRY) expect(LAB_GROUPS).toContain(e.group)
  })
})

describe('Lab coverage of src/components/app', () => {
  const inLab = new Set(LAB_REGISTRY.map((e) => e.source))
  const componentFiles = files(path.join(ROOT, 'src/components/app'), /\.tsx$/)
    .map((f) => path.relative(ROOT, f))
    .filter((f) => /export (?:async )?function [A-Z]/.test(readFileSync(path.join(ROOT, f), 'utf8')))

  it('every shared component file is in the Lab or listed with a reason', () => {
    const missing = componentFiles.filter((f) => !inLab.has(f) && !NOT_IN_LAB[f])
    expect(missing).toEqual([])
  })

  it('NOT_IN_LAB lists no file that is already in the Lab or no longer exists', () => {
    const stale = Object.keys(NOT_IN_LAB).filter((f) => inLab.has(f) || !existsSync(path.join(ROOT, f)))
    expect(stale).toEqual([])
  })
})

describe('Lab code reaches no backend', () => {
  const labFiles = [...files(path.join(ROOT, 'src/lab')), ...files(path.join(ROOT, 'src/components/admin/lab'))]
  const FORBIDDEN: [string, RegExp][] = [
    ['server actions', /from\s+['"][^'"]*\/actions['"]|['"]use server['"]/],
    ['Supabase', /from\s+['"]@\/lib\/supabase|@supabase\//],
    ['Sanity clients', /from\s+['"]@\/lib\/sanity\/(?:server-clients|client|fetch)|next-sanity|@sanity\/client/],
    ['media-api', /media-api['"]/],
    ['fetch()', /\bfetch\s*\(/],
  ]
  it('finds the Lab sources', () => {
    expect(labFiles.length).toBeGreaterThan(10)
  })
  for (const [label, re] of FORBIDDEN) {
    it(`no Lab file uses ${label}`, () => {
      expect(labFiles.filter((f) => re.test(readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f))).toEqual([])
    })
  }
})
