import { describe, expect, it } from 'vitest'
import { planProvisioning, type PlanContext } from '../plan'
import { PROVISION_STEPS, validateWizardInput, type ValidWizardInput, type WizardInput } from '../model'
import { START_PAGE_COPY } from '../placeholders'

const TENANT = '7d1f2a40-1111-4abc-8def-000000000001'
const PROJECT = '7d1f2a40-2222-4abc-8def-000000000002'

function input(patch: Partial<WizardInput> = {}): ValidWizardInput {
  const r = validateWizardInput({
    client: { mode: 'new', name: 'Studio Rossi', slug: 'studio-rossi' },
    project: { name: 'Studio Rossi', slug: 'rossi', defaultLocale: 'it', supportedLocales: ['it', 'de'] },
    designSystemId: 'abluo-base-design-system',
    owner: { name: 'Paola Rossi', email: 'paola@example.com' },
    ...patch,
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  return r.value
}

const ctx = (patch: Partial<PlanContext> = {}): PlanContext => ({
  tenantId: TENANT,
  projectId: PROJECT,
  tenant: { slug: 'studio-rossi', name: 'Studio Rossi' },
  existingClientDocId: null,
  designSystem: { _id: 'abluo-base-design-system', _type: 'designSystem', role: 'template', name: 'Abluo Base' },
  ...patch,
})

describe('planProvisioning — new client', () => {
  const plan = planProvisioning(input(), ctx())

  it('plans every step, in dependency order', () => {
    expect(plan.steps).toEqual([...PROVISION_STEPS])
  })

  it('creates the tenant and the project rows with the ids chosen at start', () => {
    expect(plan.supabase.tenant).toEqual({ mode: 'new', row: { id: TENANT, slug: 'studio-rossi', display_name: 'Studio Rossi', status: 'active' } })
    expect(plan.supabase.project.row).toEqual({
      id: PROJECT,
      slug: 'rossi',
      tenant_id: TENANT,
      name: 'Studio Rossi',
      default_locale: 'it',
      status: 'preview',
      custom_domain: null,
    })
  })

  it('creates the Sanity client document the way ProjectLinker reads it', () => {
    expect(plan.sanity.client).toEqual({
      mode: 'new',
      doc: { _id: 'client-studio-rossi', _type: 'client', tenantId: TENANT, tenantSlug: 'studio-rossi', displayName: 'Studio Rossi' },
    })
  })

  it('links the project document to the client, the Supabase project and its own design system', () => {
    expect(plan.sanity.project).toEqual({
      _id: 'project-rossi',
      _type: 'project',
      clientRef: { _type: 'reference', _ref: 'client-studio-rossi' },
      projectId: PROJECT,
      projectSlug: 'rossi',
      projectName: 'Studio Rossi',
      tenantId: TENANT,
      tenantSlug: 'studio-rossi',
      defaultLocale: 'it',
      status: 'inactive',
      designSystemRef: { _type: 'reference', _ref: 'ds-rossi' },
    })
  })

  it("gives the project its OWN design system, inheriting from the picked template", () => {
    expect(plan.sanity.designSystem).toEqual({
      _id: 'ds-rossi',
      _type: 'designSystem',
      name: 'Studio Rossi',
      role: 'active',
      projectSlug: 'rossi',
      parentDesignSystem: { _type: 'reference', _ref: 'abluo-base-design-system' },
    })
  })

  it('creates the siteConfig with the languages (default first)', () => {
    expect(plan.sanity.siteConfig).toEqual({
      _id: 'siteconfig-rossi',
      _type: 'siteConfig',
      projectSlug: 'rossi',
      siteName: 'Studio Rossi',
      defaultLocale: 'it',
      supportedLocales: ['it', 'de'],
    })
  })

  it('creates a home page with one hero and one text section, localized for each supported language only', () => {
    type Section = { _type: string; _key: string; headline: Record<string, unknown>; subheadline: Record<string, unknown>; title: Record<string, unknown>; content: Record<string, unknown[]> }
    const home = plan.sanity.homePage as unknown as { slug: unknown; sections: Section[] }
    expect(home).toMatchObject({ _id: 'page-rossi-home', _type: 'page', projectSlug: 'rossi', pageType: 'home', backgroundPattern: 'none' })
    expect(home.slug).toEqual({ _type: 'localizedSlug', it: { _type: 'slug', current: 'home' }, de: { _type: 'slug', current: 'home' } })
    expect(home.sections.map((s) => s._type)).toEqual(['heroSection', 'textSection'])
    const [hero, text] = home.sections
    expect(hero.headline).toEqual({ _type: 'localizedText', it: 'Studio Rossi', de: 'Studio Rossi' })
    expect(hero.subheadline.it).toBe(START_PAGE_COPY.it.heroSubheadline)
    expect(hero.subheadline.de).toBe(START_PAGE_COPY.de.heroSubheadline)
    expect(hero.subheadline).not.toHaveProperty('en')
    expect(text.title).toEqual({ _type: 'localizedString', it: START_PAGE_COPY.it.textTitle, de: START_PAGE_COPY.de.textTitle })
    expect(text.content.it[0]).toMatchObject({ _type: 'block', style: 'normal', children: [{ _type: 'span', text: START_PAGE_COPY.it.textBody }] })
    // Every array member has a unique _key (Studio requires it).
    expect(new Set(home.sections.map((s) => s._key)).size).toBe(2)
  })

  it('invites the Owner in the site language', () => {
    expect(plan.invite).toEqual({ email: 'paola@example.com', name: 'Paola Rossi', role: 'owner', locale: 'it' })
  })

  it('is deterministic (a stored plan replays identically) and JSON-serializable', () => {
    expect(planProvisioning(input(), ctx())).toEqual(plan)
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan)
  })

  it('every project-owned document carries the projectSlug (the universal tenant key)', () => {
    for (const d of [plan.sanity.designSystem, plan.sanity.project, plan.sanity.siteConfig, plan.sanity.homePage]) expect(d.projectSlug).toBe('rossi')
  })
})

describe('planProvisioning — existing client', () => {
  it('reuses the tenant and its existing Sanity client document, and skips the invitation when no Owner is given', () => {
    const plan = planProvisioning(
      input({ client: { mode: 'existing', tenantId: TENANT }, owner: null }),
      ctx({ tenant: { slug: 'freeriders', name: 'Freeriders' }, existingClientDocId: 'freeriders-client-legacy-id' })
    )
    expect(plan.supabase.tenant).toEqual({ mode: 'existing', id: TENANT })
    expect(plan.sanity.client).toEqual({ mode: 'existing', id: 'freeriders-client-legacy-id' })
    expect(plan.sanity.project.clientRef).toEqual({ _type: 'reference', _ref: 'freeriders-client-legacy-id' })
    expect(plan.sanity.project.tenantSlug).toBe('freeriders')
    expect(plan.invite).toBeNull()
    expect(plan.steps).toEqual(PROVISION_STEPS.filter((s) => s !== 'invite.owner'))
  })

  it('creates the Sanity client document when the existing client has none yet', () => {
    const plan = planProvisioning(input({ client: { mode: 'existing', tenantId: TENANT } }), ctx({ tenant: { slug: 'cyce', name: 'CYCE' } }))
    expect(plan.sanity.client).toMatchObject({ mode: 'new', doc: { _id: 'client-cyce', tenantId: TENANT, tenantSlug: 'cyce' } })
  })
})

describe('planProvisioning — copying an active design system', () => {
  it('copies the own fields and keeps the source parent', () => {
    const plan = planProvisioning(
      input(),
      ctx({
        designSystem: {
          _id: 'ds-hoffmann',
          _type: 'designSystem',
          role: 'active',
          name: 'Hoffmann',
          projectSlug: 'hoffmann',
          parentDesignSystem: { _ref: 'psicoterapia-base' },
          colors: { light: { primary: '#C2410C' } },
        },
      })
    )
    expect(plan.sanity.designSystem).toEqual({
      _id: 'ds-rossi',
      _type: 'designSystem',
      name: 'Studio Rossi',
      role: 'active',
      projectSlug: 'rossi',
      colors: { light: { primary: '#C2410C' } },
      parentDesignSystem: { _type: 'reference', _ref: 'psicoterapia-base' },
    })
  })
})
