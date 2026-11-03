import { describe, it, expect } from 'vitest'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { buildSchema } from '@/lib/modules/schema'
import { schemaTypes } from '@/lib/sanity/schema'
import { MODULE_PERMISSION_MAP } from '@/lib/modules/permissions'
import { moduleGroupOf } from '@/lib/modules/order'
import { grantPermissions } from '@/lib/api/tenant-context'
import { manageableTaxonomyModules } from '@/lib/taxonomy/manageable'
import { taxonomyReadPermission, taxonomyWritePermission } from '@/lib/taxonomy/permissions'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { PEOPLE_PERMISSIONS, PERSON_CONTACT_KINDS, PERSON_VISIBILITIES } from '../model'

// ADR-043 — the People module foundation. Pins what a regression would break
// silently: the manifest, the stored type names, the additive placement
// fields, the restricted bio and the Groups taxonomy.

/* eslint-disable @typescript-eslint/no-explicit-any */
const types = buildSchema() as any[]
const type = (name: string) => types.find((t) => t.name === name) ?? (schemaTypes as any[]).find((t) => t.name === name)
const field = (typeName: string, name: string) => type(typeName)?.fields?.find((f: any) => f.name === name)

describe('People module manifest', () => {
  const manifest = MODULE_REGISTRY.find((m) => m.id === 'people')!

  it('is registered, owns no section and lists People in Studio (read-only, no create template)', () => {
    expect(manifest).toBeDefined()
    expect(manifest.platformContract.sectionTypes).toEqual([])
    const item = manifest.platformContract.collections[0].items[0]
    expect(item).toMatchObject({ schemaType: 'person', label: 'People' })
    expect(item.initialValueTemplate).toBeUndefined()
    expect(type('person')?.readOnly).toBe(true)
    expect(manifest.dataStore.primary).toBe('hybrid')
  })

  it('declares the contract permissions with the contract default roles', () => {
    const perms = Object.fromEntries(manifest.platformContract.permissions.map((p) => [p.id, p.defaultRoles]))
    expect(perms).toEqual({
      'people.person.read': ['owner', 'editor', 'viewer'],
      'people.person.write': ['owner', 'editor'],
      'people.person.archive': ['owner'],
      'people.person.anonymise': ['owner'],
      'people.person.delete': ['owner'],
      'people.taxonomy.write': ['owner', 'editor'],
    })
    for (const id of Object.values(PEOPLE_PERMISSIONS)) expect(MODULE_PERMISSION_MAP[id], id).toBeDefined()
  })

  it('holds the profile pages segment as localized module config (never hardcoded)', () => {
    const seg = manifest.platformContract.configSchema.find((f) => f.id === 'profileSegment')
    expect(seg?.type).toBe('localizedString')
    expect(seg?.required).toBeFalsy()
  })

  it('is placed in the module order (Show) and integrates with Blog and Events', () => {
    expect(moduleGroupOf('people')).toBe('show')
    expect(MODULE_REGISTRY.find((m) => m.id === 'blog')!.dependencies.integratesWith).toContain('people')
    expect(MODULE_REGISTRY.find((m) => m.id === 'events')!.dependencies.integratesWith).toContain('people')
  })
})

describe('Groups taxonomy (ADR-043 D3, Amendment J)', () => {
  const grant = (role: 'owner' | 'editor' | 'viewer') => ({
    projectSlug: asSupabaseProjectSlug('cyce'),
    enabledModuleIds: ['people'],
    permissions: grantPermissions(role, ['people']),
  })

  it('declares one category kind used by person.groups', () => {
    expect(MODULE_REGISTRY.find((m) => m.id === 'people')!.taxonomies).toEqual([{ kind: 'category', usedBy: [{ type: 'person', field: 'groups' }] }])
    expect(taxonomyWritePermission('people')).toBe('people.taxonomy.write')
    expect(taxonomyReadPermission('people')).toBe('people.person.read')
  })

  it('owner and editor manage groups, a viewer reads them', () => {
    expect(manageableTaxonomyModules(grant('owner') as never)).toEqual([{ module: 'people', kinds: ['category'], canWrite: true }])
    expect(manageableTaxonomyModules(grant('editor') as never)).toEqual([{ module: 'people', kinds: ['category'], canWrite: true }])
    expect(manageableTaxonomyModules(grant('viewer') as never)).toEqual([{ module: 'people', kinds: ['category'], canWrite: false }])
  })
})

