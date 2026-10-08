'use client'

import { useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import {
  deleteGalleryAction,
  discardGalleryDraftAction,
  getGalleryAction,
  openGalleryForEditAction,
  patchGalleryDraftAction,
  publishGalleryDraftAction,
} from '@/app/[locale]/(client)/[tenant]/galleries/actions'
import { mintGalleryPreviewAction } from '@/app/[locale]/(client)/[tenant]/galleries/preview-actions'
import type { GalleryPhoto, GallerySnapshot } from '@/lib/api/gallery-drafts'
import type { GalleryStatus } from '@/lib/api/gallery-status'
import { usagePlaces } from '@/lib/client/gallery-editor'
import { photoNeedsAlt } from '@/lib/client/gallery-wizard'
import { draftPreviewUrl } from '@/lib/client/preview-url'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { AutoGrid } from '@/components/app/ui/list/AutoGrid'
import { Chips, MediaFrame, Pill } from '@/components/app/ui/list/cells'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { GALLERY_ICONS } from './gallery-bits'
import { GalleryStatusLines } from './GalleryStatusLines'

const PUBLISH_ERRORS = ['empty', 'conflict', 'offline', 'forbidden', 'failed']
type Confirm = 'discard' | 'delete'

const BUTTON =
  'inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-border px-4 text-[0.9375rem] font-semibold text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40'
const PRIMARY =
  'inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-action px-4 text-[0.9375rem] font-semibold text-action-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-40'

/**
 * One gallery's page (client dashboard · galleries/<id>), in the shared page
 * frame: PageHeader (title · Preview · Edit gallery · Save when there are
 * unpublished changes · ⋯ Discard / Delete), where it is shown, and EVERY
 * photo as a grid.
 *
 * Main image: "Set as main image" on a photo's ⋯ saves `mainImage` on the
 * gallery's draft (patchGalleryDraft checks it is one of the gallery's own
 * photos); it then leads the gallery's cards and strips. None chosen = the
 * first photo. Like any change it is published with Save.
 *
 * Editing (title, photos and their order, descriptions, languages) happens in
 * the gallery wizard (`/edit`, a full-screen flow), opened straight on the
 * right part; "Done" comes back here.
 */
export function GalleryDetail({
  projectSlug,
  initial,
  status,
  canDelete,
}: {
  projectSlug: string
  /** The gallery as getGalleryDraft returns it (the draft when there is one). */
  initial: GallerySnapshot
  status: GalleryStatus | null
  /** Owner holding gallery delete (the server re-checks). */
  canDelete: boolean
}) {
  const t = useTranslations('clientDashboard.gallery.detail')
  const tg = useTranslations('clientDashboard.gallery')
  const tl = useTranslations('clientDashboard.gallery.list')
  const tp = useTranslations('clientDashboard.gallery.photo.grid')
  const ui = useLocale()
  const router = useRouter()
  const d = initial.site.defaultLocale
  const id = initial.id
  const base = `/${projectSlug}/galleries`
  const editHref = (query = '') => `${base}/${id}/edit${query}`

  const [mainImage, setMainImage] = useState<string | null>(initial.mainImage)
  const [hasDraft, setHasDraft] = useState(initial.hasDraft)
  const [isLive, setIsLive] = useState(Boolean(initial.live))
  const revRef = useRef(initial.rev)
  const [busy, setBusy] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const { toast, show } = useUndo()

  const items = initial.items
  const title = initial.title[d]?.trim() || initial.internalName || tl('untitled')
  const description = initial.description[d]?.trim()
  const lead = mainImage && items.some((p) => p.assetId === mainImage) ? mainImage : null
  const nameOf = (p: GalleryPhoto, n: number) => p.name || p.alt[d]?.trim() || tp('photoN', { n: n + 1 })

  /** The draft's revision; a published gallery's first change opens its draft (an exact copy) first. */
  async function draftRev(): Promise<string> {
    if (hasDraft && revRef.current) return revRef.current
    const opened = await openGalleryForEditAction({ projectSlug, id })
    if (!opened.ok) throw new Error(opened.error)
    const fresh = await getGalleryAction({ projectSlug, id })
    if (!fresh.ok || !fresh.gallery.rev) throw new Error(fresh.ok ? 'failed' : fresh.error)
    revRef.current = fresh.gallery.rev
    setHasDraft(true)
    return fresh.gallery.rev
  }

  async function chooseMain(assetId: string | null) {
    if (busy) return
    setBusy(true)
    try {
      const rev = await draftRev()
      const r = await patchGalleryDraftAction({ projectSlug, id, rev, set: { mainImage: assetId } })
      if (!r.ok) throw new Error(r.error)
      revRef.current = r.rev
      setMainImage(assetId)
      show({ message: assetId ? t('main.saved') : t('main.cleared'), tone: 'status' })
      router.refresh()
    } catch {
      show({ message: t('main.failed'), tone: 'error' }, 7000)
    } finally {
      setBusy(false)
    }
  }

  async function publish() {
    if (busy || !hasDraft) return
    setBusy(true)
    setPublishing(true)
    try {
      const r = await publishGalleryDraftAction({ projectSlug, id, rev: revRef.current })
      if (!r.ok) {
        const code = PUBLISH_ERRORS.includes(r.error) ? r.error : 'failed'
        return show({ message: tg(`publish.errors.${code}`), tone: 'error' }, 8000)
      }
      revRef.current = ''
      setHasDraft(false)
      setIsLive(true)
      show({ message: t('saved'), tone: 'status' })
      router.refresh()
    } catch {
      show({ message: tg(`publish.errors.${typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'failed'}`), tone: 'error' }, 8000)
    } finally {
      setBusy(false)
      setPublishing(false)
    }
  }

  const preview = async () => {
    const tab = window.open('about:blank', '_blank')
    if (tab) tab.opener = null
    try {
      const r = await mintGalleryPreviewAction({ projectSlug, id })
      if (!r.ok) throw new Error(r.error)
      const url = draftPreviewUrl({ origin: r.origin, locale: ui, projectSlug: r.projectSlug, id, token: r.token, kind: 'gallery' })
      if (tab) tab.location.href = url
      else window.location.assign(url)
    } catch {
      tab?.close()
      show({ message: t('previewFailed'), tone: 'error' })
    }
  }

  async function runConfirm() {
    if (!confirm || confirmBusy) return
    setConfirmBusy(true)
    setConfirmError(null)
    try {
      if (confirm === 'discard') {
        const r = await discardGalleryDraftAction({ projectSlug, id, rev: revRef.current })
        if (!r.ok) return setConfirmError(tg('confirm.failed'))
        window.location.reload()
        return
      }
      const r = await deleteGalleryAction({ projectSlug, id })
      if (!r.ok) {
        const where = usagePlaces(r.detail?.usedIn)
        return setConfirmError(r.error === 'in_use' && where ? tg('confirm.inUse', { places: where }) : tg('confirm.failed'))
      }
      router.push(base)
    } catch {
      setConfirmError(tg('confirm.failed'))
    } finally {
      setConfirmBusy(false)
    }
  }

  const menu: CardMenuItem[] = [
    { key: 'edit', label: t('edit'), onSelect: () => router.push(editHref()) },
    { key: 'preview', label: t('preview'), onSelect: () => void preview() },
    ...(hasDraft && isLive ? [{ key: 'discard', label: tg('menu.discard'), onSelect: () => setConfirm('discard') }] : []),
    ...(canDelete ? [{ key: 'delete', label: tg('menu.delete'), onSelect: () => setConfirm('delete'), destructive: true }] : []),
  ]

  const photoMenu = (p: GalleryPhoto): CardMenuItem[] => [
    ...(p.missing
      ? []
      : p.assetId === lead
        ? [{ key: 'unset', label: t('main.unset'), onSelect: () => void chooseMain(null) }]
        : [{ key: 'set', label: t('main.set'), onSelect: () => void chooseMain(p.assetId) }]),
    { key: 'describe', label: t('describePhoto'), onSelect: () => router.push(editHref(`?section=describe&photo=${encodeURIComponent(p.key)}`)) },
  ]

  return (
    <div className="space-y-5">
      <Link
        href={base}
        className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {GALLERY_ICONS.back}
        {t('back')}
      </Link>
      <div className="-mt-3">
        <PageHeader
          title={title}
          actions={
            <>
              <button type="button" onClick={() => void preview()} className={`${BUTTON} hidden md:inline-flex`}>
                {GALLERY_ICONS.eye}
                {t('preview')}
              </button>
              <Link href={editHref()} className={`${BUTTON} hidden md:inline-flex`}>
                {GALLERY_ICONS.pencil}
                {t('edit')}
              </Link>
              {hasDraft ? (
                <button type="button" disabled={busy || items.length === 0} onClick={() => void publish()} className={PRIMARY}>
                  {publishing ? tg('wizard.saving') : tg('wizard.save')}
                </button>
              ) : null}
              <CardMenu label={tg('menu.label')} items={menu} />
            </>
          }
        />
      </div>

      <div className="flex flex-col items-start gap-2">
        {hasDraft ? <Pill tone={isLive ? 'highlight' : 'outline'}>{isLive ? t('changesNotice') : t('draftNotice')}</Pill> : null}
        {description ? <p className="max-w-prose text-[0.9375rem] leading-6 text-foreground">{description}</p> : null}
        {status ? <GalleryStatusLines status={status} /> : null}
        {initial.tags.length ? <Chips items={initial.tags} /> : null}
      </div>

      <section aria-labelledby="gallery-photos-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="gallery-photos-title" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
              {t('photosTitle')} <span className="font-normal text-muted-foreground tabular-nums">· {items.length}</span>
            </h2>
            {items.length ? <p className="text-sm leading-5 text-muted-foreground">{lead ? t('main.chosen') : t('main.auto')}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {items.length ? (
              <Link href={editHref('?section=describe')} className={BUTTON}>
                {t('describe')}
              </Link>
            ) : null}
            <Link href={editHref('?section=photos')} className={BUTTON}>
              {GALLERY_ICONS.plus}
              {t('editPhotos')}
            </Link>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-6 py-10">
            <p className="font-medium text-foreground">{t('noPhotos')}</p>
          </div>
        ) : (
          <AutoGrid density="large" label={t('photosTitle')} className="gap-3">
            {items.map((p, n) => {
              const name = nameOf(p, n)
              const isMain = p.assetId === lead
              return (
                <li key={p.key} className="min-w-0">
                  <div className={`group relative aspect-square overflow-hidden rounded-xl border bg-muted ${isMain ? 'border-action ring-1 ring-action' : 'border-border'}`}>
                    <Link
                      href={editHref(`?section=describe&photo=${encodeURIComponent(p.key)}`)}
                      aria-label={tp('editPhoto', { name })}
                      className="absolute inset-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <MediaFrame src={p.missing ? null : p.thumbUrl} alt="" focal={p.focal} className="absolute inset-0 size-full" />
                    </Link>
                    {isMain ? (
                      <span className="pointer-events-none absolute top-2 left-2">
                        <Pill tone="highlight" icon={GALLERY_ICONS.star}>
                          {tl('mainBadge')}
                        </Pill>
                      </span>
                    ) : null}
                    <span className="absolute top-2 right-2">
                      <CardMenu variant="chip" label={t('photoMenu', { name })} items={photoMenu(p)} />
                    </span>
                  </div>
                  <p className="mt-1.5 truncate text-sm leading-5 text-foreground" title={name}>
                    {name}
                  </p>
                  {p.missing ? (
                    <p className="text-xs leading-5 text-destructive">{tp('missing')}</p>
                  ) : photoNeedsAlt(p, d) ? (
                    <p className="text-xs leading-5 text-muted-foreground">{tp('needsDescriptionShort')}</p>
                  ) : null}
                </li>
              )
            })}
          </AutoGrid>
        )}
      </section>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'delete' ? tg('confirm.deleteTitle') : tg('confirm.discardTitle')}
        body={confirm === 'delete' ? tg('confirm.deleteBody', { title }) : tg('confirm.discardBody')}
        confirmLabel={confirm === 'delete' ? tg('confirm.delete') : tg('confirm.discard')}
        busy={confirmBusy}
        error={confirmError}
        onConfirm={() => void runConfirm()}
        onCancel={() => {
          setConfirm(null)
          setConfirmError(null)
        }}
      />

      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </div>
  )
}
