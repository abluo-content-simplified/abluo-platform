import { describe, expect, it } from 'vitest'
import { schemaTypes } from '../schema'

/**
 * Every schema type (documents, objects, module types) declares each field name
 * once — at every nesting level. Sanity refuses a duplicate at runtime with a
 * bare "SchemaError" that takes Studio down (and any admin page that builds the
 * schema), which is exactly how a second `expiresAt` on `post` slipped onto dev
 * on 2026-10-04. This test fails first.
 */
type FieldLike = { name?: string; fields?: FieldLike[]; of?: FieldLike[] }

function duplicates(fields: FieldLike[] | undefined, path: string): string[] {
  if (!Array.isArray(fields)) return []
  const seen = new Map<string, number>()
  const found: string[] = []
  for (const f of fields) {
    if (!f?.name) continue
    seen.set(f.name, (seen.get(f.name) ?? 0) + 1)
  }
  for (const [name, n] of seen) if (n > 1) found.push(`${path}.${name} ×${n}`)
  for (const f of fields) {
    found.push(...duplicates(f?.fields, `${path}.${f?.name ?? '?'}`))
    for (const member of f?.of ?? []) found.push(...duplicates(member?.fields, `${path}.${f?.name ?? '?'}[]`))
  }
  return found
}

describe('schema: no duplicate field names', () => {
  it('covers the module types too (post is in the list)', () => {
    expect((schemaTypes as FieldLike[]).some((t) => t.name === 'post')).toBe(true)
  })

  it('every type declares each field once', () => {
    const all = (schemaTypes as FieldLike[]).flatMap((t) => duplicates(t.fields, t.name ?? '?'))
    expect(all).toEqual([])
  })
})
