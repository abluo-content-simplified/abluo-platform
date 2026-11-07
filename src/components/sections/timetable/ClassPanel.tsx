'use client'

// The class details panel: opens from a class in the week, month and phone
// views. Calendar cells stay short (time, course, teacher); everything longer —
// the course description and image, the exact place, the languages, the note
// for this date — lives here. Read-only; the overlay is the site's one dialog
// (SiteDialog: focus trap, Escape, scroll lock) as a bottom sheet on phones.
//
// PRIVACY: join links, meeting numbers and passcodes come from `data.rooms`,
// which the server fills only for an allowed request (onlineDetailsAllowed);
// this component never decides that, it only shows what it was given.

import { SiteDialog } from '@/components/site/SiteDialog'
import { describeClassRepeat } from '@/lib/scheduling/repeat-label'
import type { TimetableData, TimetableOccurrence, TimetableSeries } from '@/lib/modules/courses/timetable'
import type { TimetableMessages } from '@/lib/i18n/timetable-messages'
import { formatDate, languageName, listNames, timeRange, zoneLabel } from './format'
import { CalendarDays, Globe, MapPin, MonitorSmartphone, User, ArrowRight, ArrowUpRight } from 'lucide-react'
import { Chip, courseTint, Meeting, StatusBadge, Tag, TeacherName, VolunteerNote } from './parts'
import { changeOf, placeShort } from './status'
import { AddToCalendar } from './AddToCalendar'
import { teacherHref, type ProfileLinks } from './PrintSheet'
import { courseHref, type CourseLinkContext } from '@/lib/modules/courses/website'

type Props = {
  occ: TimetableOccurrence | null
  data: TimetableData
  seriesById: Map<string, TimetableSeries>
  locale: string
  msg: TimetableMessages
  profile: ProfileLinks
  /** Course pages in this language (module `courseSegment`); a course with a slug gets an "About this course" link. */
  coursePage?: CourseLinkContext | null
  /** Where the .ics download is served from (the page and section re-gate it); null endpoint = no download, Google link only. */
  calendar?: { endpoint: string | null; pageId: string | null; sectionKey: string }
  onClose: () => void
}

const label = 'text-[11px] font-semibold uppercase tracking-widest'

const ICON = { 'aria-hidden': true, width: 18, height: 18, strokeWidth: 1.75 } as const

/** One information row of the panel: an icon, an optional small label and the content. */
function Row({ icon, label: title, children }: { icon: React.ReactNode; label?: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[2.25rem_1fr] items-start gap-x-3">
      <span className="flex h-9 w-9 items-center justify-center" style={{ borderRadius: 'var(--radius-btn)', backgroundColor: 'color-mix(in srgb, var(--color-text-primary) 6%, transparent)', color: 'var(--color-text-secondary)' }}>
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
        {title && (
          <h3 className={label} style={{ color: 'var(--color-text-muted)' }}>
            {title}
          </h3>
        )}
        {children}
      </div>
    </li>
  )
}

export function ClassPanel({ occ, data, seriesById, locale, msg, profile, coursePage, calendar, onClose }: Props) {
  const course = occ ? data.courses[occ.courseId] : null
  const open = !!occ && !!course
  return (
    <SiteDialog
      isOpen={open}
      onClose={onClose}
      closeLabel={msg.close}
      closeOnBackdrop
      variant="sheet"
      title={
        course ? (
          <span className="block" style={{ ...courseTint(course.color), paddingLeft: course.color === 'none' ? 0 : '0.75rem' }}>
            {course.title}
          </span>
        ) : null
      }
    >
      {occ && course ? <PanelBody occ={occ} data={data} seriesById={seriesById} locale={locale} msg={msg} profile={profile} coursePage={coursePage} calendar={calendar} /> : null}
    </SiteDialog>
  )
}

