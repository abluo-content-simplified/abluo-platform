import { describe, it, expect } from 'vitest'
import { assetInfo, pickHomeScreenIcon, pickTabIcon, signProblem } from '../site-icons'

const img = (ref: string) => ({ asset: { _ref: ref } })
const SVG = img('image-aaa-64x64-svg')
const PNG = img('image-bbb-32x32-png')
const TOUCH = img('image-ccc-180x180-png')
const SIGN = img('image-ddd-154x103-svg')
const SIGN_LIGHT = img('image-eee-154x103-svg')

describe('site icons — the sign is the master, explicit fields win', () => {
  it('tab icon: favicon SVG → favicon PNG → sign (light version first)', () => {
    expect(pickTabIcon({ faviconSvg: SVG, faviconPng: PNG, brandMark: SIGN })).toBe(SVG)
    expect(pickTabIcon({ faviconPng: PNG, brandMark: SIGN })).toBe(PNG)
    expect(pickTabIcon({ brandMark: SIGN, brandMarkLight: SIGN_LIGHT })).toBe(SIGN_LIGHT)
    expect(pickTabIcon({ brandMark: SIGN })).toBe(SIGN)
    expect(pickTabIcon({})).toBeNull()
    expect(pickTabIcon(null)).toBeNull()
  })

  it('home-screen icon: Apple touch icon → sign (dark version first) — never the favicon', () => {
    expect(pickHomeScreenIcon({ appleTouchIcon: TOUCH, brandMark: SIGN })).toBe(TOUCH)
    expect(pickHomeScreenIcon({ brandMark: SIGN, brandMarkLight: SIGN_LIGHT })).toBe(SIGN)
    expect(pickHomeScreenIcon({ brandMarkLight: SIGN_LIGHT })).toBe(SIGN_LIGHT)
    expect(pickHomeScreenIcon({ faviconSvg: SVG, faviconPng: PNG } as never)).toBeNull()
  })

  it('reads size and format from the asset ref', () => {
    expect(assetInfo('image-abc-530x134-svg')).toEqual({ width: 530, height: 134, ext: 'svg' })
    expect(assetInfo('nope')).toBeNull()
  })

  it('a sign must scale: SVG always, raster only from 512 × 512', () => {
    expect(signProblem('image-a-64x64-svg')).toBeNull()
    expect(signProblem('image-a-512x512-png')).toBeNull()
    expect(signProblem('image-a-180x180-png')).toMatch(/blurry/)
    expect(signProblem(undefined)).toBeNull()
  })
})
