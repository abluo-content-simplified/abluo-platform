import { describe, it, expect } from 'vitest'
import {
  isEmptyValue,
  contextMappableKeys,
  mapContextToValues,
  isStepSatisfied,
  firstIncompleteStepIndex,
  autoAdvanceSteps,
  stepValues,
  isFinalStepIndex,
} from '@/lib/forms/multistep'
import type { RenderableFormDefinition } from '@/lib/sanity/types'

// A 2-step definition: step 1 has a context-mappable required `treatment`,
// step 2 has required `name` + `email` (not context-mappable).
const def: RenderableFormDefinition = {
  _id: 'd', formId: 'appt', formType: 'multi-step', tenantSlug: 'livener',
  steps: [
    { key: 'need', fields: [{ id: 'treatment', type: 'select', required: true, contextMappable: true, label: 'Treatment' }] },
    { key: 'contact', fields: [
      { id: 'name', type: 'text', required: true, label: 'Name' },
      { id: 'email', type: 'email', required: true, label: 'Email' },
    ] },
  ],
}

describe('isEmptyValue', () => {
  it('treats empty string, null, undefined, [], and false as empty', () => {
    for (const v of ['', '  ', null, undefined, [], false]) expect(isEmptyValue(v)).toBe(true)
    for (const v of ['x', 0, ['a'], true]) expect(isEmptyValue(v)).toBe(false)
  })
})

describe('context mapping', () => {
  it('collects only context-mappable field keys', () => {
    expect(contextMappableKeys(def)).toEqual(new Set(['treatment']))
  })

  it('maps only mappable, non-empty context keys (mirrors server sanitize)', () => {
    const values = mapContextToValues(def, { treatment: 'implantology', name: 'HACK', unknown: 'x', empty: '' })
    expect(values).toEqual({ treatment: 'implantology' })
    // name is not context-mappable → never pre-filled from Context (§18)
    expect('name' in values).toBe(false)
  })

  it('returns {} for missing context', () => {
    expect(mapContextToValues(def, null)).toEqual({})
  })
})

describe('step satisfaction + landing step', () => {
  it('a step is satisfied only when all required fields are non-empty', () => {
    expect(isStepSatisfied(def.steps[0], { treatment: 'x' })).toBe(true)
    expect(isStepSatisfied(def.steps[0], {})).toBe(false)
    expect(isStepSatisfied(def.steps[1], { name: 'A', email: 'a@x.t' })).toBe(true)
    expect(isStepSatisfied(def.steps[1], { name: 'A' })).toBe(false)
  })

  it('lands on step 1 when nothing is known', () => {
    expect(firstIncompleteStepIndex(def, {})).toBe(0)
  })

  it('skips a context-satisfied leading step → lands on step 2', () => {
    expect(firstIncompleteStepIndex(def, { treatment: 'implantology' })).toBe(1)
  })

  it('lands on the last step when everything is already satisfied', () => {
    expect(firstIncompleteStepIndex(def, { treatment: 'x', name: 'A', email: 'a@x.t' })).toBe(1)
  })
})

describe('autoAdvanceSteps', () => {
  it('returns the leading steps Context fully satisfied, up to the landing step', () => {
    expect(autoAdvanceSteps(def, { treatment: 'implantology' }).map((s) => s.key)).toEqual(['need'])
  })

  it('auto-advances nothing when the first step is not satisfied', () => {
    expect(autoAdvanceSteps(def, {})).toEqual([])
  })
})

describe('stepValues + isFinalStepIndex', () => {
  it('whitelists values to the step fields', () => {
    expect(stepValues(def.steps[1], { name: 'A', email: 'a@x.t', treatment: 'x', junk: 1 })).toEqual({ name: 'A', email: 'a@x.t' })
  })

  it('identifies the final step', () => {
    expect(isFinalStepIndex(def, 1)).toBe(true)
    expect(isFinalStepIndex(def, 0)).toBe(false)
  })
})
