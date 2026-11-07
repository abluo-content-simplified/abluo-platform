'use client'

// ONE class card for every timetable view: `comfortable` (desktop week),
// `compact` (desktop month) and `mobile` (agenda). Same content and order
// everywhere — time · course · actual teacher (volunteer *) · location (short
// name) · language and online / hybrid tags — plus status badges (cancelled,
// substitute, time changed, moved). It never shows Zoom ids, passcodes, full
// addresses or instructions: those live in the class panel.

import type { TimetableData, TimetableEvent, TimetableOccurrence, TimetableSeries } from '@/lib/modules/courses/timetable'
import type { TimetableMessages } from '@/lib/i18n/timetable-messages'
import { formatDate, languageName, timeRange } from './format'
import { User, MapPin, ChevronRight } from 'lucide-react'
import { CARD_INTERACTION, CARD_STYLE, Chip, courseTint, StatusBadge, Tag, TeacherName } from './parts'
import { teacherHref, type ProfileLinks } from './PrintSheet'
import { changeOf, placeShort } from './status'

export type CardVariant = 'comfortable' | 'compact' | 'mobile'

const SIZE: Record<CardVariant, { box: string; time: string; title: string; line: string; icon: number; gap: string; pill: 'sm' | 'md' }> = {
  comfortable: { box: 'gap-1.5 px-2.5 py-2.5', time: 'text-xs', title: 'text-[15px] font-bold leading-snug', line: 'text-[13px] leading-snug', icon: 13, gap: 'gap-1', pill: 'md' },
  compact: { box: 'gap-0.5 px-2 py-1.5', time: 'text-[11px]', title: 'text-xs font-bold leading-snug', line: 'text-[11px] leading-snug', icon: 11, gap: 'gap-0.5', pill: 'sm' },
  mobile: { box: 'gap-2 p-4', time: 'text-sm', title: 'text-[22px] font-bold leading-tight', line: 'text-[15px] leading-snug', icon: 16, gap: 'gap-1.5', pill: 'md' },
}

export const EVENT_TINT = { backgroundColor: 'color-mix(in srgb, var(--color-secondary) 22%, var(--color-surface))' } as const

const TITLE_FONT: React.CSSProperties = { fontFamily: 'var(--font-body, inherit)', letterSpacing: '-0.01em', hyphens: 'manual' }

/** The whole card opens the class details: one invisible button stretched over the card ("Details: course, date, time"). */
export function OpenDetails({ occ, data, locale, msg, onOpen }: { occ: TimetableOccurrence; data: TimetableData; locale: string; msg: TimetableMessages; onOpen: (id: string) => void }) {
  const what = `${data.courses[occ.courseId]?.title ?? ''}, ${formatDate(locale, occ.date, { weekday: 'long', day: 'numeric', month: 'long' })}, ${timeRange(occ.start, occ.end)}`
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={msg.openDetails(what)}
      onClick={() => onOpen(occ.id)}
      className="absolute inset-0 z-[1] cursor-pointer rounded-[inherit] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
    />
  )
}

