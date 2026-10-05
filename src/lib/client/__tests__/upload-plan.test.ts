import { describe, it, expect } from 'vitest'
import { formatBytes, planUpload, UPLOAD_LIMITS } from '../upload-plan'

const MB = 1024 * 1024

describe('planUpload', () => {
  it('sends supported photos that fit as they are, so TinyPNG compresses the original', () => {
    expect(planUpload({ size: 3.5 * MB, type: 'image/jpeg', width: 2400, height: 1600 })).toEqual({ action: 'send' })
    expect(planUpload({ size: 900 * 1024, type: 'image/png', width: 1200, height: 800 })).toEqual({ action: 'send' })
    expect(planUpload({ size: 2 * MB, type: 'image/webp', width: null, height: null })).toEqual({ action: 'send' })
  })

  it('resizes at high quality when the file is over ~3.8 MB', () => {
    const plan = planUpload({ size: 6 * MB, type: 'image/jpeg', width: 2000, height: 1500 })
    expect(plan).toMatchObject({ action: 'resize' })
    if (plan.action !== 'resize') throw new Error()
    expect(plan.attempts[0]).toEqual({ maxEdge: 2000, quality: UPLOAD_LIMITS.quality, type: 'image/jpeg' })
    expect(plan.attempts[0].quality).toBeGreaterThanOrEqual(0.9)
  })

  it('resizes photos longer than 2560 px even when small in bytes', () => {
    const plan = planUpload({ size: 1 * MB, type: 'image/jpeg', width: 4032, height: 3024 })
    if (plan.action !== 'resize') throw new Error('expected resize')
    expect(plan.attempts[0]).toMatchObject({ maxEdge: 2560, quality: 0.92 })
  })

  it('converts formats the server does not accept (e.g. HEIC decoded by Safari)', () => {
    expect(planUpload({ size: 1 * MB, type: 'image/heic', width: 1000, height: 800 })).toMatchObject({ action: 'resize' })
  })

  it('never upsizes and steps down only as a fallback', () => {
    const plan = planUpload({ size: 10 * MB, type: 'image/png', width: 1800, height: 1200 })
    if (plan.action !== 'resize') throw new Error()
    expect(plan.attempts.map((a) => a.maxEdge)).toEqual([1800, 1800, 1800])
  })
})

describe('formatBytes', () => {
  it('formats sizes for the confirmation', () => {
    expect(formatBytes(2.4 * MB)).toBe('2.4 MB')
    expect(formatBytes(610 * 1024)).toBe('610 KB')
    expect(formatBytes(2.4 * MB, 'it')).toBe('2,4 MB')
  })
})
