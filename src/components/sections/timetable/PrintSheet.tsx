// The printed month — CYCE sheet style (build spec §5). Rows = places (name,
// address and room lines), columns = the weekdays that have classes; each cell
// lists the weekly classes with that month's exceptions; an online-rooms block
// closes the sheet when online details were allowed for this request.
//
// Presentation only: every class, exception and room comes from
// buildPrintMonth(); every word from the timetable dictionary or Intl.

import type { PrintClass, PrintException, PrintMonth, TimetableData } from '@/lib/modules/courses/timetable'
import type { TimetableMessages } from '@/lib/i18n/timetable-messages'
import { languageName, listNames, monthTitle, safeHttps, shortDate, timeRange, weekdayName } from './format'

export type ProfileLinks = { siteBase: string; segment: string | null } | null

export function teacherHref(profile: ProfileLinks, teacher: { hasPage: boolean; slug: string | null }): string | null {
  if (!profile?.segment || !teacher.hasPage || !teacher.slug) return null
  return `${profile.siteBase}/${profile.segment}/${teacher.slug}`
}

type Props = {
  print: PrintMonth
  data: TimetableData
  title: string
  locale: string
  msg: TimetableMessages
  profile: ProfileLinks
  /** Add the second page "About the courses" (each shown course's title and description). */
  showCourseDescriptions?: boolean
}

