import { describe, it, expect } from 'vitest'
import { TIMETABLE_MESSAGES_FOR_TEST, getTimetableMessages } from '../timetable-messages'
import { PLATFORM_LOCALES } from '@/lib/i18n/locales'

describe('timetable messages', () => {
  it('covers every platform locale with every key', () => {
    const keys = Object.keys(TIMETABLE_MESSAGES_FOR_TEST.en).sort()
    for (const code of Object.keys(PLATFORM_LOCALES)) {
      const m = TIMETABLE_MESSAGES_FOR_TEST[code]
      expect(m, `missing locale ${code}`).toBeDefined()
      expect(Object.keys(m).sort()).toEqual(keys)
      for (const k of keys) {
        const v = (m as unknown as Record<string, unknown>)[k]
        expect(typeof v === 'function' ? (v as (...a: string[]) => string)('A', 'B') : v, `${code}.${k}`).toBeTruthy()
      }
    }
  })

  it('template messages place their argument', () => {
    for (const code of Object.keys(PLATFORM_LOCALES)) {
      const m = TIMETABLE_MESSAGES_FOR_TEST[code]
      expect(m.withTeachers('NAME')).toContain('NAME')
      expect(m.substitute('NAME')).toContain('NAME')
      expect(m.atTime('19:00')).toContain('19:00')
      expect(m.lastClass('17/12')).toContain('17/12')
      expect(m.firstClass('7/1')).toContain('7/1')
      expect(m.closedFromTo('1/1', '2/1')).toMatch(/1\/1.*2\/1/)
    }
  })

  it('falls back to English and speaks French for fr', () => {
    expect(getTimetableMessages('xx').printMonth).toBe('Print month')
    expect(getTimetableMessages(undefined).viewWeek).toBe('Week')
    expect(getTimetableMessages('fr').printMonth).toBe('Imprimer le mois')
    expect(getTimetableMessages('fr').substitute('Sabrina')).toBe('remplacement Sabrina')
  })

  it('German addresses the visitor formally', () => {
    expect(getTimetableMessages('de').loadError).toContain('Sie')
  })
})
