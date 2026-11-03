/**
 * People migration planner (scripts/lib/people-migration.mjs): name
 * normalisation, honorific stripping, duplicate grouping, deterministic ids,
 * merge resolution and apply blockers. No network.
 */
import { describe, expect, it } from 'vitest'
import {
  accentFold,
  blockersOf,
  buildPersonDocument,
  groupCandidates,
  parseName,
  personDocId,
  personPublicId,
  proposalKey,
  refKey,
  resolveMerges,
  splitName,
  stripHonorific,
  teamCandidates,
  hostCandidates,
} from '../lib/people-migration.mjs'

const cand = (source: string, rawName: string, extra: Record<string, unknown> = {}) => ({
  source,
  rawName,
  doc: { id: `${source}-doc`, type: source, label: source },
  placements: [{ kind: source, docId: `${source}-doc`, index: 0 }],
  ...extra,
})

describe('stripHonorific', () => {
  it('strips Dott. / Dott.ssa / Dr. / Prof. and maps them per language', () => {
    expect(stripHonorific('Dott. Paolo Martegani')).toMatchObject({ name: 'Paolo Martegani', honorific: { it: 'Dott.', en: 'Dr.' } })
    expect(stripHonorific('Dott.ssa Chiara Canale')).toMatchObject({ name: 'Chiara Canale', honorific: { it: 'Dott.ssa', en: 'Dr.' } })
    expect(stripHonorific('dr. Jane Roe').name).toBe('Jane Roe')
    expect(stripHonorific('Prof. Mario Rossi')).toMatchObject({ name: 'Mario Rossi', honorific: { it: 'Prof.', en: 'Prof.' } })
  })
  it('does not eat names that merely start with the letters', () => {
    expect(stripHonorific('Drago Verdi').name).toBe('Drago Verdi')
    expect(stripHonorific('Doctorow Ed').honorific).toBeNull()
    expect(stripHonorific('Ingrid Berg').name).toBe('Ingrid Berg')
  })
  it('handles a stacked honorific and collapses whitespace', () => {
    expect(stripHonorific('  Prof.   Dott.  Ada   Lovelace ').name).toBe('Ada Lovelace')
  })
})

describe('splitName / parseName', () => {
  it('keeps surname particles together and keeps accents', () => {
    expect(splitName('Julie Van Brabant')).toMatchObject({ firstName: 'Julie', lastName: 'Van Brabant' })
    expect(splitName('Maria Rosa Di Stefano')).toMatchObject({ firstName: 'Maria Rosa', lastName: 'Di Stefano' })
    expect(splitName('Élodie Chénier')).toMatchObject({ firstName: 'Élodie', lastName: 'Chénier' })
  })
  it('flags single-word names', () => {
    expect(splitName('Emmanuelle')).toMatchObject({ firstName: 'Emmanuelle', lastName: '', singleWord: true })
  })
  it('own honorific field wins over the stripped one', () => {
    const p = parseName('Dott. Paolo Martegani', { _type: 'localizedString', it: 'Dott.', en: 'Dr.', de: 'Dr. med.' })
    expect(p.honorific).toMatchObject({ it: 'Dott.', de: 'Dr. med.' })
    expect(p.cleanName).toBe('Paolo Martegani')
  })
  it('case-folds for the exact key but keeps accents; loose key drops them', () => {
    expect(parseName('ÉLODIE chénier').exactKey).toBe('élodie chénier')
    expect(accentFold('Élodie Chénier')).toBe('elodie chenier')
  })
  it('recognises organisations', () => {
    expect(parseName('Livener Team').looksLikeOrganisation).toBe(true)
    expect(parseName('Paolo Martegani').looksLikeOrganisation).toBe(false)
  })
})

