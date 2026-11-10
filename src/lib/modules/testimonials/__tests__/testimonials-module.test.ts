import { describe, it, expect } from 'vitest'
import { MODULE_REGISTRY } from '../../registry'
import { MODULE_PERMISSION_MAP } from '../../permissions'
import { isSectionTypeAvailable } from '../../sections'
import { buildSchema } from '../../schema'
import { schemaTypes, initialValueTemplates } from '@/lib/sanity/schema'
import { PAGE_SECTIONS_OF } from '@/lib/sanity/fields/shared'
import { LIFECYCLE_PUBLIC_RULES, publicFilterFor } from '@/lib/lifecycle/public-types'
import { ACTIVITY_WEBHOOK_FILTER } from '@/lib/lifecycle/studio-activity'
import { TENANT_SURFACES } from '@/lib/client/surfaces'
import { RESERVED_SLUGS } from '@/lib/platform/reserved-slugs'
import { SECTION_CATALOGUE } from '@/lib/sanity/sections/catalogue'
import { SEARCH_KIND_ORDER } from '@/lib/search/types'
import { allSearchSources } from '@/lib/search/sources'
import { TESTIMONIAL_PERMISSIONS, TESTIMONIALS_MODULE_ID } from '../model'

// ADR-048 — the Testimonials module. Pins what a regression would break
// silently: ownership of the section (gating), permissions per role, the stored
// type names and the registrations the platform guards depend on.

/* eslint-disable @typescript-eslint/no-explicit-any */
const types = buildSchema() as any[]
const type = (name: string) => types.find((t) => t.name === name) ?? (schemaTypes as any[]).find((t) => t.name === name)
const field = (typeName: string, name: string) => type(typeName)?.fields?.find((f: any) => f.name === name)
const manifest = MODULE_REGISTRY.find((m) => m.id === TESTIMONIALS_MODULE_ID)!

describe('Testimonials manifest', () => {
  it('is registered and owns the section, the document and the Studio collection', () => {
    expect(manifest).toBeDefined()
    expect(manifest.platformContract.sectionTypes).toEqual(['testimonialsSection'])
    expect(manifest.platformContract.schemaTypes).toEqual(['testimonial', 'testimonialsSection'])
    const item = manifest.platformContract.collections?.[0]?.items?.[0]
    expect(item).toMatchObject({ schemaType: 'testimonial', initialValueTemplate: 'testimonialProjectOwned' })
    expect(item?.filter).toContain('projectSlug == $slug')
  })

  it('integrates with translate, forms and categories, and keeps its data in Sanity + Supabase', () => {
    expect(manifest.dependencies.integratesWith).toEqual(['translate', 'forms', 'categories'])
    expect(manifest.dependencies.requires).toEqual([])
    expect(manifest.dataStore.primary).toBe('hybrid')
  })

  it('has two settings, both off by default: acceptSubmissions and showPhotos', () => {
    expect(manifest.platformContract.configSchema).toEqual([
      expect.objectContaining({ id: 'acceptSubmissions', type: 'boolean', initialValue: false }),
      expect.objectContaining({ id: 'showPhotos', type: 'boolean', initialValue: false }),
    ])
  })

  it('declares the tag vocabulary on testimonial.tags', () => {
    expect(manifest.taxonomies).toEqual([{ kind: 'tag', usedBy: [{ type: 'testimonial', field: 'tags' }] }])
  })

  it('gates the section on installation, failing open when the module list is unknown', () => {
    expect(isSectionTypeAvailable('testimonialsSection', ['blog'])).toBe(false)
    expect(isSectionTypeAvailable('testimonialsSection', ['testimonials'])).toBe(true)
    expect(isSectionTypeAvailable('testimonialsSection', null)).toBe(true)
  })
})

describe('Testimonials permissions', () => {
  const roles = (id: string) => manifest.platformContract.permissions.find((p) => p.id === id)?.defaultRoles
  it('exposes the ids the services use', () => {
    expect(TESTIMONIAL_PERMISSIONS).toEqual({
      read: 'testimonials.read',
      write: 'testimonials.write',
      privateRead: 'testimonials.private.read',
      delete: 'testimonials.delete',
      taxonomy: 'testimonials.taxonomy.write',
    })
    for (const id of Object.values(TESTIMONIAL_PERMISSIONS)) expect(MODULE_PERMISSION_MAP[id], id).toBeDefined()
  })
  it('ADR-048 D8: read = owner, editor, viewer; write and private = owner, editor; delete = owner', () => {
    expect(roles('testimonials.read')).toEqual(['owner', 'editor', 'viewer'])
    expect(roles('testimonials.write')).toEqual(['owner', 'editor'])
    expect(roles('testimonials.private.read')).toEqual(['owner', 'editor'])
    expect(roles('testimonials.delete')).toEqual(['owner'])
  })
})

