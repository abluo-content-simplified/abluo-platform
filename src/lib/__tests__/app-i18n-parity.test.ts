import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * T4 — Abluo App copy exists in every dashboard language (verification.md).
 * The dashboard chrome ships in en/it/de; a key missing or empty in one of
 * them shows a raw key or blank button to that client.
 */
const LOCALES = ['en', 'it', 'de'] as const
const NAMESPACES = ['clientDashboard', 'app', 'admin', 'editor'] as const

type Tree = { [k: string]: string | Tree }

function load(locale: string): Tree {
  return JSON.parse(readFileSync(join(process.cwd(), 'messages', `${locale}.json`), 'utf8'))
}

function leaves(tree: Tree | undefined, prefix: string): Map<string, string> {
  const out = new Map<string, string>()
  if (!tree) return out
  for (const [k, v] of Object.entries(tree)) {
    const key = `${prefix}.${k}`
    if (typeof v === 'string') out.set(key, v)
    else for (const [kk, vv] of leaves(v, key)) out.set(kk, vv)
  }
  return out
}

describe('T4 — dashboard copy parity (en / it / de)', () => {
  const all = Object.fromEntries(LOCALES.map((l) => [l, load(l)])) as Record<string, Tree>

  for (const ns of NAMESPACES) {
    const en = leaves(all.en[ns] as Tree | undefined, ns)
    for (const locale of LOCALES) {
      it(`${ns}: ${locale} has every key, none empty`, () => {
        const mine = leaves(all[locale][ns] as Tree | undefined, ns)
        const missing = [...en.keys()].filter((k) => !mine.has(k))
        const extra = [...mine.keys()].filter((k) => !en.has(k))
        const empty = [...mine.entries()].filter(([, v]) => v.trim() === '').map(([k]) => k)
        expect({ missing, extra, empty }).toEqual({ missing: [], extra: [], empty: [] })
      })
    }
  }
})
