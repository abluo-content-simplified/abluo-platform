'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Pill } from '@/components/app/ui/list/cells'
import { previewCataloguePublishAction } from '@/app/[locale]/(client)/[tenant]/catalogue/actions'
import type { CataloguePublishPreview } from '@/lib/api/catalogue-drafts'
import type { Referrer } from '@/lib/lifecycle/service'
import type { CatalogueKind } from '@/lib/modules/catalogue/dashboard-patch'
import { referrerHref, useCatalogueError } from './catalogue-ui'
import { Button } from '@/components/app/ui/Button'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { useDateLocale } from '@/lib/i18n/date-locale-context'

/**
 * ADR-033 D-4 / D-5 in the dashboard.
 *
 * `DependenciesNotice` — a publish was refused because the document uses
 * content that was never published: every dependency is NAMED and LINKED, and
 * the editor may choose "Publish … and dependencies" instead.
 *
 * `PublishTogetherSheet` — the confirmation panel of that action. Before
 * anything is written it shows: what is being published and when; every
 * never-published dependency that goes with it (the whole tree); which of them
 * get a public page of their own; which are reused elsewhere; what this editor
 * may not publish; and published dependencies that will not be live then
 * (they are never changed — a warning only). Anything that blocks disables the
 * confirm button; the server re-checks everything in one transaction.
 */

function RefLink({ projectSlug, r }: { projectSlug: string; r: Referrer }) {
  const href = referrerHref(projectSlug, r)
  return href ? (
    <Link href={href} className="text-[0.9375rem] text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      {r.label}
    </Link>
  ) : (
    <span className="text-[0.9375rem] text-foreground">{r.label}</span>
  )
}

const togetherKey = (kind: CatalogueKind) => (kind === 'item' ? 'publishItem' : kind === 'collection' ? 'publishCollection' : 'publishOptionList')

export function DependenciesNotice({
  projectSlug,
  kind,
  dependencies,
  title,
  onPublishTogether,
  onClose,
}: {
  projectSlug: string
  kind: CatalogueKind
  dependencies: readonly Referrer[]
  /** Overrides the "not published yet" title (e.g. extras whose allergens are not reviewed, D-3a). */
  title?: string
  onPublishTogether?: () => void
  onClose?: () => void
}) {
  const t = useTranslations('catalogue.dashboard.together')
  const tc = useTranslations('catalogue.dashboard.common')
  return (
    <Notice
      tone="info"
      title={title ?? t('notPublishedTitle')}
      onDismiss={onClose}
      dismissLabel={tc('dismiss')}
      action={
        onPublishTogether ? (
          <Button variant="secondary" onClick={onPublishTogether}>
            {t(togetherKey(kind))}
          </Button>
        ) : undefined
      }
    >
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {dependencies.map((r) => (
          <li key={`${r.type}:${r.id}`}>
            <RefLink projectSlug={projectSlug} r={r} />
          </li>
        ))}
      </ul>
    </Notice>
  )
}

function Group({ title, tone = 'plain', children }: { title: string; tone?: 'plain' | 'warning' | 'blocking'; children: ReactNode }) {
  return (
    <Panel as="section" tone={tone === 'blocking' ? 'danger' : 'card'} aria-label={title}>
      <h3 className={`text-[0.9375rem] font-semibold ${tone === 'blocking' ? 'text-destructive' : 'text-foreground'}`}>{title}</h3>
      <div className="mt-2">{children}</div>
    </Panel>
  )
}

