'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Button } from '@/components/app/ui/Button'
import { buttonClass } from '@/components/app/ui/button-styles'
import { CardMenu } from '@/components/app/ui/CardMenu'
import { Checkbox } from '@/components/app/ui/Checkbox'
import { Field } from '@/components/app/ui/Field'
import { FieldLabel } from '@/components/app/ui/FieldLabel'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Panel } from '@/components/app/ui/Panel'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { SidePanel } from '@/components/app/ui/SidePanel'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'
import { Toast } from '@/components/app/ui/Toast'
import { UpdateCard } from '@/components/app/ui/UpdateCard'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { CellChips, CellPill, CellText, LocalDate, Pill, type PillTone } from '@/components/app/ui/list/cells'
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

const HELP = 'mt-1 text-sm text-muted-foreground'

const STATUS_FILTERS = ['all', 'draft', 'published', 'archived'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

/** Lower-case, accent-free, so "novita" finds "Novità". */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

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

  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const moduleLabel = useMemo(() => new Map(modules.map((m) => [m.id, m.label])), [modules])
  const titleOf = (u: AdminProductUpdate) => pickLocalized(u.title, 'en')?.text ?? u.slug
  const audienceOf = (u: AdminProductUpdate) => u.modules.map((m) => moduleLabel.get(m) ?? m)
  const statusLabel = (s: ProductUpdateStatus) => t(`status.${s}`)

  const searchText = (u: AdminProductUpdate) =>
    fold([...Object.values(u.title), titleOf(u), ...audienceOf(u)].filter((x): x is string => typeof x === 'string').join(' '))
  const matches = (u: AdminProductUpdate, status: StatusFilter, terms: string[]) =>
    (status === 'all' || u.status === status) && (terms.length === 0 || terms.every((term) => searchText(u).includes(term)))
  const terms = fold(q).split(/\s+/).filter(Boolean)
  const shown = updates.filter((u) => matches(u, statusFilter, terms))
  const countFor = (s: StatusFilter) => updates.filter((u) => matches(u, s, [])).length
  const isDefault = !q.trim() && statusFilter === 'all'
  const reset = () => {
    setQ('')
    setStatusFilter('all')
  }
  const filters: ListToolbarFilter[] = [
    {
      key: 'status',
      label: t('statusFilter'),
      value: statusFilter,
      options: STATUS_FILTERS.map((s) => ({ value: s, label: `${t(`statusFilters.${s}`)} (${countFor(s)})` })),
      onChange: (v) => setStatusFilter(v as StatusFilter),
    },
  ]
  const chips: FilterChip[] = statusFilter !== 'all' ? [{ id: 'status', label: t(`statusFilters.${statusFilter}`) }] : []

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

  const menuFor = (u: AdminProductUpdate) => [{ key: 'edit', label: t('editTitle'), onSelect: () => openEditor(u.id) }]

  // Date first (Tom, 2026-10-08): updates read as a timeline.
  const columns: DataTableColumn<AdminProductUpdate>[] = [
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
      key: 'title',
      header: t('columns.title'),
      width: 'min-w-72',
      render: (u) => <CellText primary={titleOf(u)} />,
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
    {
      key: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      width: 'w-12',
      render: (u) => <CardMenu variant="cell" label={t('menu', { title: titleOf(u) })} items={menuFor(u)} />,
    },
  ]

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <Button variant="primary" onClick={() => openEditor('new')}>
            {t('newUpdate')}
          </Button>
        }
      />
      <p className="text-sm text-muted-foreground">{t('description')}</p>

      {updates.length === 0 ? (
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <>
          <ListToolbar
            label={t('filters')}
            search={{ value: q, onChange: setQ, label: t('search'), placeholder: t('searchPlaceholder') }}
            filters={filters}
            summary={t('showing', { shown: shown.length, total: updates.length })}
            clear={{ label: t('clear'), onClear: reset, visible: !isDefault }}
            sheet={{ activeCount: chips.length, resultCount: shown.length, chips, onRemoveChip: () => setStatusFilter('all') }}
          />

          {shown.length === 0 ? (
            <EmptyState titleAs="p" title={t('noMatch')} action={!isDefault ? <Button onClick={reset}>{t('clear')}</Button> : undefined} />
          ) : (
            <>
              <div className="hidden md:block">
                <DataTable
                  rows={shown}
                  rowKey={(u) => u.id}
                  columns={columns}
                  onRowClick={(u) => openEditor(u.id)}
                  minWidth="min-w-[48rem]"
                  label={t('title')}
                />
              </div>
              <ul aria-label={t('title')} className="flex flex-col gap-3 md:hidden">
                {shown.map((u) => (
                  <ListRow key={u.id} onOpen={() => openEditor(u.id)} menu={{ label: t('menu', { title: titleOf(u) }), items: menuFor(u) }}>
                    <span className="text-sm text-muted-foreground">
                      <LocalDate iso={u.publishedAt} empty={t('notPublished')} />
                    </span>
                    <span className="line-clamp-2 text-[0.9375rem] leading-6 font-semibold text-foreground">{titleOf(u)}</span>
                    <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <Pill tone={STATUS_TONE[u.status]}>{statusLabel(u.status)}</Pill>
                      <span>{audienceOf(u).join(', ') || t('audienceEveryone')}</span>
                    </span>
                  </ListRow>
                ))}
              </ul>
            </>
          )}
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
        <Button variant="primary" disabled={busy} onClick={() => save('save')}>
          {t('actions.saveChanges')}
        </Button>
        <Button disabled={busy} onClick={() => save('archive')}>
          {t('actions.archive')}
        </Button>
      </>
    ) : (
      <>
        <Button variant="primary" disabled={busy} onClick={() => save('publish')}>
          {t('actions.publish')}
        </Button>
        <Button disabled={busy} onClick={() => save(status === 'archived' ? 'draft' : 'save')}>
          {status === 'archived' ? t('actions.moveToDraft') : t('actions.saveDraft')}
        </Button>
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
          <Notice tone="error">
            <ul className="space-y-1">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Notice>
        ) : null}

        {/* ── Per-language text ─────────────────────────────────────────── */}
        <fieldset className="space-y-4">
          <FieldLabel as="legend">{t('fields.language')}</FieldLabel>
          <SegmentedControl
            label={t('fields.language')}
            appearance="chips"
            value={lang}
            onChange={setLang}
            options={languages.map((l) => {
              const filled = Boolean(draft.title[l.code]?.trim())
              return {
                value: l.code,
                label: (
                  <>
                    {l.name}
                    {filled ? <span aria-hidden="true" className="size-1.5 rounded-full bg-success" /> : null}
                    {filled ? <span className="sr-only">{t('fields.filled')}</span> : null}
                  </>
                ),
              }
            })}
          />
          <Field label={t('fields.title')}>
            {(p) => <TextInput {...p} lang={lang} value={draft.title[lang] ?? ''} maxLength={WHATS_NEW_LIMITS.title} onChange={(e) => setText('title', e.target.value)} />}
          </Field>
          <Field label={t('fields.body')} hint={t('fields.bodyHelp')}>
            {(p) => <TextArea {...p} lang={lang} rows={7} value={draft.body[lang] ?? ''} maxLength={WHATS_NEW_LIMITS.body} onChange={(e) => setText('body', e.target.value)} />}
          </Field>
          <Field label={t('fields.ctaLabel')}>
            {(p) => <TextInput {...p} lang={lang} value={draft.ctaLabel[lang] ?? ''} maxLength={WHATS_NEW_LIMITS.ctaLabel} onChange={(e) => setText('ctaLabel', e.target.value)} />}
          </Field>
        </fieldset>

        {/* ── Shared fields ─────────────────────────────────────────────── */}
        <Field label={t('fields.ctaUrl')} hint={t('fields.ctaHelp')}>
          {(p) => (
            <TextInput
              {...p}
              type="url"
              inputMode="url"
              placeholder="https://"
              value={draft.ctaUrl}
              maxLength={WHATS_NEW_LIMITS.url}
              onChange={(e) => setDraft((d) => ({ ...d, ctaUrl: e.target.value }))}
            />
          )}
        </Field>

        <div>
          <FieldLabel as="p">{t('fields.image')}</FieldLabel>
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
            <label htmlFor="whats-new-image" className={buttonClass({ className: 'cursor-pointer' })} aria-disabled={busy}>
              {uploading ? t('fields.uploading') : draft.imageUrl ? t('fields.replaceImage') : t('fields.chooseImage')}
            </label>
            {draft.imageUrl ? (
              <Button disabled={busy} onClick={() => setDraft((d) => ({ ...d, imageUrl: null }))}>
                {t('fields.removeImage')}
              </Button>
            ) : null}
          </div>
        </div>

        <fieldset>
          <FieldLabel as="legend">{t('fields.audience')}</FieldLabel>
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
          <h3 id="whats-new-preview" className="text-[0.9375rem] font-medium text-foreground">
            {t('previewTitle')}
          </h3>
          {previewLang ? <p className={HELP}>{t('previewLanguage', { language: previewLang })}</p> : null}
          <Panel>
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
          </Panel>
        </section>
      </div>
    </SidePanel>
  )
}
