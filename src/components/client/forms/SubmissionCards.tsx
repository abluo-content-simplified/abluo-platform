'use client'

import { useTranslations } from 'next-intl'
import type { DashboardSubmission } from '@/lib/api/client-dashboard'
import { Checkbox, isShiftChange } from '@/components/client/ui/Checkbox'
import { CardMenu, type CardMenuItem } from '@/components/client/ui/CardMenu'
import { LocalDate } from '@/components/client/ui/list/cells'
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
          <li
            key={s.id}
            className={`flex items-start gap-1 rounded-xl border bg-card py-2 pr-1 pl-1 ${isSel ? 'border-action ring-1 ring-action' : 'border-border'}`}
          >
            <Checkbox checked={isSel} aria-label={t('selectRow', { name })} onChange={(checked, e) => onToggle(s.id, checked, isShiftChange(e))} />
            <button
              type="button"
              onClick={() => onOpen(s)}
              className="flex min-w-0 flex-1 flex-col items-start gap-1.5 pt-3 pb-1 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="line-clamp-1 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{name}</span>
              <SubmissionStatusPill status={s.status} />
              <span className="line-clamp-1 text-sm leading-5 text-muted-foreground">
                {s.formId} · <LocalDate iso={s.createdAt} />
              </span>
              {line ? <span className="line-clamp-2 text-sm leading-5 text-muted-foreground">{line}</span> : null}
            </button>
            <span className="shrink-0">
              <CardMenu label={t('menu', { name })} items={menuFor(s)} />
            </span>
          </li>
        )
      })}
    </ul>
  )
}
