import { describe, it, expect } from 'vitest'
import { LOCATIONS_SECTION_MESSAGES_FOR_TEST, getLocationsSectionMessages } from '../locations-section-messages'
import { PLATFORM_LOCALES } from '@/lib/i18n/locales'

describe('locations section messages', () => {
  it('covers every platform locale with every key', () => {
    const keys = Object.keys(LOCATIONS_SECTION_MESSAGES_FOR_TEST.en).sort()
    for (const code of Object.keys(PLATFORM_LOCALES)) {
      const m = LOCATIONS_SECTION_MESSAGES_FOR_TEST[code]
      expect(m, `missing locale ${code}`).toBeDefined()
      expect(Object.keys(m).sort()).toEqual(keys)
      for (const k of keys) expect((m as unknown as Record<string, string>)[k]).toBeTruthy()
    }
  })
  it('falls back to English', () => {
    expect(getLocationsSectionMessages('xx').openInMaps).toBe('Open in Google Maps')
    expect(getLocationsSectionMessages(undefined).openInMaps).toBe('Open in Google Maps')
    expect(getLocationsSectionMessages('fr').openInMaps).toBe('Ouvrir dans Google Maps')
  })
})
