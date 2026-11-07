'use client'

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Button, ButtonLink } from '@/components/app/ui/Button'
import { EmptyState } from '@/components/app/ui/EmptyState'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar } from '@/components/app/ui/ListToolbar'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { CellPill, CellText } from '@/components/app/ui/list/cells'
import { useRouter } from '@/i18n/navigation'
import { bookingsHref, type BookingsQuery } from '@/lib/reservations/bookings-form'
import { BOOKING_STATUSES, PAYMENT_STATUSES, type BookingStatus, type PaymentStatus } from '@/lib/reservations/types'
import type { BookingListRow, BookingPage, TargetOption } from '@/lib/reservations/server/bookings-read'
import { BookingStatusPill, PaymentStatusPill, ReviewFlags, useBookingFormat } from './booking-bits'
import { BookingsTabs } from './BookingsTabs'

/** Plain body text of a table cell, on the same 1.5rem first line as the cell primitives. */
function Plain({ children, clamp = false }: { children: ReactNode; clamp?: boolean }) {
  return <span className={`block text-sm leading-6 text-foreground ${clamp ? 'line-clamp-2' : ''}`}>{children}</span>
}

/**
 * The Bookings list (ADR-044 D16.15) — a Records screen: ListToolbar +
 * DataTable on computers, ListRow on phones. Filtering and paging happen in the
 * database (the address carries the filters, so a list can be shared or
 * bookmarked); the search waits for a pause in typing.
 */