export function PrintSheet({ print, data, title, locale, msg, profile, showCourseDescriptions = false }: Props) {
  const year = print.month.slice(0, 4)
  const fmt = (date: string) => shortDate(locale, date, date.slice(0, 4) !== year)

  const teachers = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const t = data.teachers[id]
      return t ? [t] : []
    })

  const teacherNames = (ids: readonly string[]) => {
    const list = teachers(ids)
    return list.map((t, i) => {
      const href = teacherHref(profile, t)
      return (
        <span key={t.id}>
          {href ? <a href={href}>{t.name}</a> : t.name}
          {i < list.length - 1 ? ', ' : ''}
        </span>
      )
    })
  }

  const exceptionText = (e: PrintException): string => {
    const d = fmt(e.date)
    switch (e.kind) {
      case 'cancelled':
        return `${d} ${msg.noClass}${e.note ? ` (${e.note})` : ''}`
      case 'closed':
        return `${d} ${msg.noClass}`
      case 'substitute':
        return `${d} ${msg.substitute(listNames(locale, teachers(e.teacherIds).map((t) => t.name)))}`
      case 'time':
        return `${d} ${msg.atTime(timeRange(e.start, e.end))}`
      case 'mode':
        return `${d} ${e.mode === 'inPerson' ? msg.noHybrid : e.mode === 'online' ? msg.onlineOnly : msg.hybrid}`
      case 'note':
        return `${d} ${e.note}`
    }
  }

  const closureLine = (c: PrintMonth['closures'][number]) => {
    const range = c.lastClass && c.firstClass ? `${msg.lastClass(fmt(c.lastClass))}, ${msg.firstClass(fmt(c.firstClass))}` : msg.closedFromTo(fmt(c.startsOn), fmt(c.endsOn))
    return c.label ? `${c.label}: ${range}` : range
  }

  const rowLabel = (row: PrintMonth['rows'][number]) => {
    if (row.kind === 'online') return { name: msg.online, lines: [] as string[] }
    if (row.kind === 'unplaced') return { name: msg.otherPlace, lines: [] as string[] }
    const place = data.places[row.key]
    return { name: place?.name ?? row.key, lines: place?.lines ?? [] }
  }

  const classCell = (c: PrintClass) => {
    const course = data.courses[c.courseId]
    return (
      <div className="ab-tt-class" key={c.seriesId}>
        <div className="ab-tt-class-main">
          {c.dates && c.dates.length > 0 && <>{c.dates.map((d) => fmt(d)).join(', ')} </>}
          <strong>{timeRange(c.start, c.end)}</strong> {course?.title}
          {c.teacherIds.length > 0 && <> · {teacherNames(c.teacherIds)}</>}
          {c.languages.length > 0 && (
            <>
              {' · '}
              <span title={c.languages.map((l) => languageName(locale, l)).join(', ')}>{c.languages.map((l) => l.toUpperCase()).join('/')}</span>
            </>
          )}
          {c.mode === 'mixed' && <span className="ab-tt-tag">{msg.hybrid}</span>}
          {c.mode === 'online' && <span className="ab-tt-tag">{msg.online}</span>}
        </div>
        {c.exceptions.length > 0 && <div className="ab-tt-exc">{c.exceptions.map(exceptionText).join(' · ')}</div>}
      </div>
    )
  }

  return (
    <div className="ab-tt-sheet">
      <header className="ab-tt-sheet-head">
        <h2>
          {title} <span className="ab-tt-month">{monthTitle(locale, print.month)}</span>
        </h2>
        {print.closures.length > 0 && (
          <p className="ab-tt-closures">
            {print.closures.map((c) => (
              <span key={`${c.startsOn}-${c.endsOn}`}>{closureLine(c)}</span>
            ))}
          </p>
        )}
      </header>

      <table className="ab-tt-table">
        <thead>
          <tr>
            <th className="ab-tt-place-col" aria-hidden="true" />
            {print.weekdays.map((d) => (
              <th key={d} scope="col">
                {weekdayName(locale, d, 'long')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {print.rows.map((row) => {
            const label = rowLabel(row)
            return (
              <tr key={row.key}>
                <th scope="row" className="ab-tt-place-col">
                  <strong>{label.name}</strong>
                  {label.lines.map((line) => (
                    <div key={line} className="ab-tt-place-line">
                      {line}
                    </div>
                  ))}
                </th>
                {print.weekdays.map((d) => (
                  <td key={d}>{(row.cells[d] ?? []).map(classCell)}</td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>

      {print.rooms && print.rooms.length > 0 && (
        <section className="ab-tt-rooms">
          <h3>{msg.onlineRooms}</h3>
          <ul>
            {print.rooms.map((r) => {
              const href = safeHttps(r.joinUrl)
              return (
                <li key={r.id}>
                  <strong>{r.label}</strong>
                  {r.meetingId && <> · {msg.meetingId}: {r.meetingId}</>}
                  {r.passcode && <> · {msg.passcode}: {r.passcode}</>}
                  {href && <> · <a href={href}>{href}</a></>}
                  {r.note && <> · {r.note}</>}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {showCourseDescriptions && <AboutCourses print={print} data={data} locale={locale} msg={msg} />}
    </div>
  )
}

/** The optional second page: every course shown on the sheet, with its description (courses without one are listed by title). */
function AboutCourses({ print, data, msg }: { print: PrintMonth; data: TimetableData; locale: string; msg: TimetableMessages }) {
  const courses = print.courseIds.flatMap((id) => (data.courses[id] ? [data.courses[id]] : []))
  if (courses.length === 0) return null
  return (
    <section className="ab-tt-about">
      <h2>{msg.aboutCourses}</h2>
      {courses.map((c) => (
        <div key={c.id} className="ab-tt-about-item">
          <h3>{c.title}</h3>
          {c.description && <p>{c.description}</p>}
        </div>
      ))}
    </section>
  )
}

/**
 * Print-only CSS. On screen the sheet is hidden; when printing, everything else
 * on the page is removed so the sheet is the whole document (A4 portrait).
 * Paper is white: the sheet uses black on white on purpose, whatever theme the
 * visitor was in.
 */
export const PRINT_CSS = `
.ab-tt-print-root { display: none; }
@page { size: A4 portrait; margin: 9mm; }
@media print {
  body > *:not(.ab-tt-print-root) { display: none !important; }
  html, body { background: #fff !important; }
  .ab-tt-print-root { display: block !important; color: #000; background: #fff; font-family: var(--font-body, system-ui, sans-serif); font-size: 7.5pt; line-height: 1.25; }
  .ab-tt-sheet-head h2 { font-size: 13pt; margin: 0 0 2mm; font-family: var(--font-heading, inherit); }
  .ab-tt-month { text-transform: capitalize; font-weight: 400; }
  .ab-tt-closures { margin: 0 0 3mm; font-size: 8pt; }
  .ab-tt-closures span + span::before { content: " · "; }
  .ab-tt-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .ab-tt-table th, .ab-tt-table td { border: 0.3mm solid #000; padding: 1.2mm; vertical-align: top; text-align: left; font-weight: 400; break-inside: avoid; }
  .ab-tt-table thead th { text-transform: capitalize; font-weight: 700; }
  .ab-tt-table .ab-tt-place-col { width: 24mm; }
  .ab-tt-place-line { font-size: 6.5pt; }
  .ab-tt-class + .ab-tt-class { margin-top: 1.5mm; padding-top: 1.5mm; border-top: 0.2mm dotted #000; }
  .ab-tt-exc { font-style: italic; font-size: 6.8pt; }
  .ab-tt-tag { margin-left: 1mm; padding: 0 1mm; border: 0.2mm solid #000; font-size: 6pt; text-transform: uppercase; }
  .ab-tt-rooms { margin-top: 3mm; break-inside: avoid; }
  .ab-tt-rooms h3 { font-size: 9pt; margin: 0 0 1mm; }
  .ab-tt-rooms ul { margin: 0; padding-left: 4mm; }
  .ab-tt-about { break-before: page; page-break-before: always; font-size: 9pt; line-height: 1.4; }
  .ab-tt-about h2 { font-size: 13pt; margin: 0 0 4mm; font-family: var(--font-heading, inherit); }
  .ab-tt-about-item { break-inside: avoid; margin: 0 0 4mm; }
  .ab-tt-about-item h3 { font-size: 10pt; margin: 0 0 1mm; }
  .ab-tt-about-item p { margin: 0; white-space: pre-line; }
  .ab-tt-print-root a { color: #000; text-decoration: none; }
}
`
