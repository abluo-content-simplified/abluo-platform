import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Tom: "4 pm is 16:00" — every time of day shown anywhere in Abluo is 24-hour,
 * in every language including English. Any formatter that shows an hour
 * (`hour:` or `timeStyle:`) must say so with `hourCycle: 'h23'` (or
 * `hour12: false`). This guard counts both per file, so a new formatter that
 * forgets the option fails here.
 */
const ROOT = join(__dirname, '..', '..', '..') // src/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      walk(p, out)
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

describe('24-hour times', () => {
  it('every formatter that shows an hour sets hourCycle h23 / hour12 false', () => {
    const bad: string[] = []
    for (const file of walk(ROOT)) {
      const src = readFileSync(file, 'utf8')
      const shows = (src.match(/\b(hour|timeStyle):\s*['"]/g) ?? []).length
      if (!shows) continue
      const set = (src.match(/hourCycle:\s*['"]h23['"]|hour12:\s*false/g) ?? []).length
      if (set < shows) bad.push(`${file.slice(ROOT.length)} (${shows} time formatter(s), ${set} with a 24-hour option)`)
    }
    expect(bad).toEqual([])
  })
})
