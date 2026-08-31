import { describe, it, expect } from 'vitest'
import {
  toFieldConfig,
  buildFieldConfigs,
  buildSubmissionPayload,
  singleStepFields,
  submissionEndpoint,
  projectScopeSlugFromUrlSegment,
  CONSENT_FIELD_ID,
} from '@/lib/forms/render-mapping'
import { asSupabaseProjectSlug, asTenantSlug, asUrlProjectSegment } from '@/lib/tenancy/ids'
import type { RenderableFormDefinition, RenderableFormField } from '@/lib/sanity/types'

const FIELD_TYPES = [
  'text', 'textarea', 'number', 'email', 'phone', 'url',
  'select', 'multi-select', 'radio-group', 'checkbox', 'checkbox-group', 'country-select',
  'date', 'file', 'rating',
] as const

function field(partial: Partial<RenderableFormField> & { type: string }): RenderableFormField {
  return { id: partial.id ?? 'f', label: partial.label ?? 'Label', ...partial }
}

function singleStepDef(fields: RenderableFormField[], extra: Partial<RenderableFormDefinition> = {}): RenderableFormDefinition {
  return { _id: 'd', formId: 'contact', formType: 'single-step', steps: [{ key: 'main', fields }], ...extra }
}

describe('toFieldConfig', () => {
  it('maps every renderable field type to a config with the same type', () => {
    for (const t of FIELD_TYPES) {
      const cfg = toFieldConfig(field({ id: t, type: t }))
      expect(cfg, `type ${t}`).not.toBeNull()
      expect(cfg!.type).toBe(t)
    }
  })

  it('skips hidden fields (no render value this slice)', () => {
    expect(toFieldConfig(field({ type: 'hidden' }))).toBeNull()
  })

  it('adds email/url format validation and a required rule', () => {
    const email = toFieldConfig(field({ type: 'email', required: true }))!
    expect(email.validation).toEqual([{ type: 'required' }, { type: 'email' }])
    const url = toFieldConfig(field({ type: 'url' }))!
    expect(url.validation).toEqual([{ type: 'url' }])
  })

  it('carries options through to choice fields', () => {
    const sel = toFieldConfig(field({ type: 'select', options: [{ value: 'a', label: 'A' }] }))!
    expect(sel).toMatchObject({ type: 'select', options: [{ value: 'a', label: 'A' }] })
  })
})

describe('buildFieldConfigs', () => {
  it('appends a required consent checkbox when the definition requires consent', () => {
    const def = singleStepDef([field({ id: 'email', type: 'email' })], { requireConsent: true, consentText: 'I agree' })
    const configs = buildFieldConfigs(def, def.steps[0].fields)
    const consent = configs.at(-1)!
    expect(consent.id).toBe(CONSENT_FIELD_ID)
    expect(consent.type).toBe('checkbox')
    expect(consent.required).toBe(true)
  })

  it('does not add a consent field when consent is not required', () => {
    const def = singleStepDef([field({ id: 'email', type: 'email' })])
    const configs = buildFieldConfigs(def, def.steps[0].fields)
    expect(configs.some((c) => c.id === CONSENT_FIELD_ID)).toBe(false)
  })
})

describe('buildSubmissionPayload', () => {
  it('lifts the consent flag out of data and keeps field values keyed by internalKey', () => {
    const payload = buildSubmissionPayload(
      { name: 'John', email: 'j@x.test', [CONSENT_FIELD_ID]: true },
      { locale: 'it', openedAt: 123 },
    )
    expect(payload.data).toEqual({ name: 'John', email: 'j@x.test' })
    expect(payload.gdprConsent).toBe(true)
    expect(payload.locale).toBe('it')
    expect(payload.openedAt).toBe(123)
    expect(payload.company_website).toBe('')
    expect('gdpr_consent' in payload.data).toBe(false)
  })

  it('passes the honeypot value through verbatim', () => {
    const payload = buildSubmissionPayload({}, { locale: 'en', openedAt: 1, honeypot: 'bot' })
    expect(payload.company_website).toBe('bot')
    expect(payload.gdprConsent).toBe(false)
  })
})

describe('singleStepFields', () => {
  it('returns the fields for a single-step definition', () => {
    const def = singleStepDef([field({ id: 'a', type: 'text' })])
    expect(singleStepFields(def)?.map((f) => f.id)).toEqual(['a'])
  })

  it('declines multi-step definitions (slice 5)', () => {
    const multi: RenderableFormDefinition = {
      _id: 'd', formId: 'ea', formType: 'multi-step',
      steps: [{ key: 'a', fields: [field({ type: 'text' })] }, { key: 'b', fields: [field({ type: 'text' })] }],
    }
    expect(singleStepFields(multi)).toBeNull()
  })

  it('declines an empty or missing definition', () => {
    expect(singleStepFields(null)).toBeNull()
    expect(singleStepFields(singleStepDef([]))).toBeNull()
  })
})

describe('submissionEndpoint', () => {
  it('builds the new project/form-scoped endpoint', () => {
    expect(submissionEndpoint(asSupabaseProjectSlug('livener'), 'early-access')).toBe(
      '/api/forms/livener/early-access/submissions',
    )
  })

  it('encodes both segments', () => {
    expect(submissionEndpoint(asSupabaseProjectSlug('a/b'), 'c d')).toBe('/api/forms/a%2Fb/c%20d/submissions')
  })
})

describe('projectScopeSlugFromUrlSegment (temporary one-to-N boundary shim)', () => {
  it('is identity at runtime — it only re-labels the grain, so behaviour for the five single-project tenants is unchanged', () => {
    expect(projectScopeSlugFromUrlSegment(asUrlProjectSegment('livener'))).toBe('livener')
    expect(submissionEndpoint(projectScopeSlugFromUrlSegment(asUrlProjectSegment('nologo')), 'early-access')).toBe(
      '/api/forms/nologo/early-access/submissions',
    )
  })
})
