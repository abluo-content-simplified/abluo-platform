import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// useDateLocale() reads a client context. A file without 'use client' may be
// rendered as a server component (e.g. AnalyticsOverview on Home), where the
// call throws at request time and takes the whole page down (v1.0.83, dev).
// Server code passes `dateLocale` from getDateLocale() instead.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'node_modules' || name === '__tests__' ? [] : files(p)
    return /\.tsx?$/.test(name) ? [p] : []
  })
}

describe('useDateLocale is only called from client modules', () => {
  it("every file that calls useDateLocale() starts with 'use client'", () => {
    const offenders = files(join(process.cwd(), 'src')).filter((p) => {
      const src = readFileSync(p, 'utf8')
      if (!/\buseDateLocale\(\)/.test(src) || p.endsWith('date-locale-context.tsx')) return false
      return !/^\s*['"]use client['"]/.test(src)
    })
    expect(offenders).toEqual([])
  })
})
