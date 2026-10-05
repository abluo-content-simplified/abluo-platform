'use client'

import { useMemo } from 'react'
import type { LinkTools } from '@/components/client/editor/BodyEditor'
import { searchLinkTargetsAction } from '@/app/[locale]/(client)/[tenant]/posts/link-actions'
import { siteHostsForProject } from '@/lib/links/link-target'

/** Link sheet tools for one site and content language: own hosts + "A page on your site" search. */
export function useLinkTools(projectSlug: string, locale: string | null): LinkTools | undefined {
  return useMemo<LinkTools | undefined>(() => {
    if (!locale) return undefined
    const call = async (input: { query?: string; ids?: string[] }) => {
      const res = await searchLinkTargetsAction({ projectSlug, locale, ...input })
      return res.ok ? res.results : null
    }
    return {
      siteHosts: siteHostsForProject(projectSlug),
      searchPages: (query) => call({ query }),
      describePages: (ids) => call({ ids }),
    }
  }, [projectSlug, locale])
}
