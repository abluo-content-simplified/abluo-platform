import { describe, expect, it } from 'vitest'
import {
  NEW_PROJECT_STATUS,
  PROVISION_STEPS,
  nextStep,
  orderLocales,
  ownerInviteOrigin,
  sanityDocIds,
  slugFromName,
  validateSlug,
  validateWizardInput,
  type WizardInput,
} from '../model'
import { servesOnHostKind } from '@/lib/tenancy/host-scope'
import { LOCALE_CODES } from '@/lib/i18n/locales'
import { START_PAGE_COPY } from '../placeholders'

const TENANT = '7d1f2a40-1111-4abc-8def-000000000001'

const valid = (patch: Partial<WizardInput> = {}): WizardInput => ({
  client: { mode: 'new', name: 'Studio Rossi', slug: 'studio-rossi' },
  project: { name: 'Studio Rossi', slug: 'rossi', defaultLocale: 'it', supportedLocales: ['it', 'en'] },
  designSystemId: 'abluo-base-design-system',
  owner: { name: 'Paola Rossi', email: 'Paola@Example.com ' },
  ...patch,
})

describe('validateSlug', () => {
  it.each([
    ['rossi', null],
    ['studio-rossi', null],
    ['a1', null],
    ['x'.repeat(40), null],
    ['', 'required'],
    ['a', 'tooShort'],
    ['x'.repeat(41), 'tooLong'],
    ['Rossi', 'invalidChars'],
    ['studio rossi', 'invalidChars'],
    ['studio_rossi', 'invalidChars'],
    ['rossì', 'invalidChars'],
    [' rossi', 'invalidChars'],
    ['1rossi', 'mustStartWithLetter'],
    ['-rossi', 'mustStartWithLetter'],
    ['rossi-', 'hyphenEdges'],
    ['studio--rossi', 'doubleHyphen'],
    ['admin', 'reserved'],
    ['studio', 'reserved'],
    ['whats-new', 'reserved'],
    ['en', 'reserved'],
    ['new', 'reserved'],
  ])('%j → %s', (slug, expected) => {
    expect(validateSlug(slug)).toBe(expected)
  })
})

describe('slugFromName', () => {
  it.each([
    ['Studio Rossi', 'studio-rossi'],
    ['Studio Dentistico Müller & Söhne', 'studio-dentistico-muller-sohne'],
    ['  No!Logo  ', 'no-logo'],
    ['2026 Clinic', 'clinic'],
    ['Ça va', 'ca-va'],
    ['', ''],
  ])('%j → %j', (name, slug) => {
    expect(slugFromName(name)).toBe(slug)
  })
  it('stays within the length limit and never ends with a hyphen', () => {
    const s = slugFromName(`${'abc '.repeat(20)}`)
    expect(s.length).toBeLessThanOrEqual(40)
    expect(s.endsWith('-')).toBe(false)
    expect(validateSlug(s)).toBeNull()
  })
})

describe('orderLocales', () => {
  it('puts the default first, then registry order, without duplicates or unknown codes', () => {
    expect(orderLocales('it', ['de', 'en', 'it', 'xx', 'en'])).toEqual(['it', 'en', 'de'])
    expect(orderLocales('de', [])).toEqual(['de'])
  })
})

describe('validateWizardInput', () => {
  it('accepts a complete new-client input and normalises it', () => {
    const r = validateWizardInput(valid())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.owner).toEqual({ name: 'Paola Rossi', email: 'paola@example.com' })
    expect(r.value.project.supportedLocales).toEqual(['it', 'en'])
  })

  it('accepts an existing client without an Owner', () => {
    const r = validateWizardInput(valid({ client: { mode: 'existing', tenantId: TENANT }, owner: null }))
    expect(r.ok).toBe(true)
  })

  it('requires an Owner for a new client', () => {
    const r = validateWizardInput(valid({ owner: null }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toMatchObject({ ownerEmail: 'required', ownerName: 'required' })
  })

  it('reports every bad field with a code', () => {
    const r = validateWizardInput({
      client: { mode: 'new', name: ' ', slug: 'Admin' },
      project: { name: '', slug: 'studio', defaultLocale: 'xx', supportedLocales: ['zz'] },
      designSystemId: 'drafts.abc',
      owner: { name: 'P', email: 'not-an-email' },
    })
    expect(r).toEqual({
      ok: false,
      errors: {
        clientName: 'required',
        clientSlug: 'invalidChars',
        projectName: 'required',
        projectSlug: 'reserved',
        defaultLocale: 'required',
        supportedLocales: 'invalid',
        designSystem: 'required',
        ownerEmail: 'invalid',
      },
    })
  })

  it('refuses a missing or malformed client choice', () => {
    expect(validateWizardInput(valid({ client: { mode: 'existing', tenantId: 'nope' } }))).toMatchObject({ ok: false, errors: { client: 'required' } })
    expect(validateWizardInput({ ...valid(), client: null })).toMatchObject({ ok: false, errors: { client: 'required' } })
    expect(validateWizardInput(null)).toMatchObject({ ok: false })
  })

  it('caps names at 120 characters', () => {
    const r = validateWizardInput(valid({ project: { name: 'x'.repeat(121), slug: 'rossi', defaultLocale: 'it', supportedLocales: [] } }))
    expect(r).toMatchObject({ ok: false, errors: { projectName: 'tooLong' } })
  })
})

describe('steps and ids', () => {
  it('nextStep resumes at the first step neither done nor skipped', () => {
    const at = '2026-10-08T00:00:00Z'
    expect(nextStep(PROVISION_STEPS, {})).toBe('supabase.tenant')
    expect(nextStep(PROVISION_STEPS, { 'supabase.tenant': { status: 'done', at }, 'supabase.project': { status: 'failed', at } })).toBe('supabase.project')
    const all = Object.fromEntries(PROVISION_STEPS.map((s) => [s, { status: 'done' as const, at }]))
    expect(nextStep(PROVISION_STEPS, all)).toBeNull()
  })

  it('Sanity ids are deterministic and follow the bootstrap naming', () => {
    expect(sanityDocIds('rossi', 'studio-rossi')).toEqual({
      client: 'client-studio-rossi',
      designSystem: 'ds-rossi',
      project: 'project-rossi',
      siteConfig: 'siteconfig-rossi',
      homePage: 'page-rossi-home',
    })
  })

  it('a new project serves on its preview surfaces only, never on a custom domain', () => {
    expect(servesOnHostKind(NEW_PROJECT_STATUS, 'preview-subdomain')).toBe(true)
    expect(servesOnHostKind(NEW_PROJECT_STATUS, 'custom-domain')).toBe(false)
  })

  it('the Owner invitation links to the client dashboard host, not the admin host', () => {
    expect(ownerInviteOrigin('https://admin.abluo.app')).toBe('https://abluo.app')
    expect(ownerInviteOrigin('https://dev.abluo.app')).toBe('https://dev.abluo.app')
    expect(ownerInviteOrigin('http://localhost:3000')).toBe('http://localhost:3000')
    expect(ownerInviteOrigin(null)).toBeNull()
    expect(ownerInviteOrigin('not a url')).toBeNull()
  })
})

describe('placeholder copy', () => {
  it('has every field for every platform locale', () => {
    for (const l of LOCALE_CODES) {
      for (const v of Object.values(START_PAGE_COPY[l])) expect(v.trim().length, l).toBeGreaterThan(0)
    }
  })
})
