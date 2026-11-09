'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter as useAppRouter } from '@/i18n/navigation'
import type { TestimonialSubmission } from '@/lib/api/testimonial-submissions'
import { createTestimonialFromSubmissionAction, rejectTestimonialSubmissionAction } from '@/app/[locale]/(client)/[tenant]/testimonials/actions'
import { normalizeSearch } from '@/lib/client/posts-filter'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import type { CardMenuItem } from '@/components/app/ui/CardMenu'
import { CardMenu } from '@/components/app/ui/CardMenu'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { EmptyState } from '@/components/app/ui/EmptyState'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Notice } from '@/components/app/ui/Notice'
import { DisplayTimeZoneContext, Pill, type PillTone } from '@/components/app/ui/list/cells'
import { CellPill, CellText } from '@/components/app/ui/list/cells'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { editingZone } from '@/components/app/lifecycle/zoned-time'
import { RatingValue, useDateTime } from './testimonial-bits'

type SubmissionState = 'new' | 'created' | 'rejected'
const STATES: readonly SubmissionState[] = ['new', 'created', 'rejected']
const TONE: Record<SubmissionState, PillTone> = { new: 'highlight', created: 'success', rejected: 'muted' }

type Row = TestimonialSubmission & { state: SubmissionState; name: string }

function stateOf(s: TestimonialSubmission): SubmissionState {
  if (s.testimonial || s.status === 'processed') return 'created'
  return s.status === 'archived' ? 'rejected' : 'new'
}

/**
 * The Submissions tab of Testimonials (ADR-048 D4, Phase 2) — a Records-kind
 * list screen, like Contact requests: ListToolbar + DataTable on computers,
 * ListRow on phones, never cards, no view switch. Columns: Received · Name ·
 * Testimonial · Rating · Consent · Status · ⋯. A row opens the full text and
 * the private contact details in a sheet.
 *
 * "Create testimonial" makes a DRAFT from the submission (never published
 * automatically) and opens it; when the visitor did not tick the consent box
 * the editor says that permission still needs ticking. "Reject" asks first and
 * shows "Rejected · Undo" (the submission is only marked, nothing is deleted).
 *
 * When `acceptSubmissions` is off the empty state says so; past submissions
 * stay visible.
 */
