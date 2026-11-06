// ── Scheduling — "how does this class repeat", in words (ADR-045) ─────────────
//
// Pure and client-safe, no React. One sentence per repeat preset, in the page's
// or viewer's LANGUAGE (en, it, de, fr, es, pt, nl; anything else reads English):
//
//   "Every Thursday" · "Every Monday and Wednesday" · "Every 2 weeks on Monday and Wednesday"
//   "First Monday of the month" · "Last Sunday of the month"
//   "Day 15 of every month" · "Once, 12 December"
//
// Platform chrome, not tenant content, so it is a locale dictionary beside
// timetable-messages.ts (same pattern; weekday and month names come from Intl,
// never from a table). Used by the dashboard's class list and the website's class panel.

import { parseClassRule, type ClassRule, type Ordinal } from './recurrence'

type Names = {
  /** "Monday" … in this language. */
  day: (weekday: number) => string
  /** "a, b and c". */
  list: (items: string[]) => string
}

type Words = {
  weekly: (days: string, interval: number, names: { first: string }) => string
  monthlyWeekday: (ordinal: Ordinal, weekday: number, day: string) => string
  monthlyDay: (day: number) => string
  once: (date: string | null) => string
}

const FEMININE_PT = (weekday: number) => weekday <= 5
const FEMININE_IT = (weekday: number) => weekday === 7 // domenica

const WORDS: Record<string, Words> = {
  en: {
    weekly: (days, n) => (n === 1 ? `Every ${days}` : `Every ${n} weeks on ${days}`),
    monthlyWeekday: (o, _w, day) => `${{ 1: 'First', 2: 'Second', 3: 'Third', 4: 'Fourth', [-1]: 'Last' }[o]} ${day} of the month`,
    monthlyDay: (d) => `Day ${d} of every month`,
    once: (date) => (date ? `Once, ${date}` : 'Once'),
  },
  it: {
    weekly: (days, n) => (n === 1 ? `Ogni ${days}` : `Ogni ${n} settimane, ${days}`),
    monthlyWeekday: (o, w, day) => {
      const f = FEMININE_IT(w)
      const word = {
        1: f ? 'prima' : 'primo',
        2: f ? 'seconda' : 'secondo',
        3: f ? 'terza' : 'terzo',
        4: f ? 'quarta' : 'quarto',
        [-1]: f ? 'ultima' : 'ultimo',
      }[o]
      return `${word} ${day} del mese`
    },
    monthlyDay: (d) => `Il giorno ${d} di ogni mese`,
    once: (date) => (date ? `Una volta, ${date}` : 'Una volta'),
  },
  de: {
    weekly: (days, n) => (n === 1 ? `Jeden ${days}` : `Alle ${n} Wochen am ${days}`),
    monthlyWeekday: (o, _w, day) => `Jeden ${{ 1: 'ersten', 2: 'zweiten', 3: 'dritten', 4: 'vierten', [-1]: 'letzten' }[o]} ${day} im Monat`,
    monthlyDay: (d) => `Am ${d}. jedes Monats`,
    once: (date) => (date ? `Einmalig, ${date}` : 'Einmalig'),
  },
  fr: {
    weekly: (days, n) => (n === 1 ? `Chaque ${days}` : `Toutes les ${n} semaines, ${days}`),
    monthlyWeekday: (o, _w, day) => `${{ 1: 'premier', 2: 'deuxième', 3: 'troisième', 4: 'quatrième', [-1]: 'dernier' }[o]} ${day} du mois`,
    monthlyDay: (d) => `Le ${d} de chaque mois`,
    once: (date) => (date ? `Une fois, ${date}` : 'Une fois'),
  },
  es: {
    weekly: (days, n) => (n === 1 ? `Cada ${days}` : `Cada ${n} semanas, ${days}`),
    monthlyWeekday: (o, _w, day) => `${{ 1: 'primer', 2: 'segundo', 3: 'tercer', 4: 'cuarto', [-1]: 'último' }[o]} ${day} del mes`,
    monthlyDay: (d) => `El día ${d} de cada mes`,
    once: (date) => (date ? `Una vez, ${date}` : 'Una vez'),
  },
  pt: {
    weekly: (days, n, { first }) => (n === 1 ? `${FEMININE_PT(Number(first)) ? 'Toda' : 'Todo'} ${days}` : `A cada ${n} semanas, ${days}`),
    monthlyWeekday: (o, w, day) => {
      const f = FEMININE_PT(w)
      const word = {
        1: f ? 'primeira' : 'primeiro',
        2: f ? 'segunda' : 'segundo',
        3: f ? 'terceira' : 'terceiro',
        4: f ? 'quarta' : 'quarto',
        [-1]: f ? 'última' : 'último',
      }[o]
      return `${word} ${day} do mês`
    },
    monthlyDay: (d) => `Dia ${d} de cada mês`,
    once: (date) => (date ? `Uma vez, ${date}` : 'Uma vez'),
  },
  nl: {
    weekly: (days, n) => (n === 1 ? `Elke ${days}` : `Elke ${n} weken op ${days}`),
    monthlyWeekday: (o, _w, day) => `${{ 1: 'eerste', 2: 'tweede', 3: 'derde', 4: 'vierde', [-1]: 'laatste' }[o]} ${day} van de maand`,
    monthlyDay: (d) => `Dag ${d} van elke maand`,
    once: (date) => (date ? `Eenmalig, ${date}` : 'Eenmalig'),
  },
}

