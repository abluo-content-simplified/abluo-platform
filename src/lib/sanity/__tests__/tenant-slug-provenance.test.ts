/**
 * Tenant slug provenance — where a `tenantSlug` value is allowed to come from.
 *
 * WHY THIS TEST EXISTS:
 * A `formDefinition` is TENANT-owned: it is filed under `tenantSlug`. The
 * `formDefinitionTenantOwned` initial value template used to prefill that field
 * with `params.projectSlug` — a PROJECT slug written into a TENANT field. It
 * looked correct for the four projects slugged `<tenant>-main` and corrupted
 * the fifth: project `nologo` is owned by client `freeriders`, so the live
 * document `form-nologo-demo` carries `tenantSlug: "nologo"`.
 *
 * These tests pin the two halves of the fix:
 *   1. the generator can never again write a project slug into `tenantSlug`;
 *   2. `project.tenantSlug` is stored from the client (the true ownership
 *      edge) and — critically — CLEARED when the project is relinked.
 *
 * A stale stored `tenantSlug` is worse than a missing one: it wins tier 1 of
 * deriveTenantSlug() (src/lib/tenancy/project-scope.ts) and silently outranks
 * the correct `clientRef`.
 *
 * Pure — no Sanity client, no network, no rendering.
 */

import { describe, it, expect } from 'vitest'
import { initialValueTemplates, schemaTypes } from '@/lib/sanity/schema'
import {
  buildProjectLinkPatches,
  buildProjectUnlinkPatches,
} from '@/lib/sanity/fields/ProjectLinker'

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyType = any

/** The real project → true-tenant mapping in the live `production` dataset. */
const REAL_PROJECTS = [
  { projectSlug: 'livener-main', trueTenantSlug: 'livener' },
  { projectSlug: 'studiomartegani-main', trueTenantSlug: 'studiomartegani' },
  { projectSlug: 'abluo', trueTenantSlug: 'abluo' },
  { projectSlug: 'amelie', trueTenantSlug: 'amelie' },
  // The one the whole refactor exists for.
  { projectSlug: 'nologo', trueTenantSlug: 'freeriders' },
] as const

const formTemplate = initialValueTemplates.find(
  (t: AnyType) => t.id === 'formDefinitionTenantOwned'
) as AnyType

// ─── The generator ───────────────────────────────────────────────────────────

describe('formDefinitionTenantOwned initial value template', () => {
  it('still exists and still targets formDefinition', () => {
    expect(formTemplate).toBeDefined()
    expect(formTemplate.schemaType).toBe('formDefinition')
  })

  it('never writes a project slug into tenantSlug', () => {
    for (const { projectSlug } of REAL_PROJECTS) {
      const value = formTemplate.value({ projectSlug })
      expect(value.tenantSlug).toBeUndefined()
      expect(Object.values(value)).not.toContain(projectSlug)
    }
  })

  it('omits tenantSlug entirely rather than prefilling an unproven value', () => {
    // Omitted, not set-to-undefined: an explicit undefined would still be a key
    // on the created draft, and the editor must be prompted by the field's own
    // "Active forms must have a tenant slug" validation instead.
    const value = formTemplate.value({ projectSlug: 'nologo' })
    expect(Object.keys(value)).not.toContain('tenantSlug')
  })

  it('still prefills the fields it can prove, so creating a form works', () => {
    expect(formTemplate.value({ projectSlug: 'nologo' })).toEqual({
      role: 'active',
      version: 1,
      formType: 'single-step',
    })
  })

  it('tolerates being called with no params at all', () => {
    expect(() => formTemplate.value(undefined)).not.toThrow()
    expect(formTemplate.value(undefined).tenantSlug).toBeUndefined()
    expect(formTemplate.value({}).tenantSlug).toBeUndefined()
  })

  it('uses a real tenant slug when — and only when — one is actually passed', () => {
    // Forward compatibility: the structure builder already has the true tenant
    // (sanity.config.ts: clientDoc.tenantSlug). The day it threads it into
    // initialValueTemplateItem, this template must use it.
    expect(
      formTemplate.value({ projectSlug: 'nologo', tenantSlug: 'freeriders' }).tenantSlug
    ).toBe('freeriders')
    // Blank/whitespace is not a tenant slug.
    expect(formTemplate.value({ projectSlug: 'nologo', tenantSlug: '  ' }).tenantSlug)
      .toBeUndefined()
  })

  it('declares tenantSlug as a template parameter with a valid string type', () => {
    const names = formTemplate.parameters.map((p: AnyType) => p.name)
    expect(names).toContain('tenantSlug')
    for (const p of formTemplate.parameters) {
      expect(p.type).toBe('string')
      // Sanity rejects a parameter literally named "template".
      expect(p.name).not.toBe('template')
    }
  })
})

