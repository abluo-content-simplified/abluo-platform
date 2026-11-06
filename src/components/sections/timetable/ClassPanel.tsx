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
import { courseTint, Meeting } from './parts'
import { teacherHref, type ProfileLinks } from './PrintSheet'

type Props = {
  occ: TimetableOccurrence | null
  data: TimetableData
  seriesById: Map<string, TimetableSeries>
  locale: string
  msg: TimetableMessages
  profile: ProfileLinks
  onClose: () => void
}

const label = 'text-[11px] font-semibold uppercase tracking-widest'

export function ClassPanel({ occ, data, seriesById, locale, msg, profile, onClose }: Props) {
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
      {occ && course ? <PanelBody occ={occ} data={data} seriesById={seriesById} locale={locale} msg={msg} profile={profile} /> : null}
    </SiteDialog>
  )
}

function PanelBody({ occ, data, seriesById, locale, msg, profile }: Omit<Props, 'onClose'> & { occ: TimetableOccurrence }) {
  const course = data.courses[occ.courseId]
  const cancelled = occ.status === 'cancelled'
  const place = occ.placeKey ? data.places[occ.placeKey] : null
  const teachers = occ.teacherIds.flatMap((id) => (data.teachers[id] ? [data.teachers[id]] : []))
  const series = seriesById.get(occ.seriesId)
  const repeat = series ? describeClassRepeat(series.rule, locale, { date: occ.date, withYear: true }) : ''
  const zone = zoneLabel(locale, data.timeZone, occ.date)
  const inPerson = occ.mode !== 'online'
  const online = occ.mode !== 'inPerson'

  return (
    <div className="flex flex-col gap-5 pb-2" style={{ color: 'var(--color-text-secondary)' }}>
      {course.image && (
        // The cropping keeps the Media Library focal point.
        <img src={course.image.src} alt={course.image.alt} loading="lazy" decoding="async" className="aspect-[16/9] w-full object-cover" style={{ objectPosition: course.image.position, borderRadius: 'var(--radius-md, var(--radius-lg))' }} />
      )}

      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold" style={{ color: 'var(--color-text-primary)', textDecoration: cancelled ? 'line-through' : undefined }}>
          <time dateTime={occ.date}>{formatDate(locale, occ.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</time>
        </p>
        <p className="text-sm tabular-nums" style={{ color: 'var(--color-text-primary)', textDecoration: cancelled ? 'line-through' : undefined }}>
          {timeRange(occ.start, occ.end)}
          {zone && <span style={{ color: 'var(--color-text-muted)' }}> · {zone}</span>}
        </p>
        {cancelled && (
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {msg.cancelled}
          </p>
        )}
        {occ.note && <p className="text-sm">{occ.note}</p>}
        {repeat && (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {repeat}
          </p>
        )}
      </div>

      {course.description && (
        <p className="text-sm leading-relaxed" style={{ whiteSpace: 'pre-line' }}>
          {course.description}
        </p>
      )}

      {teachers.length > 0 && (
        <section aria-label={msg.teachersLabel} className="flex flex-col gap-2">
          <h3 className={label} style={{ color: 'var(--color-text-muted)' }}>
            {msg.teachersLabel}
          </h3>
          <ul className="flex flex-col gap-2">
            {teachers.map((t) => {
              const href = teacherHref(profile, t)
              return (
                <li key={t.id} className="flex items-center gap-3">
                  {t.photo && <img src={t.photo.src} alt="" width={40} height={40} loading="lazy" decoding="async" className="h-10 w-10 shrink-0 rounded-full object-cover" style={{ objectPosition: t.photo.position }} />}
                  {href ? (
                    <a href={href} className="text-sm font-medium underline underline-offset-2" style={{ color: 'var(--color-text-primary)' }}>
                      {t.name}
                    </a>
                  ) : (
                    <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                      {t.name}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {!cancelled && (inPerson || online) && (
        <section aria-label={msg.placeLabel} className="flex flex-col gap-1">
          <h3 className={label} style={{ color: 'var(--color-text-muted)' }}>
            {msg.placeLabel}
          </h3>
          {inPerson && place && (
            <div className="text-sm">
              <p className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {place.name}
              </p>
              {place.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {place.mapsUrl && (
                <p className="mt-1">
                  {/* A plain outbound link — never an embed. */}
                  <a href={place.mapsUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2" style={{ color: 'var(--color-primary)' }}>
                    {msg.openInMaps}
                    <span className="sr-only"> ({msg.opensInNewTab})</span>
                  </a>
                </p>
              )}
            </div>
          )}
          {online && (
            <div className="text-sm">
              <p className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {occ.mode === 'mixed' ? msg.hybrid : msg.online}
              </p>
              <Meeting occ={occ} data={data} msg={msg} className="text-sm" />
            </div>
          )}
        </section>
      )}

      {occ.languages.length > 0 && (
        <p className="text-sm">
          <span className={label} style={{ color: 'var(--color-text-muted)' }}>
            {msg.languagesLabel}
          </span>
          <br />
          {listNames(locale, occ.languages.map((l) => languageName(locale, l)))}
        </p>
      )}
    </div>
  )
}
