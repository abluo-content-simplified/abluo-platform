'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { ChoiceCard, ChoiceCardGrid } from '@/components/app/ui/ChoiceCard'
import { Fab } from '@/components/app/ui/Fab'
import type { CreateMenu } from '@/lib/modules/create-menu'

/**
 * Add content → "What would you like to create?" (ADR-025 D8 · the Type step).
 *
 * Cards come from the project's installed content modules (`buildCreateMenu`,
 * computed on the server), shown as ChoiceCards (icon + label). Blog post and
 * Gallery are actionable: they open their wizard with NO document yet (lazy
 * creation — the first real content creates the draft, so closing early
 * leaves nothing behind). "Add to media library" (owner/editor) opens the
 * media wizard. Other installed types say "Coming soon". Owners also see
 * "More you can add to your site", which only explains and offers
 * "Ask us to add it" — it is never a choice in itself.
 *
 * Motion: a full-screen transparent native dialog holding a dimmed, slightly
 * blurred backdrop and a glass panel that slides up from the bottom (280ms
 * ease-out, translate-y + opacity) and back down on close; reduced motion
 * skips the slide. When `fab` is given, a copy of the FAB sits above the
 * panel (inside the dialog, so above it in the top layer) at the same spot,
 * its "+" turned 45° into an ×; tapping it closes the panel.
 */
