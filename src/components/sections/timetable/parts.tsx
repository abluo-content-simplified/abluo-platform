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
