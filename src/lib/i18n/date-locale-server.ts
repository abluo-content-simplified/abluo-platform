import 'server-only'
import { headers } from 'next/headers'
import { getLocale } from 'next-intl/server'
import { resolveDateLocale } from './date-locale'

/**
 * The date locale of this request (see `resolveDateLocale`). Reads the request
 * headers, so call it only from dashboard (dynamic) code — never from public
 * website pages, which would stop them being static.
 */
export async function getDateLocale(): Promise<string> {
  const [locale, h] = await Promise.all([getLocale(), headers()])
  return resolveDateLocale(locale, h.get('accept-language'))
}
