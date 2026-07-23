import { describe, expect, it } from 'vitest'
import { isExpectedDocType } from '../auth'

describe('isExpectedDocType', () => {
  it('rejects a non-mediaAsset document type', () => {
    expect(isExpectedDocType('siteConfig', 'mediaAsset')).toBe(false)
    expect(isExpectedDocType('project', 'mediaAsset')).toBe(false)
    expect(isExpectedDocType('client', 'mediaAsset')).toBe(false)
  })

  it('allows a mediaAsset document type', () => {
    expect(isExpectedDocType('mediaAsset', 'mediaAsset')).toBe(true)
  })

  it('rejects a missing or unknown document type', () => {
    expect(isExpectedDocType(null, 'mediaAsset')).toBe(false)
    expect(isExpectedDocType(undefined, 'mediaAsset')).toBe(false)
  })
})