// ─── The stored field ────────────────────────────────────────────────────────

describe('project.tenantSlug (expand phase)', () => {
  const projectType = schemaTypes.find((t: AnyType) => t.name === 'project') as AnyType
  const field = projectType.fields.find((f: AnyType) => f.name === 'tenantSlug')

  it('exists as a hidden string field on the project document', () => {
    expect(field).toBeDefined()
    expect(field.type).toBe('string')
    expect(field.hidden).toBe(true)
  })

  it('is NOT required — every existing project predates it', () => {
    // A Rule.required() here would make all five live projects invalid the
    // moment the schema deploys, before the backfill has run.
    expect(field.validation).toBeUndefined()
  })
})

// ─── The linker patches ──────────────────────────────────────────────────────

const linkSelection = {
  clientId: 'client-freeriders',
  tenantId: 'b1f0c0de-0000-4000-8000-000000000005',
  tenantSlug: 'freeriders',
  projectId: 'supabase-project-nologo',
  projectSlug: 'nologo',
  projectName: 'No!Logo',
  domain: 'nologo.example',
}

/** Collapse a patch list into { path → 'unset' | value } for readable assertions. */
function byPath(patches: AnyType[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of patches) {
    out[p.path.join('.')] = p.type === 'unset' ? 'unset' : p.value
  }
  return out
}

describe('buildProjectLinkPatches', () => {
  it("stores the client's tenantSlug alongside tenantId", () => {
    const patched = byPath(buildProjectLinkPatches(linkSelection))
    expect(patched.tenantSlug).toBe('freeriders')
    expect(patched.tenantId).toBe(linkSelection.tenantId)
  })

  it('stores the true tenant, never the project slug', () => {
    // The exact case the bug got wrong: nologo → freeriders.
    const patched = byPath(buildProjectLinkPatches(linkSelection))
    expect(patched.projectSlug).toBe('nologo')
    expect(patched.tenantSlug).not.toBe(patched.projectSlug)
  })

  it('unsets tenantSlug when the client carries none, rather than leaving it stale', () => {
    for (const tenantSlug of [undefined, null, '', '   ']) {
      const patched = byPath(buildProjectLinkPatches({ ...linkSelection, tenantSlug }))
      expect(patched.tenantSlug).toBe('unset')
    }
  })

  it('trims a padded slug', () => {
    const patched = byPath(
      buildProjectLinkPatches({ ...linkSelection, tenantSlug: ' freeriders ' })
    )
    expect(patched.tenantSlug).toBe('freeriders')
  })

  it('leaves the pre-existing link fields untouched', () => {
    const patched = byPath(buildProjectLinkPatches(linkSelection))
    expect(patched.clientRef).toEqual({ _type: 'reference', _ref: 'client-freeriders' })
    expect(patched.projectId).toBe(linkSelection.projectId)
    expect(patched.projectName).toBe('No!Logo')
    expect(patched.customDomain).toBe('nologo.example')
    expect(byPath(buildProjectLinkPatches({ ...linkSelection, domain: null })).customDomain)
      .toBe('unset')
  })
})

describe('buildProjectUnlinkPatches', () => {
  it('clears tenantSlug — a stale one outranks the correct clientRef', () => {
    const patched = byPath(buildProjectUnlinkPatches())
    expect(patched.tenantSlug).toBe('unset')
  })

  it('clears every field the link patch can write', () => {
    const written = Object.keys(byPath(buildProjectLinkPatches(linkSelection)))
    const cleared = Object.keys(byPath(buildProjectUnlinkPatches()))
    expect([...cleared].sort()).toEqual([...written].sort())
  })

  it('is entirely unsets', () => {
    for (const patch of buildProjectUnlinkPatches() as AnyType[]) {
      expect(patch.type).toBe('unset')
    }
  })
})
