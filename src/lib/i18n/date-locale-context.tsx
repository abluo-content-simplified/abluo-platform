'use client'

import { createContext, useContext } from 'react'
import { useLocale } from 'next-intl'
import { resolveDateLocale } from './date-locale'

/**
 * The date locale resolved once on the server (`getDateLocale`) and provided by
 * `AppRoot`, so server and client render the same date text (no hydration
 * mismatch). Use `useDateLocale()` wherever a dashboard formats a date.
 */
const DateLocaleContext = createContext<string | null>(null)

export function DateLocaleProvider({ value, children }: { value: string; children: React.ReactNode }) {
  return <DateLocaleContext.Provider value={value}>{children}</DateLocaleContext.Provider>
}

/** Outside a provider (tests, Studio) it falls back to the interface language's own convention. */
export function useDateLocale(): string {
  const provided = useContext(DateLocaleContext)
  const locale = useLocale()
  return provided ?? resolveDateLocale(locale, null)
}
