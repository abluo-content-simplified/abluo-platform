'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { deletePostDraftAction, discardPostChangesAction } from '@/app/[locale]/(client)/[tenant]/posts/lifecycle-actions'
import { mintDraftPreviewAction } from '@/app/[locale]/(client)/[tenant]/posts/preview-actions'
import { deleteGalleryAction, discardGalleryDraftAction, getGalleryAction } from '@/app/[locale]/(client)/[tenant]/galleries/actions'
import { mintGalleryPreviewAction } from '@/app/[locale]/(client)/[tenant]/galleries/preview-actions'
import { draftPreviewUrl } from '@/lib/client/preview-url'
import { segmentFills } from '@/lib/client/home-cards'
import { CardMenu } from '@/components/app/ui/CardMenu'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'

/** One "Continue editing" card, prepared on the server. */
export type DraftCard = {
  kind: 'post' | 'gallery'
  id: string
  /** Draft revision (posts; galleries read theirs when needed). */
  rev: string
  title: string
  thumb: string | null
  /** "Draft · You were on “Tell your story” · 2 h ago". */
  meta: string
  /** Optional topics line under the title. */
  topics: string | null
  /** 0…1, shown as four segments. */
  progress: number
  href: string
  /** A published version exists: the menu offers "Discard changes", never Delete. */
  hasLive: boolean
  /** May delete (unpublished galleries need the owner; post drafts any writer). */
  canDelete: boolean
  /** Site language to preview in. */
  previewLocale: string
}

/**
 * Home · "Continue editing" (canvas Main): draft cards with a 96px thumbnail,
 * meta line, 4-segment progress and Continue — plus a ⋯ menu (Continue
 * editing · Preview · Delete for never-published drafts / Discard changes
 * for changes to something live). Delete and Discard wait five seconds behind
 * "Deleted · Undo" before the server is asked; Discard only removes the
 * draft, the live version stays exactly as it is.
 */
export function ContinueEditing({
  projectSlug,
  cards,
  layout = 'stack',
}: {
  projectSlug: string
  cards: DraftCard[]
  /** 'grid' puts two cards per row on desktop (when the block has the full width). */
  layout?: 'stack' | 'grid'
}) {
  const t = useTranslations('clientDashboard.home')
  const ui = useLocale()
  const router = useRouter()
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const { toast, show, schedule } = useUndo()
  const key = (c: DraftCard) => `${c.kind}:${c.id}`
  const visible = cards.filter((c) => !hidden.has(key(c)))

  const preview = async (c: DraftCard) => {
    // Open the tab now (a user gesture), fill it once the private link exists.
    const tab = window.open('about:blank', '_blank')
    if (tab) tab.opener = null
    try {
      const r = c.kind === 'post' ? await mintDraftPreviewAction({ projectSlug, id: c.id }) : await mintGalleryPreviewAction({ projectSlug, id: c.id })
      if (!r.ok) throw new Error(r.error)
      const url = draftPreviewUrl({ origin: r.origin, locale: c.previewLocale || ui, projectSlug: r.projectSlug, id: c.id, token: r.token, kind: c.kind })
      if (tab) tab.location.href = url
      else window.location.assign(url)
    } catch {
      tab?.close()
      show({ message: t('menu.previewFailed'), tone: 'error' })
    }
  }

  const remove = (c: DraftCard) => {
    const k = key(c)
    setHidden((s) => new Set(s).add(k))
    schedule({
      id: k,
      message: c.hasLive ? t('menu.discarded') : t('menu.deleted'),
      undoLabel: t('menu.undo'),
      failMessage: t('menu.failed'),
      restore: () =>
        setHidden((s) => {
          const n = new Set(s)
          n.delete(k)
          return n
        }),
      run: async () => {
        if (c.kind === 'post') {
          const action = c.hasLive ? discardPostChangesAction : deletePostDraftAction
          const r = await action({ projectSlug, id: c.id, rev: c.rev })
          if (r.ok) router.refresh()
          return r.ok
        }
        if (c.hasLive) {
          const g = await getGalleryAction({ projectSlug, id: c.id })
          if (!g.ok || !g.gallery.rev) return false
          const r = await discardGalleryDraftAction({ projectSlug, id: c.id, rev: g.gallery.rev })
          if (r.ok) router.refresh()
          return r.ok
        }
        const r = await deleteGalleryAction({ projectSlug, id: c.id })
        if (r.ok) router.refresh()
        return r.ok
      },
    })
  }

  if (!visible.length && !toast) return null
  return (
    <section aria-labelledby="continue-editing" className="flex flex-col gap-3">
      {visible.length ? <SectionHeading id="continue-editing" title={t('continueEditing')} /> : null}
      <div className={`grid grid-cols-1 items-start gap-3 ${layout === 'grid' ? 'lg:grid-cols-2' : ''}`}>
      {visible.map((c) => (
        <div key={key(c)} className="flex items-start gap-4 rounded-xl border border-border bg-card p-3">
          {c.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- Sanity CDN thumbnail, already sized
            <img src={c.thumb} alt="" width={96} height={96} loading="lazy" className="size-24 shrink-0 rounded-lg bg-muted object-cover" />
          ) : (
            <div
              role="img"
              aria-label={t('noCover')}
              className="flex size-24 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-muted text-muted-foreground"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" className="fill-none stroke-current stroke-[1.5]">
                {c.kind === 'gallery' ? (
                  <path d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01" />
                ) : (
                  <>
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
                  </>
                )}
              </svg>
              <span className="text-[0.6875rem] font-medium">{t('noCoverShort')}</span>
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-start gap-1">
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-xs leading-4 font-medium text-muted-foreground">{t(c.kind === 'gallery' ? 'kind.gallery' : 'kind.post')}</p>
                <p className="mt-0.5 line-clamp-2 text-[0.9375rem] leading-[1.375rem] font-semibold">{c.title}</p>
                {c.topics ? <p className="mt-0.5 truncate text-sm font-medium text-foreground/80">{c.topics}</p> : null}
                <p className="mt-0.5 text-sm leading-5 text-muted-foreground">{c.meta}</p>
              </div>
              <div className="-mt-1 -mr-1">
                <CardMenu
                  label={t('menu.label', { title: c.title })}
                  items={[
                    { key: 'continue', label: t('menu.continue'), onSelect: () => router.push(c.href) },
                    { key: 'preview', label: t('menu.preview'), onSelect: () => void preview(c) },
                    ...(c.hasLive
                      ? [{ key: 'discard', label: t('menu.discard'), onSelect: () => remove(c), destructive: true }]
                      : c.canDelete
                        ? [{ key: 'delete', label: t('menu.delete'), onSelect: () => remove(c), destructive: true }]
                        : []),
                  ]}
                />
              </div>
            </div>
            <div className="flex gap-1" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c.progress * 100)} aria-label={t('progress')}>
              {segmentFills(c.progress).map((f, i) => (
                <span key={i} className="h-1 flex-1 overflow-hidden bg-border">
                  <span className="block h-full bg-foreground" style={{ width: `${f * 100}%` }} />
                </span>
              ))}
            </div>
            <Link
              href={c.href}
              className="inline-flex h-11 items-center self-start rounded-md bg-action px-4 text-[0.9375rem] font-semibold text-action-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t('continueEditing')}
            </Link>
          </div>
        </div>
      ))}
      </div>
      <Toast message={toast?.message ?? null} tone={toast?.tone} action={toast?.undo ? t('menu.undo') : undefined} onAction={toast?.undo} />
    </section>
  )
}
