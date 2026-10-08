'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { DashboardSubmission, SubmissionStatus } from '@/lib/api/client-dashboard'
import {
  deleteSubmissionsAction,
  setSubmissionStatusAction,
  setSubmissionsStatusBatchAction,
} from '@/app/[locale]/(client)/[tenant]/submissions/actions'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { BarButton, SheetItem } from '@/components/app/ui/BarButton'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import type { CardMenuItem } from '@/components/app/ui/CardMenu'
import { FilterSelect } from '@/components/app/ui/FilterBar'
import { idRange, SelectionBar } from '@/components/app/ui/SelectionBar'
import { SidePanel } from '@/components/app/ui/SidePanel'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import {
  applySubmissionFilters,
  dataKeys,
  DEFAULT_SUBMISSION_FILTERS,
  groupCounts,
  isDefaultSubmissionFilters,
  nextSubmissionSort,
  submissionsCsv,
  submissionStatusCounts,
  type SubmissionFilters,
} from '@/lib/client/submissions-filter'
import { FORMS_ICONS, SubmissionStatusPill, SubmissionStatusSelect } from './forms-bits'
import { humanizeKey, humanizeValue, SubmissionDetail } from './SubmissionDetail'
import { SubmissionPhoneList } from './SubmissionCards'
import { SubmissionsFilters } from './SubmissionsFilters'
import { SubmissionsTable } from './SubmissionsTable'

/** The server's batch cap (SUBMISSION_BATCH_MAX); larger selections go in chunks. */
const BATCH = 100

const SECONDARY_BTN =
  'inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-border px-4 text-[0.9375rem] font-medium text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40'

/**
 * The Forms list (contact requests = form submissions) — built on the shared
 * list pattern like Posts and People: ListToolbar (search first, form, status,
 * received date), DataTable on computers, phone cards, CardMenu, SelectionBar
 * with BarButtons, ConfirmDialog, Toast, and a SidePanel with the request and
 * "Where it came from".
 *
 * Writes go through the Server Actions in submissions/actions.ts (they
 * re-check identity, grant, module permission and RLS): status changes are
 * optimistic and rolled back on failure; batches are chunked to the server
 * cap. `canUpdate` / `canDelete` come from the grant (forms.submission.update
 * / .delete) and only hide controls: without update the status is a
 * read-only pill and there are no mark-as actions; without delete there is
 * no delete anywhere. "Summary by" and CSV export live on the summary line.
 */
