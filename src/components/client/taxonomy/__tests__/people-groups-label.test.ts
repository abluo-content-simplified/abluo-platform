import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * People groups read "Groups" in Categories & Tags (fragment g.<locale>.json →
 * clientDashboard.taxonomy.modules.people.category.*). Every override key must
 * be one the shared `category` section knows, and every locale must carry the
 * same keys. Reads the fragment until the orchestrator merges it into messages/.
 */
const root = process.cwd()
const bundle = (locale: string) => JSON.parse(readFileSync(join(root, 'messages', `${locale}.json`), 'utf8')).clientDashboard.taxonomy
const fragment = (locale: string) => JSON.parse(readFileSync(join(root, 'docs/engineering/people-module/messages', `g.${locale}.json`), 'utf8')).clientDashboard.taxonomy.modules.people.category

describe('People "Groups" wording', () => {
  const keys = Object.keys(fragment('en')).sort()
  it.each(['en', 'it', 'de'])('%s overrides only keys of the shared category section, same set in every locale', (l) => {
    expect(Object.keys(fragment(l)).sort()).toEqual(keys)
    for (const k of keys) expect(Object.keys(bundle('en').category)).toContain(k)
  })
  it('keeps the placeholders of the shared text', () => {
    const shared = bundle('en').category
    for (const l of ['en', 'it', 'de']) {
      for (const k of keys) {
        const ph = (s: string) => [...s.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]).sort().join()
        expect(ph(fragment(l)[k]), `${l}.${k}`).toBe(ph(shared[k]))
      }
    }
  })
})
