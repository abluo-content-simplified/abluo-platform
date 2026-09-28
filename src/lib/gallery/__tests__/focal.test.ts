import { describe, it, expect } from 'vitest'
import { focalPoint, focalObjectPosition } from '../focal'

describe('focalObjectPosition', () => {
  it('centres when no focal point is set (today\'s behaviour)', () => {
    expect(focalObjectPosition(null)).toBe('50% 50%')
    expect(focalObjectPosition({})).toBe('50% 50%')
  })

  it('uses the hotspot directly when the image is not cropped', () => {
    expect(focalObjectPosition({ hotspot: { x: 0.5, y: 0.2 } })).toBe('50% 20%')
  })

  it('re-expresses the hotspot inside the cropped frame', () => {
    // Top 20% cropped away: a point at y=0.6 of the original sits at 0.5 of
    // the remaining 80%.
    const p = focalPoint({ x: 0.5, y: 0.6 }, { top: 0.2, bottom: 0, left: 0, right: 0 })
    expect(p?.y).toBeCloseTo(0.5)
    expect(p?.x).toBeCloseTo(0.5)
  })

  it('clamps a hotspot that ended up outside the crop', () => {
    const p = focalPoint({ x: 0.05, y: 0.95 }, { top: 0, bottom: 0.1, left: 0.1, right: 0 })
    expect(p).toEqual({ x: 0, y: 1 })
  })

  it('ignores a malformed hotspot', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(focalPoint({ x: 'a' as any, y: 0.5 })).toBeNull()
  })
})
