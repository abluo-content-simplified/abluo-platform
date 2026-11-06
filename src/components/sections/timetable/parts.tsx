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
  if (kind === 'online') return { border: '1px solid var(--color-primary)', color: 'var(--color-primary)', backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, transparent)', borderRadius: 'var(--radius-btn)' }
  if (kind === 'workshop') return { border: '1px solid var(--color-secondary)', color: 'var(--color-secondary)', backgroundColor: 'color-mix(in srgb, var(--color-secondary) 12%, transparent)', borderRadius: 'var(--radius-btn)' }
  return { border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', borderRadius: 'var(--radius-btn)' }
}

const TAG = 'inline-flex shrink-0 items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest'

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
