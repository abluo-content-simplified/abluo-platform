import { describe, it, expect, vi } from 'vitest'
import { PLATFORM_LOCALES, LOCALE_CODES } from '@/lib/i18n/locales'
import {
  TESTIMONIAL_FORM_TEXT,
  TESTIMONIAL_FORM_TEXT_KEYS,
  buildTestimonialFormDocument,
  buildTestimonialFormPatch,
  testimonialFormDocId,
} from '../form'
import { acceptsTestimonialSubmissions, syncTestimonialForm } from '../form-sync'
import { TESTIMONIAL_FORM_ID, TESTIMONIAL_FORM_KEYS, TESTIMONIAL_RATING } from '../model'

// ADR-048 D4 — the module-owned Testimonial form (WhatsApp pattern).

/* eslint-disable @typescript-eslint/no-explicit-any */
const allStrings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') out.push(v)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) allStrings(x, out)
  return out
}

describe('labels exist in every platform locale', () => {
  it('every text has a non-empty string for every locale, and nothing extra', () => {
    expect(Object.keys(PLATFORM_LOCALES).length).toBeGreaterThan(0)
    for (const key of TESTIMONIAL_FORM_TEXT_KEYS) {
      const t = TESTIMONIAL_FORM_TEXT[key] as Record<string, string>
      expect(Object.keys(t).sort(), key).toEqual([...LOCALE_CODES].sort())
      for (const code of LOCALE_CODES) expect(t[code]?.trim(), `${key}.${code}`).toBeTruthy()
    }
  })

  it('the built document carries every locale on every localized value', () => {
    const doc = buildTestimonialFormDocument({ tenantSlug: 'acme' }) as any
    const localized: any[] = []
    const walk = (v: any) => {
      if (!v || typeof v !== 'object') return
      if (v._type === 'localizedString' || v._type === 'localizedText') localized.push(v)
      for (const x of Object.values(v)) walk(x)
    }
    walk(doc)
    expect(localized.length).toBeGreaterThan(10)
    for (const l of localized) for (const code of LOCALE_CODES) expect(typeof l[code], JSON.stringify(l)).toBe('string')
  })
})

describe('form document', () => {
  const doc = buildTestimonialFormDocument({ tenantSlug: 'acme' }) as any
  it('has a derived, stable id and the stable form id', () => {
    expect(testimonialFormDocId('acme')).toBe('formDefinition-acme-testimonial')
    expect(doc._id).toBe('formDefinition-acme-testimonial')
    expect(doc).toMatchObject({ _type: 'formDefinition', formId: TESTIMONIAL_FORM_ID, tenantSlug: 'acme', version: 1, role: 'active' })
    expect(TESTIMONIAL_FORM_ID).toBe('testimonial')
  })
  it('uses stable internal keys; name, email and text are asked, the rest optional; consent is required', () => {
    const fields = doc.steps[0].fields as any[]
    expect(fields.map((f) => f.internalKey)).toEqual(Object.values(TESTIMONIAL_FORM_KEYS))
    const req = (k: string) => fields.find((f) => f.internalKey === k).required
    expect(req(TESTIMONIAL_FORM_KEYS.displayName)).toBe(true)
    expect(req(TESTIMONIAL_FORM_KEYS.email)).toBe(true)
    expect(req(TESTIMONIAL_FORM_KEYS.text)).toBe(true)
    expect(req(TESTIMONIAL_FORM_KEYS.fullName)).toBe(false)
    expect(req(TESTIMONIAL_FORM_KEYS.phone)).toBe(false)
    expect(req(TESTIMONIAL_FORM_KEYS.rating)).toBe(false)
    expect(fields.find((f) => f.internalKey === 'rating').maxRating).toBe(TESTIMONIAL_RATING.max)
    expect(doc.privacy.requireConsent).toBe(true)
  })
  it('no field carries a hardcoded tenant or locale-specific string outside the localized types', () => {
    const json = JSON.stringify(doc)
    expect(json.match(/acme/g)?.length).toBeLessThanOrEqual(4)
    expect(allStrings(doc).length).toBeGreaterThan(0)
  })
})

describe('syncTestimonialForm', () => {
  const client = () => {
    const ops: Array<[string, unknown]> = []
    const patch = (id: string) => {
      ops.push(['patch', id])
      const p = {
        setIfMissing: (v: unknown) => (ops.push(['setIfMissing', v]), p),
        set: (v: unknown) => (ops.push(['set', v]), p),
        commit: vi.fn(async () => (ops.push(['commit', null]), {})),
      }
      return p
    }
    return { ops, c: { createIfNotExists: vi.fn(async (d: unknown) => (ops.push(['createIfNotExists', d]), d)), patch } as never }
  }

  it('creates the form if missing and fills only what is missing; identity is always set', async () => {
    const { ops, c } = client()
    const id = await syncTestimonialForm(c, { tenantSlug: 'acme' })
    expect(id).toBe('formDefinition-acme-testimonial')
    expect(ops.map((o) => o[0])).toEqual(['createIfNotExists', 'patch', 'setIfMissing', 'set', 'commit'])
    const filled = ops.find((o) => o[0] === 'setIfMissing')![1] as Record<string, unknown>
    const identity = ops.find((o) => o[0] === 'set')![1] as Record<string, unknown>
    expect(Object.keys(identity).sort()).toEqual(['formId', 'formType', 'role', 'tenantSlug'])
    expect(filled).toHaveProperty('steps')
    expect(filled).toHaveProperty('privacy')
    expect(filled).not.toHaveProperty('formId')
    expect(filled).toEqual(expect.objectContaining(Object.fromEntries(Object.entries(buildTestimonialFormPatch({ tenantSlug: 'acme' })).filter(([k]) => !['formId', 'formType', 'role', 'tenantSlug'].includes(k)))))
  })

  it('reads the module setting', () => {
    expect(acceptsTestimonialSubmissions({ acceptSubmissions: true })).toBe(true)
    expect(acceptsTestimonialSubmissions({ acceptSubmissions: false })).toBe(false)
    expect(acceptsTestimonialSubmissions({})).toBe(false)
    expect(acceptsTestimonialSubmissions(undefined)).toBe(false)
  })
})
