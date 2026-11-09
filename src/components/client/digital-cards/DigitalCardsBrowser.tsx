'use client'

import { useMemo, useState } from 'react'
import { useLocale } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type { DigitalCardList, DigitalCardListItem, DigitalCardState } from '@/lib/api/digital-cards'
import { createPersonCardAction, createSiteCardAction } from '@/app/[locale]/(client)/[tenant]/cards/actions'
import { digitalCardErrorText, formatDigitalCardsMessage, getDigitalCardsMessages } from '@/lib/i18n/digital-cards-messages'
import { LifecycleBadge } from '@/components/app/lifecycle/LifecycleBadge'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button, ButtonLink } from '@/components/app/ui/Button'
import type { CardMenuItem } from '@/components/app/ui/CardMenu'
import { CardMenu } from '@/components/app/ui/CardMenu'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { ListToolbar } from '@/components/app/ui/ListToolbar'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { RadioList } from '@/components/app/ui/RadioList'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { CellPill, CellText, LocalDate, Pill } from '@/components/app/ui/list/cells'

type StatusFilter = 'all' | 'published' | 'draft' | 'unpublished' | 'archived'

/**
 * Digital Cards (ADR-049) — a Records list: ListToolbar + DataTable on
 * computers, ListRow on phones, no cards and no view switch. The site card
 * comes first, then the person cards by name. "New Site Card" shows only while
 * the project has none; "New Person Card" picks one of the People without a
 * card (disabled, with the reason, when there is nobody left).
 */
