// next-intl rejects message keys that contain a dot (INVALID_KEY at bundle load). Fails on any such key in any locale.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = join(process.cwd(), 'messages')

function dotted(node: unknown, path: string, out: string[]): string[] {
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const p = path ? `${path}/${k}` : k
      if (k.includes('.')) out.push(p)
      dotted(v, p, out)
    }
  }
  return out
}

describe('messages/*.json keys', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.json'))
  it('finds the locale bundles', () => expect(files.length).toBeGreaterThanOrEqual(3))
  it.each(files)('%s has no message key containing a dot', (file) => {
    expect(dotted(JSON.parse(readFileSync(join(DIR, file), 'utf8')), '', [])).toEqual([])
  })
})
