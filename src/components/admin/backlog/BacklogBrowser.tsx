'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { FactRow } from '@/components/app/ui/FactRow'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { SidePanel } from '@/components/app/ui/SidePanel'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { CellDate, CellText, LocalDate, Pill } from '@/components/app/ui/list/cells'
import {
  BACKLOG_AREAS,
  BACKLOG_PRIORITIES,
  BACKLOG_STATUSES,
  BACKLOG_TYPES,
  DEFAULT_BACKLOG_FILTERS,
  EMPTY_BACKLOG_INPUT,
  applyBacklogFilters,
  isDefaultBacklogFilters,
  nextBacklogSort,
  type BacklogFilters,
  type BacklogInput,
  type BacklogItem,
  type BacklogProjectOption,
  type BacklogSortKey,
  type BacklogStatus,
} from '@/lib/admin/backlog-model'
import {
  createBacklogItemAction,
  deleteBacklogItemAction,
  setBacklogStatusAction,
  updateBacklogItemAction,
  type BacklogActionResult,
} from '@/app/[locale]/(admin)/backlog/actions'
import { BacklogForm, type BacklogFieldErrors } from './BacklogForm'
import { CONTROL, DESTRUCTIVE_BUTTON, PLUS_ICON, PRIMARY_BUTTON, SECONDARY_BUTTON, PriorityPill, StatusPill } from './backlog-bits'

type Panel = { kind: 'new' } | { kind: 'view'; id: string } | { kind: 'edit'; id: string } | null

const FORM_ID = 'backlog-item-form'
const ACTION_ERRORS = ['forbidden', 'not_set_up', 'not_found', 'invalid', 'failed'] as const

/**
 * The admin Backlog (ADR-030 §5.5): the shared list pattern (PageHeader,
 * ListToolbar, DataTable on computers, cards on phones, SidePanel, Toast).
 * Changes show at once; a failed server call puts the item back and says why.
 */
