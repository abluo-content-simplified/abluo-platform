/**
 * useProjectLocales
 *
 * Returns the list of locales enabled for the project being edited.
 * Reads `projectSlug` from the root of the current Sanity document,
 * then queries the matching siteConfig.supportedLocales.
 *
 * Falls back to all platform locales if:
 *   - the document has no projectSlug (e.g. during creation)
 *   - no siteConfig exists for that project yet
 *   - the query fails for any reason
 *
 * Uses a module-level Promise cache so every localizedString field in
 * the same document shares one query rather than making N requests.
 * Cache lifetime is the browser session — refresh Studio to pick up
 * siteConfig changes.
 */

import { useEffect, useState } from 'react'
import { useClient, useFormValue } from 'sanity'
import { LOCALE_CODES, type SupportedLocale } from '@/lib/i18n/locales'

// Shared cache — keyed by projectSlug, value is a settled Promise<SupportedLocale[]>.
// Scoped to the module so all component instances in the same Studio session share it.
const cache = new Map<string, Promise<SupportedLocale[]>>()

function fetchLocalesForProject(
  client: ReturnType<typeof useClient>,
  projectSlug: string
): Promise<SupportedLocale[]> {
  if (!cache.has(projectSlug)) {
    const promise = client
      .fetch<SupportedLocale[] | null>(
        `*[_type == "siteConfig" && projectSlug == $slug && !(_id in path("drafts.**"))][0].supportedLocales`,
        { slug: projectSlug }
      )
      .then((res): SupportedLocale[] => {
        if (Array.isArray(res) && res.length > 0) return res
        return LOCALE_CODES
      })
      .catch((): SupportedLocale[] => LOCALE_CODES)

    cache.set(projectSlug, promise)
  }
  return cache.get(projectSlug)!
}

export function useProjectLocales(): {
  locales: SupportedLocale[]
  loading: boolean
} {
  const projectSlug = useFormValue(['projectSlug']) as string | undefined
  const client = useClient({ apiVersion: '2026-05-21' })

  // Start with all platform locales — safe default that prevents a blank flash.
  // Narrows to tenant-specific locales once the query resolves.
  const [locales, setLocales] = useState<SupportedLocale[]>(LOCALE_CODES)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!projectSlug) {
      setLocales(LOCALE_CODES)
      setLoading(false)
      return
    }

    setLoading(true)
    fetchLocalesForProject(client, projectSlug).then((resolved) => {
      setLocales(resolved)
      setLoading(false)
    })
  }, [projectSlug]) // eslint-disable-line react-hooks/exhaustive-deps
  // client intentionally omitted — useClient() returns a stable reference
  // and including it would re-run the effect on every render.

  return { locales, loading }
}