/** The language we have words for (a region such as 'fr-BE' reads 'fr'); anything else is English. */
function languageOf(locale: string | undefined | null): string {
  const code = (locale ?? '').toLowerCase().split(/[-_]/)[0]
  return WORDS[code] ? code : 'en'
}

/** English reads day-before-month, as the rest of the product does. */
const intlTag = (lang: string) => (lang === 'en' ? 'en-GB' : lang)

function namesFor(lang: string): Names {
  const tag = intlTag(lang)
  const day = (weekday: number) => new Intl.DateTimeFormat(tag, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, weekday, 12))) // 1 Jan 2024 was a Monday
  const list = (items: string[]) => new Intl.ListFormat(tag, { style: 'long', type: 'conjunction' }).format(items)
  return { day, list }
}

const capital = (text: string, lang: string) => (text ? text.charAt(0).toLocaleUpperCase(lang) + text.slice(1) : text)

export type DescribeRepeatOptions = {
  /** The one date of a "once" class ('YYYY-MM-DD'): without it "Once" stands alone. */
  date?: string | null
  /** Show the year of a "once" date ("12 December 2026"). */
  withYear?: boolean
}

/**
 * The words for a class's repeat. `rule` is the stored text (`ClassSeries.rule`) or a parsed `ClassRule`;
 * `locale` any language tag ('en', 'it', 'de-AT' …; unknown ones read English). Returns '' for a missing or
 * unknown rule so callers can fall back to something else.
 *
 *   describeClassRepeat('FREQ=WEEKLY;INTERVAL=1;BYDAY=TH', 'en')                → "Every Thursday"
 *   describeClassRepeat('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', 'en')             → "Every 2 weeks on Monday and Wednesday"
 *   describeClassRepeat('FREQ=MONTHLY;BYDAY=-1SU', 'it')                        → "Ultima domenica del mese"
 *   describeClassRepeat('FREQ=DAILY;COUNT=1', 'en', { date: '2026-12-12' })     → "Once, 12 December"
 */
export function describeClassRepeat(rule: string | ClassRule | null | undefined, locale: string, options: DescribeRepeatOptions = {}): string {
  const parsed = typeof rule === 'string' ? parseClassRule(rule) : (rule ?? null)
  if (!parsed) return ''
  const lang = languageOf(locale)
  const words = WORDS[lang]
  const names = namesFor(lang)
  let text: string
  switch (parsed.kind) {
    case 'once': {
      const ms = options.date ? Date.parse(`${options.date}T12:00:00Z`) : NaN
      const date = Number.isNaN(ms)
        ? null
        : new Intl.DateTimeFormat(intlTag(lang), {
            day: 'numeric',
            month: 'long',
            ...(options.withYear && { year: 'numeric' }),
            timeZone: 'UTC',
          }).format(ms)
      text = words.once(date)
      break
    }
    case 'weekly': {
      const days = [...parsed.weekdays].sort((a, b) => a - b)
      text = words.weekly(names.list(days.map(names.day)), parsed.interval, {
        first: String(days[0]),
      })
      break
    }
    case 'monthlyWeekday':
      text = words.monthlyWeekday(parsed.ordinal, parsed.weekday, names.day(parsed.weekday))
      break
    case 'monthlyDay':
      text = words.monthlyDay(parsed.day)
      break
  }
  return capital(text, lang)
}
