import { describe, it, expect } from 'vitest'
import { SOCIAL_PROFILES_MESSAGES_FOR_TEST, SOCIAL_PROFILES_MESSAGE_LOCALES, getSocialProfilesMessages } from '../social-profiles-messages'

describe('Settings → Social Profiles messages', () => {
  const en = SOCIAL_PROFILES_MESSAGES_FOR_TEST.en
  it('every dashboard language has every key, none empty, same placeholders', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
    for (const code of SOCIAL_PROFILES_MESSAGE_LOCALES) {
      const m = SOCIAL_PROFILES_MESSAGES_FOR_TEST[code] as unknown as Record<string, string>
      expect(Object.keys(m).sort()).toEqual(Object.keys(en).sort())
      for (const [k, v] of Object.entries(en)) {
        expect(m[k].trim(), `${code}.${k}`).not.toBe('')
        expect(ph(m[k]), `${code}.${k}`).toBe(ph(v))
      }
    }
  })
  it('the page title is the navigation label (Title Case in English) and falls back to English', () => {
    expect(getSocialProfilesMessages('en').title).toBe('Social Profiles')
    expect(getSocialProfilesMessages('xx').title).toBe('Social Profiles')
    expect(getSocialProfilesMessages('de-AT').title).toBe('Soziale Profile')
  })
})