describe('person schema', () => {
  it('registers each People type exactly once', () => {
    const names = (schemaTypes as any[]).map((t) => t.name)
    for (const n of ['person', 'personContact', 'personQualification', 'personBioText']) expect(names.filter((x) => x === n), n).toHaveLength(1)
  })

  it('has the contract fields with the contract types', () => {
    const expected: Record<string, string> = {
      projectSlug: 'string', publicId: 'string', firstName: 'string', lastName: 'string', displayName: 'string',
      honorific: 'localizedString', jobTitle: 'localizedString', groups: 'array', photo: 'reference', shortBio: 'localizedText',
      bio: 'personBioText', languages: 'array', website: 'url', contacts: 'array', qualifications: 'array', visibility: 'string',
      slug: 'localizedSlug', redirectFrom: 'redirectFrom', sortOrder: 'number', legacyAnchors: 'array', anonymisedAt: 'datetime', archivedAt: 'datetime',
    }
    for (const [name, t] of Object.entries(expected)) expect(field('person', name)?.type, name).toBe(t)
    expect(field('person', 'photo')?.to).toEqual([{ type: 'mediaAsset' }])
    expect(field('person', 'contacts')?.of?.[0]?.type).toBe('personContact')
    expect(field('person', 'qualifications')?.of?.[0]?.type).toBe('personQualification')
    expect(field('person', 'visibility')?.initialValue).toBe('listed')
    expect(field('person', 'visibility')?.options?.list.map((o: any) => o.value)).toEqual([...PERSON_VISIBILITIES])
    expect(field('person', 'legacyAnchors')?.hidden).toBe(true)
    expect(field('person', 'anonymisedAt')?.hidden).toBe(true)
  })

  it('public contacts carry kind, value, label, preferred — and no visibility (private ones never live in Sanity)', () => {
    expect(type('personContact').fields.map((f: any) => f.name)).toEqual(['kind', 'value', 'label', 'preferred'])
    expect(field('personContact', 'kind')?.options?.list.map((o: any) => o.value)).toEqual([...PERSON_CONTACT_KINDS])
    expect(type('personQualification').fields.map((f: any) => [f.name, f.type])).toEqual([
      ['title', 'localizedString'], ['issuer', 'string'], ['issuedOn', 'date'], ['expiresOn', 'date'],
    ])
  })

  it('the long bio has the FAQ answer restrictions (paragraphs, lists, bold, italic, the shared body link)', () => {
    const answer = type('faqAnswerText').fields.find((f: any) => f.name === 'en').of[0]
    const bio = type('personBioText').fields.find((f: any) => f.name === 'en').of[0]
    expect(bio.styles).toEqual(answer.styles)
    expect(bio.lists).toEqual(answer.lists)
    expect(bio.marks.decorators).toEqual(answer.marks.decorators)
    expect(bio.marks.annotations).toEqual(answer.marks.annotations)
    expect(type('personBioText').fields.some((f: any) => f.name === 'translationStatus' && f.hidden === true)).toBe(true)
  })
})

describe('placement fields (contracts §4) — additive, deprecated fields untouched', () => {
  const refsTo = (f: any) => f?.of?.[0]

  it('teamSection: people (weak, project-scoped refs) + groupFilter; members kept', () => {
    expect(refsTo(field('teamSection', 'people'))).toMatchObject({ type: 'reference', to: [{ type: 'person' }], weak: true })
    expect(field('teamSection', 'groupFilter')?.type).toBe('string')
    expect(field('teamSection', 'members')?.of?.[0]?.type).toBe('teamMemberObject')
  })

  it('post: authors (max 10); the old author reference kept', () => {
    expect(refsTo(field('post', 'authors'))).toMatchObject({ type: 'reference', to: [{ type: 'person' }], weak: true })
    expect(field('post', 'author')?.to).toEqual([{ type: 'postAuthor' }])
  })

  it('event: hostPeople; the inline hosts kept', () => {
    expect(refsTo(field('event', 'hostPeople'))).toMatchObject({ type: 'reference', to: [{ type: 'person' }], weak: true })
    expect(field('event', 'hosts')?.of?.[0]?.name).toBe('eventHost')
  })

  it('the picker lists only this project’s people', () => {
    const filter = refsTo(field('post', 'authors')).options.filter
    expect(filter({ document: { projectSlug: 'cyce' } })).toEqual({ filter: 'projectSlug == $projectSlug', params: { projectSlug: 'cyce' } })
  })
})