describe('groupCandidates', () => {
  it('same normalised name across sources is ONE proposal listing every source', () => {
    const { proposals, checks } = groupCandidates('cyce', [
      cand('teamMember', 'Florian Parra', { role: { it: 'Insegnante' }, order: 1000 }),
      cand('eventHost', 'florian  parra', { order: 8e8 }),
      cand('postAuthor', 'Dott. Florian Parra', { order: 5e8 }),
    ])
    expect(proposals).toHaveLength(1)
    expect(proposals[0].sources.map((s: { source: string }) => s.source)).toEqual(['teamMember', 'postAuthor', 'eventHost'])
    expect(proposals[0].placements).toHaveLength(3)
    expect(proposals[0].person.jobTitle).toEqual({ it: 'Insegnante' })
    expect(checks).toHaveLength(0)
  })
  it('flags near-duplicates for checking and never merges them', () => {
    const { proposals, checks } = groupCandidates('x', [
      cand('teamMember', 'Elena Constantinides'),
      cand('eventHost', 'E. Constantinides'),
      cand('teamMember', 'Anne Raison'),
      cand('postAuthor', 'Anna Raison'),
      cand('teamMember', 'Zoë Müller'),
      cand('eventHost', 'Zoe Muller'),
      cand('teamMember', 'Parra Florian'),
      cand('teamMember', 'Florian Parra'),
    ])
    expect(proposals).toHaveLength(8)
    const kinds = checks.map((c: { kind: string }) => c.kind).sort()
    expect(kinds).toContain('accent-or-case')
    expect(kinds).toContain('word-order')
    expect(kinds).toContain('same-surname-initial')
    expect(proposals.every((p) => p.mergeInto === null)).toBe(true)
  })
  it('a one-word entry that matches a full name is a check', () => {
    const { checks } = groupCandidates('x', [cand('teamMember', 'Emmanuelle'), cand('teamMember', 'Emmanuelle Dubois')])
    expect(checks.map((c: { kind: string }) => c.kind)).toContain('first-name-only')
  })
  it('records conflicting values instead of silently picking', () => {
    const { proposals } = groupCandidates('x', [
      cand('teamMember', 'Paolo Martegani', { role: { it: 'Odontoiatra' } }),
      cand('postAuthor', 'Paolo Martegani', { role: { it: 'Il Dottore' } }),
    ])
    expect(proposals[0].person.jobTitle).toEqual({ it: 'Odontoiatra' })
    expect(proposals[0].conflicts.jobTitle).toHaveLength(2)
  })
  it('single-word names and organisations need review; anchors become legacyAnchors', () => {
    const { proposals } = groupCandidates('x', [cand('teamMember', 'Dorota', { anchorId: 'dorota' }), cand('postAuthor', 'Livener Team')])
    for (const p of proposals) expect(p.decision).toBe('review')
    expect(proposals.find((p) => p.displayName === 'Dorota')!.person.legacyAnchors).toEqual(['dorota'])
  })
  it('host linking to /page#anchor of a team member is flagged', () => {
    const { checks } = groupCandidates('x', [
      cand('teamMember', 'Florian Parra', { anchorId: 'florian-parra' }),
      cand('eventHost', 'F. Parra', { hostAnchor: 'florian-parra' }),
    ])
    expect(checks.map((c: { kind: string }) => c.kind)).toContain('host-links-to-member')
  })
})