describe('Testimonials schema', () => {
  it('registers testimonial and testimonialsSection exactly once', () => {
    const names = (schemaTypes as any[]).map((t) => t.name)
    for (const n of ['testimonial', 'testimonialsSection']) expect(names.filter((x) => x === n), n).toHaveLength(1)
  })

  it('testimonial has the ADR D2 fields, a Publishing group and a meaningful preview', () => {
    const t = type('testimonial')
    const names = t.fields.map((f: any) => f.name)
    for (const n of ['projectSlug', 'publicId', 'displayName', 'anonymous', 'context', 'age', 'abstract', 'body', 'originalLocale', 'rating', 'givenOn', 'source', 'sourceUrl', 'tags', 'permissionToPublish', 'featured', 'expiresAt', 'archivedAt']) {
      expect(names, n).toContain(n)
    }
    expect(t.groups.map((g: any) => g.name)).toContain('publishing')
    expect(t.preview).toBeDefined()
    expect(field('testimonial', 'body').type).toBe('localizedText')
    expect(field('testimonial', 'context').type).toBe('localizedString')
  })

  it('no private field exists on the public document', () => {
    const names = type('testimonial').fields.map((f: any) => f.name)
    for (const n of ['fullName', 'email', 'phone', 'note', 'submissionId']) expect(names, n).not.toContain(n)
  })

  it('the section is available on page and homePage', () => {
    expect(PAGE_SECTIONS_OF.map((m: any) => m.type)).toContain('testimonialsSection')
    for (const doc of ['page', 'homePage']) {
      const of = field(doc, 'sections')?.of?.map((m: any) => m.type) ?? []
      expect(of, doc).toContain('testimonialsSection')
    }
  })

  it('the section has the selection, layout and display fields', () => {
    const names = type('testimonialsSection').fields.map((f: any) => f.name)
    for (const n of ['selectionMode', 'limit', 'tagKey', 'testimonials', 'layout', 'showRating', 'showDate', 'showSource', 'showDisclosure']) expect(names, n).toContain(n)
    expect(field('testimonialsSection', 'testimonials').of[0].weak).toBe(true)
  })

  it('has a project-owned initial value template with permission OFF', () => {
    const tpl = (initialValueTemplates as any[]).find((t) => t.id === 'testimonialProjectOwned')
    expect(tpl).toMatchObject({ schemaType: 'testimonial' })
    const v = tpl.value({ projectSlug: 'acme' })
    expect(v).toMatchObject({ projectSlug: 'acme', permissionToPublish: false, source: 'website' })
    expect(v.publicId).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('Testimonials platform registrations', () => {
  it('is a lifecycle type with the optional rule, in the Studio activity webhook', () => {
    expect(LIFECYCLE_PUBLIC_RULES.testimonial).toBe('optional')
    expect(publicFilterFor('testimonial')).toContain('archivedAt')
    expect(ACTIVITY_WEBHOOK_FILTER).toContain('"testimonial"')
  })

  it('has a nav entry in Content on the testimonials segment', () => {
    const nav = TENANT_SURFACES.find((s: any) => s.kind === 'nav' && s.id === 'testimonials') as any
    expect(nav).toMatchObject({ segment: 'testimonials', group: 'content' })
    expect(nav.requires).toMatchObject({ module: 'testimonials', permission: 'testimonials.read' })
  })

  it('reserves the segment as a slug (CLIENT_PROJECT_SEGMENTS follows with the dashboard route folder, which a test keeps in lockstep)', () => {
    expect(RESERVED_SLUGS).toContain('testimonials')
  })

  it('is in the section catalogue (modules group) and the dashboard search', () => {
    expect(SECTION_CATALOGUE.testimonialsSection?.group).toBe('modules')
    expect(SEARCH_KIND_ORDER).toContain('testimonials')
    expect(allSearchSources().some((s) => s.def.kind === 'testimonials')).toBe(true)
  })
})
