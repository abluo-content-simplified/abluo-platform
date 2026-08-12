/**
 * Form overlay core — ADR-018 slice 7a. Pure helpers only: the lookup, the
 * single-vs-multi routing decision (must match FormSection), and localized
 * modal chrome. No rendering, no DOM.
 */
import { describe, it, expect } from 'vitest'
import {
  selectOverlayForm,
  isMultiStepDefinition,
  getOverlayChromeMessages,
  type OverlayFormEntry,
} from '../overlay'
import type { RenderableFormDefinition } from '@/lib/sanity/types'

/** Minimal definition factory — only the fields these pure helpers read. */
function def(formId: string, steps: number): RenderableFormDefinition {
  return {
    formId,
    title: `${formId} title`,
    steps: Array.from({ length: steps }, (_, i) => ({ key: `s${i}`, title: null, fields: [] })),
  } as unknown as RenderableFormDefinition
}

const forms: OverlayFormEntry[] = [
  { formId: 'contact', definition: def('contact', 1) },
  { formId: 'consultation', definition: def('consultation', 3) },
]

describe('selectOverlayForm', () => {
  it('returns the entry matching formId', () => {
    expect(selectOverlayForm(forms, 'consultation')?.formId).toBe('consultation')
  })
  it('returns null when the formId is not seeded', () => {
    expect(selectOverlayForm(forms, 'missing')).toBeNull()
  })
  it('returns null for an empty registry', () => {
    expect(selectOverlayForm([], 'contact')).toBeNull()
  })
})

describe('isMultiStepDefinition', () => {
  it('is true for more than one step', () => {
    expect(isMultiStepDefinition(def('x', 3))).toBe(true)
  })
  it('is false for a single step (matches FormSection)', () => {
    expect(isMultiStepDefinition(def('x', 1))).toBe(false)
  })
  it('is false for zero steps or a null/undefined definition', () => {
    expect(isMultiStepDefinition(def('x', 0))).toBe(false)
    expect(isMultiStepDefinition(null)).toBe(false)
    expect(isMultiStepDefinition(undefined)).toBe(false)
  })
})

describe('getOverlayChromeMessages', () => {
  it('returns localized copy for a known locale', () => {
    expect(getOverlayChromeMessages('it').closeLabel).toBe('Chiudi')
  })
  it('falls back to English for an unknown locale', () => {
    expect(getOverlayChromeMessages('zz').closeLabel).toBe('Close')
  })
})
