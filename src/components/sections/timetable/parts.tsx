// Small pieces shared by the timetable views and the class details panel.

import type { TimetableData, TimetableOccurrence } from '@/lib/modules/courses/timetable'
import type { TimetableMessages } from '@/lib/i18n/timetable-messages'
import { safeHttps } from './format'

/** The course colour as a left marker — design-system tokens only. */
export const courseTint = (color: 'none' | 'accent' | 'muted') =>
  color === 'accent' ? { borderLeft: '3px solid var(--color-primary)' } : color === 'muted' ? { borderLeft: '3px solid var(--color-border)' } : {}

/**
 * Join details of an online / hybrid session. `data.rooms` is null unless the
 * server allowed meeting details for this request, so nothing renders otherwise.
 */
export function Meeting({ occ, data, msg, className = 'mt-1 text-xs' }: { occ: TimetableOccurrence; data: TimetableData; msg: TimetableMessages; className?: string }) {
  const room = occ.meetingRoomId ? data.rooms?.[occ.meetingRoomId] : null
  if (!room || occ.status === 'cancelled') return null
  const href = safeHttps(room.joinUrl)
  return (
    <p className={className} style={{ color: 'var(--color-text-secondary)' }}>
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          {msg.joinLink}
          <span className="sr-only"> ({msg.opensInNewTab})</span>
        </a>
      )}
      {room.meetingId && <span>{href ? ' · ' : ''}{msg.meetingId}: {room.meetingId}</span>}
      {room.passcode && <span> · {msg.passcode}: {room.passcode}</span>}
    </p>
  )
}

// ── Tags, weekends, volunteer mark ───────────────────────────────────────────

export type TagKind = 'hybrid' | 'online' | 'workshop'

/** Tag colours — design-system tokens only: hybrid = quiet outline, online = primary, workshop = secondary. */
export const tagStyle = (kind: TagKind): React.CSSProperties => {
  if (kind === 'online') return { color: 'color-mix(in srgb, var(--color-primary) 75%, var(--color-text-primary))', backgroundColor: 'color-mix(in srgb, var(--color-primary) 14%, transparent)', borderRadius: 'var(--radius-btn)' }
  if (kind === 'workshop') return { color: 'var(--color-background)', backgroundColor: 'var(--color-text-secondary)', borderRadius: 'var(--radius-btn)' }
  return { color: 'var(--color-text-secondary)', backgroundColor: 'color-mix(in srgb, var(--color-secondary) 45%, transparent)', borderRadius: 'var(--radius-btn)' }
}

const TAG = 'inline-flex shrink-0 items-center px-2 py-px text-[11px] font-semibold leading-5'

export function Tag({ kind, children }: { kind: TagKind; children: React.ReactNode }) {
  return (
    <span className={TAG} data-tag={kind} style={tagStyle(kind)}>
      {children}
    </span>
  )
}

/** Saturday / Sunday cells and columns are shaded a little. */
export const WEEKEND_BG = 'color-mix(in srgb, var(--color-text-primary) 6%, var(--color-surface))'

/** A teacher's name; a volunteer gets an asterisk (decorative) and a screen-reader word. */
export function TeacherName({ teacher, volunteerSr }: { teacher: { name: string; volunteer?: boolean }; volunteerSr: string }) {
  return (
    <>
      {teacher.name}
      {teacher.volunteer && (
        <>
          <span aria-hidden="true">*</span>
          <span className="sr-only"> ({volunteerSr})</span>
        </>
      )}
    </>
  )
}

/** "* volunteer teacher" under a timetable that shows one. */
export function VolunteerNote({ text }: { text: string }) {
  return (
    <p className="mt-4 text-xs" data-volunteer-note style={{ color: 'var(--color-text-muted)' }}>
      {text}
    </p>
  )
}

// ── Status badges (cards, updates, panel) ────────────────────────────────────

export type StatusKind = 'cancelled' | 'substitute' | 'timeChanged' | 'moved'

/** Status colours — design-system tokens only: cancelled = danger, teacher change = primary, new time = warning, moved = secondary. */
const STATUS_TONE: Record<StatusKind, string> = {
  cancelled: 'var(--color-danger, #B3261E)',
  substitute: 'var(--color-primary)',
  timeChanged: 'var(--color-warning, #9A6700)',
  moved: 'var(--color-text-secondary)',
}

export const statusStyle = (kind: StatusKind): React.CSSProperties => ({
  color: `color-mix(in srgb, ${STATUS_TONE[kind]} 80%, var(--color-text-primary))`,
  backgroundColor: `color-mix(in srgb, ${STATUS_TONE[kind]} 14%, transparent)`,
  borderRadius: 'var(--radius-btn)',
})

/** A soft coloured pill ("Teacher change", "Cancelled", …). `size="sm"` for the month grid. */
export function StatusBadge({ kind, children, size = 'md' }: { kind: StatusKind; children: React.ReactNode; size?: 'sm' | 'md' }) {
  return (
    <span className={size === 'sm' ? 'inline-flex shrink-0 items-center px-1.5 py-px text-[10px] font-semibold leading-4' : 'inline-flex shrink-0 items-center px-2.5 py-0.5 text-xs font-semibold leading-5'} data-status={kind} style={statusStyle(kind)}>
      {children}
    </span>
  )
}

/** A neutral chip (languages). */
export function Chip({ children, title, size = 'md' }: { children: React.ReactNode; title?: string; size?: 'sm' | 'md' }) {
  return (
    <span
      title={title}
      className={size === 'sm' ? 'inline-flex shrink-0 items-center px-1.5 py-px text-[10px] font-semibold leading-4' : 'inline-flex shrink-0 items-center px-2.5 py-0.5 text-xs font-semibold leading-5'}
      style={{ color: 'var(--color-text-secondary)', backgroundColor: 'color-mix(in srgb, var(--color-text-primary) 7%, transparent)', borderRadius: 'var(--radius-btn)' }}
    >
      {children}
    </span>
  )
}

/** Card surface: the site's surface colour, a hairline border and the medium radius. */
export const CARD_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--color-surface)',
  border: '1px solid color-mix(in srgb, var(--color-border) 85%, transparent)',
  borderRadius: 'var(--radius-md)',
}

/** Hover / focus / press feedback for clickable cards (CSS, motion-safe). */
export const CARD_INTERACTION =
  'cursor-pointer text-left transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-px hover:shadow-[0_6px_18px_-8px_rgba(0,0,0,0.18)] active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] motion-reduce:transition-none motion-reduce:hover:translate-y-0'
