import { describe, it, expect } from 'vitest'
import { GALLERY_MESSAGES_FOR_TEST, getGalleryMessages, formatGalleryMessage } from '../gallery-messages'
import { PLATFORM_LOCALES } from '@/lib/i18n/locales'

describe('gallery messages', () => {
  it('covers every platform locale with every key', () => {
    const keys = Object.keys(GALLERY_MESSAGES_FOR_TEST.en).sort()
    for (const code of Object.keys(PLATFORM_LOCALES)) {
      const m = GALLERY_MESSAGES_FOR_TEST[code]
      expect(m, `missing locale ${code}`).toBeDefined()
      expect(Object.keys(m).sort()).toEqual(keys)
      for (const k of keys) expect((m as unknown as Record<string, string>)[k]).toBeTruthy()
    }
  })
  it('falls back to English', () => {
    expect(getGalleryMessages('xx').close).toBe('Close')
    expect(getGalleryMessages(undefined).close).toBe('Close')
  })
  it('fills placeholders', () => {
    expect(formatGalleryMessage(getGalleryMessages('it').openPhoto, { n: 3, total: 12 })).toBe('Apri la foto 3 di 12')
  })
})
