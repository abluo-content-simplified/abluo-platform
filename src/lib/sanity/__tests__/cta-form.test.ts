import { describe, it, expect } from 'vitest'
import { resolveCta } from '../cta'
import { CTA_FIELDS } from '../queries'

// ── One form type ────────────────────────────────────────────────────────────
//
// Two form document types used to coexist: the legacy `form` (project-scoped,
// flat, never actually rendered) and `formDefinition` (tenant-scoped,
// multi-step). A CTA pointing at a legacy form read one field from it —
// inquiryType — and used it to choose which modal to open, so the document
// behaved as a switch rather than a form.
//
// That indirection is gone: every CTA now points at a formDefinition and opens
// it by its stable route key. These tests exist to stop it coming back, since
// the failure mode was a button that looked fine and silently did nothing.

describe('CTA_FIELDS projection', () => {
  it('resolves the form by its stable route key', () => {
    expect(CTA_FIELDS).toContain('"formId": formRef->formId')
  })

  it('no longer reads inquiryType from the referenced document', () => {
    // The legacy switch. If this reappears, so has the indirection.
    expect(CTA_FIELDS).not.toContain('inquiryType')
  })

  it('no longer falls back to a raw reference id', () => {
    // A _ref is a document id, not a route key — it could never resolve a form.
    expect(CTA_FIELDS).not.toContain('formRef._ref')
  })
})

describe('resolveCta — form CTAs', () => {
  const base = { internalName: 'Hero Investors', label: 'Get Early Access', actionType: 'form' as const }

  it('carries the route key through', () => {
    const resolved = resolveCta({ ...base, formId: 'early-access' })
    expect(resolved.type).toBe('form')
    if (resolved.type !== 'form') throw new Error('expected a form CTA')
    expect(resolved.formId).toBe('early-access')
  })

  it('preserves internalName, which is the attribution recorded on submissions', () => {
    const resolved = resolveCta({ ...base, formId: 'early-access' })
    expect(resolved.internalName).toBe('Hero Investors')
  })

  it('returns none when no form is selected', () => {
    // An editor who chose "Open a form" but picked nothing must not produce a
    // button that renders and does nothing — the exact shape of the bug that
    // made the legacy indirection dangerous to remove carelessly.
    expect(resolveCta({ ...base }).type).toBe('none')
  })
})
