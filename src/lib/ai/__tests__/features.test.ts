import { describe, it, expect } from 'vitest'
import { parseAiFeatures, getAiFeatureFlags, isAiFeatureEnabled } from '../features'

describe('AI_FEATURES flag', () => {
  it.each([[undefined], [''], ['off'], ['none'], ['  '], ['improv'], ['true']])('%s → everything off (default)', (raw) => {
    expect(parseAiFeatures(raw)).toEqual({ improve: false, translate: false })
  })

  it.each([
    ['all', { improve: true, translate: true }],
    ['ALL', { improve: true, translate: true }],
    ['improve', { improve: true, translate: false }],
    ['translate', { improve: false, translate: true }],
    ['improve,translate', { improve: true, translate: true }],
    [' Improve ,  translate ', { improve: true, translate: true }],
    ['improve translate', { improve: true, translate: true }],
  ])('%s', (raw, expected) => {
    expect(parseAiFeatures(raw)).toEqual(expected)
  })

  it('reads AI_FEATURES from the given env', () => {
    expect(getAiFeatureFlags({ AI_FEATURES: 'improve' }).improve).toBe(true)
    expect(isAiFeatureEnabled('improve', {})).toBe(false)
    expect(isAiFeatureEnabled('translate', { AI_FEATURES: 'all' })).toBe(true)
  })
})
