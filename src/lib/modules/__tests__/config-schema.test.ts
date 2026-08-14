import { describe, it, expect } from 'vitest'
import {
  buildModuleConfigSchemaTypes,
  moduleConfigTypeName,
  moduleInstallationTypeName,
  moduleInstallationTypeNameForId,
} from '../config-schema'
import { buildModuleInstallationsField } from '../config-schema'
import { MODULE_REGISTRY } from '../registry'
import type { ModuleManifest } from '../types'

// ── ADR-020 — generated module config schema ─────────────────────────────────
//
// These tests protect the property that makes ADR-020's uniform module contract
// hold by construction: every module in the registry, with or without config
// fields, produces exactly one config type and one installation type, and the
// moduleInstallations array field refers to precisely those installation types.
//
// The equivalent guarantee for integrations lives in
// src/lib/integrations/__tests__/schema.test.ts; this mirrors its shape so the
// two registries stay recognisably the same mechanism.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyType = any

function findType(name: string): AnyType {
  return buildModuleConfigSchemaTypes().find((t) => (t as AnyType).name === name)
}

describe('moduleConfigTypeName / moduleInstallationTypeName', () => {
  it('camelCases a kebab-case module id', () => {
    const fake = { id: 'my-long-module', label: 'X' } as ModuleManifest
    expect(moduleConfigTypeName(fake)).toBe('myLongModuleModuleConfig')
    expect(moduleInstallationTypeName(fake)).toBe('myLongModuleModuleInstallation')
  })

  it('leaves a single-word id untouched apart from the suffix', () => {
    const fake = { id: 'blog', label: 'Blog' } as ModuleManifest
    expect(moduleConfigTypeName(fake)).toBe('blogModuleConfig')
    expect(moduleInstallationTypeName(fake)).toBe('blogModuleInstallation')
  })
})

describe('moduleInstallationTypeNameForId', () => {
  it('resolves the installation type for every registered module', () => {
    for (const manifest of MODULE_REGISTRY) {
      expect(moduleInstallationTypeNameForId(manifest.id)).toBe(
        moduleInstallationTypeName(manifest)
      )
    }
  })

  it('returns null for an unknown module id rather than inventing a type', () => {
    // Guards the migration/pane path: writing an installation record for a
    // module the registry does not know would produce an unresolvable _type.
    expect(moduleInstallationTypeNameForId('not-a-real-module')).toBeNull()
  })
})

