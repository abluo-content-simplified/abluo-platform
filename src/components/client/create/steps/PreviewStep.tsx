'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import type { StepProps } from '@/components/client/create/types'
import { PreviewPane } from '@/components/client/create/PreviewPane'
import { hasText } from '@/lib/client/wizard-steps'
import { draftPreviewUrl } from '@/lib/client/preview-url'
import { mintDraftPreviewAction } from '@/app/[locale]/(client)/[tenant]/posts/preview-actions'

/**
 * "Here's how your post will look" — the shared PreviewPane on the post draft
 * (languages with content; the last edits are saved before the link is minted).
 */
export function PreviewStep({ draft, site, flush }: StepProps) {
  const t = useTranslations('clientDashboard.create.preview')
  const withContent = site.languages.filter((l) => draft.title[l]?.trim() || hasText(draft.body[l]))
  const mint = useCallback(async () => {
    // The preview reads the saved draft: make sure the last edits are saved.
    if (flush) await flush()
    return mintDraftPreviewAction({
      projectSlug: site.projectSlug,
      id: draft.id,
    })
  }, [flush, site.projectSlug, draft.id])

  return (
    <PreviewPane
      title={t('title')}
      helper={t('helper')}
      languages={withContent}
      defaultLocale={site.defaultLocale}
      mint={mint}
      buildSrc={(link, locale, theme) =>
        draftPreviewUrl({
          origin: link.origin,
          locale,
          projectSlug: link.projectSlug,
          id: draft.id,
          token: link.token,
          theme,
        })
      }
    />
  )
}
