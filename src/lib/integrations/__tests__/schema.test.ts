// ── schema.test.ts ────────────────────────────────────────────────────────────
// ADR-014 Phase A. Tests buildIntegrationSchemaTypes()/buildIntegrationConfigsField()
// in ../schema.ts.
//
// Mock strategy: a lightweight chainable Rule mock that records what was called
// and returns an inspectable terminal object — the same "record calls, inspect
// the tracker" convention src/lib/modules/__tests__/navigation.test.ts uses for
// its StructureBuilder mock, adapted for Sanity's Rule builder shape.
//
// Static imports throughout (no dynamic import) — see validate.test.ts's I9 note.

import { describe, it, expect } from 'vitest'
import {
  buildIntegrationSchemaTypes,
  buildIntegrationConfigsField,
  integrationValuesTypeName,
  integrationConfigTypeName,
} from '../schema'
import { INTEGRATION_REGISTRY } from '../registry'

// ── Mock Rule ──────────────────────────────────────────────────────────────────
// Sanity's `validation: (Rule) => ...` callback is invoked with a chainable Rule
// builder. Field definitions here return either a single terminal rule object
// (Rule.required()) or an array built by the field generator. Each mock method
// returns a plain, inspectable object rather than another Sanity type, so tests
// can assert on `.kind`, `.pattern`, `.message` directly.

type MockRuleResult =
  | { kind: 'required' }
  | { kind: 'regex'; pattern: RegExp; name?: string; message?: string }

