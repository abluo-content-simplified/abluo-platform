// ── Courses — the body of a course's own page (ADR-045 D5) ────────────────────
//
// Presentational and server-safe (no hooks, no data reads): the route
// (CourseRoute.tsx) reads the course and its classes and hands them over. Calm
// layout in the site's design-system tokens only — the same vocabulary as the
// People profile and the timetable's class panel: heading font, surface cards,
// muted small labels, focal-point cropping for the Media Library image.
//
// Every word that is not tenant content comes from the course page dictionary
// (getCoursePageMessages) or Intl (dates, language names) or
// describeClassRepeat ("Every Thursday"). Never meeting details: the route reads
// the classes without them.

import { ArrowRight, ArrowUpRight, CalendarDays, Globe, MapPin, MonitorSmartphone, User } from 'lucide-react'
import { Tag } from '@/components/sections/timetable/parts'
import { describeClassRepeat } from '@/lib/scheduling/repeat-label'
import { getCoursePageMessages } from '@/lib/i18n/course-page-messages'
import type { CourseClassView } from '@/lib/modules/courses/course-page'
import type { TimetableImage } from '@/lib/modules/courses/timetable'
import { formatDate, languageName, timeRange, zoneLabel } from '@/components/sections/timetable/format'

export interface CoursePageProps {
  locale: string
  title: string
  description?: string | null
  /** The course image (Media Library; `position` = its focal point), or null. */
  image?: (TimetableImage & { srcSet?: string | null }) | null
  classes: CourseClassView[]
  /** The site's time zone (shown beside the times), or null. */
  timeZone?: string | null
  /** The published timetable page that shows this course, in this language, or null. */
  timetableHref?: string | null
}

