'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale } from 'next-intl'
import type { DigitalCardPreviewBase } from '@/lib/api/digital-card-preview'
import type { DigitalCardLinkValue } from '@/lib/api/digital-cards'
import type { DigitalCardKind } from '@/lib/modules/digital-cards/model'
import { previewCardView } from '@/lib/modules/digital-cards/preview'
import { CARD_PREVIEW_ATTRIBUTE } from '@/lib/modules/digital-cards/preview-theme'
import { getDigitalCardPreviewAction } from '@/app/[locale]/(client)/[tenant]/cards/actions'
import { formatDigitalCardsMessage, getDigitalCardsMessages } from '@/lib/i18n/digital-cards-messages'
import { getDigitalCardSiteMessages } from '@/lib/i18n/digital-cards-site-messages'
import type { FocalPoint } from '@/components/app/ui/FocalPointPicker'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { Skeleton } from '@/components/app/ui/Skeleton'
import { DigitalCardView } from '@/components/digital-cards/DigitalCardView'

const H2 = 'text-[1.0625rem] leading-7 font-semibold text-foreground'

/**
 * The live preview of the Digital Card editor (ADR-049 Amendment A): the
 * card rendered by the website's own component (DigitalCardView) from what is
 * on screen — description, buttons, switches, background (with the focus
 * point being moved) — so what you see is what visitors see. The site's
 * design system is scoped to the frame (preview-theme.ts), never to the
 * dashboard. The frame is inert: nothing in it can be used or counted.
 *
 * What it reads (site, person, pages, files, background, design system) comes
 * from getDigitalCardPreviewAction, again only when the language, the
 * background or the set of files changes.
 */
export function DigitalCardPreview({
  projectSlug,
  id,
  kind,
  publicId,
  lang,
  languages,
  languageName,
  description,
  links,
  backgroundId,
  focal,
  show,
  urlName,
}: {
  projectSlug: string
  id: string
  kind: DigitalCardKind
  publicId: string
  /** The website language being edited — the preview follows it unless another one is picked above the preview. */
  lang: string
  /** Every language of the site, default first. */
  languages: readonly string[]
  languageName: (code: string) => string
  description: Record<string, string>
  links: readonly DigitalCardLinkValue[]
  backgroundId: string | null
  /** The background's focus point while it is being moved (null = as stored). */
  focal: FocalPoint | null
  show: unknown
  urlName: string
}) {
  const m = getDigitalCardsMessages(useLocale())
  const c = m.card
  // The preview's own language: follows the editing tab; a language picked
  // here holds until the editing tab changes again.
  const [picked, setPicked] = useState<{ editing: string; value: string } | null>(null)
  const previewLang = picked && picked.editing === lang && languages.includes(picked.value) ? picked.value : lang
  const fileIds = useMemo(() => [...new Set(links.flatMap((l) => [l.kind === 'file' ? l.file : null, l.logo]).filter((f): f is string => Boolean(f)))].sort(), [links])
  // Amendment B — page links may point at a catalogue target: its address and title are read too.
  const targetIds = useMemo(() => [...new Set(links.filter((l) => l.kind === 'page' && l.page).map((l) => l.page!))].sort(), [links])
  const key = `${previewLang}|${backgroundId ?? ''}|${fileIds.join(',')}|${targetIds.join(',')}`
  const [state, setState] = useState<{ key: string; base: DigitalCardPreviewBase } | 'failed' | null>(null)

  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      getDigitalCardPreviewAction({ projectSlug, id, locale: previewLang, backgroundId, fileIds, targetIds })
        .then((r) => live && setState(r.ok ? { key, base: r.preview } : 'failed'))
        .catch(() => live && setState('failed'))
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [projectSlug, id, previewLang, backgroundId, fileIds, targetIds, key])

  // The last data read stays on screen while the next one loads (no flashing).
  const base = state && state !== 'failed' ? state.base : null
  const siteMessages = getDigitalCardSiteMessages(previewLang)
  const view = useMemo(() => {
    if (!base) return null
    const withFocal =
      focal && base.background
        ? { ...base, background: { ...base.background, hotspot: { ...(base.background.hotspot ?? {}), x: focal.x, y: focal.y } } as typeof base.background }
        : base
    try {
      return previewCardView(kind, publicId, { description, links, backgroundId, show, urlName }, withFocal, siteMessages)
    } catch {
      return null
    }
  }, [base, focal, kind, publicId, description, links, backgroundId, show, urlName, siteMessages])
  const scope = id.replace(/[^A-Za-z0-9_-]/g, '')

  return (
    <Panel as="section" aria-labelledby="card-preview" className="space-y-3">
      <div className="space-y-2">
        <div>
          <h2 id="card-preview" className={H2}>
            {c.previewTitle}
          </h2>
          <p className="text-sm leading-5 text-muted-foreground">
            {c.previewHint} {formatDigitalCardsMessage(c.previewLanguage, { language: languageName(previewLang) })}
          </p>
        </div>
        {languages.length > 1 ? (
          <SegmentedControl
            label={c.previewLanguagePick}
            appearance="soft"
            value={previewLang}
            onChange={(value) => setPicked({ editing: lang, value })}
            options={languages.map((l) => ({ value: l, label: l.toUpperCase() }))}
          />
        ) : null}
      </div>
      {state === 'failed' && !base ? (
        <Notice tone="error">{c.previewFailed}</Notice>
      ) : !base ? (
        <div aria-busy="true" aria-label={c.previewLoading}>
          <Skeleton shape="block" className="mx-auto h-[36rem] w-full max-w-[22rem]" />
        </div>
      ) : !view ? (
        <Notice tone="info">{c.previewNoPerson}</Notice>
      ) : (
        <div className="mx-auto w-full max-w-[22rem] overflow-hidden rounded-[2rem] border border-border shadow-sm">
          {/* The site's design system, scoped to this frame only. */}
          <style>{base.theme.css}</style>
          {base.theme.fontsUrl ? <link rel="stylesheet" href={base.theme.fontsUrl} /> : null}
          <div
            {...{ [CARD_PREVIEW_ATTRIBUTE]: scope }}
            tabIndex={0}
            role="region"
            aria-label={c.previewTitle}
            className="relative h-[36rem] overflow-y-auto overscroll-contain focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:h-[40rem]"
          >
            <div inert className="min-h-full">
              <DigitalCardView view={view} messages={siteMessages} legalLinks={[]} projectSlug={projectSlug} countable={false} motion={base.motion} preview />
            </div>
          </div>
        </div>
      )}
    </Panel>
  )
}