export function BacklogBrowser({ items, projects }: { items: BacklogItem[]; projects: BacklogProjectOption[] }) {
  const t = useTranslations('admin.backlog')
  const router = useRouter()
  const { toast, show } = useUndo()

  // Local copy for optimistic updates; replaced whenever the server sends a new list.
  const [source, setSource] = useState(items)
  const [list, setList] = useState(items)
  if (source !== items) {
    setSource(items)
    setList(items)
  }

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const projectName = (id: string | null) => (id ? (projectById.get(id)?.name ?? null) : null)

  const [filters, setFilters] = useState<BacklogFilters>(DEFAULT_BACKLOG_FILTERS)
  const update = (patch: Partial<BacklogFilters>) => setFilters((f) => ({ ...f, ...patch }))
  const reset = () => setFilters((f) => ({ ...DEFAULT_BACKLOG_FILTERS, sort: f.sort }))
  const shown = useMemo(() => applyBacklogFilters(list, filters, (id) => projectById.get(id)?.name), [list, filters, projectById])

  const [panel, setPanel] = useState<Panel>(null)
  const [busy, setBusy] = useState(false)
  const [serverErrors, setServerErrors] = useState<BacklogFieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<BacklogItem | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const openItem = panel && panel.kind !== 'new' ? (list.find((i) => i.id === panel.id) ?? null) : null

  const errorText = (code: string) => (ACTION_ERRORS.includes(code as never) ? t(`errors.${code}` as 'errors.failed') : t('errors.failed'))

  const openPanel = (next: Panel) => {
    setServerErrors({})
    setFormError(null)
    setPanel(next)
  }

  const replace = (item: BacklogItem) => setList((l) => (l.some((i) => i.id === item.id) ? l.map((i) => (i.id === item.id ? item : i)) : [item, ...l]))

  /** Runs a create/update; shows field errors in the form, other errors above it. */
  async function submitForm(run: () => Promise<BacklogActionResult>, done: string) {
    if (busy) return
    setBusy(true)
    setFormError(null)
    try {
      const r = await run()
      if (!r.ok) {
        setServerErrors(r.fields ?? {})
        setFormError(errorText(r.error))
        return
      }
      if (r.item) {
        replace(r.item)
        openPanel({ kind: 'view', id: r.item.id })
      } else openPanel(null)
      show({ message: done, tone: 'status' })
      router.refresh()
    } catch {
      setFormError(t('errors.failed'))
    } finally {
      setBusy(false)
    }
  }

  const create = (input: BacklogInput) => void submitForm(() => createBacklogItemAction(input), t('toast.created'))
  const save = (id: string, input: BacklogInput) => void submitForm(() => updateBacklogItemAction(id, input), t('toast.saved'))

  /** Optimistic status change: moves at once, goes back (and says so) if the server refuses. */
  async function changeStatus(item: BacklogItem, status: BacklogStatus) {
    if (status === item.status) return
    const before = item
    replace({ ...item, status })
    try {
      const r = await setBacklogStatusAction(item.id, status)
      if (!r.ok) {
        replace(before)
        show({ message: errorText(r.error), tone: 'error' })
        return
      }
      if (r.item) replace(r.item)
      show({ message: t('toast.statusChanged', { status: t(`status.${status}`) }), tone: 'status' })
      router.refresh()
    } catch {
      replace(before)
      show({ message: t('errors.failed'), tone: 'error' })
    }
  }

  async function remove(item: BacklogItem) {
    if (busy) return
    setBusy(true)
    setDeleteError(null)
    try {
      const r = await deleteBacklogItemAction(item.id)
      if (!r.ok) {
        setDeleteError(errorText(r.error))
        return
      }
      setList((l) => l.filter((i) => i.id !== item.id))
      setConfirmDelete(null)
      openPanel(null)
      show({ message: t('toast.deleted'), tone: 'status' })
      router.refresh()
    } catch {
      setDeleteError(t('errors.failed'))
    } finally {
      setBusy(false)
    }
  }

  // ── Toolbar ────────────────────────────────────────────────────────────────
  const opt = <T extends string>(ns: 'area' | 'type' | 'priority' | 'status', values: readonly T[]) =>
    values.map((v) => ({ value: v, label: t(`${ns}.${v}` as 'type.bug') }))
  const usedProjects = projects.filter((p) => list.some((i) => i.projectId === p.id))
  const selects: ListToolbarFilter[] = [
    {
      key: 'status',
      label: t('filters.status'),
      value: filters.status,
      options: [{ value: 'open', label: t('filters.statusOpen') }, { value: 'all', label: t('filters.statusAll') }, ...opt('status', BACKLOG_STATUSES)],
      onChange: (v) => update({ status: v as BacklogFilters['status'] }),
    },
    {
      key: 'priority',
      label: t('filters.priority'),
      value: filters.priority,
      options: [{ value: '', label: t('filters.priorityAll') }, ...opt('priority', BACKLOG_PRIORITIES)],
      onChange: (v) => update({ priority: v as BacklogFilters['priority'] }),
    },
    {
      key: 'type',
      label: t('filters.type'),
      value: filters.type,
      options: [{ value: '', label: t('filters.typeAll') }, ...opt('type', BACKLOG_TYPES)],
      onChange: (v) => update({ type: v as BacklogFilters['type'] }),
    },
    {
      key: 'area',
      label: t('filters.area'),
      value: filters.area,
      options: [{ value: '', label: t('filters.areaAll') }, ...opt('area', BACKLOG_AREAS)],
      onChange: (v) => update({ area: v as BacklogFilters['area'] }),
    },
    {
      key: 'project',
      label: t('filters.project'),
      value: filters.project,
      options: [
        { value: '', label: t('filters.projectAll') },
        { value: 'none', label: t('filters.projectNone') },
        ...usedProjects.map((p) => ({ value: p.id, label: p.name })),
      ],
      onChange: (v) => update({ project: v }),
    },
  ]
  const chips: FilterChip[] = []
  if (filters.status !== DEFAULT_BACKLOG_FILTERS.status)
    chips.push({ id: 'status', label: filters.status === 'all' ? t('filters.statusAll') : t(`status.${filters.status}` as 'status.done') })
  if (filters.priority) chips.push({ id: 'priority', label: t(`priority.${filters.priority}`) })
  if (filters.type) chips.push({ id: 'type', label: t(`type.${filters.type}`) })
  if (filters.area) chips.push({ id: 'area', label: t(`area.${filters.area}`) })
  if (filters.project) chips.push({ id: 'project', label: filters.project === 'none' ? t('filters.projectNone') : (projectName(filters.project) ?? filters.project) })
  const removeChip = (id: string) =>
    update(id === 'status' ? { status: DEFAULT_BACKLOG_FILTERS.status } : ({ [id]: '' } as Partial<BacklogFilters>))
  const isDefault = isDefaultBacklogFilters(filters)

  // ── Table ──────────────────────────────────────────────────────────────────
  const subtitle = (i: BacklogItem) =>
    [t(`area.${i.area}`), i.moduleId, projectName(i.projectId)].filter(Boolean).join(' · ')
  const columns: DataTableColumn<BacklogItem>[] = [
    {
      key: 'title',
      header: t('columns.title'),
      sortable: true,
      width: 'min-w-72',
      render: (i) => <CellText primary={i.title} secondary={subtitle(i)} />,
    },
    { key: 'type', header: t('columns.type'), width: 'w-32', render: (i) => <Pill tone="outline">{t(`type.${i.type}`)}</Pill> },
    { key: 'priority', header: t('columns.priority'), sortable: true, width: 'w-36', render: (i) => <PriorityPill priority={i.priority} /> },
    { key: 'status', header: t('columns.status'), sortable: true, width: 'w-36', render: (i) => <StatusPill status={i.status} /> },
    { key: 'updated', header: t('columns.updated'), sortable: true, width: 'w-32', render: (i) => <CellDate iso={i.updatedAt} /> },
  ]

  const newButton = (
    <button type="button" onClick={() => openPanel({ kind: 'new' })} className={PRIMARY_BUTTON}>
      {PLUS_ICON}
      {t('newItem')}
    </button>
  )

  // ── Panel ──────────────────────────────────────────────────────────────────
  const panelOpen = panel !== null && (panel.kind === 'new' || openItem !== null)
  const panelTitle = panel?.kind === 'new' ? t('detail.newTitle') : panel?.kind === 'edit' ? t('detail.editTitle') : (openItem?.title ?? '')
  const panelSubtitle = panel?.kind === 'view' && openItem ? subtitle(openItem) : undefined

  const formActions = (submitLabel: string, onCancel: () => void) => (
    <>
      <button type="submit" form={FORM_ID} disabled={busy} aria-busy={busy || undefined} className={PRIMARY_BUTTON}>
        {submitLabel}
      </button>
      <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
        {t('form.cancel')}
      </button>
    </>
  )

  let panelActions: ReactNode = null
  let panelBody: ReactNode = null
  if (panel?.kind === 'new') {
    panelActions = formActions(t('form.create'), () => openPanel(null))
    panelBody = (
      <>
        {formError ? <FormError text={formError} /> : null}
        <BacklogForm key="new" id={FORM_ID} initial={EMPTY_BACKLOG_INPUT} projects={projects} serverErrors={serverErrors} onSubmit={create} />
      </>
    )
  } else if (panel?.kind === 'edit' && openItem) {
    panelActions = formActions(t('form.save'), () => openPanel({ kind: 'view', id: openItem.id }))
    panelBody = (
      <>
        {formError ? <FormError text={formError} /> : null}
        <BacklogForm
          key={`edit-${openItem.id}`}
          id={FORM_ID}
          initial={{
            title: openItem.title,
            body: openItem.body,
            area: openItem.area,
            type: openItem.type,
            priority: openItem.priority,
            status: openItem.status,
            projectId: openItem.projectId,
            moduleId: openItem.moduleId,
            links: openItem.links,
          }}
          projects={projects}
          serverErrors={serverErrors}
          onSubmit={(input) => save(openItem.id, input)}
        />
      </>
    )
  } else if (panel?.kind === 'view' && openItem) {
    panelActions = (
      <>
        <label className="block w-44">
          <span className="sr-only">{t('detail.changeStatus')}</span>
          <select
            value={openItem.status}
            onChange={(e) => void changeStatus(openItem, e.target.value as BacklogStatus)}
            className={`${CONTROL} truncate`}
          >
            {BACKLOG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => openPanel({ kind: 'edit', id: openItem.id })} className={SECONDARY_BUTTON}>
          {t('detail.edit')}
        </button>
        <button
          type="button"
          onClick={() => {
            setDeleteError(null)
            setConfirmDelete(openItem)
          }}
          className={DESTRUCTIVE_BUTTON}
        >
          {t('detail.delete')}
        </button>
      </>
    )
    panelBody = <BacklogDetail item={openItem} projectName={projectName(openItem.projectId)} />
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <PageHeader title={t('title')} actions={newButton} />
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      {list.length === 0 ? (
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <>
          <ListToolbar
            label={t('filters.label')}
            search={{ value: filters.q, onChange: (q) => update({ q }), label: t('filters.search'), placeholder: t('filters.searchPlaceholder') }}
            filters={selects}
            summary={t('filters.showing', { shown: shown.length, total: list.length })}
            clear={{ label: t('filters.clear'), onClear: reset, visible: !isDefault }}
            sheet={{ activeCount: chips.length, resultCount: shown.length, chips, onRemoveChip: removeChip }}
            filterWidth="w-[10rem]"
          />

          {shown.length === 0 ? (
            <EmptyState
              title={t('filters.noMatch')}
              action={
                !isDefault ? (
                  <button type="button" onClick={reset} className={SECONDARY_BUTTON}>
                    {t('filters.clear')}
                  </button>
                ) : undefined
              }
            />
          ) : (
            <>
              <div className="hidden md:block">
                <DataTable
                  label={t('title')}
                  rows={shown}
                  rowKey={(i) => i.id}
                  columns={columns}
                  minWidth="min-w-[52rem]"
                  sort={{
                    column: filters.sort.key,
                    dir: filters.sort.dir,
                    onSort: (key) => update({ sort: nextBacklogSort(key as BacklogSortKey, filters.sort) }),
                  }}
                  onRowClick={(i) => openPanel({ kind: 'view', id: i.id })}
                />
              </div>
              <ul className="flex flex-col gap-3 md:hidden">
                {shown.map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      onClick={() => openPanel({ kind: 'view', id: i.id })}
                      aria-label={t('detail.open', { title: i.title })}
                      className="flex w-full flex-col items-start gap-2 rounded-xl border border-border bg-card px-4 py-3 text-left text-card-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <span className="line-clamp-2 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{i.title}</span>
                      <span className="line-clamp-1 text-sm leading-5 text-muted-foreground">{subtitle(i)}</span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <PriorityPill priority={i.priority} />
                        <StatusPill status={i.status} />
                        <Pill tone="outline">{t(`type.${i.type}`)}</Pill>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <SidePanel
        open={panelOpen}
        title={panelTitle}
        subtitle={panelSubtitle}
        closeLabel={t('detail.close')}
        onClose={() => openPanel(null)}
        actions={panelActions}
      >
        {panelBody}
      </SidePanel>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t('confirmDelete.title')}
        body={confirmDelete ? t('confirmDelete.body', { title: confirmDelete.title }) : ''}
        confirmLabel={t('confirmDelete.confirm')}
        cancelLabel={t('form.cancel')}
        busy={busy}
        error={deleteError}
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />

      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </div>
  )
}

function FormError({ text }: { text: string }) {
  return (
    <p role="alert" className="mb-4 rounded-xl border border-destructive px-4 py-3 text-sm leading-5 text-destructive">
      {text}
    </p>
  )
}

function BacklogDetail({ item, projectName }: { item: BacklogItem; projectName: string | null }) {
  const t = useTranslations('admin.backlog')
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-1.5">
        <PriorityPill priority={item.priority} />
        <StatusPill status={item.status} />
        <Pill tone="outline">{t(`type.${item.type}`)}</Pill>
        <Pill tone="muted">{t(`area.${item.area}`)}</Pill>
      </div>

      {item.body ? (
        <div className="rounded-xl border border-border bg-background px-4 py-3 font-mono text-sm leading-6 break-words whitespace-pre-wrap text-foreground">
          {item.body}
        </div>
      ) : (
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('detail.noBody')}</p>
      )}

      {item.links.length ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm leading-5 font-semibold text-foreground">{t('detail.links')}</h3>
          <ul className="flex flex-col gap-1">
            {item.links.map((l, n) => (
              <li key={`${n}-${l.url}`}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-1.5 text-[0.9375rem] break-all text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {l.label}
                  <span aria-hidden="true">↗</span>
                  <span className="sr-only"> {t('detail.opensInNewTab')}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <dl>
        <FactRow label={t('detail.project')}>{projectName ?? t('detail.none')}</FactRow>
        <FactRow label={t('detail.module')}>{item.moduleId ? <span className="font-mono">{item.moduleId}</span> : t('detail.none')}</FactRow>
        <FactRow label={t('detail.created')}>
          <LocalDate iso={item.createdAt} empty={t('detail.none')} />
        </FactRow>
        <FactRow label={t('detail.updated')}>
          <LocalDate iso={item.updatedAt} empty={t('detail.none')} />
        </FactRow>
        {item.doneAt ? (
          <FactRow label={t('detail.done')}>
            <LocalDate iso={item.doneAt} />
          </FactRow>
        ) : null}
      </dl>
    </div>
  )
}
