'use client'

import { useState } from 'react'
import { DocumentActionComponent, DocumentActionProps, useClient, useDocumentOperation } from 'sanity'
import { PublishIcon } from '@sanity/icons'
import { clearLocalesCache } from '@/lib/sanity/fields/useProjectLocales'

/**
 * AutoCreateSiteConfigAction
 *
 * Replaces the built-in Publish action on `project` documents.
 *
 * On publish of a linked project it idempotently bootstraps a minimal
 * `siteConfig` document — if one does not already exist — seeded from
 * the project's `defaultLocale` field. This prevents:
 *   - the "seven languages" issue caused by useProjectLocales falling back
 *     to all platform locales when no siteConfig is found
 *   - the "missing Settings" entry in the Studio sidebar
 *
 * Idempotency: checks for an existing published siteConfig with the same
 * projectSlug before creating. Safe to click Publish multiple times.
 *
 * Cache invalidation: calls clearLocalesCache() so the newly created
 * siteConfig is picked up by useProjectLocales on the next render without
 * requiring a Studio reload.
 */
export const AutoCreateSiteConfigAction: DocumentActionComponent = (
  props: DocumentActionProps
) => {
  const { id, type, draft, published, onComplete } = props
  const { publish } = useDocumentOperation(id, type)
  const client = useClient({ apiVersion: '2026-05-21' })
  const [busy, setBusy] = useState(false)

  // Read from draft first (user may have just changed defaultLocale),
  // fall back to published if there is no draft.
  const doc = draft ?? published
  const projectSlug = doc?.projectSlug as string | undefined
  const defaultLocale = (doc?.defaultLocale as string | undefined) ?? 'en'

  return {
    label: busy ? 'Publishing…' : 'Publish',
    icon: PublishIcon,
    // Mirrors the disabled logic of the built-in Publish action
    disabled: !draft || !!publish.disabled || busy,
    tone: 'positive',
    onHandle: async () => {
      setBusy(true)
      try {
        // 1. Execute the standard publish operation
        publish.execute()

        // 2. Idempotently bootstrap siteConfig if this project is linked
        if (projectSlug) {
          const existingId = await client.fetch<string | null>(
            `*[_type == "siteConfig" && projectSlug == $slug && !(_id in path("drafts.**"))][0]._id`,
            { slug: projectSlug }
          )

          if (!existingId) {
            await client.create({
              _type: 'siteConfig',
              projectSlug,
              defaultLocale,
              supportedLocales: [defaultLocale],
            })
            // Bust the module-level cache so the next useProjectLocales
            // call fetches the real supportedLocales instead of falling
            // back to all 7 platform locales.
            clearLocalesCache(projectSlug)
          }
        }

        onComplete()
      } catch (err) {
        console.error('[AutoCreateSiteConfigAction]', err)
        setBusy(false)
      }
    },
  }
}
