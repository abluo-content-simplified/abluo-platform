import { describe, it, expect } from 'vitest'
import { resolveCta } from '../cta'
import { CTA_FIELDS } from '../queries'

// ── Retiring the legacy `form` document type ─────────────────────────────────
//
// Two form document types coexist: the legacy `form` (project-scoped, flat) and
// `formDefinition` (tenant-scoped, multi-step). No legacy form has ever been
// *rendered* — a CTA pointing at one reads a single field, inquiryType, and uses
// it to choose which modal opens. That indirection is what these tests protect
// while it is unwound.
//
// The ordering rule matters more than the code: this must deploy BEFORE the
// content is repointed, and the content must be repointed BEFORE the legacy
// documents are deleted. A dual-read that only handles the new shape would take
// every live CTA down the moment it shipped.

describe('CTA_FIELDS projection', () => {
  it('falls back to the raw _ref when the target has no formId', () => {
    // The legacy `form` type has no formId field, so coalesce must fall through
    // to _ref — preserving exactly what shipped before.
    expect(CTA_FIELDS).toContain('coalesce(formRef->formId, formRef._ref)')
  })

  it('projects formDefinitionId so the new path can be distinguished', () => {
    expect(CTA_FIELDS).toContain('"formDefinitionId": formRef->formId')
  })

  it('still projects inquiryType, which the legacy fallback depends on', () => {
    expect(CTA_FIELDS).toContain('"formInquiryType": formRef->inquiryType')
  })
})

describe('resolveCta — form CTAs', () => {
  const base = { internalName: 'Hero Investors', label: 'Get Early Access', actionType: 'form' as const }

  it('carries formDefinitionId through for a new-style CTA', () => {
    const resolved = resolveCta({ ...base, formId: 'early-access', formDefinitionId: 'early-access' })
    expect(resolved.type).toBe('form')
    if (resolved.type !== 'form') throw new Error('expected a form CTA')
    expect(resolved.formDefinitionId).toBe('early-access')
  })

  it('leaves formDefinitionId undefined for a legacy CTA, so the fallback runs', () => {
    // This is the shape live content still has: _ref of a legacy form document
    // plus its inquiryType. The hero components branch on exactly this.
    const resolved = resolveCta({
      ...base,
      formId: 'form-livener-early-access',
      formInquiryType: 'earlyAccess',
    })
    if (resolved.type !== 'form') throw new Error('expected a form CTA')
    expect(resolved.formDefinitionId).toBeUndefined()
    expect(resolved.formInquiryType).toBe('earlyAccess')
  })

  it('preserves internalName, which is the attribution recorded on submissions', () => {
    const resolved = resolveCta({ ...base, formId: 'early-access', formDefinitionId: 'early-access' })
    expect(resolved.internalName).toBe('Hero Investors')
  })

  it('returns none when the form target is missing entirely', () => {
    // An editor who picked "Open a form" but chose nothing yet must not produce
    // a button that appears live and does nothing.
    expect(resolveCta({ ...base }).type).toBe('none')
  })
})
