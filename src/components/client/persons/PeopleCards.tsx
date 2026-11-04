'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { DragGrip } from '@/components/app/ui/DragGrip'
import { CardGrid, CardGridItem, ContentCard } from '@/components/app/ui/list/ContentCard'
import { LocalDate } from '@/components/app/ui/list/cells'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { dropEdgeClass } from '@/components/app/ui/use-pointer-drag'
import { isShiftChange } from '@/components/app/ui/Checkbox'
import type { DataTableSelection } from '@/components/app/ui/list/DataTable'
import { GroupPills, MissingPills, PersonAvatar, PersonStateBadge, usageLine, VisibilityText, type PersonRow } from './person-bits'
import type { PersonReorder } from './PeopleTable'

type CardProps = {
  rows: PersonRow[]
  /** Square checkboxes (bulk bar); absent when the person can't change anything. */
  selection?: DataTableSelection<PersonRow>
  onOpen: (row: PersonRow, newTab: boolean) => void
  onUsedIn: (row: PersonRow) => void
  menuFor: (row: PersonRow) => CardMenuItem[]
  groupLabel: (key: string) => string
}

/** The card's media area when there is no photo: a large initials avatar, top-aligned like the rest. */
function InitialsMedia({ name }: { name: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-muted">
      <PersonAvatar name={name} src={null} size="lg" />
    </div>
  )
}

/** "Used in 2 pages, 1 post" (the count opens the list). */
function UsageLine({ row, onUsedIn }: { row: PersonRow; onUsedIn: (row: PersonRow) => void }) {
  const t = useTranslations('clientDashboard.persons.list')
  const tu = useTranslations('clientDashboard.persons.usedIn')
  return (
    <p className="flex flex-wrap items-center gap-x-1 text-sm leading-5 text-muted-foreground">
      {row.usageCount ? (
        <Button variant="link" className="-my-3 text-left text-sm" onClick={() => onUsedIn(row)} aria-label={t('usedInOpen', { name: row.name, count: row.usageCount })}>
          {usageLine(tu, row.usage)}
        </Button>
      ) : (
        <span>{t('notUsed')}</span>
      )}
    </p>
  )
}

/**
 * Desktop cards view: the generic CardGrid / ContentCard configured for
 * people — the media area is the photo (or initials), then name, job title,
 * groups, status, "On the website", usage and the last update. ⋯ top-right.
 */
export function PeopleCardsGrid({ rows, selection, onOpen, onUsedIn, menuFor, groupLabel }: CardProps) {
  const t = useTranslations('clientDashboard.persons.list')
  return (
    <CardGrid label={t('title')}>
      {rows.map((p) => (
        <CardGridItem key={p.id}>
          <ContentCard
            media={{ src: p.photoUrl, alt: '' }}
            mediaContent={p.photoUrl ? undefined : <InitialsMedia name={p.name} />}
            title={p.name}
            subtitle={p.jobTitle || undefined}
            href={p.href}
            onOpen={(newTab) => onOpen(p, newTab)}
            selection={selection ? { checked: selection.selected.has(p.id), onChange: (checked, shift) => selection.onToggle(p.id, checked, shift), label: selection.rowLabel(p) } : undefined}
            overlay={<CardMenu variant="chip" label={t('menu', { name: p.name })} items={menuFor(p)} />}
          >
            <span className="flex flex-wrap items-start gap-1.5">
              <PersonStateBadge state={p.state} />
            </span>
            <MissingPills missing={p.missing} state={p.state} />
            <GroupPills groups={p.groups} label={groupLabel} />
            <p className="text-sm leading-5 text-muted-foreground">
              {t('columns.visibility')}: <VisibilityText visibility={p.visibility} />
            </p>
            <UsageLine row={p} onUsedIn={onUsedIn} />
            <p className="mt-auto flex items-baseline justify-between gap-3 text-xs leading-5">
              <span className="text-muted-foreground">{t('columns.updated')}</span>
              <LocalDate iso={p.updatedAt} empty="—" className="text-right text-foreground tabular-nums" />
            </p>
          </ContentCard>
        </CardGridItem>
      ))}
    </CardGrid>
  )
}

/**
 * Phones: one row per person (ListRow) — photo or initials, name, job title,
 * status, groups, usage — tapping opens the editor; ⋯ for the rest. With the
 * whole list in the site order (`reorder`) each row has the drag grip (touch
 * drag, or the arrow keys).
 */
export function PeoplePhoneList({ rows, selection, menuFor, groupLabel, reorder }: Pick<CardProps, 'rows' | 'selection' | 'menuFor' | 'groupLabel'> & { reorder?: PersonReorder }) {
  const t = useTranslations('clientDashboard.persons.list')
  const tu = useTranslations('clientDashboard.persons.usedIn')
  return (
    <ul className="flex flex-col gap-3" aria-label={t('title')}>
      {rows.map((p, n) => (
        <ListRow
          key={p.id}
            href={p.href}
            leading={<PersonAvatar name={p.name} src={p.photoUrl} size="md" muted={p.state === 'archived'} />}
            select={selection ? { checked: selection.selected.has(p.id), label: selection.rowLabel(p), onChange: (checked, e) => selection.onToggle(p.id, checked, isShiftChange(e)) } : undefined}
            menu={{ label: t('menu', { name: p.name }), items: menuFor(p) }}
            rowProps={reorder ? { ...reorder.drag.rowProps(p.id), className: `${dropEdgeClass(reorder.drag.edge(p.id))} ${reorder.drag.dragging === p.id ? 'opacity-50' : ''}` } : undefined}
            trailing={
              reorder ? (
                <DragGrip
                  label={t('drag', { name: p.name, position: n + 1, total: rows.length })}
                  drag={reorder.drag.gripProps(p.id)}
                  onMove={(dir) => reorder.move(p.id, dir)}
                  disabled={reorder.disabled}
                />
              ) : undefined
            }
          >
            <span className="line-clamp-2 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{p.name}</span>
            {p.jobTitle ? <span className="line-clamp-2 text-sm leading-5 text-foreground">{p.jobTitle}</span> : null}
            <span className="flex flex-wrap items-start gap-1.5">
              <PersonStateBadge state={p.state} />
            </span>
            <MissingPills missing={p.missing} state={p.state} />
            <GroupPills groups={p.groups} label={groupLabel} />
            <span className="text-sm leading-5 text-muted-foreground">
              <VisibilityText visibility={p.visibility} /> · {p.usageCount ? usageLine(tu, p.usage) : t('notUsed')}
            </span>
        </ListRow>
      ))}
    </ul>
  )
}