export function TestimonialSubmissionsBrowser({
  projectSlug,
  submissions,
  loadFailed,
  acceptSubmissions,
  timeZone = null,
  canWrite,
  belowHeader,
}: {
  projectSlug: string
  submissions: TestimonialSubmission[] | null
  loadFailed: boolean
  /** Module config: the Testimonial form is switched on. */
  acceptSubmissions: boolean
  timeZone?: string | null
  canWrite: boolean
  belowHeader?: ReactNode
}) {
  const t = useTranslations('clientDashboard.testimonials.submissions')
  const te = useTranslations('clientDashboard.testimonials.errors')
  const tList = useTranslations('clientDashboard.testimonials.list')
  const appRouter = useAppRouter()
  const { toast, show, schedule } = useUndo()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<SubmissionState | 'all'>('all')
  const [overlay, setOverlay] = useState<Record<string, SubmissionState>>({})
  const [viewing, setViewing] = useState<Row | null>(null)
  const [confirmReject, setConfirmReject] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const working = useRef(false)

  const rows: Row[] = useMemo(
    () =>
      (submissions ?? []).map((s) => ({
        ...s,
        state: overlay[s.id] ?? stateOf(s),
        name: s.displayName || s.fullName || t('noName'),
      })),
    [submissions, overlay, t]
  )
  const nq = normalizeSearch(q.trim())
  const matches = (r: Row) => !nq || normalizeSearch(`${r.name} ${r.fullName} ${r.text}`).includes(nq)
  const shown = rows.filter((r) => matches(r) && (status === 'all' || r.state === status))
  const counts: Record<SubmissionState | 'all', number> = { all: 0, new: 0, created: 0, rejected: 0 }
  for (const r of rows) {
    if (!matches(r)) continue
    counts.all++
    counts[r.state]++
  }
  const stateLabel = (s: SubmissionState) => t(`status.${s}`)
  const errorText = (code: string) => (te.has(code) ? te(code) : te('failed'))

  async function create(r: Row) {
    if (working.current) return
    working.current = true
    setBusy(true)
    try {
      const res = await createTestimonialFromSubmissionAction({ projectSlug, submissionId: r.id })
      if (!res.ok) {
        working.current = false
        return show({ message: res.error === 'conflict' ? t('alreadyCreated') : errorText(res.error), tone: 'error' }, 8000)
      }
      appRouter.push(`/${projectSlug}/testimonials/${res.id}?from=${res.permissionToPublish ? 'submission' : 'submission-no-consent'}`)
    } catch {
      working.current = false
      show({ message: te('failed'), tone: 'error' }, 7000)
    } finally {
      setBusy(false)
    }
  }

  /** After the confirmation: "Rejected · Undo" — the row changes at once, the server call waits. */
  function reject(r: Row) {
    setConfirmReject(null)
    setOverlay((o) => ({ ...o, [r.id]: 'rejected' }))
    let failure = te('failed')
    schedule({
      id: `reject:${r.id}`,
      message: t('done.rejected', { name: r.name }),
      undoLabel: t('undo'),
      get failMessage() {
        return failure
      },
      restore: () =>
        setOverlay((o) => {
          const n = { ...o }
          delete n[r.id]
          return n
        }),
      run: async () => {
        const res = await rejectTestimonialSubmissionAction({ projectSlug, submissionId: r.id })
        if (!res.ok) failure = errorText(res.error)
        else appRouter.refresh()
        return res.ok
      },
    })
  }

  const menuFor = (r: Row): CardMenuItem[] => {
    const items: CardMenuItem[] = [{ key: 'view', label: t('actions.view'), onSelect: () => setViewing(r) }]
    if (r.state === 'created' && r.testimonial) items.push({ key: 'open', label: t('actions.openTestimonial'), onSelect: () => appRouter.push(`/${projectSlug}/testimonials/${r.testimonial!.id}`) })
    if (canWrite && r.state === 'new') {
      items.push({ key: 'create', label: t('actions.create'), onSelect: () => void create(r) })
      items.push({ key: 'reject', label: t('actions.reject'), onSelect: () => setConfirmReject(r), destructive: true, separated: true })
    }
    return items
  }

  const header = <PageHeader title={tList('title')} />

  const dialogs = (
    <>
      <BottomSheet open={viewing !== null} title={viewing ? t('detail.title', { name: viewing.name }) : ''} onClose={() => setViewing(null)}>
        {viewing ? <SubmissionDetail row={viewing} canWrite={canWrite} busy={busy} onCreate={() => void create(viewing)} onReject={() => { setConfirmReject(viewing); setViewing(null) }} /> : null}
      </BottomSheet>
      <ConfirmDialog
        open={confirmReject !== null}
        title={t('confirmReject.title', { name: confirmReject?.name ?? '' })}
        body={t('confirmReject.body')}
        confirmLabel={t('actions.reject')}
        onConfirm={() => confirmReject && reject(confirmReject)}
        onCancel={() => setConfirmReject(null)}
      />
      <Toast message={toast?.message ?? null} tone={toast?.tone} action={toast?.undo ? t('undo') : undefined} onAction={toast?.undo} />
    </>
  )

  if (loadFailed) {
    return (
      <div className="space-y-4">
        {header}
        {belowHeader}
        <Notice tone="error" title={t('loadFailed')} />
        {dialogs}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        {header}
        {belowHeader}
        {acceptSubmissions ? (
          <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <EmptyState title={t('offTitle')} body={t('offBody')} />
        )}
        {dialogs}
      </div>
    )
  }

  const selects: ListToolbarFilter[] = [
    {
      key: 'status',
      label: t('filters.status'),
      value: status,
      options: [{ value: 'all', label: `${t('filters.statusAll')} (${counts.all})` }, ...STATES.map((s) => ({ value: s, label: `${stateLabel(s)} (${counts[s]})` }))],
      onChange: (v) => setStatus(v as SubmissionState | 'all'),
    },
  ]
  const chips: FilterChip[] = status !== 'all' ? [{ id: 'status', label: stateLabel(status) }] : []
  const reset = () => {
    setQ('')
    setStatus('all')
  }

  return (
    <DisplayTimeZoneContext.Provider value={editingZone(timeZone)}>
      <div className="space-y-4">
        {header}
        {belowHeader}
        {!acceptSubmissions ? <Notice tone="info">{t('offNotice')}</Notice> : null}

        <ListToolbar
          label={t('filters.label')}
          search={{ value: q, onChange: setQ, label: t('filters.search'), placeholder: t('filters.searchPlaceholder') }}
          filters={selects}
          summary={t('filters.showing', { shown: shown.length, total: rows.length })}
          clear={{ label: t('filters.clear'), onClear: reset, visible: q.trim() !== '' || status !== 'all' }}
          sheet={{ activeCount: status !== 'all' ? 1 : 0, resultCount: shown.length, chips, onRemoveChip: () => setStatus('all') }}
        />

        {shown.length === 0 ? (
          <EmptyState titleAs="p" title={t('filters.noMatch')} action={<Button onClick={reset}>{t('filters.clear')}</Button>} />
        ) : (
          <>
            <div className="hidden md:block">
              <SubmissionsTable rows={shown} menuFor={menuFor} onOpen={setViewing} />
            </div>
            <div className="md:hidden">
              <SubmissionsPhoneList rows={shown} menuFor={menuFor} onOpen={setViewing} />
            </div>
          </>
        )}
        {dialogs}
      </div>
    </DisplayTimeZoneContext.Provider>
  )
}

