'use client'

import { useTranslations } from 'next-intl'
import type { SubmissionStatus } from '@/lib/api/client-dashboard'
import { Pill, type PillTone } from '@/components/client/ui/list/cells'
import { SUBMISSION_STATUSES } from '@/lib/client/submissions-filter'

/**
 * Small Forms-specific pieces for the list (table, phone cards, panel): the
 * status pill / status select and the icons. 'processed' is shown to people as
 * "Handled" (message key `submissions.status.processed`).
 */

function svg(d: string, size = 20, width = 2) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export const FORMS_ICONS = {
  handled: svg('M20 6 9 17l-5-5'),
  markNew: svg('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 9v6M9 12h6'),
  archive: svg('M3 4h18v4H3zM5 8v12h14V8M10 12h4'),
  download: svg('M12 4v11M7 10l5 5 5-5M5 20h14'),
  trash: svg('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'),
  more: svg('M5 12h.01M12 12h.01M19 12h.01', 20, 2.6),
  x: svg('M6 6l12 12M18 6L6 18'),
  chevron: svg('m6 9 6 6 6-6', 14, 2.2),
}

const TONE: Record<SubmissionStatus, PillTone> = { new: 'highlight', processed: 'success', archived: 'outline' }
const SELECT_TONE: Record<SubmissionStatus, string> = {
  new: 'bg-accent text-accent-foreground border-transparent',
  processed: 'bg-success/15 text-foreground border-transparent',
  archived: 'border-border text-muted-foreground bg-transparent',
}

/** New / Handled / Archived as a read-only 1.5rem pill. */
export function SubmissionStatusPill({ status }: { status: SubmissionStatus }) {
  const t = useTranslations('clientDashboard.submissions.status')
  return (
    <Pill tone={TONE[status]} icon={status === 'new' ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : undefined}>
      {t(status)}
    </Pill>
  )
}

/**
 * The status as a select that looks like its pill (people with
 * forms.submission.update). `size="lg"`: a 44px control (panel, phones).
 */
export function SubmissionStatusSelect({
  status,
  label,
  onChange,
  size = 'sm',
}: {
  status: SubmissionStatus
  /** Accessible name, e.g. "Status: Anna". */
  label: string
  onChange: (next: SubmissionStatus) => void
  size?: 'sm' | 'lg'
}) {
  const t = useTranslations('clientDashboard.submissions.status')
  const box = size === 'lg' ? 'h-11 rounded-xl pr-9 pl-3 text-[0.9375rem]' : 'h-6 rounded-full pr-7 pl-2.5 text-xs'
  return (
    <label className="relative inline-flex shrink-0 items-center">
      <span className="sr-only">{label}</span>
      <select
        value={status}
        onChange={(e) => onChange(e.target.value as SubmissionStatus)}
        className={`appearance-none border font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${box} ${SELECT_TONE[status]}`}
      >
        {SUBMISSION_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(s)}
          </option>
        ))}
      </select>
      <span className={`pointer-events-none absolute ${size === 'lg' ? 'right-3' : 'right-2'}`}>{FORMS_ICONS.chevron}</span>
    </label>
  )
}