/** Icon + text line (teacher, place). */
function IconLine({ icon, size, className, style, children, ...rest }: { icon: 'person' | 'pin'; size: number; className: string; style?: React.CSSProperties; children: React.ReactNode } & Record<`data-${string}`, string | boolean | undefined>) {
  const Icon = icon === 'person' ? User : MapPin
  return (
    <p className={`flex min-w-0 items-start gap-1.5 ${className}`} style={style} {...rest}>
      <Icon aria-hidden="true" width={size} height={size} strokeWidth={1.75} className="mt-[0.2em] shrink-0" style={{ color: 'var(--color-text-muted)' }} />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/** An event's title, linking to its page when it has one. */
export function EventTitle({ e, eventsBase, className = '' }: { e: TimetableEvent; eventsBase: string; className?: string }) {
  return e.slug && eventsBase ? (
    <a href={`${eventsBase}/${e.slug}`} className={`hover:underline underline-offset-2 ${className}`}>
      {e.title}
    </a>
  ) : (
    <span className={className}>{e.title}</span>
  )
}

/** The actual teachers of a session (a substitute shows here, not the regular teacher), volunteers marked. */
export function TeacherList({ ids, data, msg, profile, links = true }: { ids: string[]; data: TimetableData; msg: TimetableMessages; profile: ProfileLinks; links?: boolean }) {
  const list = ids.flatMap((id) => (data.teachers[id] ? [data.teachers[id]] : []))
  if (list.length === 0) return null
  return (
    <>
      {list.map((t, i) => {
        const href = links ? teacherHref(profile, t) : null
        return (
          <span key={t.id}>
            {href ? (
              <a href={href} className="underline underline-offset-2">
                <TeacherName teacher={t} volunteerSr={msg.volunteerSr} />
              </a>
            ) : (
              <TeacherName teacher={t} volunteerSr={msg.volunteerSr} />
            )}
            {i < list.length - 1 ? ', ' : ''}
          </span>
        )
      })}
    </>
  )
}

type Props = {
  occ: TimetableOccurrence
  data: TimetableData
  series?: TimetableSeries | null
  variant: CardVariant
  locale: string
  msg: TimetableMessages
  profile: ProfileLinks
  onOpen: (occurrenceId: string) => void
}

export function ClassCard({ occ, data, series, variant, locale, msg, profile, onOpen }: Props) {
  const s = SIZE[variant]
  const course = data.courses[occ.courseId]
  const change = changeOf(occ, series)
  const cancelled = change.cancelled
  const place = occ.placeKey ? data.places[occ.placeKey] : null
  const strike = cancelled ? ({ textDecoration: 'line-through' } as const) : undefined
  const hasTeachers = occ.teacherIds.some((id) => data.teachers[id])
  const status = cancelled ? (
    <StatusBadge kind="cancelled" size={s.pill}>{msg.cancelled}</StatusBadge>
  ) : (
    <>
      {change.substitute && <StatusBadge kind="substitute" size={s.pill}>{msg.substituteBadge}</StatusBadge>}
      {change.timeChanged && <StatusBadge kind="timeChanged" size={s.pill}>{msg.timeChangedBadge}</StatusBadge>}
      {change.moved && <StatusBadge kind="moved" size={s.pill}>{msg.movedBadge}</StatusBadge>}
    </>
  )
  const hasStatus = cancelled || change.substitute || change.timeChanged || change.moved
  const showTags = occ.languages.length > 0 || (!cancelled && occ.mode !== 'inPerson')

  return (
    <article
      className={`group relative flex min-w-0 flex-col break-words ${s.box} ${CARD_INTERACTION}`}
      data-card={variant}
      data-cancelled={cancelled ? 'true' : undefined}
      style={{ ...CARD_STYLE, ...courseTint(course?.color ?? 'none'), ...(variant === 'compact' ? { borderRadius: 'var(--radius-sm)' } : {}), ...(cancelled ? { opacity: 0.72 } : {}) }}
    >
      <OpenDetails occ={occ} data={data} locale={locale} msg={msg} onOpen={onOpen} />
      <p className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 font-medium tabular-nums ${s.time}`} style={{ color: 'var(--color-text-secondary)' }}>
        <span style={strike}>{timeRange(occ.start, occ.end)}</span>
        {hasStatus && variant !== 'mobile' && status}
      </p>
      <p className={s.title} style={{ ...TITLE_FONT, color: 'var(--color-text-primary)', ...strike }}>
        {course?.title}
      </p>
      {hasStatus && variant === 'mobile' && <span className="flex flex-wrap gap-1.5">{status}</span>}
      {(!cancelled && (hasTeachers || place)) || occ.note ? (
        <div className={`flex flex-col ${s.gap}`}>
          {!cancelled && hasTeachers && (
            <IconLine icon="person" size={s.icon} className={s.line} style={{ color: 'var(--color-text-primary)' }} data-teachers>
              <TeacherList ids={occ.teacherIds} data={data} msg={msg} profile={profile} links={false} />
            </IconLine>
          )}
          {!cancelled && place && (
            <IconLine icon="pin" size={s.icon} className={s.line} style={{ color: 'var(--color-text-secondary)' }} data-place>
              {placeShort(place)}
            </IconLine>
          )}
          {occ.note && (
            <p className={`${s.line} italic`} style={{ color: 'var(--color-text-secondary)' }}>
              {occ.note}
            </p>
          )}
        </div>
      ) : null}
      {(showTags || variant === 'mobile') && (
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex flex-wrap items-center gap-1">
            {occ.languages.length > 0 && (
              <Chip size={s.pill} title={occ.languages.map((l) => languageName(locale, l)).join(', ')}>
                {occ.languages.map((l) => l.toUpperCase()).join('/')}
              </Chip>
            )}
            {!cancelled && occ.mode === 'mixed' && <Tag kind="hybrid">{msg.hybrid}</Tag>}
            {!cancelled && occ.mode === 'online' && <Tag kind="online">{msg.online}</Tag>}
          </span>
          {variant === 'mobile' && <ChevronRight aria-hidden="true" width={18} height={18} strokeWidth={1.75} className="shrink-0 transition-transform group-hover:translate-x-0.5" style={{ color: 'var(--color-text-muted)' }} />}
        </div>
      )}
    </article>
  )
}

/** An event (workshop): the same card, with its Workshop tag. */
export function EventCard({ event: e, variant, msg, eventsBase }: { event: TimetableEvent; variant: CardVariant; msg: TimetableMessages; eventsBase: string }) {
  const s = SIZE[variant]
  const href = e.slug && eventsBase ? `${eventsBase}/${e.slug}` : null
  return (
    <article
      className={`group relative flex min-w-0 flex-col break-words ${s.box} ${href ? CARD_INTERACTION : ''}`}
      data-card={variant}
      data-event
      style={{ ...CARD_STYLE, ...EVENT_TINT, ...(variant === 'compact' ? { borderRadius: 'var(--radius-sm)' } : {}) }}
    >
      {href && <a href={href} className="absolute inset-0 z-[1] rounded-[inherit]" aria-label={e.title} />}
      <p className={`flex flex-wrap items-center gap-1.5 font-medium tabular-nums ${s.time}`} style={{ color: 'var(--color-text-secondary)' }}>
        <span>{timeRange(e.start, e.end)}</span>
        <Tag kind="workshop">{msg.workshop}</Tag>
      </p>
      <p className={s.title} style={{ ...TITLE_FONT, color: 'var(--color-text-primary)' }}>
        {e.title}
      </p>
      {e.placeName && (
        <IconLine icon="pin" size={s.icon} className={s.line} style={{ color: 'var(--color-text-secondary)' }} data-place>
          {e.placeName}
        </IconLine>
      )}
    </article>
  )
}