function PanelBody({ occ, data, seriesById, locale, msg, profile, coursePage, calendar }: Omit<Props, 'onClose'> & { occ: TimetableOccurrence }) {
  const course = data.courses[occ.courseId]
  const aboutHref = courseHref(course.slug, coursePage)
  const series = seriesById.get(occ.seriesId)
  const change = changeOf(occ, series)
  const cancelled = change.cancelled
  const place = occ.placeKey ? data.places[occ.placeKey] : null
  const teachers = occ.teacherIds.flatMap((id) => (data.teachers[id] ? [data.teachers[id]] : []))
  const originalNames = change.substitute ? change.originalTeacherIds.flatMap((id) => (data.teachers[id] ? [data.teachers[id].name] : [])) : []
  const repeat = series ? describeClassRepeat(series.rule, locale, { date: occ.date, withYear: true }) : ''
  const zone = zoneLabel(locale, data.timeZone, occ.date)
  const inPerson = occ.mode !== 'online'
  const online = occ.mode !== 'inPerson'
  const wasTime = change.timeChanged && change.originalStart ? timeRange(change.originalStart, change.originalEnd) : null
  const wasPlace = change.moved && change.originalPlaceKey ? placeShort(data.places[change.originalPlaceKey]) : ''
  // Where the "add to calendar" links point: this page, without a fragment.
  const pageUrl = typeof window === 'undefined' ? null : `${window.location.origin}${window.location.pathname}`

  const hasStatus = cancelled || change.substitute || change.timeChanged || change.moved || occ.mode !== 'inPerson'

  return (
    <div className="flex flex-col gap-5 pb-2" style={{ color: 'var(--color-text-secondary)' }}>
      {hasStatus && (
        <p className="-mt-1 flex flex-wrap items-center gap-1.5">
          {cancelled && <StatusBadge kind="cancelled">{msg.cancelled}</StatusBadge>}
          {!cancelled && change.substitute && <StatusBadge kind="substitute">{msg.substituteBadge}</StatusBadge>}
          {!cancelled && change.timeChanged && <StatusBadge kind="timeChanged">{msg.timeChangedBadge}</StatusBadge>}
          {!cancelled && change.moved && <StatusBadge kind="moved">{msg.movedBadge}</StatusBadge>}
          {occ.mode === 'online' && <Tag kind="online">{msg.online}</Tag>}
          {occ.mode === 'mixed' && <Tag kind="hybrid">{msg.hybrid}</Tag>}
        </p>
      )}

      {/* The essentials first: date and time, teacher, place, languages. */}
      <ul className="flex flex-col gap-4">
        <Row icon={<CalendarDays {...ICON} />}>
          <p className="text-[15px] font-semibold" style={{ color: 'var(--color-text-primary)', textDecoration: cancelled ? 'line-through' : undefined }}>
            <time dateTime={occ.date}>{formatDate(locale, occ.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</time>
          </p>
          <p className="text-sm tabular-nums" style={{ color: 'var(--color-text-primary)', textDecoration: cancelled ? 'line-through' : undefined }}>
            {timeRange(occ.start, occ.end)}
            {zone && <span style={{ color: 'var(--color-text-muted)' }}> · {zone}</span>}
          </p>
          {wasTime && (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {msg.wasTime(wasTime)}
            </p>
          )}
          {repeat && (
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {repeat}
            </p>
          )}
          {occ.note && <p className="mt-1 text-sm italic">{occ.note}</p>}
        </Row>

        {teachers.length > 0 && !cancelled && (
          <Row icon={<User {...ICON} />} label={teachers.length === 1 ? msg.teacherLabel : msg.teachersLabel}>
            <ul className="flex flex-col gap-2">
              {teachers.map((t) => {
                const href = teacherHref(profile, t)
                return (
                  <li key={t.id} className="flex items-center gap-3">
                    {t.photo && <img src={t.photo.src} alt="" width={44} height={44} loading="lazy" decoding="async" className="h-11 w-11 shrink-0 rounded-full object-cover" style={{ objectPosition: t.photo.position }} />}
                    <span className="flex flex-col">
                      {href ? (
                        <a href={href} className="text-[15px] font-semibold underline-offset-2 hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                          <TeacherName teacher={t} volunteerSr={msg.volunteerSr} />
                        </a>
                      ) : (
                        <span className="text-[15px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                          <TeacherName teacher={t} volunteerSr={msg.volunteerSr} />
                        </span>
                      )}
                      {originalNames.length > 0 && (
                        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                          {msg.insteadOf(listNames(locale, originalNames))}
                        </span>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
            {teachers.some((t) => t.volunteer) && <VolunteerNote text={msg.volunteerNote} />}
          </Row>
        )}

        {!cancelled && inPerson && place && (
          <Row icon={<MapPin {...ICON} />} label={msg.placeLabel}>
            <p className="text-[15px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {place.name}
            </p>
            <div className="text-sm leading-relaxed">
              {place.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
            {wasPlace && (
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {msg.wasTime(wasPlace)}
              </p>
            )}
            {place.mapsUrl && (
              // A plain outbound link — never an embed.
              <a href={place.mapsUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 self-start text-sm font-medium underline-offset-2 hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                {msg.openInMaps}
                <ArrowUpRight aria-hidden="true" width={15} height={15} strokeWidth={1.75} />
                <span className="sr-only"> ({msg.opensInNewTab})</span>
              </a>
            )}
          </Row>
        )}

        {!cancelled && online && (
          <Row icon={<MonitorSmartphone {...ICON} />} label={msg.placeLabel}>
            <p className="text-[15px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {occ.mode === 'mixed' ? msg.hybrid : msg.online}
            </p>
            <Meeting occ={occ} data={data} msg={msg} className="text-sm" />
          </Row>
        )}

        {occ.languages.length > 0 && (
          <Row icon={<Globe {...ICON} />} label={msg.languagesLabel}>
            <span className="flex flex-wrap gap-1.5">
              {occ.languages.map((l) => (
                <Chip key={l}>{languageName(locale, l)}</Chip>
              ))}
            </span>
          </Row>
        )}
      </ul>

      {!cancelled && <AddToCalendar occurrence={occ} series={series} data={data} locale={locale} pageUrl={pageUrl} endpoint={calendar?.endpoint ?? null} pageId={calendar?.pageId ?? null} sectionKey={calendar?.sectionKey ?? null} />}

      {(course.image || course.description || aboutHref) && <hr style={{ borderColor: 'var(--color-border)' }} />}
      {course.image && (
        // The cropping keeps the Media Library focal point.
        <img src={course.image.src} alt={course.image.alt} loading="lazy" decoding="async" className="aspect-[16/9] w-full object-cover" style={{ objectPosition: course.image.position, borderRadius: 'var(--radius-md, var(--radius-lg))' }} />
      )}
      {course.description && (
        <p className="text-sm leading-relaxed" style={{ whiteSpace: 'pre-line' }}>
          {course.description}
        </p>
      )}
      {aboutHref && (
        // The course's own page (ADR-045 D5), only where it exists in this language.
        <a href={aboutHref} data-course-page className="inline-flex items-center gap-1 self-start text-sm font-semibold underline-offset-2 hover:underline" style={{ color: 'var(--color-text-primary)' }}>
          {msg.aboutCourse}
          <ArrowRight aria-hidden="true" width={15} height={15} strokeWidth={1.75} />
        </a>
      )}
    </div>
  )
}
