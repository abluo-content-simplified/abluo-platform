/**
 * The Courses list and editor texts exist in every dashboard language with the
 * same keys and the same ICU arguments (Tom, 2026-11-08 — the list redesign),
 * and German uses the informal "du" (checked platform-wide elsewhere).
 */
import { describe, expect, it } from 'vitest'
import en from '../../../../../messages/en.json'
import it_ from '../../../../../messages/it.json'
import de from '../../../../../messages/de.json'

type Tree = { [k: string]: string | Tree }
const flat = (t: Tree, prefix = ''): Record<string, string> =>
  Object.entries(t).reduce<Record<string, string>>((out, [k, v]) => Object.assign(out, typeof v === 'string' ? { [`${prefix}${k}`]: v } : flat(v, `${prefix}${k}.`)), {})
const args = (s: string) => [...new Set([...s.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1]))].sort()
const NEW = ['teachersMore', 'columns', 'when', 'exception', 'until', 'status', 'attention', 'actions', 'done', 'filters', 'unpublish', 'unpublishSheet', 'cancelNext', 'substituteNext', 'bulk.bar.unpublish', 'bulk.done.unpublish', 'bulk.done.restore', 'bulk.reason.unpublished']

const list = (m: unknown) => flat(((m as Tree).clientDashboard as Tree).courses as Tree)

describe('Courses list / editor messages', () => {
  const E = list(en)
  for (const [name, m] of [['it', it_], ['de', de]] as const) {
    it(`${name} has every new key with the same ICU arguments`, () => {
      const L = list(m)
      const keys = Object.keys(E).filter((k) => NEW.some((n) => k.startsWith(`list.${n}`)) || k.startsWith('editor.color') || k.startsWith('editor.unpublished'))
      expect(keys.length).toBeGreaterThan(60)
      for (const k of keys) {
        expect(L[k], `${name}: ${k}`).toBeTypeOf('string')
        expect(args(L[k]), `${name}: ${k}`).toEqual(args(E[k]))
      }
    })
  }

  it('the colour names cover exactly the palette (no legacy keys left)', () => {
    for (const m of [en, it_, de]) expect(Object.keys(((((m as unknown as Tree).clientDashboard as Tree).courses as Tree).editor as Tree).color as Tree)).toEqual(['none', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'])
  })
})