function StatePill({ state }: { state: SubmissionState }) {
  const t = useTranslations('clientDashboard.testimonials.submissions')
  return <Pill tone={TONE[state]}>{t(`status.${state}`)}</Pill>
}

function ConsentPill({ consent }: { consent: boolean }) {
  const t = useTranslations('clientDashboard.testimonials.submissions')
  return <Pill tone={consent ? 'success' : 'outline'}>{consent ? t('consent.yes') : t('consent.no')}</Pill>
}

function SubmissionsTable({ rows, menuFor, onOpen }: { rows: Row[]; menuFor: (r: Row) => CardMenuItem[]; onOpen: (r: Row) => void }) {
  const t = useTranslations('clientDashboard.testimonials.submissions')
  const when = useDateTime()
  const columns: DataTableColumn<Row>[] = [
    { key: 'received', header: t('columns.received'), width: 'w-44', className: 'whitespace-nowrap', render: (r) => <span className="flex min-h-6 items-center text-sm leading-6 text-muted-foreground tabular-nums">{when(r.createdAt) || '—'}</span> },
    { key: 'name', header: t('columns.name'), width: 'min-w-40', render: (r) => <CellText primary={r.name} secondary={r.fullName && r.fullName !== r.name ? r.fullName : null} clamp={1} /> },
    { key: 'text', header: t('columns.text'), width: 'min-w-64', render: (r) => <span className="line-clamp-2 text-sm leading-6 break-words text-muted-foreground">{r.text || '—'}</span> },
    { key: 'rating', header: t('columns.rating'), width: 'w-24', render: (r) => <RatingValue rating={r.rating} /> },
    { key: 'consent', header: t('columns.consent'), width: 'w-28', render: (r) => <CellPill><ConsentPill consent={r.consent} /></CellPill> },
    { key: 'status', header: t('columns.status'), width: 'w-32', render: (r) => <CellPill><StatePill state={r.state} /></CellPill> },
    { key: 'actions', header: <span className="sr-only">{t('columns.actions')}</span>, width: 'w-12', render: (r) => <CardMenu variant="cell" label={t('menu', { name: r.name })} items={menuFor(r)} /> },
  ]
  return <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} label={t('title')} onRowClick={(r) => onOpen(r)} />
}

function SubmissionsPhoneList({ rows, menuFor, onOpen }: { rows: Row[]; menuFor: (r: Row) => CardMenuItem[]; onOpen: (r: Row) => void }) {
  const t = useTranslations('clientDashboard.testimonials.submissions')
  const when = useDateTime()
  return (
    <ul className="flex flex-col gap-3" aria-label={t('title')}>
      {rows.map((r) => (
        <ListRow key={r.id} onOpen={() => onOpen(r)} menu={{ label: t('menu', { name: r.name }), items: menuFor(r) }}>
          <span className="line-clamp-2 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{r.name}</span>
          <span className="flex flex-wrap items-start gap-1.5">
            <StatePill state={r.state} />
            <ConsentPill consent={r.consent} />
          </span>
          {r.text ? <span className="line-clamp-2 text-sm leading-5 text-foreground">{r.text}</span> : null}
          <span className="text-sm leading-5 text-muted-foreground tabular-nums">{when(r.createdAt)}</span>
        </ListRow>
      ))}
    </ul>
  )
}

function SubmissionDetail({ row, canWrite, busy, onCreate, onReject }: { row: Row; canWrite: boolean; busy: boolean; onCreate: () => void; onReject: () => void }) {
  const t = useTranslations('clientDashboard.testimonials.submissions')
  const when = useDateTime()
  const facts: Array<[string, string]> = [
    [t('detail.received'), when(row.createdAt)],
    [t('detail.fullName'), row.fullName],
    [t('detail.email'), row.email],
    [t('detail.phone'), row.phone],
  ]
  return (
    <div className="space-y-4">
      <p className="text-[0.9375rem] leading-6 whitespace-pre-line text-foreground">{row.text || t('noText')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <StatePill state={row.state} />
        <ConsentPill consent={row.consent} />
        <RatingValue rating={row.rating} empty={t('noRating')} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm leading-6">
        {facts.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
      {!row.consent && row.state === 'new' ? <Notice tone="info">{t('detail.noConsent')}</Notice> : null}
      {canWrite && row.state === 'new' ? (
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button variant="primary" disabled={busy} onClick={onCreate}>
            {t('actions.create')}
          </Button>
          <Button onClick={onReject}>{t('actions.reject')}</Button>
        </div>
      ) : null}
    </div>
  )
}
