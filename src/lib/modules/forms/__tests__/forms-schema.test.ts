import { describe, it, expect } from 'vitest'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { validateRegistry } from '@/lib/modules/validate'
import { buildSchema } from '@/lib/modules/schema'
import { formsSchemaTypes } from '@/lib/modules/forms/schema'
import { FORM_FIELD_TYPE_VALUES, CHOICE_FIELD_TYPES } from '@/lib/modules/forms/field-library'

// ADR-018 slice 2 — the forms module is additive + inert. These tests guard the
// two invariants that matter at this slice: (1) the manifest is well-formed and
// registered, and (2) the generated Studio field-type enum stays in lockstep
// with the runtime Field Library's FieldType union.

// The canonical 16 FieldType values, mirrored from src/components/fields/types.ts.
// If a field type is added there, add it to FORM_FIELD_TYPES and to this list —
// this test is the drift alarm ADR-018 §"lockstep" calls for.
const RUNTIME_FIELD_TYPES = [
  'text', 'textarea', 'number', 'email', 'phone', 'url',
  'select', 'multi-select', 'radio-group', 'checkbox', 'checkbox-group', 'country-select',
  'date', 'file', 'hidden', 'rating',
]

describe('forms module — registry', () => {
  it('registers a well-formed `forms` manifest', () => {
    const forms = MODULE_REGISTRY.find((m) => m.id === 'forms')
    expect(forms).toBeDefined()
    expect(forms!.dataStore.primary).toBe('hybrid')
    expect(forms!.platformContract.schemaTypes).toContain('formDefinition')
    // Inert this slice: no page, no collections, no section types yet.
    expect(forms!.platformContract.pageType).toBeUndefined()
    expect(forms!.platformContract.collections).toEqual([])
    expect(forms!.platformContract.sectionTypes).toEqual([])
  })

  it('all forms permissions are namespaced under "forms."', () => {
    const forms = MODULE_REGISTRY.find((m) => m.id === 'forms')!
    for (const p of forms.platformContract.permissions) {
      expect(p.id.startsWith('forms.')).toBe(true)
    }
  })

  it('the full registry still passes validateRegistry with forms added', () => {
    expect(() => validateRegistry(MODULE_REGISTRY)).not.toThrow()
  })

  it('buildSchema() includes the generated formDefinition type exactly once', () => {
    const names = buildSchema().map((t) => (t as { name: string }).name)
    expect(names.filter((n) => n === 'formDefinition')).toHaveLength(1)
  })
})

describe('forms field library — lockstep with runtime FieldType', () => {
  it('declares exactly the 16 runtime field types, in order', () => {
    expect(FORM_FIELD_TYPE_VALUES).toEqual(RUNTIME_FIELD_TYPES)
  })

  it('generates a formDefinition type whose field-type enum matches the library', () => {
    // Descend: formDefinition → steps[].of[0] (step) → its `fields` array
    // → .of[0] (field object) → the `type` field's generated option list.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const def = formsSchemaTypes.find((t) => (t as any).name === 'formDefinition') as any
    const stepObj = def.fields.find((f: any) => f.name === 'steps').of[0]
    const fieldObj = stepObj.fields.find((f: any) => f.name === 'fields').of[0]
    const typeField = fieldObj.fields.find((f: any) => f.name === 'type')
    const enumValues = (typeField.options?.list ?? []).map((o: any) => o.value)
    expect(enumValues).toEqual(RUNTIME_FIELD_TYPES)
  })

  it('marks only the choice types as option-bearing', () => {
    expect(CHOICE_FIELD_TYPES).toEqual(['select', 'multi-select', 'radio-group', 'checkbox-group'])
  })
})
