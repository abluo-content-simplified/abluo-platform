'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { recipientSiteAction } from '@/app/[locale]/(admin)/messages/message-actions'
import { AttachmentPicker } from '@/components/app/ui/AttachmentPicker'
import { MediaLibraryPicker } from '@/components/client/media/MediaLibraryPicker'
import { thumbOf } from '@/components/client/media/media-api'
import { MESSAGE_FILE_TYPES, MESSAGE_LIMITS, isPageLink, type StoredLink } from '@/lib/messages/model'
import type { LibraryPick } from '@/lib/messages/library'
import type { SitePageOption } from '@/lib/messages/site-pages'
import { LinkChooser } from './LinkChooser'

export type MessageExtrasValue = { files: File[]; library: LibraryPick[]; links: StoredLink[] }
export const EMPTY_EXTRAS: MessageExtrasValue = { files: [], library: [], links: [] }

type Site = { slug: string; defaultLocale: string; pages: SitePageOption[] }

/**
 * Everything a message can carry besides its text (ADR-050 D4/D5), the same
 * in New Message and in a reply — "the usual process":
 * - files: Upload (or paste a screenshot), or From Media Library;
 * - links: a dashboard destination or a page of the website.
 *
 * Media Library and website pages belong to one site. `projectId` is that
 * site; null when the recipients are on several sites (or none yet) — those
 * two then stay disabled and say why.
 */
export function MessageExtras({
  projectId,
  noSiteReason,
  linkTargets,
  value,
  onChange,
  disabled = false,
}: {
  projectId: string | null
  /** Why Media Library and website pages are unavailable when `projectId` is null. */
  noSiteReason: string
  linkTargets: string[]
  value: MessageExtrasValue
  onChange: (next: MessageExtrasValue) => void
  disabled?: boolean
}) {
  const tc = useTranslations('app.messages')
  const t = useTranslations('admin.messages.extras')
  const [site, setSite] = useState<{ projectId: string; site: Site | null } | null>(null)
  const [picking, setPicking] = useState(false)
  const mb = Math.round(MESSAGE_LIMITS.imageBytesMax / (1024 * 1024))

  useEffect(() => {
    if (!projectId) return
    let live = true
    void recipientSiteAction(projectId).then((s) => {
      if (live) setSite({ projectId, site: s })
    })
    return () => {
      live = false
    }
  }, [projectId])

  // Library pictures and website pages belong to the site they were chosen on: drop them when it changes.
  const lastSite = useRef(projectId)
  useEffect(() => {
    if (lastSite.current === projectId) return
    lastSite.current = projectId
    if (value.library.length || value.links.some(isPageLink)) onChange({ ...value, library: [], links: value.links.filter((l) => !isPageLink(l)) })
  }, [projectId, value, onChange])

  const current = projectId && site?.projectId === projectId ? site.site : null
  const loading = Boolean(projectId) && site?.projectId !== projectId
  const why = !projectId ? noSiteReason : loading ? t('loading') : !current ? t('siteUnavailable') : null
  const reason = why ? t('libraryWhy', { reason: why }) : null
  const room = MESSAGE_LIMITS.attachmentsMax - value.files.length - value.library.length

  return (
    <>
      <AttachmentPicker
        acceptPaste
        files={value.files}
        onChange={(files) => onChange({ ...value, files })}
        extra={value.library.map((p) => ({ key: p.url, src: thumbOf(p.url) ?? p.url, name: p.name || t('libraryPicture') }))}
        onRemoveExtra={(key) => onChange({ ...value, library: value.library.filter((p) => p.url !== key) })}
        secondaryAction={{ label: t('fromLibrary'), onClick: () => setPicking(true), disabled: !current }}
        max={MESSAGE_LIMITS.attachmentsMax}
        maxBytes={MESSAGE_LIMITS.imageBytesMax}
        accept={MESSAGE_FILE_TYPES}
        disabled={disabled}
        labels={{
          add: tc('picker.add'),
          hint: [tc('picker.hint', { max: MESSAGE_LIMITS.attachmentsMax, size: mb }), reason].filter(Boolean).join(' '),
          remove: (name) => tc('picker.remove', { name }),
          problem: (p) => tc(`picker.problem.${p.kind}`, { name: p.name, size: mb, max: MESSAGE_LIMITS.attachmentsMax }),
        }}
      />
      <LinkChooser targets={linkTargets} pages={current ? current.pages : null} pagesReason={reason} value={value.links} onChange={(links) => onChange({ ...value, links })} disabled={disabled} />
      {picking && current ? (
        <MediaLibraryPicker
          projectSlug={current.slug}
          scope="admin"
          defaultLocale={current.defaultLocale}
          exclude={[]}
          room={Math.max(0, room)}
          onClose={() => setPicking(false)}
          onAdd={(photos) => {
            setPicking(false)
            const add = photos.filter((ph) => !value.library.some((x) => x.url === ph.url)).map((ph) => ({ url: ph.url, name: ph.name ?? '' }))
            onChange({ ...value, library: [...value.library, ...add].slice(0, MESSAGE_LIMITS.attachmentsMax - value.files.length) })
          }}
        />
      ) : null}
    </>
  )
}
