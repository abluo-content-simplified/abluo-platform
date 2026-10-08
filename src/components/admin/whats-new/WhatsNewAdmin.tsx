'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Checkbox } from '@/components/app/ui/Checkbox'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { SidePanel } from '@/components/app/ui/SidePanel'
import { Toast } from '@/components/app/ui/Toast'
import { UpdateCard } from '@/components/app/ui/UpdateCard'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { CellChips, CellPill, LocalDate, Pill, type PillTone } from '@/components/app/ui/list/cells'
import {
  saveProductUpdateAction,
  uploadProductUpdateImageAction,
  type SaveIntent,
} from '@/app/[locale]/(admin)/whats-new/actions'
import type { AdminProductUpdate } from '@/lib/whats-new/admin'
import {
  isSafeHttpsUrl,
  pickLocalized,
  WHATS_NEW_LIMITS,
  type LocalizedText,
  type ProductUpdateError,
  type ProductUpdateInput,
  type ProductUpdateStatus,
  type WhatsNewLocale,
} from '@/lib/whats-new/model'

/**
 * Admin "What's new" (ADR-030 step 6): the list of product updates and the
 * editor (a SidePanel — a bottom sheet on phones). Title, body and button
 * label per language (tabs), one image, one https button link, the audience
 * (modules; none ticked = every client) and a live preview of exactly what a
 * client sees (the shared UpdateCard, with the client's language fallback).
 * Every write goes through the admin server actions (requireAbluoAdmin).
 */

type ModuleOption = { id: string; label: string }
type LanguageOption = { code: WhatsNewLocale; name: string }

const STATUS_TONE: Record<ProductUpdateStatus, PillTone> = { draft: 'outline', published: 'success', archived: 'muted' }

const INPUT =
  'mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 text-base text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
const TEXTAREA =
  'mt-2 min-h-40 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-base leading-6 text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
const LABEL = 'block text-[0.9375rem] font-medium text-foreground'
const HELP = 'mt-1 text-sm text-muted-foreground'
const PRIMARY =
  'inline-flex h-11 items-center justify-center rounded-xl bg-action px-4 text-[0.9375rem] font-semibold text-action-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50'
const SECONDARY =
  'inline-flex h-11 items-center justify-center rounded-xl border border-border px-4 text-[0.9375rem] font-medium text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50'

type Draft = ProductUpdateInput

const EMPTY: Draft = { title: {}, body: {}, ctaLabel: {}, ctaUrl: '', imageUrl: null, modules: [] }

function toDraft(u: AdminProductUpdate): Draft {
  return { title: u.title, body: u.body, ctaLabel: u.ctaLabel, ctaUrl: u.ctaUrl, imageUrl: u.imageUrl, modules: u.modules }
}

