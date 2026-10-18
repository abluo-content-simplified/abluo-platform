import { headers } from 'next/headers'

/**
 * The visitor's country (ISO 3166-1 alpha-2, upper case) from the header Vercel
 * adds to every request, or null (local dev, other hosts, outside a request).
 * Reading it makes the page dynamic per request, which the website routes
 * already are (`force-dynamic`); nothing is stored and no cookie is set.
 */
export async function visitorCountry(): Promise<string | null> {
  try {
    const v = (await headers()).get('x-vercel-ip-country')
    return v && /^[A-Za-z]{2}$/.test(v.trim()) ? v.trim().toUpperCase() : null
  } catch {
    return null
  }
}
