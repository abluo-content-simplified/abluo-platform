import { describe, it, expect } from 'vitest'
import { MODULE_REGISTRY } from '../../registry'
import { MODULE_PERMISSION_MAP } from '../../permissions'
import { buildSchema } from '../../schema'
import { schemaTypes, initialValueTemplates } from '@/lib/sanity/schema'
import { LIFECYCLE_PUBLIC_RULES, publicFilterFor } from '@/lib/lifecycle/public-types'
import { ACTIVITY_WEBHOOK_FILTER } from '@/lib/lifecycle/studio-activity'
import { RESERVED_SLUGS } from '@/lib/platform/reserved-slugs'
import { PERSON_LISTABLE, PERSON_PUBLIC_FIELDS } from '@/lib/modules/people/projection'
import { DIGITAL_CARD_PERMISSIONS, DIGITAL_CARDS_MODULE_ID } from '../model'
import { DIGITAL_CARD_PUBLIC } from '../projection'
import * as Q from '../queries'

// ADR-049 — the Digital Cards module foundation: manifest, permissions, schema,
// lifecycle and the website queries' guards.

/* eslint-disable @typescript-eslint/no-explicit-any */
const types = buildSchema() as any[]
const type = (name: string) => types.find((t) => t.name === name)
const field = (typeName: string, name: string) => type(typeName)?.fields?.find((f: any) => f.name === name)
const manifest = MODULE_REGISTRY.find((m) => m.id === DIGITAL_CARDS_MODULE_ID)!

describe('Digital Cards manifest', () => {
  it('is registered, owns the card types and a Studio collection, no sections', () => {
    expect(manifest).toBeDefined()
    expect(manifest.platformContract.sectionTypes).toEqual([])
    expect(manifest.platformContract.schemaTypes).toEqual(['digitalCard', 'digitalCardLink'])
    expect(manifest.platformContract.schemaDefinitions().map((t: any) => t.name)).toEqual(['digitalCard', 'digitalCardLink'])
    const item = manifest.platformContract.collections?.[0]?.items?.[0]
    expect(item).toMatchObject({ schemaType: 'digitalCard', initialValueTemplate: 'digitalCardProjectOwned' })
    expect(item?.filter).toContain('projectSlug == $slug')
    expect(manifest.dataStore.primary).toBe('hybrid')
  })

  it('permissions per CONTRACTS.md', () => {
    const roles = (id: string) => manifest.platformContract.permissions.find((p) => p.id === id)?.defaultRoles
    expect(roles('digital-cards.read')).toEqual(['owner', 'editor', 'viewer'])
    expect(roles('digital-cards.write')).toEqual(['owner', 'editor'])
    expect(roles('digital-cards.delete')).toEqual(['owner'])
    expect(roles('digital-cards.stats.read')).toEqual(['owner', 'editor'])
    for (const id of Object.values(DIGITAL_CARD_PERMISSIONS)) expect(MODULE_PERMISSION_MAP[id], id).toBeDefined()
  })
})