const ICON = { 'aria-hidden': true, width: 18, height: 18, strokeWidth: 1.75 } as const
const LABEL = 'text-[11px] font-semibold uppercase tracking-widest'
const heading = { fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' } as const

const capitalise = (text: string, locale: string) => (text ? text.charAt(0).toLocaleUpperCase(locale) + text.slice(1) : text)

/** One information row of a class card: a small icon, a small label and the content. */
function Detail({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-x-3">
      <span className="mt-0.5 flex h-7 w-7 items-center justify-center" style={{ color: 'var(--color-text-muted)' }}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className={LABEL} style={{ color: 'var(--color-text-muted)' }}>
          {label}
        </p>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  )
}

function ClassCard({ c, locale, timeZone }: { c: CourseClassView; locale: string; timeZone: string | null }) {
  const msg = getCoursePageMessages(locale)
  const repeat = describeClassRepeat(c.rule, locale, { date: c.anchor, withYear: true })
  const zone = zoneLabel(locale, timeZone, c.nextDate ?? c.anchor)
  // The repeat already names the weekday: the next date is day + month only.
  const longDate = (d: string) => formatDate(locale, d, { day: 'numeric', month: 'long' })
  const plainDate = (d: string) => formatDate(locale, d, { day: 'numeric', month: 'long', year: 'numeric' })
  const once = !!c.rule && /COUNT=1\b/.test(c.rule)
  const span = [c.startsOn ? msg.startsOn(plainDate(c.startsOn)) : null, c.endsOn && !once ? msg.until(plainDate(c.endsOn)) : null].filter(Boolean).join(' · ')
  const primary = { color: 'var(--color-text-primary)' }

  return (
    <li
      className="grid gap-6 p-6 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:gap-10 md:p-8"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, var(--radius-lg))' }}
    >
      {/* When: the repeat and the time, read first. */}
      <div className="min-w-0">
        {c.mode !== 'inPerson' && (
          <p className="mb-3 flex items-center gap-1.5">
            <MonitorSmartphone aria-hidden="true" width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--color-text-muted)' }} />
            <Tag kind={c.mode === 'online' ? 'online' : 'hybrid'}>{c.mode === 'online' ? msg.online : msg.hybrid}</Tag>
          </p>
        )}
        <p className="text-lg font-semibold leading-snug" style={primary}>
          {repeat}
        </p>
        <p className="mt-1 text-[1.75rem] leading-tight tabular-nums" style={heading}>
          {timeRange(c.start, c.end)}
        </p>
        {zone && (
          <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {zone}
          </p>
        )}
        {span && (
          <p className="mt-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {span}
          </p>
        )}
        {c.nextDate && !once && (
          <p className="mt-3 inline-flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            <CalendarDays aria-hidden="true" width={15} height={15} strokeWidth={1.75} />
            <span>{msg.nextClass(longDate(c.nextDate))}</span>
          </p>
        )}
      </div>

      <div className="grid min-w-0 content-start gap-5 lg:grid-cols-2 lg:gap-x-8">
        <div className="flex min-w-0 flex-col gap-5">
          {c.teachers.length > 0 && (
            <Detail icon={<User {...ICON} />} label={c.teachers.length === 1 ? msg.teacherLabel : msg.teachersLabel}>
              <ul className="flex flex-wrap gap-x-5 gap-y-2">
                {c.teachers.map((t) => (
                  <li key={t.id} className="flex items-center gap-2.5">
                    {t.photo && (
                      <img src={t.photo.src} alt="" width={32} height={32} loading="lazy" decoding="async" className="h-8 w-8 shrink-0 rounded-full object-cover" style={{ objectPosition: t.photo.position }} />
                    )}
                    {t.href ? (
                      <a href={t.href} className="text-[15px] font-semibold underline-offset-4 hover:underline" style={primary}>
                        {t.name}
                      </a>
                    ) : (
                      <span className="text-[15px] font-semibold" style={primary}>
                        {t.name}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Detail>
          )}

          {c.languages.length > 0 && (
            <Detail icon={<Globe {...ICON} />} label={msg.languagesLabel}>
              <p className="text-[15px]" style={primary}>
                {c.languages.map((l) => capitalise(languageName(locale, l), locale)).join(', ')}
              </p>
            </Detail>
          )}
        </div>
        {c.place && (
          <div className="min-w-0">
            <Detail icon={<MapPin {...ICON} />} label={msg.placeLabel}>
              <p className="text-[15px] font-semibold" style={primary}>
                {c.place.name}
              </p>
              {c.place.lines.length > 0 && (
                <div className="mt-0.5 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  {c.place.lines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              )}
              {c.place.mapsUrl && (
                // A plain outbound link — never an embed.
                <a href={c.place.mapsUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline" style={primary}>
                  {msg.openInMaps}
                  <ArrowUpRight aria-hidden="true" width={15} height={15} strokeWidth={1.75} />
                  <span className="sr-only"> ({msg.opensInNewTab})</span>
                </a>
              )}
            </Detail>
          </div>
        )}
      </div>
    </li>
  )
}

export function CoursePage({ locale, title, description, image, classes, timeZone = null, timetableHref = null }: CoursePageProps) {
  const msg = getCoursePageMessages(locale)
  return (
    <div style={{ backgroundColor: 'var(--color-background)' }}>
      <article className="mx-auto max-w-[1040px] px-5 pb-20 pt-12 md:px-8 md:pb-28 md:pt-20">
        <header className={image ? 'grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-14' : 'max-w-2xl'}>
          <div className="min-w-0">
              <h1 className="text-[clamp(2.25rem,6vw,3.5rem)] font-semibold leading-[1.08] tracking-tight" style={heading}>
                {title}
              </h1>
              {description && (
                <p className="mt-6 text-lg leading-relaxed" style={{ color: 'var(--color-text-secondary)', whiteSpace: 'pre-line' }}>
                  {description}
                </p>
              )}
              {timetableHref && (
                <a
                  href={timetableHref}
                  className="mt-8 inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-opacity hover:opacity-85"
                  style={{ backgroundColor: 'var(--btn-primary-bg, var(--color-primary))', color: 'var(--btn-primary-text, var(--color-background))', borderRadius: 'var(--radius-btn, var(--radius-full))' }}
                >
                  {msg.seeTimetable}
                  <ArrowRight aria-hidden="true" width={16} height={16} strokeWidth={2} />
                </a>
              )}
          </div>
          {image && (
            <div className="-order-1 overflow-hidden md:order-none" style={{ aspectRatio: '4 / 3', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg, var(--radius-md))' }}>
              <img
                src={image.src}
                srcSet={image.srcSet ?? undefined}
                sizes="(max-width: 768px) 100vw, 500px"
                alt={image.alt}
                className="h-full w-full object-cover"
                style={{ objectPosition: image.position }}
                loading="eager"
              />
            </div>
          )}
        </header>

        <section aria-labelledby="course-when" className="mt-16 md:mt-24">
          <h2 id="course-when" className="text-[1.75rem] font-semibold leading-tight md:text-[2rem]" style={heading}>
            {msg.when}
          </h2>
          {classes.length > 0 ? (
            <ul className="mt-8 flex flex-col gap-4">
              {classes.map((c) => (
                <ClassCard key={c.id} c={c} locale={locale} timeZone={timeZone} />
              ))}
            </ul>
          ) : (
            <p className="mt-6 text-base" style={{ color: 'var(--color-text-secondary)' }}>
              {msg.noClasses}
            </p>
          )}
        </section>
      </article>
    </div>
  )
}
