import { describe, expect, it } from 'vitest'
import { PLATFORM_LOCALES } from '@/lib/i18n/locales'
import { describeClassRepeat } from '../repeat-label'

const RULES = ['FREQ=DAILY;COUNT=1', 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TH', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR', 'FREQ=MONTHLY;BYDAY=1MO', 'FREQ=MONTHLY;BYDAY=-1SU', 'FREQ=MONTHLY;BYMONTHDAY=15']

describe('describeClassRepeat', () => {
  it('English', () => {
    const d = (r: string, o = {}) => describeClassRepeat(r, 'en', o)
    expect(d('FREQ=WEEKLY;INTERVAL=1;BYDAY=TH')).toBe('Every Thursday')
    expect(d('FREQ=WEEKLY;BYDAY=TH')).toBe('Every Thursday')
    expect(d('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE')).toBe('Every Monday and Wednesday')
    expect(d('FREQ=WEEKLY;INTERVAL=1;BYDAY=FR,MO,WE')).toBe('Every Monday, Wednesday and Friday')
    expect(d('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE')).toBe('Every 2 weeks on Monday and Wednesday')
    expect(d('FREQ=MONTHLY;BYDAY=1MO')).toBe('First Monday of the month')
    expect(d('FREQ=MONTHLY;BYDAY=-1SU')).toBe('Last Sunday of the month')
    expect(d('FREQ=MONTHLY;BYDAY=4TH')).toBe('Fourth Thursday of the month')
    expect(d('FREQ=MONTHLY;BYMONTHDAY=15')).toBe('Day 15 of every month')
    expect(d('FREQ=DAILY;COUNT=1', { date: '2026-12-12' })).toBe('Once, 12 December')
    expect(d('FREQ=DAILY;COUNT=1', { date: '2026-12-12', withYear: true })).toBe('Once, 12 December 2026')
    expect(d('FREQ=DAILY;COUNT=1')).toBe('Once')
  })
  it('Italian and German', () => {
    expect(describeClassRepeat('FREQ=WEEKLY;INTERVAL=1;BYDAY=TH', 'it')).toBe('Ogni giovedì')
    expect(describeClassRepeat('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', 'it')).toBe('Ogni 2 settimane, lunedì e mercoledì')
    expect(describeClassRepeat('FREQ=MONTHLY;BYDAY=1MO', 'it')).toBe('Primo lunedì del mese')
    expect(describeClassRepeat('FREQ=MONTHLY;BYDAY=-1SU', 'it')).toBe('Ultima domenica del mese')
    expect(describeClassRepeat('FREQ=MONTHLY;BYMONTHDAY=15', 'it')).toBe('Il giorno 15 di ogni mese')
    expect(describeClassRepeat('FREQ=DAILY;COUNT=1', 'it', { date: '2026-12-12' })).toBe('Una volta, 12 dicembre')
    expect(describeClassRepeat('FREQ=WEEKLY;INTERVAL=1;BYDAY=TH', 'de')).toBe('Jeden Donnerstag')
    expect(describeClassRepeat('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', 'de')).toBe('Alle 2 Wochen am Montag und Mittwoch')
    expect(describeClassRepeat('FREQ=MONTHLY;BYDAY=-1SU', 'de')).toBe('Jeden letzten Sonntag im Monat')
    expect(describeClassRepeat('FREQ=MONTHLY;BYMONTHDAY=15', 'de')).toBe('Am 15. jedes Monats')
    expect(describeClassRepeat('FREQ=DAILY;COUNT=1', 'de', { date: '2026-12-12' })).toBe('Einmalig, 12. Dezember')
  })
  it('every platform language says something for every preset, and a region reads its language', () => {
    for (const code of Object.keys(PLATFORM_LOCALES)) for (const r of RULES) expect(describeClassRepeat(r, code, { date: '2026-12-12' }), `${code} ${r}`).toBeTruthy()
    expect(describeClassRepeat('FREQ=WEEKLY;BYDAY=TH', 'de-AT')).toBe('Jeden Donnerstag')
    expect(describeClassRepeat('FREQ=WEEKLY;BYDAY=TH', 'xx')).toBe('Every Thursday')
    expect(describeClassRepeat('FREQ=WEEKLY;BYDAY=SA', 'pt')).toBe('Todo sábado')
  })
  it('accepts a parsed rule and is empty for a missing or unknown one', () => {
    expect(describeClassRepeat({ kind: 'monthlyDay', day: 3 }, 'en')).toBe('Day 3 of every month')
    for (const r of [null, undefined, '', 'FREQ=YEARLY', 'junk']) expect(describeClassRepeat(r, 'en')).toBe('')
  })
})
