'use client'

import { useTranslations } from 'next-intl'
import type { DashboardSubmission } from '@/lib/api/client-dashboard'
import { isShiftChange } from '@/components/app/ui/Checkbox'
import type { CardMenuItem } from '@/components/app/ui/CardMenu'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { LocalDate } from '@/components/app/ui/list/cells'
import { firstLine } from '@/lib/client/submissions-filter'
import { SubmissionStatusPill } from './forms-bits'

/**
 * Phone cards for the Forms list: square checkbox · name, status pill,
 * "form · date", the first line of the message · ⋯. The checkbox selects;
 * the card opens the request.
 */
export function SubmissionPhoneList({
  rows,
  selected,
  onToggle,
  onOpen,
  menuFor,
}: {
  rows: DashboardSubmission[]
  selected: Set<string>
  onToggle: (id: string, checked: boolean, shift: boolean) => void
  onOpen: (row: DashboardSubmission) => void
  menuFor: (row: DashboardSubmission) => CardMenuItem[]
}) {
  const t = useTranslations('clientDashboard.submissions')
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((s) => {
        const isSel = selected.has(s.id)
        const name = s.name ?? t('anonymous')
        const line = firstLine(s)
        return (
          <ListRow
            key={s.id}
            onOpen={() => onOpen(s)}
            select={{ checked: isSel, label: t('selectRow', { name }), onChange: (checked, e) => onToggle(s.id, checked, isShiftChange(e)) }}
            menu={{ label: t('menu', { name }), items: menuFor(s) }}
          >
            <span className="line-clamp-1 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{name}</span>
            <SubmissionStatusPill status={s.status} />
            <span className="line-clamp-1 text-sm leading-5 text-muted-foreground">
              {s.formId} · <LocalDate iso={s.createdAt} />
            </span>
            {line ? <span className="line-clamp-2 text-sm leading-5 text-muted-foreground">{line}</span> : null}
          </ListRow>
        )
      })}
    </ul>
  )
}