export function BookingsBrowser({
  projectSlug,
  page,
  targets,
  query,
  timeZone,
  unavailable = false,
}: {
  projectSlug: string
  page: BookingPage
  targets: TargetOption[]
  query: BookingsQuery
  timeZone: string
  unavailable?: boolean
}) {
  const t = useTranslations('clientDashboard.bookings')
  const router = useRouter()
  const fmt = useBookingFormat(timeZone)
  const [q, setQ] = useState(query.q)
  const [, startTransition] = useTransition()
  const firstRun = useRef(true)

  const go = (next: Partial<BookingsQuery>, toPage = 1) => startTransition(() => router.replace(bookingsHref(projectSlug, { ...query, ...next }, toPage)))

  // The search waits for a pause in typing, then reloads the list from page 1.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    if (q.trim() === query.q.trim()) return
    const id = setTimeout(() => go({ q }), 350)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const isDefault = !query.status && !query.paymentStatus && !query.targetId && !query.q.trim()
  const reset = () => {
    setQ('')
    startTransition(() => router.replace(bookingsHref(projectSlug, { status: null, paymentStatus: null, targetId: null, q: '' })))
  }
  const hrefOf = (x: BookingListRow) => `/${projectSlug}/bookings/${x.id}`
  const targetLabel = (id: string) => targets.find((x) => x.targetId === id)?.label || t('list.allWhat')

  const chips: FilterChip[] = [
    ...(query.status ? [{ id: 'status', label: t(`status.${query.status}`) }] : []),
    ...(query.paymentStatus ? [{ id: 'payment', label: t(`paymentStatus.${query.paymentStatus}`) }] : []),
    ...(query.targetId ? [{ id: 'what', label: targetLabel(query.targetId) }] : []),
  ]
  const removeChip = (id: string) => go(id === 'status' ? { status: null } : id === 'payment' ? { paymentStatus: null } : { targetId: null })

  const from = page.total === 0 ? 0 : (page.page - 1) * page.pageSize + 1
  const to = Math.min(page.total, (page.page - 1) * page.pageSize + page.rows.length)
  const lastPage = Math.max(1, Math.ceil(page.total / page.pageSize))
  const nameOf = (x: BookingListRow) => (x.anonymised ? t('list.anonymised') : x.name || x.email || t('list.noName'))
  const sessionsOf = (x: BookingListRow) => (x.hasPass ? t('list.pass') : x.sessionCount > 0 ? t('list.sessions', { count: x.sessionCount }) : t('list.noSessions'))

  const columns: DataTableColumn<BookingListRow>[] = [
    { key: 'reference', header: t('list.columns.reference'), width: 'w-36', className: 'whitespace-nowrap', render: (x) => <CellText primary={x.reference} href={hrefOf(x)} clamp={1} /> },
    { key: 'name', header: t('list.columns.name'), width: 'min-w-48', render: (x) => <CellText primary={nameOf(x)} secondary={x.anonymised ? undefined : x.name ? x.email ?? undefined : undefined} clamp={1} /> },
    { key: 'what', header: t('list.columns.what'), width: 'min-w-56', render: (x) => <Plain clamp>{x.what ?? '—'}</Plain> },
    { key: 'sessions', header: t('list.columns.sessions'), width: 'w-32', className: 'whitespace-nowrap', render: (x) => <Plain>{sessionsOf(x)}</Plain> },
    { key: 'amount', header: t('list.columns.amount'), width: 'w-28', className: 'whitespace-nowrap', render: (x) => <Plain>{fmt.money(x.totalCents)}</Plain> },
    { key: 'payment', header: t('list.columns.payment'), width: 'w-40', render: (x) => <CellPill><PaymentStatusPill status={x.paymentStatus} /></CellPill> },
    {
      key: 'status',
      header: t('list.columns.status'),
      width: 'w-48',
      render: (x) => (
        <CellPill>
          <BookingStatusPill status={x.status} />
          <ReviewFlags paymentReview={x.paymentReview} eligibilityReview={x.eligibilityReview} />
        </CellPill>
      ),
    },
    { key: 'created', header: t('list.columns.created'), width: 'w-44', className: 'whitespace-nowrap', render: (x) => <Plain>{fmt.dateTime(x.createdAt)}</Plain> },
  ]

  return (
    <>
      <BookingsTabs projectSlug={projectSlug} current="bookings" />
      <PageHeader title={t('list.title')} />

      {unavailable ? (
        <EmptyState title={t('list.unavailableTitle')} body={t('list.unavailableBody')} />
      ) : page.total === 0 && isDefault ? (
        <EmptyState title={t('list.emptyTitle')} body={t('list.emptyBody')} />
      ) : (
        <>
          <ListToolbar
            label={t('list.filtersLabel')}
            search={{ value: q, onChange: setQ, label: t('list.searchLabel'), placeholder: t('list.search') }}
            filters={[
              {
                key: 'status',
                label: t('list.statusFilter'),
                value: query.status ?? 'all',
                options: [{ value: 'all', label: t('list.allStatuses') }, ...BOOKING_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))],
                onChange: (v) => go({ status: v === 'all' ? null : (v as BookingStatus) }),
              },
              {
                key: 'payment',
                label: t('list.paymentFilter'),
                value: query.paymentStatus ?? 'all',
                options: [{ value: 'all', label: t('list.allPayments') }, ...PAYMENT_STATUSES.map((s) => ({ value: s, label: t(`paymentStatus.${s}`) }))],
                onChange: (v) => go({ paymentStatus: v === 'all' ? null : (v as PaymentStatus) }),
              },
              ...(targets.length
                ? [{
                    key: 'what',
                    label: t('list.whatFilter'),
                    value: query.targetId ?? 'all',
                    options: [{ value: 'all', label: t('list.allWhat') }, ...targets.map((x) => ({ value: x.targetId, label: x.label || '—' }))],
                    onChange: (v: string) => go({ targetId: v === 'all' ? null : v }),
                  }]
                : []),
            ]}
            summary={page.total === 0 ? t('list.showingNone') : t('list.showing', { from, to, total: page.total })}
            clear={{ label: t('list.clear'), onClear: reset, visible: !isDefault }}
            sheet={{ activeCount: chips.length, resultCount: page.total, chips, onRemoveChip: removeChip }}
          />
          {page.rows.length === 0 ? (
            <Notice>{t('list.noMatch')}</Notice>
          ) : (
            <>
              <div className="hidden md:block">
                <DataTable rows={page.rows} columns={columns} rowKey={(x) => x.id} rowHref={hrefOf} label={t('list.title')} minWidth="min-w-[64rem]" />
              </div>
              <ul className="flex flex-col gap-3 md:hidden">
                {page.rows.map((x) => (
                  <ListRow key={x.id} href={hrefOf(x)} label={t('list.open', { reference: x.reference, name: nameOf(x) })}>
                    <span className="text-xs leading-5 font-medium text-muted-foreground">{x.reference}</span>
                    <span className="text-[0.9375rem] leading-6 font-semibold break-words text-foreground">{nameOf(x)}</span>
                    {x.what ? <span className="text-sm leading-5 break-words text-muted-foreground">{x.what}</span> : null}
                    <span className="flex flex-wrap items-start gap-1.5">
                      <BookingStatusPill status={x.status} />
                      <PaymentStatusPill status={x.paymentStatus} />
                      <ReviewFlags paymentReview={x.paymentReview} eligibilityReview={x.eligibilityReview} />
                    </span>
                    <span className="text-xs leading-5 text-muted-foreground">
                      {sessionsOf(x)} · {fmt.money(x.totalCents)} · {fmt.dateTime(x.createdAt)}
                    </span>
                  </ListRow>
                ))}
              </ul>
              {lastPage > 1 ? (
                <nav aria-label={t('list.pageLabel')} className="flex items-start gap-2">
                  {page.page > 1 ? (
                    <ButtonLink variant="secondary" href={bookingsHref(projectSlug, query, page.page - 1)}>
                      {t('list.previous')}
                    </ButtonLink>
                  ) : (
                    <Button variant="secondary" disabled>
                      {t('list.previous')}
                    </Button>
                  )}
                  {page.page < lastPage ? (
                    <ButtonLink variant="secondary" href={bookingsHref(projectSlug, query, page.page + 1)}>
                      {t('list.next')}
                    </ButtonLink>
                  ) : (
                    <Button variant="secondary" disabled>
                      {t('list.next')}
                    </Button>
                  )}
                </nav>
              ) : null}
            </>
          )}
        </>
      )}
    </>
  )
}