export function DigitalCardsBrowser({
  projectSlug,
  list,
  canWrite,
  peopleInstalled,
}: {
  projectSlug: string
  list: DigitalCardList
  /** digital-cards.write (the server re-checks). */
  canWrite: boolean
  /** The People module is installed (person cards need it). */
  peopleInstalled: boolean
}) {
  const m = getDigitalCardsMessages(useLocale())
  const s = m.screen
  const router = useRouter()
  const { toast, show } = useUndo()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cards = list.cards
  const titleOf = (c: DigitalCardListItem) => (c.kind === 'site' ? list.siteName || s.siteCard : c.title || m.editor.personFallback)
  const hrefOf = (c: DigitalCardListItem) => `/${projectSlug}/cards/${c.id}`
  const stateOf = (c: DigitalCardListItem): DigitalCardState => c.status
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return cards.filter((c) => {
      if (status === 'all' ? c.status === 'archived' : c.status !== status) return false
      if (!needle) return true
      return [titleOf(c), c.path, c.urlName ?? ''].join(' ').toLowerCase().includes(needle)
    })
    // titleOf only reads props
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, q, status])
  const isDefault = !q && status === 'all'

  const statusLabel: Record<StatusFilter, string> = {
    all: s.statusAll,
    published: s.statusPublished,
    draft: s.statusDraft,
    unpublished: s.statusUnpublished,
    archived: s.statusArchived,
  }
  const linksText = (n: number) => (n === 1 ? s.linksOne : formatDigitalCardsMessage(s.linksOther, { count: n }))
  const address = (c: DigitalCardListItem) => (list.origin ? `${list.origin.replace(/^https:\/\//, '')}${c.path}` : c.path)

  async function copy(c: DigitalCardListItem) {
    try {
      await navigator.clipboard.writeText(`${list.origin}${c.path}`)
      show({ message: s.copied, tone: 'status' })
    } catch {
      show({ message: s.copyFailed, tone: 'error' })
    }
  }
  const menuFor = (c: DigitalCardListItem): CardMenuItem[] => [
    { key: 'open', label: s.open, onSelect: () => router.push(hrefOf(c)) },
    ...(list.origin && c.isPublished && c.status !== 'archived' ? [{ key: 'copy', label: s.copyAddress, onSelect: () => void copy(c) }] : []),
  ]

  const kindPill = (c: DigitalCardListItem) => <Pill tone="muted">{c.kind === 'site' ? s.siteCard : s.personCard}</Pill>
  const missingPill = (c: DigitalCardListItem) => (c.personMissing ? <Pill tone="warning">{s.personMissing}</Pill> : null)

  const columns: DataTableColumn<DigitalCardListItem>[] = [
    {
      key: 'card',
      header: s.columnCard,
      width: 'min-w-64',
      render: (c) => <CellText primary={titleOf(c)} secondary={c.kind === 'site' ? s.siteCard : s.personCard} href={hrefOf(c)} />,
    },
    { key: 'address', header: s.columnAddress, width: 'w-64', render: (c) => <span className="text-sm leading-6 break-all text-foreground" translate="no">{address(c)}</span> },
    {
      key: 'status',
      header: s.columnStatus,
      width: 'w-56',
      render: (c) => (
        <CellPill>
          <span className="flex flex-col items-start gap-1">
            <LifecycleBadge status={stateOf(c)} changes={c.hasChanges} />
            {missingPill(c)}
          </span>
        </CellPill>
      ),
    },
    { key: 'links', header: s.columnLinks, width: 'w-28', className: 'whitespace-nowrap', render: (c) => <span className="text-sm leading-6 text-foreground">{linksText(c.linkCount)}</span> },
    { key: 'updated', header: s.columnUpdated, width: 'w-40', className: 'whitespace-nowrap', render: (c) => <LocalDate iso={c.updatedAt} className="text-sm leading-6 text-foreground" /> },
    {
      key: 'menu',
      header: <span className="sr-only">{s.columnActions}</span>,
      width: 'w-14',
      render: (c) => <CardMenu variant="cell" label={formatDigitalCardsMessage(s.actionsFor, { name: titleOf(c) })} items={menuFor(c)} />,
    },
  ]

  async function newSiteCard() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await createSiteCardAction({ projectSlug })
      if (!r.ok) return setError(digitalCardErrorText(m, r.error))
      router.push(`/${projectSlug}/cards/${r.id}`)
    } catch {
      setError(m.errors.failed)
    } finally {
      setBusy(false)
    }
  }

  const noPeople = list.people.length === 0
  const actions = canWrite ? (
    <>
      {!list.hasSiteCard ? (
        <Button variant={cards.length ? 'secondary' : 'primary'} disabled={busy} onClick={() => void newSiteCard()}>
          {s.newSite}
        </Button>
      ) : null}
      {peopleInstalled ? (
        <Button variant={list.hasSiteCard ? 'primary' : 'secondary'} disabled={busy || noPeople} aria-describedby={noPeople ? 'cards-no-people' : undefined} onClick={() => setPicking(true)}>
          {s.newPerson}
        </Button>
      ) : null}
    </>
  ) : null

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={m.nav} actions={actions} />
      <p className="-mt-2 max-w-2xl text-[0.9375rem] leading-6 text-muted-foreground">{s.intro}</p>
      {canWrite && peopleInstalled && noPeople ? (
        <p id="cards-no-people" className="-mt-2 text-sm leading-5 text-muted-foreground">
          {s.noPeople}{' '}
          <ButtonLink variant="link" className="text-sm" href={`/${projectSlug}/people`}>
            {s.noPeopleLink}
          </ButtonLink>
        </p>
      ) : null}
      {error ? (
        <Notice tone="error" onDismiss={() => setError(null)} dismissLabel={m.editor.dismiss}>
          {error}
        </Notice>
      ) : null}

      {cards.length === 0 ? (
        <EmptyState
          title={s.emptyTitle}
          body={s.emptyBody}
          action={canWrite && !list.hasSiteCard ? <Button variant="primary" disabled={busy} onClick={() => void newSiteCard()}>{s.newSite}</Button> : undefined}
        />
      ) : (
        <>
          <ListToolbar
            label={s.filtersLabel}
            search={{ value: q, onChange: setQ, label: s.searchLabel, placeholder: s.search }}
            filters={[
              {
                key: 'status',
                label: s.statusFilter,
                value: status,
                options: (Object.keys(statusLabel) as StatusFilter[]).map((v) => ({ value: v, label: statusLabel[v] })),
                onChange: (v) => setStatus(v as StatusFilter),
              },
            ]}
            summary={formatDigitalCardsMessage(s.showing, { shown: shown.length, total: cards.length })}
            clear={{ label: s.clear, onClear: () => { setQ(''); setStatus('all') }, visible: !isDefault }}
            sheet={{ activeCount: status === 'all' ? 0 : 1, resultCount: shown.length, chips: status === 'all' ? [] : [{ id: 'status', label: statusLabel[status] }], onRemoveChip: () => setStatus('all') }}
          />
          {shown.length === 0 ? (
            <Notice>{s.noMatch}</Notice>
          ) : (
            <>
              <div className="hidden md:block">
                <DataTable rows={shown} columns={columns} rowKey={(c) => c.id} rowHref={hrefOf} label={s.listLabel} minWidth="min-w-[52rem]" />
              </div>
              <ul className="flex flex-col gap-3 md:hidden">
                {shown.map((c) => (
                  <ListRow key={c.id} href={hrefOf(c)} label={formatDigitalCardsMessage(s.openNamed, { name: titleOf(c) })} menu={{ label: formatDigitalCardsMessage(s.actionsFor, { name: titleOf(c) }), items: menuFor(c) }}>
                    <span className="text-[0.9375rem] leading-6 font-semibold break-words text-foreground">{titleOf(c)}</span>
                    <span className="flex flex-wrap items-start gap-1.5">
                      {kindPill(c)}
                      <LifecycleBadge status={stateOf(c)} changes={c.hasChanges} />
                      {missingPill(c)}
                    </span>
                    <span className="text-xs leading-5 break-all text-muted-foreground" translate="no">
                      {address(c)}
                    </span>
                    <span className="text-xs leading-5 text-muted-foreground">
                      {linksText(c.linkCount)} · <LocalDate iso={c.updatedAt} />
                    </span>
                  </ListRow>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <PickPersonSheet open={picking} onClose={() => setPicking(false)} projectSlug={projectSlug} people={list.people} />
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </div>
  )
}

/** "New Person Card": one of the People without a card; the card opens straight in the editor. */
function PickPersonSheet({ open, onClose, projectSlug, people }: { open: boolean; onClose: () => void; projectSlug: string; people: DigitalCardList['people'] }) {
  const m = getDigitalCardsMessages(useLocale())
  const s = m.screen
  const router = useRouter()
  const [personId, setPersonId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seen, setSeen] = useState(open)
  if (seen !== open) {
    setSeen(open)
    if (open) {
      setPersonId(people[0]?.id ?? null)
      setError(null)
    }
  }

  async function create() {
    if (!personId || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await createPersonCardAction({ projectSlug, personId })
      if (!r.ok) return setError(digitalCardErrorText(m, r.error))
      router.push(`/${projectSlug}/cards/${r.id}`)
    } catch {
      setError(m.errors.failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} title={s.pickTitle} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{s.pickIntro}</p>
        <div className="max-h-[50dvh] overflow-y-auto">
          <RadioList legend={s.pickLegend} name="card-person" value={personId} onChange={setPersonId} options={people.map((p) => ({ value: p.id, label: p.name, ...(p.jobTitle && { description: p.jobTitle }) }))} />
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            {s.cancel}
          </Button>
          <Button variant="primary" type="submit" disabled={!personId || busy}>
            {busy ? s.creating : s.create}
          </Button>
        </div>
      </form>
    </BottomSheet>
  )
}