export function WhatsNewAdmin({
  updates: initial,
  modules,
  languages,
}: {
  updates: AdminProductUpdate[]
  modules: ModuleOption[]
  languages: LanguageOption[]
}) {
  const t = useTranslations('admin.whatsNew')
  const router = useRouter()
  // Saved rows show at once; the server list (fresh read counts) replaces them after router.refresh().
  const [updates, setUpdates] = useState(initial)
  const [serverList, setServerList] = useState(initial)
  if (serverList !== initial) {
    setServerList(initial)
    setUpdates(initial)
  }
  // null = closed; 'new' = a new update; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null)
  // A fresh editor per opening; closing keeps the same one so it can slide out.
  const [session, setSession] = useState(0)
  const openEditor = (id: string) => {
    setSession((s) => s + 1)
    setEditing(id)
  }
  const [toast, setToast] = useState<{ message: string; tone: 'status' | 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const moduleLabel = useMemo(() => new Map(modules.map((m) => [m.id, m.label])), [modules])
  const titleOf = (u: AdminProductUpdate) => pickLocalized(u.title, 'en')?.text ?? u.slug
  const audienceOf = (u: AdminProductUpdate) => u.modules.map((m) => moduleLabel.get(m) ?? m)
  const statusLabel = (s: ProductUpdateStatus) => t(`status.${s}`)

  const show = (message: string, tone: 'status' | 'error' = 'status') => {
    setToast({ message, tone })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  const current = editing && editing !== 'new' ? (updates.find((u) => u.id === editing) ?? null) : null

  const onSaved = (saved: AdminProductUpdate, intent: SaveIntent) => {
    setUpdates((list) => {
      const prev = list.find((u) => u.id === saved.id)
      const merged = { ...saved, readCount: prev?.readCount ?? saved.readCount }
      return prev ? list.map((u) => (u.id === saved.id ? merged : u)) : [merged, ...list]
    })
    setEditing(null)
    show(t(`toast.${intent === 'publish' ? 'published' : intent === 'archive' ? 'archived' : 'saved'}`))
    router.refresh()
  }

  const columns: DataTableColumn<AdminProductUpdate>[] = [
    {
      key: 'title',
      header: t('columns.title'),
      width: 'min-w-72',
      render: (u) => (
        <button
          type="button"
          onClick={() => openEditor(u.id)}
          className="line-clamp-2 text-left text-sm leading-6 font-semibold text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {titleOf(u)}
        </button>
      ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      width: 'w-32',
      render: (u) => (
        <CellPill>
          <Pill tone={STATUS_TONE[u.status]}>{statusLabel(u.status)}</Pill>
        </CellPill>
      ),
    },
    {
      key: 'published',
      header: t('columns.published'),
      width: 'w-36',
      className: 'whitespace-nowrap',
      render: (u) => (
        <span className="flex min-h-6 items-center">
          <LocalDate iso={u.publishedAt} empty={t('notPublished')} />
        </span>
      ),
    },
    {
      key: 'audience',
      header: t('columns.audience'),
      width: 'w-56',
      render: (u) => <CellChips items={audienceOf(u)} max={3} empty={t('audienceEveryone')} />,
    },
    {
      key: 'reads',
      header: t('columns.reads'),
      width: 'w-28',
      className: 'whitespace-nowrap',
      render: (u) => (
        <span className="flex min-h-6 items-center text-muted-foreground">
          {u.readCount === null ? '—' : t('readCount', { count: u.readCount })}
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <button type="button" onClick={() => openEditor('new')} className={PRIMARY}>
            {t('newUpdate')}
          </button>
        }
      />
      <p className="text-sm text-muted-foreground">{t('description')}</p>

      {updates.length === 0 ? (
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable
              rows={updates}
              rowKey={(u) => u.id}
              columns={columns}
              onRowClick={(u) => openEditor(u.id)}
              minWidth="min-w-[48rem]"
              label={t('title')}
            />
          </div>
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border bg-card text-card-foreground md:hidden">
            {updates.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => openEditor(u.id)}
                  className="flex w-full flex-col items-start gap-1.5 px-4 py-4 text-left transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
                >
                  <span className="line-clamp-2 text-[0.9375rem] leading-6 font-semibold text-foreground">{titleOf(u)}</span>
                  <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <Pill tone={STATUS_TONE[u.status]}>{statusLabel(u.status)}</Pill>
                    {u.publishedAt ? <LocalDate iso={u.publishedAt} /> : null}
                    <span>{audienceOf(u).join(', ') || t('audienceEveryone')}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <UpdateEditor
        key={session}
        open={editing !== null}
        update={current}
        modules={modules}
        languages={languages}
        onClose={() => setEditing(null)}
        onSaved={onSaved}
        onError={(m) => show(m, 'error')}
      />

      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </>
  )
}

function UpdateEditor({
  open,
  update,
  modules,
  languages,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean
  update: AdminProductUpdate | null
  modules: ModuleOption[]
  languages: LanguageOption[]
  onClose: () => void
  onSaved: (u: AdminProductUpdate, intent: SaveIntent) => void
  onError: (message: string) => void
}) {
  const t = useTranslations('admin.whatsNew')
  const [draft, setDraft] = useState<Draft>(() => (update ? toDraft(update) : EMPTY))
  const [lang, setLang] = useState<WhatsNewLocale>(languages[0]?.code ?? 'en')
  const [errors, setErrors] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [pending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  const status: ProductUpdateStatus = update?.status ?? 'draft'
  const busy = pending || uploading

  const setText = (field: 'title' | 'body' | 'ctaLabel', value: string) =>
    setDraft((d) => ({ ...d, [field]: { ...d[field], [lang]: value } as LocalizedText }))

  const toggleModule = (id: string, on: boolean) =>
    setDraft((d) => ({ ...d, modules: on ? [...new Set([...d.modules, id])] : d.modules.filter((m) => m !== id) }))

  const save = (intent: SaveIntent) =>
    startTransition(async () => {
      setErrors([])
      const res = await saveProductUpdateAction(update?.id ?? null, intent, draft)
      if (res.ok) return onSaved(res.update, intent)
      if (res.error === 'invalid') setErrors(res.errors.map((e: ProductUpdateError) => t(`errors.${e}`)))
      else onError(t(`errors.${res.error}`))
    })

  const upload = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await uploadProductUpdateImageAction(fd)
      if (res.ok) setDraft((d) => ({ ...d, imageUrl: res.url }))
      else onError(t(`errors.image.${res.error}`))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // The preview uses the client's rule: this tab's language, else English, else any.
  const title = pickLocalized(draft.title, lang)
  const body = pickLocalized(draft.body, lang)
  const ctaLabel = pickLocalized(draft.ctaLabel, lang)
  const ctaUrl = draft.ctaUrl.trim()
  const previewLang = languages.find((l) => l.code === title?.locale)?.name

  const actions =
    status === 'published' ? (
      <>
        <button type="button" disabled={busy} onClick={() => save('save')} className={PRIMARY}>
          {t('actions.saveChanges')}
        </button>
        <button type="button" disabled={busy} onClick={() => save('archive')} className={SECONDARY}>
          {t('actions.archive')}
        </button>
      </>
    ) : (
      <>
        <button type="button" disabled={busy} onClick={() => save('publish')} className={PRIMARY}>
          {t('actions.publish')}
        </button>
        <button type="button" disabled={busy} onClick={() => save(status === 'archived' ? 'draft' : 'save')} className={SECONDARY}>
          {status === 'archived' ? t('actions.moveToDraft') : t('actions.saveDraft')}
        </button>
      </>
    )

  return (
    <SidePanel
      open={open}
      title={update ? t('editTitle') : t('newTitle')}
      subtitle={update ? t(`status.${status}`) : undefined}
      closeLabel={t('actions.close')}
      onClose={onClose}
      actions={actions}
    >
      <div className="space-y-6">
        {errors.length ? (
          <ul role="alert" className="space-y-1 rounded-2xl border border-destructive px-4 py-3 text-sm text-destructive">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}

        {/* ── Per-language text ─────────────────────────────────────────── */}
        <fieldset className="space-y-4">
          <legend className={LABEL}>{t('fields.language')}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {languages.map((l) => {
              const filled = Boolean(draft.title[l.code]?.trim())
              return (
                <button
                  key={l.code}
                  type="button"
                  aria-pressed={lang === l.code}
                  onClick={() => setLang(l.code)}
                  className={`inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    lang === l.code ? 'border-foreground bg-muted text-foreground' : 'border-border text-muted-foreground hover:bg-hover'
                  }`}
                >
                  {l.name}
                  {filled ? <span aria-hidden="true" className="size-1.5 rounded-full bg-success" /> : null}
                  {filled ? <span className="sr-only">{t('fields.filled')}</span> : null}
                </button>
              )
            })}
          </div>
          <label className={LABEL}>
            {t('fields.title')}
            <input
              lang={lang}
              value={draft.title[lang] ?? ''}
              maxLength={WHATS_NEW_LIMITS.title}
              onChange={(e) => setText('title', e.target.value)}
              className={INPUT}
            />
          </label>
          <label className={LABEL}>
            {t('fields.body')}
            <textarea
              lang={lang}
              value={draft.body[lang] ?? ''}
              maxLength={WHATS_NEW_LIMITS.body}
              onChange={(e) => setText('body', e.target.value)}
              className={TEXTAREA}
            />
            <span className={`${HELP} block font-normal`}>{t('fields.bodyHelp')}</span>
          </label>
          <label className={LABEL}>
            {t('fields.ctaLabel')}
            <input
              lang={lang}
              value={draft.ctaLabel[lang] ?? ''}
              maxLength={WHATS_NEW_LIMITS.ctaLabel}
              onChange={(e) => setText('ctaLabel', e.target.value)}
              className={INPUT}
            />
          </label>
        </fieldset>

        {/* ── Shared fields ─────────────────────────────────────────────── */}
        <label className={LABEL}>
          {t('fields.ctaUrl')}
          <input
            type="url"
            inputMode="url"
            placeholder="https://"
            value={draft.ctaUrl}
            maxLength={WHATS_NEW_LIMITS.url}
            onChange={(e) => setDraft((d) => ({ ...d, ctaUrl: e.target.value }))}
            className={INPUT}
          />
          <span className={`${HELP} block font-normal`}>{t('fields.ctaHelp')}</span>
        </label>

        <div>
          <p className={LABEL}>{t('fields.image')}</p>
          <p className={HELP}>{t('fields.imageHelp')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              id="whats-new-image"
              onChange={(e) => void upload(e.target.files?.[0])}
            />
            <label htmlFor="whats-new-image" className={`${SECONDARY} cursor-pointer`} aria-disabled={busy}>
              {uploading ? t('fields.uploading') : draft.imageUrl ? t('fields.replaceImage') : t('fields.chooseImage')}
            </label>
            {draft.imageUrl ? (
              <button type="button" disabled={busy} onClick={() => setDraft((d) => ({ ...d, imageUrl: null }))} className={SECONDARY}>
                {t('fields.removeImage')}
              </button>
            ) : null}
          </div>
        </div>

        <fieldset>
          <legend className={LABEL}>{t('fields.audience')}</legend>
          <p className={HELP}>{t('fields.audienceHelp')}</p>
          <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {modules.map((m) => (
              <li key={m.id}>
                <label className="flex cursor-pointer items-center gap-1 text-[0.9375rem] text-foreground">
                  <Checkbox checked={draft.modules.includes(m.id)} onChange={(on) => toggleModule(m.id, on)} aria-label={m.label} />
                  {m.label}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        {/* ── Preview ───────────────────────────────────────────────────── */}
        <section aria-labelledby="whats-new-preview" className="space-y-2">
          <h3 id="whats-new-preview" className={LABEL}>
            {t('previewTitle')}
          </h3>
          {previewLang ? <p className={HELP}>{t('previewLanguage', { language: previewLang })}</p> : null}
          <div className="rounded-2xl border border-border p-4">
            {title ? (
              <UpdateCard
                title={title.text}
                body={body?.text ?? ''}
                imageUrl={draft.imageUrl}
                cta={ctaLabel && isSafeHttpsUrl(ctaUrl) ? { label: ctaLabel.text, url: ctaUrl } : null}
                publishedAt={update?.publishedAt ?? new Date().toISOString()}
                lang={title.locale}
                newLabel={t('previewNew')}
                opensInNewTabLabel={t('opensInNewTab')}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t('previewEmpty')}</p>
            )}
          </div>
        </section>
      </div>
    </SidePanel>
  )
}
