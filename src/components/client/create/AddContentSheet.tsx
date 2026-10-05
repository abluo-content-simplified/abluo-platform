'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { createPostDraftAction } from '@/app/[locale]/(client)/[tenant]/posts/actions'
import type { CreateMenu } from '@/lib/modules/create-menu'

/**
 * Add content → "What would you like to create?" (ADR-025 D8 · the Type step).
 *
 * Cards come from the project's installed content modules (`buildCreateMenu`,
 * computed on the server). Blog post is actionable: it creates the draft
 * (`createPostDraftAction` — the id, type and project come from the server) and
 * opens the wizard. Other installed types say "Coming soon". Owners also see
 * "More you can add to your site", which only explains and offers
 * "Ask us to add it" — it is never a choice in itself.
 */
export function AddContentSheet({
  open,
  onClose,
  projectSlug,
  menu,
  contactEmail,
}: {
  open: boolean
  onClose: () => void
  projectSlug: string
  menu: CreateMenu
  /** Abluo contact for "Ask us to add it"; when absent the sheet shows a hint instead. */
  contactEmail?: string | null
}) {
  const t = useTranslations('clientDashboard.create.type')
  const router = useRouter()
  const ref = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState<string | null>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      setError(null)
      setAsking(null)
      d.showModal()
    }
    if (!open && d.open) d.close()
  }, [open])

  async function startBlogPost() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await createPostDraftAction({ projectSlug })
      if (!r.ok) {
        setError(t('failed'))
        return
      }
      router.push(`/${projectSlug}/posts/write/${r.id}`)
      onClose()
    } catch {
      setError(t('failed'))
    } finally {
      setBusy(false)
    }
  }

  const askHref = (moduleId: string) =>
    contactEmail
      ? `mailto:${contactEmail}?subject=${encodeURIComponent(t('askSubject', { module: t(`items.${moduleId}`), project: projectSlug }))}`
      : null

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="add-sheet-title"
      data-surface="create"
      className="m-auto mb-0 max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-popover p-6 pb-[max(24px,env(safe-area-inset-bottom))] text-popover-foreground backdrop:bg-overlay md:mb-auto md:rounded-2xl"
    >
      {asking ? (
        <div>
          <h2 id="add-sheet-title" className="text-2xl font-semibold tracking-tight">
            {t(`items.${asking}`)}
          </h2>
          <p className="mt-2 text-[17px] leading-7 text-muted-foreground">{t(`desc.${asking}`)}</p>
          <p className="mt-2 text-[15px] leading-6 text-muted-foreground">{t('moreHelper')}</p>
          {askHref(asking) ? (
            <a
              href={askHref(asking)!}
              className="mt-6 flex h-14 w-full items-center justify-center rounded-xl bg-action text-[17px] font-semibold text-action-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t('ask')}
            </a>
          ) : (
            <p className="mt-6 rounded-xl bg-muted p-4 text-[15px] leading-6 text-muted-foreground">{t('askUnavailable')}</p>
          )}
          <button
            type="button"
            onClick={() => setAsking(null)}
            className="mt-3 h-12 w-full rounded-xl text-[15px] font-semibold text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t('close')}
          </button>
        </div>
      ) : (
        <div>
          <h2 id="add-sheet-title" className="text-2xl font-semibold tracking-tight">
            {t('title')}
          </h2>
          <p className="mt-2 text-[17px] leading-7 text-muted-foreground">{t('helper')}</p>

          {menu.available.length === 0 ? (
            <p className="mt-6 text-[15px] text-muted-foreground">{t('nothing')}</p>
          ) : (
            <ul className="mt-6 flex flex-col gap-3">
              {menu.available.map((item) => (
                <li key={item.moduleId}>
                  <button
                    type="button"
                    disabled={!item.ready || busy}
                    aria-busy={item.ready && busy ? true : undefined}
                    onClick={item.ready ? startBlogPost : undefined}
                    className="flex min-h-[72px] w-full items-center gap-4 rounded-2xl border border-border bg-background p-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none enabled:hover:border-foreground enabled:hover:bg-hover disabled:cursor-not-allowed"
                  >
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
                      <TypeIcon moduleId={item.moduleId} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[17px] font-semibold ${item.ready ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {t(`items.${item.moduleId}`)}
                      </span>
                      <span className="block text-[15px] leading-6 text-muted-foreground">
                        {item.ready && busy ? t('starting') : t(`desc.${item.moduleId}`)}
                      </span>
                    </span>
                    {!item.ready ? (
                      <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{t('soon')}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p role="alert" className="mt-3 min-h-5 text-sm text-destructive">
            {error}
          </p>

          {menu.more.length > 0 ? (
            <section aria-labelledby="add-sheet-more" className="mt-4 border-t border-border-subtle pt-5">
              <h3 id="add-sheet-more" className="text-[15px] font-semibold text-foreground">
                {t('more')}
              </h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {menu.more.map((moduleId) => (
                  <li key={moduleId}>
                    <button
                      type="button"
                      onClick={() => setAsking(moduleId)}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-[15px] text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
            className="mt-6 h-12 w-full rounded-xl text-[15px] font-semibold text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t('close')}
          </button>
        </div>
      )}
    </dialog>
  )
}

const TYPE_ICONS: Record<string, string> = {
  blog: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  news: 'M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5',
  events: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  gallery: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
}

function TypeIcon({ moduleId }: { moduleId: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={TYPE_ICONS[moduleId] ?? TYPE_ICONS.blog} />
    </svg>
  )
}