describe('deterministic ids (idempotence)', () => {
  it('same project + same name => same key, id and publicId; other project differs', () => {
    const k = proposalKey('cyce', 'florian parra')
    expect(proposalKey('cyce', 'florian parra')).toBe(k)
    expect(proposalKey('tmz', 'florian parra')).not.toBe(k)
    expect(personDocId('cyce', k)).toBe(`person-cyce-${k}`)
    expect(personPublicId('cyce', k)).toBe(personPublicId('cyce', k))
    expect(personPublicId('cyce', k)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
  it('re-grouping the same data gives identical proposals; editing names does not change ids', () => {
    const data = [cand('teamMember', 'Florian Parra'), cand('eventHost', 'Anne Raison')]
    const a = groupCandidates('cyce', data).proposals
    const b = groupCandidates('cyce', data).proposals
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id))
    const edited = structuredClone(a[0])
    edited.person.firstName = 'Flo'
    expect(buildPersonDocument('cyce', edited)._id).toBe(a[0].id)
  })
  it('ref keys are stable', () => {
    expect(refKey('person-cyce-abc')).toBe(refKey('person-cyce-abc'))
  })
})

describe('resolveMerges / blockers / person document', () => {
  it('folds mergeInto placements into the target; unknown targets are errors', () => {
    const { proposals } = groupCandidates('x', [cand('teamMember', 'Elena Constantinides'), cand('eventHost', 'E. Constantinides')])
    const [a, b] = proposals
    b.mergeInto = a.key
    const r = resolveMerges(proposals)
    expect(r.proposals).toHaveLength(1)
    expect(r.proposals[0].placements).toHaveLength(2)
    const bad = structuredClone(proposals)
    bad[1].mergeInto = 'nope'
    expect(resolveMerges(bad).errors).toHaveLength(1)
  })
  it('blocks single-word names and non-create decisions', () => {
    const { proposals } = groupCandidates('x', [cand('teamMember', 'Dorota')])
    expect(blockersOf(proposals[0]).length).toBe(2)
    proposals[0].decision = 'create'
    proposals[0].person.lastName = 'Nowak'
    expect(blockersOf(proposals[0])).toEqual([])
  })
  it('builds a person with empty groups, listed visibility, localized fields and a photo ref', () => {
    const { proposals } = groupCandidates('cyce', [cand('teamMember', 'Dott.ssa Anna Neri', { role: { it: 'Dentista' }, bio: { it: 'Bio' }, website: 'https://a.example', anchorId: 'anna-neri' })])
    proposals[0].person.photoMediaAssetId = 'media-1'
    const d = buildPersonDocument('cyce', proposals[0], { sortOrder: 10 })
    expect(d).toMatchObject({ _type: 'person', projectSlug: 'cyce', firstName: 'Anna', lastName: 'Neri', visibility: 'listed', groups: [], sortOrder: 10, legacyAnchors: ['anna-neri'], website: 'https://a.example' })
    expect(d.honorific).toMatchObject({ _type: 'localizedString', it: 'Dott.ssa' })
    expect(d.jobTitle).toMatchObject({ it: 'Dentista' })
    expect(d.photo).toEqual({ _type: 'reference', _ref: 'media-1' })
  })
})

describe('reading stored shapes', () => {
  it('teamCandidates follows section/member order and records the patch path', () => {
    const doc = { _id: 'p1', _type: 'page', sections: [{ _type: 'heroSection', _key: 'h' }, { _type: 'teamSection', _key: 's1', members: [{ _key: 'a', name: 'Dott. Ann Lee', anchorId: 'ann', photo: { asset: { _ref: 'image-1' } } }, { _key: 'b', name: 'Bob Ray' }] }] }
    const c = teamCandidates(doc, 'page p1')
    expect(c.map((x) => x.rawName)).toEqual(['Dott. Ann Lee', 'Bob Ray'])
    expect(c[0].placements[0]).toMatchObject({ kind: 'teamSection', sectionPath: 'sections[_key=="s1"]', index: 0, memberCount: 2 })
    expect(c[0].imageAssetRef).toBe('image-1')
    expect(c[0].order).toBeLessThan(c[1].order)
  })
  it('hostCandidates reads inline hosts', () => {
    const c = hostCandidates({ _id: 'e1', title: { en: 'Class' }, hosts: [{ _key: 'h', name: 'Ann Lee', url: '/teachers#ann-lee' }] })
    expect(c[0]).toMatchObject({ rawName: 'Ann Lee', hostAnchor: 'ann-lee' })
  })
})
