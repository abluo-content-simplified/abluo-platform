/**
 * ADR-043 D5 — "a test fails if any website query projects a person field
 * outside PERSON_PUBLIC_FIELDS". Scans every exported GROQ string of the
 * website delivery modules (and the People module's own queries): each read of
 * a `person` — a top-level `_type == "person"` filter or a dereferenced
 * people / authors / hostPeople reference — must project exactly
 * PERSON_PUBLIC_FIELDS (plus routing keys), and must carry a visibility rule.
 */
import { describe, expect, it } from 'vitest'
import * as queries from '@/lib/sanity/queries'
import * as sitemapQueries from '@/lib/seo/sitemap-queries'
import * as llms from '@/lib/seo/llms'
import * as postPreview from '@/lib/sanity/post-preview-query'
import * as peopleQueries from '../queries'
import * as peopleWebsite from '../website'
import * as peopleRoute from '../route'
import * as digitalCardQueries from '@/lib/modules/digital-cards/queries'
import { PERSON_LISTABLE, PERSON_PUBLIC_FIELDS, PERSON_PUBLIC_KEYS, PERSON_RENDERABLE } from '../projection'
import { personDisplayName, personFullName, personInitials } from '../model'

const MODULES: Record<string, Record<string, unknown>> = {
  'src/lib/sanity/queries.ts': queries,
  'src/lib/seo/sitemap-queries.ts': sitemapQueries,
  'src/lib/seo/llms.ts': llms,
  'src/lib/sanity/post-preview-query.ts': postPreview,
  'src/lib/modules/people/queries.ts': peopleQueries,
  'src/lib/modules/people/website.ts': peopleWebsite,
  'src/lib/modules/people/route.ts': peopleRoute,
  // ADR-049 D2 — a person card reads its person through PERSON_PUBLIC_FIELDS only.
  'src/lib/modules/digital-cards/queries.ts': digitalCardQueries,
}

/** Fields that hold references to person documents. */
const PERSON_REF_FIELDS = ['people', 'authors', 'hostPeople']
/** Keys a person projection may add besides PERSON_PUBLIC_FIELDS (routing only). */
const ROUTING_KEYS = new Set(['slugMap', 'currentSlug', '_updatedAt'])

/** Index of the bracket closing the one opened at `open`, skipping GROQ string literals. */
function closing(q: string, open: number): number {
  const pairs: Record<string, string> = { '[': ']', '(': ')', '{': '}' }
  const stack: string[] = []
  for (let i = open; i < q.length; i++) {
    const c = q[i]
    if (c === '"') {
      i = q.indexOf('"', i + 1)
      if (i < 0) return -1
      continue
    }
    if (pairs[c]) stack.push(pairs[c])
    else if (c === stack[stack.length - 1]) {
      stack.pop()
      if (stack.length === 0) return i
    }
  }
  return -1
}

/** Top-level keys of a projection body ("name": … or a bare name). */
function topLevelKeys(body: string): string[] {
  const keys: string[] = []
  let depth = 0
  let start = 0
  const push = (part: string) => {
    const t = part.replace(/\/\/[^\n]*/g, '').trim()
    if (!t) return
    const m = t.match(/^"([^"]+)"\s*:/) ?? t.match(/^([A-Za-z_][A-Za-z0-9_]*)/)
    keys.push(m ? m[1] : t)
  }
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '"') {
      i = body.indexOf('"', i + 1)
      continue
    }
    if ('[({'.includes(c)) depth++
    else if ('])}'.includes(c)) depth--
    else if (c === ',' && depth === 0) {
      push(body.slice(start, i))
      start = i + 1
    }
  }
  push(body.slice(start))
  return keys
}