export function SubmissionsBrowser({
  submissions,
  projectSlug,
  locale,
  canUpdate,
  canDelete,
}: {
  submissions: DashboardSubmission[]
  projectSlug: string
  locale: string
  /** Server-computed from the caller's grant (forms.submission.update). UI only — the server re-checks. */
  canUpdate: boolean
  /** Server-computed from the caller's grant (forms.submission.delete). UI only — the server re-checks. */
  canDelete: boolean
}) {
  const t = useTranslations('clientDashboard.submissions')
  const { toast, show } = useUndo()

  // Local copy for optimistic updates; replaced when the server sends a fresh list.
  const [rows, setRows] = useState(submissions)
  const [seen, setSeen] = useState(submissions)
  if (seen !== submissions) {
    setSeen(submissions)
    setRows(submissions)
  }

  // ── Filters ────────────────────────────────────────────────────────────────
  const [filters, setFilters] = useState<SubmissionFilters>(DEFAULT_SUBMISSION_FILTERS)
  const update = (patch: Partial<SubmissionFilters>) => setFilters((f) => ({ ...f, ...patch }))
  const reset = () => setFilters((f) => ({ ...DEFAULT_SUBMISSION_FILTERS, sort: f.sort }))
  const shown = useMemo(() => applySubmissionFilters(rows, filters), [rows, filters])
  const counts = useMemo(() => submissionStatusCounts(rows, filters), [rows, filters])
  const forms = useMemo(() => Array.from(new Set(rows.map((r) => r.formId))).sort(), [rows])
  const keys = useMemo(() => dataKeys(rows), [rows])
  const isDefault = isDefaultSubmissionFilters(filters)

  const [groupBy, setGroupBy] = useState('none')
  const groups = useMemo(() => groupCounts(shown, groupBy), [shown, groupBy])

  // ── Selection ──────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lastPicked, setLastPicked] = useState<string | null>(null)
  const selectedRows = shown.filter((r) => selected.has(r.id))
  const selectedIds = selectedRows.map((r) => r.id)
  const allState: 'none' | 'some' | 'all' =
    selectedIds.length === 0 ? 'none' : selectedIds.length === shown.length ? 'all' : 'some'

  const toggle = (id: string, checked: boolean, shift: boolean) => {
    const order = shown.map((r) => r.id)
    setSelected((s) => {
      const n = new Set(s)
      const ids = shift && lastPicked && lastPicked !== id ? idRange(order, lastPicked, id) : [id]
      for (const x of ids) {
        if (checked) n.add(x)
        else n.delete(x)
      }
      return n
    })
    setLastPicked(id)
  }
  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(shown.map((r) => r.id)) : new Set())
    setLastPicked(null)
  }
  const clearSelection = () => {
    setSelected(new Set())
    setLastPicked(null)
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  const [openId, setOpenId] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const opened = openId ? (rows.find((r) => r.id === openId) ?? null) : null
  const nameOf = (s: DashboardSubmission) => s.name ?? t('anonymous')
  const doneKey = (s: SubmissionStatus) => (s === 'processed' ? 'done.processed' : s === 'new' ? 'done.new' : 'done.archived')

  async function runChunks(ids: string[], call: (chunk: string[]) => Promise<{ ok: boolean }>): Promise<string[]> {
    const done: string[] = []
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH)
      const res = await call(chunk).catch(() => ({ ok: false }))
      if (!res.ok) break
      done.push(...chunk)
    }
    return done
  }

  /** Optimistic status change for one or many requests; what the server refuses rolls back. */
  async function setStatus(ids: string[], next: SubmissionStatus) {
    if (!canUpdate || !ids.length || busy) return
    const before = new Map(rows.filter((r) => ids.includes(r.id)).map((r) => [r.id, r.status]))
    setBusy(true)
    setRows((rs) => rs.map((r) => (before.has(r.id) ? { ...r, status: next } : r)))
    let done: Set<string>
    if (ids.length === 1) {
      const r = await setSubmissionStatusAction({ projectSlug, submissionId: ids[0], status: next, locale }).catch(() => ({ ok: false }))
      done = new Set(r.ok ? ids : [])
    } else {
      done = new Set(await runChunks(ids, (submissionIds) => setSubmissionsStatusBatchAction({ projectSlug, submissionIds, status: next, locale })))
    }
    if (done.size < ids.length) {
      setRows((rs) => rs.map((r) => (before.has(r.id) && !done.has(r.id) ? { ...r, status: before.get(r.id)! } : r)))
      show({ message: ids.length === 1 ? t('updateError') : t('batchError'), tone: 'error' })
    } else {
      show({ message: t(doneKey(next), { count: done.size }), tone: 'status' })
      if (ids.length > 1) clearSelection()
    }
    setBusy(false)
  }

  async function remove(ids: string[]) {
    if (!canDelete || !ids.length) return
    setBusy(true)
    const done = new Set(await runChunks(ids, (submissionIds) => deleteSubmissionsAction({ projectSlug, submissionIds, locale })))
    setRows((rs) => rs.filter((r) => !done.has(r.id)))
    setSelected((s) => new Set([...s].filter((id) => !done.has(id))))
    if (openId && done.has(openId)) setOpenId(null)
    if (done.size < ids.length) show({ message: t('batchError'), tone: 'error' })
    else show({ message: t('done.deleted', { count: done.size }), tone: 'status' })
    setConfirmDelete(null)
    setBusy(false)
  }

  function exportCsv(list: DashboardSubmission[]) {
    if (!list.length) return
    const blob = new Blob(['﻿' + submissionsCsv(list)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leads-${projectSlug}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const menuFor = (s: DashboardSubmission): CardMenuItem[] => {
    const items: CardMenuItem[] = [{ key: 'open', label: t('open'), onSelect: () => setOpenId(s.id) }]
    if (canUpdate) {
      if (s.status !== 'processed') items.push({ key: 'handled', label: t('markHandled'), onSelect: () => void setStatus([s.id], 'processed') })
      if (s.status !== 'new') items.push({ key: 'new', label: t('markNew'), onSelect: () => void setStatus([s.id], 'new') })
      if (s.status !== 'archived') items.push({ key: 'archive', label: t('markArchived'), onSelect: () => void setStatus([s.id], 'archived') })
    }
    items.push({ key: 'export', label: t('exportOne'), onSelect: () => exportCsv([s]) })
    if (canDelete) items.push({ key: 'delete', label: t('delete'), onSelect: () => setConfirmDelete([s.id]), destructive: true })
    return items
  }

  const none = !selectedIds.length || busy

  return (
    <>
      <SubmissionsFilters
        filters={filters}
        update={update}
        reset={reset}
        isDefault={isDefault}
        forms={forms}
        counts={counts}
        resultCount={shown.length}
        total={rows.length}
        summaryExtra={
          <span className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label={t('filters.groupBy')}
              value={groupBy}
              onChange={setGroupBy}
              sizing="w-[13rem] shrink-0"
              options={[
                { value: 'none', label: `${t('filters.groupBy')}: ${t('filters.groupNone')}` },
                { value: 'form', label: `${t('filters.groupBy')}: ${t('filters.groupForm')}` },
                { value: 'status', label: `${t('filters.groupBy')}: ${t('filters.groupStatus')}` },
                ...keys.map((k) => ({ value: k, label: `${t('filters.groupBy')}: ${humanizeKey(k)}` })),
              ]}
            />
            <button type="button" onClick={() => exportCsv(shown)} disabled={shown.length === 0} className={SECONDARY_BTN}>
              {FORMS_ICONS.download}
              {t('exportCsv')}
            </button>
          </span>
        }
      />

      {groups.length > 0 ? (
        <ul aria-label={t('filters.groupBy')} className="flex flex-wrap gap-2">
          {groups.map(([key, n]) => (
            <li key={key} className="rounded-full border border-border px-3 py-1 text-[0.8125rem] text-muted-foreground">
              {groupBy === 'status' ? t(`status.${key as SubmissionStatus}`) : humanizeValue(key)}:{' '}
              <span className="font-semibold text-foreground">{n}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-10">
          <p className="font-medium text-foreground">{t('filters.noMatch')}</p>
          {!isDefault ? (
            <button type="button" onClick={reset} className={`${SECONDARY_BTN} mt-3`}>
              {t('filters.clear')}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          {/* Computers */}
          <div className="hidden md:block">
            <SubmissionsTable
              rows={shown}
              canUpdate={canUpdate}
              selected={selected}
              onToggle={toggle}
              allState={allState}
              onToggleAll={toggleAll}
              sort={filters.sort}
              onSort={(c) => update({ sort: nextSubmissionSort(c, filters.sort) })}
              onOpen={(s) => setOpenId(s.id)}
              onStatus={(s, next) => void setStatus([s.id], next)}
              menuFor={menuFor}
            />
          </div>
          {/* Phones */}
          <div className="md:hidden">
            <SubmissionPhoneList rows={shown} selected={selected} onToggle={toggle} onOpen={(s) => setOpenId(s.id)} menuFor={menuFor} />
          </div>
        </>
      )}

      {selectedIds.length > 0 ? (
        <SelectionBar label={t('selection')} count={t('selected', { count: selectedIds.length })}>
          {/* Phones: the main actions + More */}
          {canUpdate ? (
            <BarButton className="md:hidden" disabled={none} onPress={() => void setStatus(selectedIds, 'processed')} icon={FORMS_ICONS.handled}>
              {t('markHandled')}
            </BarButton>
          ) : null}
          <BarButton className="md:hidden" disabled={none} onPress={() => exportCsv(selectedRows)} icon={FORMS_ICONS.download}>
            {t('exportSelected')}
          </BarButton>
          {canDelete ? (
            <BarButton className="md:hidden" disabled={none} onPress={() => setConfirmDelete(selectedIds)} icon={FORMS_ICONS.trash} destructive>
              {t('delete')}
            </BarButton>
          ) : null}
          <BarButton className="md:hidden" disabled={busy} onPress={() => setMoreOpen(true)} icon={FORMS_ICONS.more}>
            {t('more')}
          </BarButton>
          {/* Computers: everything in the bar */}
          {canUpdate ? (
            <>
              <BarButton className="hidden md:flex" disabled={none} onPress={() => void setStatus(selectedIds, 'processed')} icon={FORMS_ICONS.handled}>
                {t('markHandled')}
              </BarButton>
              <BarButton className="hidden md:flex" disabled={none} onPress={() => void setStatus(selectedIds, 'new')} icon={FORMS_ICONS.markNew}>
                {t('markNew')}
              </BarButton>
              <BarButton className="hidden md:flex" disabled={none} onPress={() => void setStatus(selectedIds, 'archived')} icon={FORMS_ICONS.archive}>
                {t('markArchived')}
              </BarButton>
            </>
          ) : null}
          <BarButton className="hidden md:flex" disabled={none} onPress={() => exportCsv(selectedRows)} icon={FORMS_ICONS.download}>
            {t('exportSelected')}
          </BarButton>
          {canDelete ? (
            <BarButton className="hidden md:flex" disabled={none} onPress={() => setConfirmDelete(selectedIds)} icon={FORMS_ICONS.trash} destructive>
              {t('delete')}
            </BarButton>
          ) : null}
          <BarButton className="hidden md:flex" onPress={clearSelection} icon={FORMS_ICONS.x}>
            {t('clearSelection')}
          </BarButton>
        </SelectionBar>
      ) : null}

      <BottomSheet open={moreOpen} title={t('more')} onClose={() => setMoreOpen(false)}>
        {canUpdate ? (
          <>
            <SheetItem disabled={none} onPress={() => { setMoreOpen(false); void setStatus(selectedIds, 'new') }}>
              {t('markNew')}
            </SheetItem>
            <SheetItem disabled={none} onPress={() => { setMoreOpen(false); void setStatus(selectedIds, 'archived') }}>
              {t('markArchived')}
            </SheetItem>
          </>
        ) : null}
        <SheetItem onPress={() => { setMoreOpen(false); clearSelection() }}>{t('clearSelection')}</SheetItem>
      </BottomSheet>

      <SidePanel
        open={opened !== null}
        title={opened ? nameOf(opened) : ''}
        subtitle={opened?.email ?? undefined}
        closeLabel={t('close')}
        onClose={() => setOpenId(null)}
        actions={
          opened ? (
            <>
              {canUpdate ? (
                <SubmissionStatusSelect
                  size="lg"
                  status={opened.status}
                  label={t('columns.status')}
                  onChange={(next) => void setStatus([opened.id], next)}
                />
              ) : (
                <SubmissionStatusPill status={opened.status} />
              )}
              <span className="flex-1" />
              <button type="button" onClick={() => exportCsv([opened])} className={SECONDARY_BTN}>
                {FORMS_ICONS.download}
                {t('exportOne')}
              </button>
              {canDelete ? (
                <button type="button" disabled={busy} onClick={() => setConfirmDelete([opened.id])} className={`${SECONDARY_BTN} text-destructive`}>
                  {FORMS_ICONS.trash}
                  {t('delete')}
                </button>
              ) : null}
            </>
          ) : null
        }
      >
        {opened ? <SubmissionDetail s={opened} locale={locale} columns={1} /> : null}
      </SidePanel>

      {canDelete ? (
        <ConfirmDialog
          open={confirmDelete !== null}
          title={t('deleteTitle', { count: confirmDelete?.length ?? 0 })}
          body={t('deleteBody')}
          confirmLabel={t('delete')}
          busy={busy}
          onConfirm={() => void remove(confirmDelete ?? [])}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}

      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </>
  )
}
