/**
 * Menus and popovers portal to the app root with z-50. A full-screen dashboard
 * layer above that (the Create flow, z-[60]) must carry `data-portal-root`, or
 * every "⋯" menu opened inside it renders BEHIND it and seems to do nothing
 * (Tom, 2026-10-17: the post overview's menu).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const DIRS = ['src/components/client', 'src/components/admin', 'src/components/app']
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const full = path.join(dir, n)
    return statSync(full).isDirectory() ? (n === '__tests__' ? [] : files(full)) : full.endsWith('.tsx') ? [full] : []
  })

describe('full-screen layers host their own popovers', () => {
  it('every fixed full-screen layer above z-50 is a data-portal-root', () => {
    const missing: string[] = []
    for (const f of DIRS.flatMap((d) => files(path.join(process.cwd(), d)))) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/<div\b[^>]*className="[^"]*\bfixed inset-0 z-\[(\d+)\][^"]*"[^>]*>/g)) {
        if (Number(m[1]) > 50 && !m[0].includes('data-portal-root')) missing.push(path.relative(process.cwd(), f))
      }
    }
    expect(missing).toEqual([])
  })
})