function createMockRule() {
  const chain = {
    required: () => ({ kind: 'required' as const }),
    regex: (pattern: RegExp, opts?: { name?: string }) => ({
      error: (message: string): MockRuleResult => ({
        kind: 'regex' as const,
        pattern,
        name: opts?.name,
        message,
      }),
    }),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return chain as any
}

function invokeValidation(field: { validation?: unknown }): MockRuleResult[] {
  if (typeof field.validation !== 'function') return []
  const result = (field.validation as (rule: unknown) => unknown)(createMockRule())
  return Array.isArray(result) ? (result as MockRuleResult[]) : [result as MockRuleResult]
}

// ── Naming ────────────────────────────────────────────────────────────────────

describe('naming helpers', () => {
  it('integrationValuesTypeName converts kebab-case id to camelCase + suffix', () => {
    const m = INTEGRATION_REGISTRY.find((x) => x.id === 'google-analytics')!
    expect(integrationValuesTypeName(m)).toBe('googleAnalyticsIntegrationValues')
  })

  it('integrationConfigTypeName converts kebab-case id to camelCase + suffix', () => {
    const m = INTEGRATION_REGISTRY.find((x) => x.id === 'google-tag-manager')!
    expect(integrationConfigTypeName(m)).toBe('googleTagManagerIntegrationConfig')
  })

  it('handles a single-word id with no hyphen', () => {
    const m = { ...INTEGRATION_REGISTRY[0], id: 'stripe' }
    expect(integrationValuesTypeName(m)).toBe('stripeIntegrationValues')
  })
})

// ── buildIntegrationSchemaTypes — shape ──────────────────────────────────────

describe('buildIntegrationSchemaTypes', () => {
  const types = buildIntegrationSchemaTypes()

  it('produces exactly one values type and one config type per manifest', () => {
    expect(types).toHaveLength(INTEGRATION_REGISTRY.length * 2)
  })

  it('generates correctly named values and config types for every manifest', () => {
    for (const manifest of INTEGRATION_REGISTRY) {
      const valuesName = integrationValuesTypeName(manifest)
      const configName = integrationConfigTypeName(manifest)
      expect(types.some((t) => t.name === valuesName)).toBe(true)
      expect(types.some((t) => t.name === configName)).toBe(true)
    }
  })

  it('every generated type is a Sanity object type', () => {
    for (const t of types) {
      expect(t.type).toBe('object')
    }
  })
})

// ── Values type — google-analytics regex + required ──────────────────────────

describe('googleAnalyticsIntegrationValues', () => {
  const types = buildIntegrationSchemaTypes()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gaValues = types.find((t) => t.name === 'googleAnalyticsIntegrationValues') as any

  it('has exactly one field: measurementId', () => {
    expect(gaValues.fields).toHaveLength(1)
    expect(gaValues.fields[0].name).toBe('measurementId')
  })

  it('carries the required flag', () => {
    const rules = invokeValidation(gaValues.fields[0])
    expect(rules.some((r) => r.kind === 'required')).toBe(true)
  })

  it('attaches the GA4 regex with the manifest message', () => {
    const rules = invokeValidation(gaValues.fields[0])
    const regexRule = rules.find((r) => r.kind === 'regex') as Extract<MockRuleResult, { kind: 'regex' }>
    expect(regexRule).toBeDefined()
    expect(regexRule.pattern.test('G-ABC1234')).toBe(true)
    expect(regexRule.pattern.test('UA-12345')).toBe(false)
    expect(regexRule.message).toBe('Must be in the format G-XXXXXXXXXX')
  })
})

describe('googleTagManagerIntegrationValues', () => {
  const types = buildIntegrationSchemaTypes()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gtmValues = types.find((t) => t.name === 'googleTagManagerIntegrationValues') as any

  it('attaches the GTM regex', () => {
    const rules = invokeValidation(gtmValues.fields[0])
    const regexRule = rules.find((r) => r.kind === 'regex') as Extract<MockRuleResult, { kind: 'regex' }>
    expect(regexRule.pattern.test('GTM-ABCD123')).toBe(true)
    expect(regexRule.pattern.test('G-ABCD123')).toBe(false)
  })
})

describe('metaPixelIntegrationValues', () => {
  const types = buildIntegrationSchemaTypes()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const metaValues = types.find((t) => t.name === 'metaPixelIntegrationValues') as any

  it('attaches the numeric-only regex', () => {
    const rules = invokeValidation(metaValues.fields[0])
    const regexRule = rules.find((r) => r.kind === 'regex') as Extract<MockRuleResult, { kind: 'regex' }>
    expect(regexRule.pattern.test('123456789')).toBe(true)
    expect(regexRule.pattern.test('abc123')).toBe(false)
  })
})

// ── Config type — enabled initialValue, integrationId ────────────────────────

describe('generated *IntegrationConfig types', () => {
  const types = buildIntegrationSchemaTypes()

  it('every config type has integrationId, enabled, and values fields', () => {
    for (const manifest of INTEGRATION_REGISTRY) {
      const configName = integrationConfigTypeName(manifest)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const configType = types.find((t) => t.name === configName) as any
      const fieldNames = configType.fields.map((f: { name: string }) => f.name)
      expect(fieldNames).toEqual(['integrationId', 'enabled', 'values'])
    }
  })

  it('enabled defaults to false on every generated config type', () => {
    for (const manifest of INTEGRATION_REGISTRY) {
      const configName = integrationConfigTypeName(manifest)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const configType = types.find((t) => t.name === configName) as any
      const enabledField = configType.fields.find((f: { name: string }) => f.name === 'enabled')
      expect(enabledField.initialValue).toBe(false)
    }
  })

  it('integrationId is hidden, read-only, and initialized to the manifest id', () => {
    for (const manifest of INTEGRATION_REGISTRY) {
      const configName = integrationConfigTypeName(manifest)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const configType = types.find((t) => t.name === configName) as any
      const idField = configType.fields.find((f: { name: string }) => f.name === 'integrationId')
      expect(idField.hidden).toBe(true)
      expect(idField.readOnly).toBe(true)
      expect(idField.initialValue).toBe(manifest.id)
    }
  })

  it('values field references the manifest-specific generated values type', () => {
    for (const manifest of INTEGRATION_REGISTRY) {
      const configName = integrationConfigTypeName(manifest)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const configType = types.find((t) => t.name === configName) as any
      const valuesField = configType.fields.find((f: { name: string }) => f.name === 'values')
      expect(valuesField.type).toBe(integrationValuesTypeName(manifest))
    }
  })
})

// ── custom-scripts array shape (ADR-013 hardening) ───────────────────────────

describe('customScriptsIntegrationValues — scripts array shape', () => {
  const types = buildIntegrationSchemaTypes()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const csValues = types.find((t) => t.name === 'customScriptsIntegrationValues') as any
  const scriptsField = csValues.fields.find((f: { name: string }) => f.name === 'scripts')
  const scriptMember = scriptsField.of[0]
  const scriptFieldNames = scriptMember.fields.map((f: { name: string }) => f.name)

  it('generates a top-level array field named "scripts"', () => {
    expect(scriptsField.type).toBe('array')
  })

  it('the array member reproduces the ADR-013-hardened shape: label, description, placement, code, consentCategory, enabled', () => {
    expect(scriptFieldNames).toEqual([
      'label',
      'description',
      'placement',
      'code',
      'consentCategory',
      'enabled',
    ])
  })

  it('description is required', () => {
    const descriptionField = scriptMember.fields.find((f: { name: string }) => f.name === 'description')
    const rules = invokeValidation(descriptionField)
    expect(rules.some((r) => r.kind === 'required')).toBe(true)
  })

  it('consentCategory is required and offers all four values', () => {
    const consentField = scriptMember.fields.find((f: { name: string }) => f.name === 'consentCategory')
    const rules = invokeValidation(consentField)
    expect(rules.some((r) => r.kind === 'required')).toBe(true)
    const values = consentField.options.list.map((o: { value: string }) => o.value)
    expect(values).toEqual(['necessary', 'analytics', 'marketing', 'functional'])
  })

  it('enabled defaults to false (disabled by default, ADR-013 hardening)', () => {
    const enabledField = scriptMember.fields.find((f: { name: string }) => f.name === 'enabled')
    expect(enabledField.initialValue).toBe(false)
  })
})

// ── integrationConfigs field ──────────────────────────────────────────────────

describe('buildIntegrationConfigsField', () => {
  const field = buildIntegrationConfigsField()

  it('is named integrationConfigs and is an array', () => {
    expect(field.name).toBe('integrationConfigs')
    expect(field.type).toBe('array')
  })

  it('is hidden from the raw Studio form (platform-managed)', () => {
    expect(field.hidden).toBe(true)
  })

  it('has one array member type per registry manifest', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const memberTypes = (field.of as any[]).map((m) => m.type)
    const expected = INTEGRATION_REGISTRY.map((m) => integrationConfigTypeName(m))
    expect(memberTypes).toEqual(expected)
  })
})