export function PublishTogetherSheet({
  open,
  requestId,
  projectSlug,
  kind,
  id,
  publishAt,
  zone,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean
  /** Changes on every opening, so the preview is always read fresh. */
  requestId: number
  projectSlug: string
  kind: CatalogueKind
  id: string
  /** null = now. */
  publishAt: string | null
  zone: string
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const t = useTranslations('catalogue.dashboard.together')
  const te = useTranslations('catalogue.dashboard.errors')
  const dateLocale = useDateLocale()
  const errorText = useCatalogueError()
  const reqKey = open && id ? `${requestId}:${kind}:${id}:${publishAt ?? ''}` : null
  const [result, setResult] = useState<{ key: string; preview?: CataloguePublishPreview; error?: string } | null>(null)

  useEffect(() => {
    if (!reqKey) return
    let live = true
    previewCataloguePublishAction({ projectSlug, kind, id, publishAt })
      .then((r) => {
        if (live) setResult(r.ok ? { key: reqKey, preview: r.preview } : { key: reqKey, error: errorText(r.error) })
      })
      .catch(() => live && setResult({ key: reqKey, error: errorText('offline') }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reqKey stands for the inputs; errorText is a stable lookup
  }, [reqKey])
  // Only the answer to THIS opening counts (never a stale one).
  const current = result && result.key === reqKey ? result : null
  const preview = current?.preview ?? null
  const error = current?.error ?? null

  const when = preview?.publishAt
    ? t('whenScheduled', { date: new Intl.DateTimeFormat(dateLocale, { dateStyle: 'full', timeStyle: 'short', hourCycle: 'h23', timeZone: zone }).format(new Date(preview.publishAt)) })
    : t('whenNow')
  const blocking = Boolean(preview && (preview.forbidden.length || preview.missing.length || preview.blocked.length))

  return (
    <BottomSheet open={open} title={t(togetherKey(kind))} onClose={onClose}>
      {error ? (
        <p role="alert" className="text-[0.9375rem] text-destructive">
          {error}
        </p>
      ) : !preview ? (
        <p className="text-[0.9375rem] text-muted-foreground" role="status">
          {t('loading')}
        </p>
      ) : (
        <div className="space-y-3">
          <Group title={t('rootTitle')}>
            <p className="flex flex-wrap items-center gap-2">
              <RefLink projectSlug={projectSlug} r={preview.root} />
              {preview.root.opensPage ? <Pill tone="outline">{t('opensPage')}</Pill> : null}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{when}</p>
          </Group>
          <Group title={t('includedTitle')}>
            {preview.dependencies.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('nothingElse')}</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{t('includedHelp')}</p>
                <ul className="mt-2 flex flex-col gap-2">
                  {preview.dependencies.map((r) => (
                    <li key={`${r.type}:${r.id}`} className="flex flex-wrap items-center gap-2">
                      <RefLink projectSlug={projectSlug} r={r} />
                      {r.opensPage ? <Pill tone="outline">{t('opensPage')}</Pill> : null}
                      {r.reusedBy > 0 ? <Pill>{t('reused', { count: r.reusedBy })}</Pill> : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Group>
          {preview.blocked.length ? (
            <Group title={t('blockedTitle')} tone="blocking">
              <ul className="flex flex-col gap-1.5">
                {preview.blocked.map((r) => (
                  <li key={`${r.type}:${r.id}`} className="text-[0.9375rem]">
                    <RefLink projectSlug={projectSlug} r={r} /> <span className="text-sm text-muted-foreground">— {te.has(r.code) ? te(r.code) : te('failed')}</span>
                  </li>
                ))}
              </ul>
            </Group>
          ) : null}
          {preview.forbidden.length ? (
            <Group title={t('forbiddenTitle')} tone="blocking">
              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                {preview.forbidden.map((r) => (
                  <li key={`${r.type}:${r.id}`}>
                    <RefLink projectSlug={projectSlug} r={r} />
                  </li>
                ))}
              </ul>
            </Group>
          ) : null}
          {preview.missing.length ? (
            <Group title={t('missingTitle')} tone="blocking">
              <p className="text-sm text-muted-foreground">{t('missingHelp', { count: preview.missing.length })}</p>
            </Group>
          ) : null}
          {preview.notLive.length ? (
            <Group title={t('notLiveTitle')} tone="warning">
              <p className="text-sm text-muted-foreground">{t('notLiveHelp')}</p>
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {preview.notLive.map((r) => (
                  <li key={`${r.type}:${r.id}`}>
                    <RefLink projectSlug={projectSlug} r={r} />
                  </li>
                ))}
              </ul>
            </Group>
          ) : null}
          <Button variant="primary" className="mt-2 w-full" disabled={busy || blocking} onClick={onConfirm}>
            {preview.publishAt ? t('confirmSchedule', { count: preview.dependencies.length + 1 }) : t('confirmNow', { count: preview.dependencies.length + 1 })}
          </Button>
        </div>
      )}
    </BottomSheet>
  )
}

type DraftPublisher = {
  id: string
  publish: (
    mode: 'now' | 'schedule' | 'keep',
    dates?: { publishAt?: string | null },
    opts?: { keepEditing?: boolean; withDependencies?: boolean }
  ) => Promise<{ ok: true; notLive: Referrer[] } | { ok: false; error: string; detail?: { dependencies?: Referrer[] } }>
}

/**
 * The editors' shared D-4/D-5 flow: a refused publish that names never-
 * published dependencies shows them (linked) with "Publish … and
 * dependencies"; that action (also in the editor's menu) opens the
 * confirmation panel and publishes everything in one transaction.
 */
export function usePublishTogether({
  projectSlug,
  kind,
  draft,
  isLive,
  publishAt,
  zone,
  onPublished,
  onError,
}: {
  projectSlug: string
  kind: CatalogueKind
  draft: DraftPublisher
  isLive: boolean
  /** The root's schedule when it has one (null = now). */
  publishAt: string | null
  zone: string
  onPublished: (notLive: Referrer[]) => void
  onError: (error: string) => void
}) {
  const t = useTranslations('catalogue.dashboard.together')
  const [dependencies, setDependencies] = useState<Referrer[] | null>(null)
  /** D-3a refusal: extras (list · choice) whose allergens are not reviewed — named and linked, no "publish together". */
  const [choices, setChoices] = useState<Referrer[] | null>(null)
  const [open, setOpen] = useState(false)
  const [requestId, setRequestId] = useState(0)
  const [busy, setBusy] = useState(false)

  /** Call with a failed publish result: true when it was a D-4 dependency refusal (now shown). */
  const handleRefusal = (r: { ok: false; error: string; detail?: { dependencies?: Referrer[] } }) => {
    if (r.error === 'unpublished_dependencies' && r.detail?.dependencies?.length) {
      setDependencies(r.detail.dependencies)
      return true
    }
    if (r.error === 'option_allergens_not_reviewed' && r.detail?.dependencies?.length) {
      setChoices(r.detail.dependencies)
      return true
    }
    return false
  }

  function openSheet() {
    setRequestId((n) => n + 1)
    setOpen(true)
  }

  async function confirm() {
    if (busy) return
    setBusy(true)
    try {
      const scheduled = !isLive && publishAt !== null && Date.parse(publishAt) > Date.now()
      const r = await draft.publish(isLive ? 'keep' : scheduled ? 'schedule' : 'now', scheduled ? { publishAt } : {}, { keepEditing: true, withDependencies: true })
      if (!r.ok) {
        setOpen(false)
        if (!handleRefusal(r)) onError(r.error)
        return
      }
      setOpen(false)
      setDependencies(null)
      setChoices(null)
      onPublished(r.notLive)
    } finally {
      setBusy(false)
    }
  }

  const ui = (
    <>
      {dependencies ? (
        <DependenciesNotice projectSlug={projectSlug} kind={kind} dependencies={dependencies} onPublishTogether={openSheet} onClose={() => setDependencies(null)} />
      ) : null}
      {choices ? <DependenciesNotice projectSlug={projectSlug} kind={kind} title={t('optionAllergensTitle')} dependencies={choices} onClose={() => setChoices(null)} /> : null}
      <PublishTogetherSheet open={open} requestId={requestId} projectSlug={projectSlug} kind={kind} id={draft.id} publishAt={publishAt} zone={zone} busy={busy} onClose={() => setOpen(false)} onConfirm={() => void confirm()} />
    </>
  )
  return {
    handleRefusal,
    openSheet,
    clear: () => {
      setDependencies(null)
      setChoices(null)
    },
    ui,
  }
}