describe('buildModuleConfigSchemaTypes', () => {
  it('generates exactly two types per registered module', () => {
    expect(buildModuleConfigSchemaTypes()).toHaveLength(MODULE_REGISTRY.length * 2)
  })

  it('generates a config type and an installation type for every module', () => {
    for (const manifest of MODULE_REGISTRY) {
      expect(findType(moduleConfigTypeName(manifest))).toBeDefined()
      expect(findType(moduleInstallationTypeName(manifest))).toBeDefined()
    }
  })

  it('gives every generated type a unique name', () => {
    const names = buildModuleConfigSchemaTypes().map((t) => (t as AnyType).name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('gives a module with no config fields a valid non-empty object type', () => {
    // Sanity rejects an object type with zero fields. A config-less module must
    // still get a type so every installation record has the same shape.
    const emptyConfigModule = MODULE_REGISTRY.find(
      (m) => m.platformContract.configSchema.length === 0
    )
    expect(emptyConfigModule).toBeDefined()
    const type = findType(moduleConfigTypeName(emptyConfigModule!))
    expect(type.fields.length).toBeGreaterThan(0)
  })

  it('generates one field per declared config field, named by field id', () => {
    for (const manifest of MODULE_REGISTRY) {
      if (manifest.platformContract.configSchema.length === 0) continue
      const type = findType(moduleConfigTypeName(manifest))
      const fieldNames = type.fields.map((f: AnyType) => f.name)
      for (const declared of manifest.platformContract.configSchema) {
        expect(fieldNames).toContain(declared.id)
      }
    }
  })

  it('carries the module id as a hidden read-only initialValue on each installation type', () => {
    for (const manifest of MODULE_REGISTRY) {
      const type = findType(moduleInstallationTypeName(manifest))
      const moduleIdField = type.fields.find((f: AnyType) => f.name === 'moduleId')
      expect(moduleIdField.initialValue).toBe(manifest.id)
      expect(moduleIdField.readOnly).toBe(true)
      expect(moduleIdField.hidden).toBe(true)
    }
  })

  it('points each installation type config field at that module config type', () => {
    for (const manifest of MODULE_REGISTRY) {
      const type = findType(moduleInstallationTypeName(manifest))
      const configField = type.fields.find((f: AnyType) => f.name === 'config')
      expect(configField.type).toBe(moduleConfigTypeName(manifest))
    }
  })

  it('keeps the ADR-011 installation fields intact', () => {
    // version / enabled / installedAt / provenance are read by the structure
    // builder and ProjectLinker; regenerating the type must not drop them.
    for (const manifest of MODULE_REGISTRY) {
      const type = findType(moduleInstallationTypeName(manifest))
      const names = type.fields.map((f: AnyType) => f.name)
      for (const expected of ['moduleId', 'version', 'enabled', 'installedAt', 'provenance']) {
        expect(names).toContain(expected)
      }
    }
  })
})

describe('buildModuleInstallationsField', () => {
  it('is a hidden array named moduleInstallations', () => {
    const field = buildModuleInstallationsField() as AnyType
    expect(field.name).toBe('moduleInstallations')
    expect(field.type).toBe('array')
    // Managed by the Modules pane — never edited as a raw array on the project form.
    expect(field.hidden).toBe(true)
  })

  it('accepts exactly one member type per registered module', () => {
    const field = buildModuleInstallationsField() as AnyType
    const memberTypes = field.of.map((m: AnyType) => m.type).sort()
    const expected = MODULE_REGISTRY.map(moduleInstallationTypeName).sort()
    expect(memberTypes).toEqual(expected)
  })

  it('only references member types that are actually generated', () => {
    // A member type absent from the schema would fail to resolve at Studio load.
    const generated = new Set(buildModuleConfigSchemaTypes().map((t) => (t as AnyType).name))
    const field = buildModuleInstallationsField() as AnyType
    for (const member of field.of) {
      expect(generated.has(member.type)).toBe(true)
    }
  })
})

describe('reference config fields', () => {
  it('generates a reference field with its declared targets and filter', () => {
    for (const manifest of MODULE_REGISTRY) {
      const refFields = manifest.platformContract.configSchema.filter(
        (f) => f.type === 'reference'
      )
      if (refFields.length === 0) continue

      const type = findType(moduleConfigTypeName(manifest))
      for (const declared of refFields) {
        const generated = type.fields.find((f: AnyType) => f.name === declared.id)
        expect(generated.type).toBe('reference')
        expect(generated.to).toEqual(declared.referenceTo!.map((t) => ({ type: t })))
        if (declared.referenceFilter) {
          expect(generated.options.filter).toBe(declared.referenceFilter)
        }
      }
    }
  })
})

// ── ADR-020 Amendment B — cross-tenant safety and delete protection ──────────

describe('reference config fields are tenant-scoped', () => {
  it('every formDefinition picker filters by tenantSlug', () => {
    // Without this the Modules pane offered EVERY tenant's forms: Livener could
    // be pointed at Studio Martegani's contact form, putting one client's
    // wording on another client's site. Submissions stay correctly filed (the
    // endpoint uses the page's tenant, not the form's), but the content leak
    // and the resulting orphan formId are both unacceptable.
    for (const manifest of MODULE_REGISTRY) {
      for (const field of manifest.platformContract.configSchema) {
        if (field.type !== 'reference') continue
        if (!(field.referenceTo ?? []).includes('formDefinition')) continue
        expect(field.referenceFilter, `${manifest.id}.${field.id}`).toContain(
          'tenantSlug == $tenantSlug'
        )
      }
    }
  })
})

describe('category lists declare a usage guard', () => {
  it('every categories field names the type that references it', () => {
    // Deleting a category that content still uses would silently strip the
    // badge off every entry filed under it. The guard is declarative so the
    // pane can count usages before allowing the removal.
    const withCategories = MODULE_REGISTRY.filter((m) =>
      m.platformContract.configSchema.some((f) => f.id === 'categories')
    )
    expect(withCategories.length).toBeGreaterThan(0)

    for (const manifest of withCategories) {
      const field = manifest.platformContract.configSchema.find((f) => f.id === 'categories')!
      expect(field.usage, manifest.id).toBeDefined()
      expect(field.usage!.field).toBe('categories')
      expect(field.usage!.schemaType.length).toBeGreaterThan(0)
      expect(field.usage!.noun.length).toBeGreaterThan(0)
      // The guard must point at a type the module actually owns.
      expect(manifest.platformContract.schemaTypes).toContain(field.usage!.schemaType)
    }
  })

  it('each module guards its own content type', () => {
    const byModule = Object.fromEntries(
      MODULE_REGISTRY.filter((m) => m.platformContract.configSchema.some((f) => f.id === 'categories'))
        .map((m) => [m.id, m.platformContract.configSchema.find((f) => f.id === 'categories')!.usage!.schemaType])
    )
    expect(byModule).toEqual({ blog: 'post', news: 'newsArticle', events: 'event' })
  })
})