describe('Digital Cards schema', () => {
  it('registers digitalCard and digitalCardLink exactly once', () => {
    const names = (schemaTypes as any[]).map((t) => t.name)
    for (const n of ['digitalCard', 'digitalCardLink']) expect(names.filter((x) => x === n), n).toHaveLength(1)
  })

  it('has the contract fields and the publishing group', () => {
    const names = type('digitalCard').fields.map((f: any) => f.name)
    for (const n of ['projectSlug', 'publicId', 'kind', 'person', 'urlName', 'retiredUrlNames', 'description', 'links', 'background', 'show', 'publishingStatus', 'expiresAt', 'archivedAt']) expect(names, n).toContain(n)
    expect(type('digitalCard').groups.map((g: any) => g.name)).toContain('publishing')
    expect(field('digitalCard', 'description').type).toBe('localizedText')
    expect(field('digitalCard', 'person').weak).toBe(true)
    const show = field('digitalCard', 'show').fields.map((f: any) => f.name)
    for (const n of ['name', 'description', 'phone', 'email', 'whatsapp', 'saveContact', 'socials', 'hiddenSocials', 'logo', 'businessName', 'locations', 'photo', 'role', 'nameMode', 'profileLink']) expect(show, n).toContain(n)
    const link = type('digitalCardLink').fields.map((f: any) => f.name)
    for (const n of ['kind', 'label', 'url', 'page', 'file', 'value', 'hidden', 'primary']) expect(link, n).toContain(n)
    expect(field('digitalCardLink', 'label').type).toBe('localizedString')
  })

  it('validates the URL name only for person cards', async () => {
    const { validateUrlName } = await import('../schema')
    const ctx = (kind: string) => ({ document: { _id: 'x', kind, projectSlug: 'p' } })
    expect(await validateUrlName(undefined, ctx('site'))).toBe(true)
    expect(await validateUrlName('', ctx('person'))).not.toBe(true)
    expect(await validateUrlName('Sofia Rossi', ctx('person'))).not.toBe(true)
    expect(await validateUrlName('sofia-rossi', ctx('person'))).toBe(true)
    const getClient = () => ({ fetch: async () => [{ _id: 'y', urlName: 'marco', retiredUrlNames: ['sofia-rossi'] }, { _id: 'drafts.x', urlName: 'old' }] })
    expect(await validateUrlName('sofia-rossi', { ...ctx('person'), getClient })).not.toBe(true)
    expect(await validateUrlName('old', { ...ctx('person'), getClient })).toBe(true)
  })

  it('has a project-owned template with a publicId', () => {
    const tpl = (initialValueTemplates as any[]).find((t) => t.id === 'digitalCardProjectOwned')
    expect(tpl).toMatchObject({ schemaType: 'digitalCard' })
    const v = tpl.value({ projectSlug: 'cyce' })
    expect(v).toMatchObject({ projectSlug: 'cyce', kind: 'person' })
    expect(v.publicId).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('Digital Cards platform registrations', () => {
  it('is a lifecycle type with the optional rule, in the Studio activity webhook', () => {
    expect(LIFECYCLE_PUBLIC_RULES.digitalCard).toBe('optional')
    expect(publicFilterFor('digitalCard')).toContain('archivedAt')
    expect(ACTIVITY_WEBHOOK_FILTER).toContain('"digitalCard"')
  })

  it('reserves the website and dashboard segments', () => {
    expect(RESERVED_SLUGS).toContain('link')
    expect(RESERVED_SLUGS).toContain('cards')
  })
})

describe('Digital Cards website queries', () => {
  it('every card read is public, project-scoped and published', () => {
    expect(DIGITAL_CARD_PUBLIC).toContain(publicFilterFor('digitalCard'))
    expect(DIGITAL_CARD_PUBLIC).toContain('projectSlug == $projectSlug')
    expect(DIGITAL_CARD_PUBLIC).toContain('!(_id in path("drafts.**"))')
    for (const q of [Q.DIGITAL_CARD_SITE_QUERY, Q.DIGITAL_CARD_PERSON_QUERY, Q.DIGITAL_CARD_BY_RETIRED_NAME_QUERY, Q.DIGITAL_CARD_KNOWN_IDS_QUERY]) expect(q).toContain(DIGITAL_CARD_PUBLIC)
  })

  it('reads the person through PERSON_PUBLIC_FIELDS, listable only, never private', () => {
    expect(Q.DIGITAL_CARD_PERSON_QUERY).toContain(PERSON_PUBLIC_FIELDS)
    expect(Q.DIGITAL_CARD_PERSON_QUERY).toContain(PERSON_LISTABLE)
    for (const q of Object.values(Q)) {
      expect(q).not.toContain('person_private')
      expect(q).not.toMatch(/\bperson->/)
    }
  })

  it('never projects hidden links or retired names as content', () => {
    expect(Q.DIGITAL_CARD_SITE_QUERY).toContain('links[hidden != true]')
    expect(Q.DIGITAL_CARD_PERSON_QUERY).not.toMatch(/"retiredUrlNames"|\bretiredUrlNames\s*,/)
  })
})
