/**
 * Fields side by side line up (Tom, 2026-11-05 — "you don't align the fields").
 *
 * A `<Field hint=…>` puts its hint under the LABEL by default, which pushes
 * its control down. Next to a field without a hint (or with a shorter one) the
 * two inputs then sit at different heights. In a multi-column row the hint
 * must go under the control: `hintBelow`.
 *
 * The check: every `<Field … hint=…>` in dashboard code whose nearest
 * enclosing grid/flex container lays its children out in a row (grid-cols-2+,
 * a responsive grid-cols-N, flex-row, or flex without flex-col) must carry
 * `hintBelow`. Comments are ignored. Pure file reading, no network.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../../..')
const SCOPE = ['src/components', 'src/app']

function files(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') out.push(...files(full))
    } else if (name.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** The opening tag starting at `from` (`<Tag …>`), braces respected; null if it is self-closing or unterminated. */
function openingTag(src: string, from: number): { text: string; end: number; selfClosing: boolean } | null {
  let depth = 0
  let quote: string | null = null
  for (let i = from + 1; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === quote && src[i - 1] !== '\\') quote = null
      continue
    }
    if (depth > 0 && (c === "'" || c === '"' || c === '`')) quote = c
    else if (depth === 0 && c === '"') quote = c
    else if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return { text: src.slice(from, i + 1), end: i + 1, selfClosing: src[i - 1] === '/' }
  }
  return null
}

const classOf = (tag: string) => /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(tag)?.slice(1).find(Boolean) ?? ''

/** Does this container place its children side by side? Pure. */
export function isRowContainer(cls: string): boolean {
  const tokens = cls.split(/\s+/)
  if (tokens.some((t) => /^(?:[a-z]+:)?grid-cols-([2-9]|1[0-2])$/.test(t))) return true
  if (tokens.some((t) => /^(?:sm|md|lg|xl):flex-row$/.test(t))) return true
  return tokens.includes('flex') && !tokens.includes('flex-col')
}

const isLayout = (cls: string) => /(^|\s)(grid|flex|inline-flex)(\s|$)/.test(cls)

/** `file:line` of every hinted Field in a row without hintBelow. */
export function misalignedFields(src: string, file = 'x.tsx'): string[] {
  const text = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^\s*\/\/.*$/gm, (m) => m.replace(/./g, ' '))
  const stack: string[] = []
  const out: string[] = []
  const re = /<\/?(div|ul|ol|li|section|fieldset|form|Field)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const closing = m[0].startsWith('</')
    const tag = m[1]
    if (tag === 'Field') {
      if (closing) continue
      const open = openingTag(text, m.index)
      if (!open) continue
      if (/\bhint=/.test(open.text) && !/\bhintBelow\b/.test(open.text)) {
        const container = [...stack].reverse().find(isLayout)
        if (container && isRowContainer(container)) out.push(`${file}:${text.slice(0, m.index).split('\n').length}`)
      }
      re.lastIndex = open.end
      continue
    }
    if (closing) {
      stack.pop()
      continue
    }
    const open = openingTag(text, m.index)
    if (!open) continue
    if (!open.selfClosing) stack.push(classOf(open.text))
    re.lastIndex = open.end
  }
  return out
}

describe('Fields side by side line up (hintBelow)', () => {
  it('detects a hinted field in a two-column row, and accepts hintBelow / single columns', () => {
    const bad = `<div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Field label="a">{(p) => <X {...p} />}</Field><Field label="b" hint="h" error={a >= b ? 'x' : undefined}>{(p) => <X />}</Field></div>`
    expect(misalignedFields(bad)).toEqual(['x.tsx:1'])
    expect(misalignedFields(bad.replace('hint="h"', 'hint="h" hintBelow'))).toEqual([])
    expect(misalignedFields(`<div className="flex flex-col gap-4"><Field label="a" hint="h">{(p) => <X />}</Field></div>`)).toEqual([])
    expect(misalignedFields(`<div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Field label="a" hint="h">{(p) => <X />}</Field></div></div>`)).toEqual(['x.tsx:1'])
  })

  it('no dashboard file has a hinted Field in a row without hintBelow', () => {
    const found = SCOPE.flatMap((d) => files(path.join(root, d))).flatMap((f) => misalignedFields(readFileSync(f, 'utf8'), path.relative(root, f)))
    expect(found, `Add hintBelow to these Fields so the inputs in the row line up:\n${found.join('\n')}`).toEqual([])
  })
})