/** Problems with the person reads of one GROQ string. */
function problems(q: string): string[] {
  const out: string[] = []
  const reads: Array<{ filterOpen: number; rule: boolean }> = []
  for (const m of q.matchAll(/\*\[\s*_type\s*==\s*"person"/g)) {
    // A count() of people never projects fields.
    if (/count\(\s*$/.test(q.slice(0, m.index!))) continue
    reads.push({ filterOpen: m.index! + 1, rule: false })
  }
  for (const f of PERSON_REF_FIELDS) {
    // Every dereference of a person reference must be the filtered form "(f[]->)[…]".
    const all = [...q.matchAll(new RegExp(`\\b${f}(\\[[^\\]]*\\])?->`, 'g'))]
    const filtered = [...q.matchAll(new RegExp(`\\(${f}\\[\\]->\\)\\[`, 'g'))]
    if (all.length !== filtered.length) out.push(`unfiltered dereference of ${f}`)
    for (const m of filtered) reads.push({ filterOpen: m.index! + m[0].length - 1, rule: false })
  }
  for (const r of reads) {
    const close = closing(q, r.filterOpen)
    if (close < 0) {
      out.push('unbalanced person filter')
      continue
    }
    const filter = q.slice(r.filterOpen, close + 1)
    if (!filter.includes(PERSON_RENDERABLE)) out.push(`a person read without the visibility rule: ${filter.slice(0, 80)}`)
    // Skip "| order(…)" and "[0]" / "[a...b]" to the projection.
    let i = close + 1
    for (;;) {
      const rest = q.slice(i)
      const ws = rest.match(/^\s*/)![0].length
      i += ws
      if (q.startsWith('|', i)) {
        const open = q.indexOf('(', i)
        i = closing(q, open) + 1
        continue
      }
      if (q[i] === '[') {
        i = closing(q, i) + 1
        continue
      }
      break
    }
    if (q[i] === '.') {
      out.push(`a person read that returns a raw attribute: ${q.slice(i, i + 30)}`)
      continue
    }
    if (q[i] !== '{') {
      out.push('a person read without a projection (would return every field)')
      continue
    }
    const end = closing(q, i)
    const body = q.slice(i + 1, end)
    const rest = body.split(PERSON_PUBLIC_FIELDS).join(',')
    for (const key of topLevelKeys(rest)) if (!ROUTING_KEYS.has(key)) out.push(`person field outside PERSON_PUBLIC_FIELDS: ${key}`)
    if (!body.includes(PERSON_PUBLIC_FIELDS) && topLevelKeys(rest).some((k) => k !== 'currentSlug' && k !== 'slugMap' && k !== '_updatedAt')) out.push('projection without PERSON_PUBLIC_FIELDS')
  }
  return out
}

const ENTRIES = Object.entries(MODULES).flatMap(([file, mod]) =>
  Object.entries(mod)
    .filter(([, v]) => typeof v === 'string')
    .map(([name, v]) => ({ id: `${file}#${name}`, query: v as string }))
)
const readsPeople = (q: string) => /_type\s*==\s*"person"/.test(q) || PERSON_REF_FIELDS.some((f) => new RegExp(`\\b${f}(\\[[^\\]]*\\])?->`).test(q))

describe('PERSON_PUBLIC_FIELDS', () => {
  it('projects exactly the declared public keys', () => {
    expect(topLevelKeys(PERSON_PUBLIC_FIELDS)).toEqual([...PERSON_PUBLIC_KEYS])
  })

  it('never names private, internal or bookkeeping fields', () => {
    for (const bad of ['sortOrder', 'archivedBy', 'redirectFrom', 'translationStatus', 'notes', 'birthday', 'linked_user_id', 'person_private']) {
      expect(PERSON_PUBLIC_FIELDS.includes(bad), bad).toBe(false)
    }
    // projectSlug appears only as a CONDITION (photo scope) and inside link targets, never as a person key.
    for (const bad of ['_id', 'projectSlug', '_rev', '_type', 'anonymisedAt', 'archivedAt']) expect(topLevelKeys(PERSON_PUBLIC_FIELDS)).not.toContain(bad)
  })

  it('the listing rule is the rendering rule plus "not archived"', () => {
    expect(PERSON_LISTABLE).toContain(PERSON_RENDERABLE)
    expect(PERSON_LISTABLE).toContain('!defined(archivedAt)')
    expect(PERSON_RENDERABLE).toContain('!defined(anonymisedAt)')
    expect(PERSON_RENDERABLE).toContain('!= "off"')
  })
})

describe('ADR-043 D5 — website queries project people only through PERSON_PUBLIC_FIELDS', () => {
  const reading = ENTRIES.filter((e) => readsPeople(e.query))

  it('finds the person reads (sanity check on the scanner)', () => {
    const ids = reading.map((e) => e.id)
    for (const expected of [
      'src/lib/sanity/queries.ts#PAGE_SECTIONS_PROJECTION',
      'src/lib/sanity/queries.ts#pageBySlugQuery',
      'src/lib/sanity/queries.ts#homePageQuery',
      'src/lib/sanity/queries.ts#postBySlugQuery',
      'src/lib/sanity/queries.ts#eventBySlugQuery',
      'src/lib/modules/people/queries.ts#PERSON_BY_SLUG_QUERY',
      'src/lib/modules/people/queries.ts#PEOPLE_BY_GROUP_QUERY',
      'src/lib/modules/people/queries.ts#TEAM_SECTION_PEOPLE_FIELDS',
      'src/lib/modules/digital-cards/queries.ts#DIGITAL_CARD_PERSON_QUERY',
    ]) expect(ids).toContain(expected)
  })

  for (const e of ENTRIES.filter((x) => readsPeople(x.query))) {
    it(e.id, () => {
      expect(problems(e.query)).toEqual([])
    })
  }

  it('the scanner rejects extra fields, raw dereferences, missing projections and missing rules', () => {
    expect(problems(`*[_type == "person" && projectSlug == $projectSlug && ${PERSON_RENDERABLE}]{ ${PERSON_PUBLIC_FIELDS}, sortOrder }`)).not.toEqual([])
    expect(problems(`*[_type == "person" && projectSlug == $projectSlug && ${PERSON_RENDERABLE}]{ firstName, "notes": notes }`)).not.toEqual([])
    expect(problems(`*[_type == "person" && projectSlug == $projectSlug && ${PERSON_RENDERABLE}]`)).not.toEqual([])
    expect(problems(`*[_type == "person" && projectSlug == $projectSlug]{ ${PERSON_PUBLIC_FIELDS} }`)).not.toEqual([])
    expect(problems(`"authors": authors[]->{ firstName }`)).not.toEqual([])
    expect(problems(`"x": (people[]->)[_type == "person" && ${PERSON_RENDERABLE}]{ ..., ${PERSON_PUBLIC_FIELDS} }`)).not.toEqual([])
    expect(problems(`*[_type == "person" && ${PERSON_RENDERABLE}][0].birthday`)).not.toEqual([])
    // and accepts the real shapes
    expect(problems(`*[_type == "person" && ${PERSON_RENDERABLE}] | order(sortOrder asc)[0...3]{ "slugMap": slug, ${PERSON_PUBLIC_FIELDS} }`)).toEqual([])
  })
})

describe('display name rule (contracts §2)', () => {
  it('displayName wins, else "first last"; honorific prefixes the website name', () => {
    expect(personDisplayName({ firstName: 'Anna', lastName: 'Rossi' })).toBe('Anna Rossi')
    expect(personDisplayName({ firstName: 'Anna', lastName: 'Rossi', displayName: ' Annina ' })).toBe('Annina')
    expect(personDisplayName({ firstName: '', lastName: '' })).toBe('')
    expect(personFullName({ honorific: 'Dott.', firstName: 'Paolo', lastName: 'Martegani' })).toBe('Dott. Paolo Martegani')
    expect(personFullName({ honorific: 'Dott.', firstName: '', lastName: '' })).toBe('')
    expect(personInitials({ firstName: 'élodie', lastName: 'Martin' })).toBe('ÉM')
    expect(personInitials({ displayName: 'Swami Yogananda' })).toBe('SY')
  })
})
