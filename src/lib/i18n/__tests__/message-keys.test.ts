/**
 * Every literal translation key used in src/ exists in messages/en.json.
 *
 * A static scan, deliberately pragmatic: it finds `useTranslations('<ns>')` /
 * `getTranslations('<ns>')` (or `{ namespace: '<ns>' }`) bound to a name, then
 * that name's calls — `t('key')`, `t.rich('key')`, `t.markup('key')`,
 * `t.raw('key')`. Static keys must resolve; a template key with a static
 * prefix (`t(\`inline.${p}\`)`) must at least have a matching sibling. Fully
 * dynamic keys and namespaces are skipped. The binding used for a call is the
 * nearest one above it with that name, so several components per file work.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '../../../../messages/en.json'

const ROOT = join(__dirname, '../../../..')
const SRC = join(ROOT, 'src')

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) files(p, out)
    else if (/\.(tsx?|jsx?)$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(p)
  }
  return out
}

type Tree = Record<string, unknown>
function lookup(path: string): unknown {
  let node: unknown = en as Tree
  for (const part of path.split('.')) {
    if (!node || typeof node !== 'object' || !(part in (node as Tree))) return undefined
    node = (node as Tree)[part]
  }
  return node
}

const BINDING =
  /\b(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:(['"])([^'"]*)\2|\{[^}]*?namespace:\s*(['"])([^'"]*)\4[^}]*\}|\))/g

type Binding = { name: string; ns: string; at: number }

export function scanKeys(): { checked: number; missing: string[] } {
  const missing: string[] = []
  let checked = 0
  for (const file of files(SRC)) {
    const src = readFileSync(file, 'utf8')
    if (!/useTranslations|getTranslations/.test(src)) continue
    const bindings: Binding[] = []
    for (const m of src.matchAll(BINDING)) bindings.push({ name: m[1], ns: m[3] ?? m[5] ?? '', at: m.index ?? 0 })
    const names = [...new Set(bindings.map((b) => b.name))]
    for (const name of names) {
      const call = new RegExp(`(?<![\\w.])${name}(?:\\.(?:rich|markup|raw))?\\(\\s*(['"\`])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1`, 'g')
      for (const m of src.matchAll(call)) {
        const at = m.index ?? 0
        const binding = bindings.filter((b) => b.name === name && b.at < at).at(-1)
        if (!binding) continue
        const key = m[2]
        const full = (k: string) => (binding.ns ? `${binding.ns}.${k}` : k)
        const where = `${relative(ROOT, file)}: ${full(key)}`
        checked++
        if (m[1] !== '`' || !key.includes('${')) {
          if (lookup(full(key)) === undefined) missing.push(where)
          continue
        }
        // Template key: check the static prefix has at least one matching entry.
        const prefix = key.slice(0, key.indexOf('${'))
        if (!prefix) continue
        const dot = prefix.lastIndexOf('.')
        const parentPath = dot === -1 ? '' : prefix.slice(0, dot)
        const start = prefix.slice(dot + 1)
        const parent = parentPath ? lookup(full(parentPath)) : binding.ns ? lookup(binding.ns) : en
        const ok = parent && typeof parent === 'object' && Object.keys(parent as Tree).some((k) => k.startsWith(start))
        if (!ok) missing.push(where)
      }
    }
  }
  return { checked, missing: [...new Set(missing)].sort() }
}

describe('translation keys', () => {
  it('every literal key used in src/ exists in messages/en.json', () => {
    const { checked, missing } = scanKeys()
    // Guard against the scan silently matching nothing.
    expect(checked).toBeGreaterThan(200)
    expect(missing).toEqual([])
  })
})