const SLIDE_MS = 280

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function AddContentSheet({
  open,
  onClose,
  projectSlug,
  menu,
  contactEmail,
  mediaLibrary = false,
  fab = null,
}: {
  open: boolean
  onClose: () => void
  projectSlug: string
  menu: CreateMenu
  /** Abluo contact for "Ask us to add it"; when absent the sheet shows a hint instead. */
  contactEmail?: string | null
  /** Show "Add to media library" (owner/editor). */
  mediaLibrary?: boolean
  /** Show the FAB above the panel (as ×) — when the page has one. */
  fab?: { label: string; closeLabel: string } | null
}) {
  const t = useTranslations('clientDashboard.create.type')
  const router = useRouter()
  const ref = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState<string | null>(null)
  /** Drives the slide / fade / rotation: true one frame after the dialog opens, false before it closes. */
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open) {
      if (!d.open) {
        setError(null)
        setAsking(null)
        d.showModal()
      }
      const raf = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(raf)
    }
    if (d.open) {
      setShown(false)
      const id = setTimeout(() => d.close(), reducedMotion() ? 0 : SLIDE_MS)
      return () => clearTimeout(id)
    }
  }, [open])

  /** Opens the wizard with NO document yet (lazy creation). */
  function start(moduleId: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    router.push(
      moduleId === 'gallery'
        ? `/${projectSlug}/galleries/new`
        : moduleId === 'media'
          ? `/${projectSlug}/media/add`
          : `/${projectSlug}/posts/write/new`
    )
    onClose()
    setBusy(false)
  }

  const askHref = (moduleId: string) =>
    contactEmail
      ? `mailto:${contactEmail}?subject=${encodeURIComponent(t('askSubject', { module: t(`items.${moduleId}`), project: projectSlug }))}`
      : null

  const motion = 'transition-[opacity,transform] duration-[280ms] ease-out motion-reduce:transition-none'

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        // Escape: slide down first, then close (the effect closes the dialog).
        e.preventDefault()
        onClose()
      }}
      aria-labelledby="add-sheet-title"
      data-surface="create"
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 text-foreground backdrop:bg-transparent"
    >
      <div aria-hidden="true" onClick={onClose} className={`absolute inset-0 bg-scrim backdrop-blur-sm ${motion} ${shown ? 'opacity-100' : 'opacity-0'}`} />
      <div
        className={`absolute inset-x-0 bottom-0 mx-auto max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border-t border-border bg-background/80 p-6 backdrop-blur-xl ${
          fab ? 'pb-[calc(9.5rem+env(safe-area-inset-bottom))]' : 'pb-[max(1.5rem,env(safe-area-inset-bottom))]'
        } md:pb-[max(1.5rem,env(safe-area-inset-bottom))] ${motion} ${shown ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'}`}
      >
        {asking ? (
          <div>
            <h2 id="add-sheet-title" className="text-2xl font-semibold tracking-tight">
              {t(`items.${asking}`)}
            </h2>
            <p className="mt-2 text-[1.0625rem] leading-7 text-muted-foreground">{t(`desc.${asking}`)}</p>
            <p className="mt-2 text-[0.9375rem] leading-6 text-muted-foreground">{t('moreHelper')}</p>
            {askHref(asking) ? (
              <a
                href={askHref(asking)!}
                className="mt-6 flex h-14 w-full items-center justify-center rounded-xl bg-action text-[1.0625rem] font-semibold text-action-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {t('ask')}
              </a>
            ) : (
              <p className="mt-6 rounded-xl bg-muted p-4 text-[0.9375rem] leading-6 text-muted-foreground">{t('askUnavailable')}</p>
            )}
            <button
              type="button"
              onClick={() => setAsking(null)}
              className="mt-3 h-12 w-full rounded-xl text-[0.9375rem] font-semibold text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t('close')}
            </button>
          </div>
        ) : (
          <div>
            <h2 id="add-sheet-title" className="text-2xl font-semibold tracking-tight">
              {t('title')}
            </h2>
            <p className="mt-2 text-[1.0625rem] leading-7 text-muted-foreground">{t('helper')}</p>

            {menu.available.length === 0 && !mediaLibrary ? (
              <p className="mt-6 text-[0.9375rem] text-muted-foreground">{t('nothing')}</p>
            ) : (
              <ChoiceCardGrid label={t('title')} className="mt-6">
                {menu.available.map((item) => (
                  <ChoiceCard
                    key={item.moduleId}
                    icon={<TypeIcon moduleId={item.moduleId} />}
                    label={t(`items.${item.moduleId}`)}
                    disabled={!item.ready || busy}
                    busy={item.ready && busy}
                    badge={item.ready ? undefined : t('soon')}
                    onSelect={item.ready ? () => start(item.moduleId) : undefined}
                  />
                ))}
                {mediaLibrary ? (
                  <ChoiceCard icon={<TypeIcon moduleId="media" />} label={t('items.media')} disabled={busy} onSelect={() => start('media')} />
                ) : null}
              </ChoiceCardGrid>
            )}

            <p role="alert" className="mt-3 min-h-5 text-sm text-destructive">
              {error}
            </p>

            {menu.more.length > 0 ? (
              <section aria-labelledby="add-sheet-more" className="mt-4 border-t border-border-subtle pt-5">
                <h3 id="add-sheet-more" className="text-[0.9375rem] font-semibold text-foreground">
                  {t('more')}
                </h3>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {menu.more.map((moduleId) => (
                    <li key={moduleId}>
                      <button
                        type="button"
                        onClick={() => setAsking(moduleId)}
                        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-[0.9375rem] text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {t(`items.${moduleId}`)}
                        <span className="text-sm text-muted-foreground">{t('add')}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <button
              type="button"
              onClick={onClose}
              className="mt-6 h-12 w-full rounded-xl text-[0.9375rem] font-semibold text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t('close')}
            </button>
          </div>
        )}
      </div>
      {fab ? <Fab label={fab.label} closeLabel={fab.closeLabel} open={shown} onPress={onClose} portal={false} /> : null}
    </dialog>
  )
}

const TYPE_ICONS: Record<string, string> = {
  blog: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  news: 'M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5',
  events: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  gallery: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  media: 'M3 7h4l2-3h6l2 3h4v13H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
}

function TypeIcon({ moduleId }: { moduleId: string }) {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={TYPE_ICONS[moduleId] ?? TYPE_ICONS.blog} />
    </svg>
  )
}
