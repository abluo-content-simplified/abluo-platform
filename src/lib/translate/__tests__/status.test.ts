import { describe, it, expect } from 'vitest'
import {
  effectiveStatus,
  hashText,
  isWritableTarget,
  localesToMarkReviewed,
  machineMeta,
} from '../status'

describe('translation status model (ADR-023 §4)', () => {
  const meta = machineMeta({
    text: 'Nos professeurs',
    source: 'Our teachers',
    sourceLocale: 'en',
    provider: 'google',
    now: new Date('2026-09-29T10:00:00Z'),
  })

  it('hash is stable and sensitive to edits', () => {
    expect(hashText('abc')).toBe(hashText('abc'))
    expect(hashText('abc')).not.toBe(hashText('abd'))
    expect(hashText('')).toMatch(/^[0-9a-f]{8}$/)
  })

  it('machineMeta records provider, source and hashes', () => {
    expect(meta).toMatchObject({
      _type: 'translationMeta',
      status: 'machine',
      provider: 'google',
      sourceLocale: 'en',
      translatedAt: '2026-09-29T10:00:00.000Z',
      textHash: hashText('Nos professeurs'),
      sourceHash: hashText('Our teachers'),
    })
  })

  it('absent meta = original', () => {
    expect(effectiveStatus('Hello', undefined)).toBe('original')
  })

  it('an untouched machine value stays machine; a hand-edited one becomes reviewed', () => {
    expect(effectiveStatus('Nos professeurs', meta)).toBe('machine')
    expect(effectiveStatus('Nos enseignants', meta)).toBe('reviewed')
  })

  it('one click writes only empty or untouched machine targets', () => {
    expect(isWritableTarget(undefined, undefined)).toBe(true)
    expect(isWritableTarget('   ', undefined)).toBe(true)
    expect(isWritableTarget('Nos professeurs', meta)).toBe(true)
    expect(isWritableTarget('Typed by a person', undefined)).toBe(false)
    expect(isWritableTarget('Nos enseignants', meta)).toBe(false)
    expect(isWritableTarget('Nos professeurs', { ...meta, status: 'reviewed' })).toBe(false)
  })

  it('reports which persisted machine entries were edited', () => {
    expect(
      localesToMarkReviewed(
        { en: 'Our teachers', fr: 'Nos enseignants', de: 'Unsere Lehrer' },
        { fr: meta, de: { ...meta, textHash: hashText('Unsere Lehrer') } }
      )
    ).toEqual(['fr'])
  })
})
