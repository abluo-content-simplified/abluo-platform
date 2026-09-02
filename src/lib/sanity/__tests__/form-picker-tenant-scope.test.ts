/**
 * Form-picker tenant scope — every Studio picker that selects a form definition
 * must be scoped to the owning tenant.
 *
 * WHY THIS TEST EXISTS:
 * A `formDefinition` is TENANT-owned (`tenantSlug`), while the documents that
 * point at one are PROJECT-owned (`projectSlug`). Five reference fields select
 * a form. Two of them were scoped in v1.0.31 via `activeFormReferenceFilter`;
 * the other three kept a hardcoded string filter of `role == "active"` with no
 * tenant clause, so the Studio picker OFFERED an editor on one project every
 * other tenant's forms. The runtime failed closed, so picking one rendered
 * nothing — but MIGRATION.md Stage 4 asks that none be offered at all.
 *
 * The sweep below is the point of the file: it does not name the three fields,
 * it finds every `reference → formDefinition` field in the whole schema and
 * insists on a tenant clause. A picker added later is covered the day it is
 * written. It also finds a sixth — `whatsappModuleConfig.internalFormRef`,
 * generated from `src/lib/modules/registry.ts`. Its manifest still declares a
 * `tenantSlug == $tenantSlug` STRING, which is right for the Modules pane
 * (ModuleList.tsx binds that param itself) but would select NOTHING in a
 * Studio reference picker, where nothing binds it. `config-schema.ts`
 * therefore generates every formDefinition picker with the shared resolver
 * instead, so this field takes the FUNCTION branch below like the other five.
 *
 * Pure — no Sanity client, no network. The resolver is exercised against a
 * stubbed `getClient`.
 */

import { describe, it, expect } from 'vitest'
import { schemaTypes, activeFormReferenceFilter, resolveProjectScope } from '@/lib/sanity/schema'

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyType = any

// ─── Find every picker that selects a formDefinition ─────────────────────────

interface FoundField {
  /** Dotted path, e.g. "contactSection.contactForm". */
  path: string
  field: AnyType
}

/** Walk a schema type's fields and array members, collecting form references. */
function collectFormReferences(): FoundField[] {
  const found: FoundField[] = []
  const seen = new Set<unknown>()

  const pointsAtFormDefinition = (field: AnyType) =>
    field?.type === 'reference' &&
    Array.isArray(field.to) &&
    field.to.some((t: AnyType) => t?.type === 'formDefinition')

  const walk = (node: AnyType, path: string) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    for (const field of (node.fields ?? []) as AnyType[]) {
      const fieldPath = `${path}.${field.name}`
      if (pointsAtFormDefinition(field)) found.push({ path: fieldPath, field })
      walk(field, fieldPath)
    }
    for (const member of (node.of ?? []) as AnyType[]) {
      walk(member, `${path}[]`)
    }
  }

  for (const type of schemaTypes as AnyType[]) walk(type, type.name)
  return found
}

const formReferences = collectFormReferences()

describe('formDefinition reference pickers', () => {
  it('finds the pickers at all (guards against a silently empty sweep)', () => {
    const paths = formReferences.map((f) => f.path)
    // The five known call sites. More is fine; fewer means the walk broke or a
    // picker was deleted.
    expect(paths).toEqual(
      expect.arrayContaining([
        'cta.formRef',
        'formSection.form',
        'contactSection.contactForm',
        'formOverlayButtonSection.form',
        'siteConfig.whatsappForm',
      ])
    )
  })

  it('not one of them can be opened without a tenant clause', () => {
    // The invariant, stated once for every shape a filter can take:
    //   • a FUNCTION must be the shared resolver — nothing else has been shown
    //     to fail closed;
    //   • a STRING must already carry `tenantSlug ==` — no picker takes this
    //     branch today, but a module that declares one keeps the guarantee;
    //   • no filter at all is the defect this file was written for.
    for (const { path, field } of formReferences) {
      const filter = field.options?.filter
      expect(filter, `${path} has no reference filter at all`).toBeDefined()
      if (typeof filter === 'function') {
        expect(filter, `${path} filters by an unshared function`).toBe(activeFormReferenceFilter)
      } else {
        expect(String(filter), `${path} filters by a string with no tenant clause`).toContain(
          'tenantSlug =='
        )
      }
    }
  })

  it('every picker declared in schema.ts uses the shared resolver', () => {
    // A string filter here could not be scoped at all: `$tenantSlug` is not
    // bound in a Studio reference filter unless the callback binds it, which is
    // precisely what the resolver does.
    const inSchemaFile = [
      'cta.formRef',
      'formSection.form',
      'contactSection.contactForm',
      'formOverlayButtonSection.form',
      'siteConfig.whatsappForm',
    ]
    for (const path of inSchemaFile) {
      const found = formReferences.find((f) => f.path === path)
      expect(found, `${path} no longer exists`).toBeDefined()
      expect(found!.field.options?.filter, `${path} is not scoped to a tenant`).toBe(
        activeFormReferenceFilter
      )
    }
  })
})

// ─── The resolver itself ─────────────────────────────────────────────────────

/** A `getClient` stub returning one project document for any query. */
const clientReturning = (project: unknown) => () => ({
  fetch: async () => project,
})

describe('activeFormReferenceFilter', () => {
  it('scopes to the tenant that owns the project', async () => {
    const result = (await activeFormReferenceFilter({
      document: { projectSlug: 'nologo' },
      getClient: clientReturning({ projectSlug: 'nologo', clientTenantSlug: 'freeriders' }),
    })) as AnyType
    expect(result.filter).toContain('tenantSlug == $tenantSlug')
    expect(result.params.tenantSlug).toBe('freeriders')
  })

  it('selects NOTHING when no project can be resolved — never everything', async () => {
    const noDocument = (await activeFormReferenceFilter({})) as AnyType
    expect(noDocument.filter).not.toContain('role ==')
    expect(noDocument.params).toBeUndefined()

    const noTenant = (await activeFormReferenceFilter({
      document: { projectSlug: 'orphan' },
      getClient: clientReturning(null),
    })) as AnyType
    expect(noTenant.filter).not.toContain('tenantSlug == $tenantSlug')
    expect(noTenant.params).toBeUndefined()
  })

  it('still offers only active forms — templates are NOT newly offered', async () => {
    // `role == "template"` documents are unscoped by design (tenantSlug: null)
    // and stay pickable where they are already offered (Modules → Forms "add
    // from template"). None of these five pickers ever listed them, and
    // scoping them must not start. The clause is preserved verbatim.
    const result = (await activeFormReferenceFilter({
      document: { projectSlug: 'nologo' },
      getClient: clientReturning({ projectSlug: 'nologo', clientTenantSlug: 'freeriders' }),
    })) as AnyType
    expect(result.filter).toContain('role == "active"')
    expect(result.filter).not.toContain('template')
  })

  it('resolves a project from the document context with no bound GROQ param', async () => {
    // The reason the three pickers were left unscoped was a belief that
    // `$projectSlug` is not in scope inside the callback. It does not need to
    // be: the project comes off the document Sanity hands the callback.
    const scope = await resolveProjectScope({
      document: { projectSlug: 'livener' },
      getClient: clientReturning({ projectSlug: 'livener', tenantSlug: 'livener' }),
    })
    expect(scope?.tenantSlug).toBe('livener')
    expect(await resolveProjectScope({ document: {} })).toBeNull()
  })
})
