import { describe, expect, it } from 'vitest'
import { pathServedBase } from '../site-base'

describe('pathServedBase', () => {
  it('serves by path on dev and preview', () => {
    expect(pathServedBase('dev.abluo.app', 'tmz')).toBe('https://dev.abluo.app/tmz')
    expect(pathServedBase('Preview.Abluo.app', 'tmz')).toBe('https://preview.abluo.app/tmz')
  })
  it('is null on admin, custom domains and unknown hosts', () => {
    expect(pathServedBase('admin.abluo.app', 'tmz')).toBeNull()
    expect(pathServedBase('tmz.it', 'tmz')).toBeNull()
    expect(pathServedBase(null, 'tmz')).toBeNull()
  })
})
