import { describe, it, expect } from 'vitest'
import { TEAM_SECTION_MESSAGES_FOR_TEST, getTeamSectionMessages } from '../team-section-messages'
import { PLATFORM_LOCALES } from '@/lib/i18n/locales'

describe('team section messages', () => {
  it('covers every platform locale with every key', () => {
    const keys = Object.keys(TEAM_SECTION_MESSAGES_FOR_TEST.en).sort()
    for (const code of Object.keys(PLATFORM_LOCALES)) {
      const m = TEAM_SECTION_MESSAGES_FOR_TEST[code]
      expect(m, `missing locale ${code}`).toBeDefined()
      expect(Object.keys(m).sort()).toEqual(keys)
      for (const k of keys) expect((m as unknown as Record<string, string>)[k]).toBeTruthy()
    }
  })
  it('falls back to English', () => {
    expect(getTeamSectionMessages('xx').website).toBe('Website')
    expect(getTeamSectionMessages(undefined).website).toBe('Website')
    expect(getTeamSectionMessages('fr').website).toBe('Site web')
  })
})
