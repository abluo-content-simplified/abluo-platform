'use client'

// The printed week / month: a print preview over the page (A4, black on white)
// with a Print button. "Print week" (portrait) lists each day of the week on
// screen; "Print month" (landscape) is a calendar of the month on screen, one
// row of seven days per week. Both follow the filters on screen (named in the
// header) and show every change on its own date.
//
// The document is cut into pages here, not by the browser: every block (a
// calendar week, a day's class, an update) is measured and placed whole, a
// heading is repeated on the next page ("continued"), and each page carries
// its period, number and the generation date and time — the same in every browser.
//
// Presentation only: the content comes from buildPrintDoc(), every word from
// the timetable dictionary or Intl.

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import type { TimetableMessages } from '@/lib/i18n/timetable-messages'
import { useFocusTrap } from '@/components/site/SiteDialog'
import { safeHttps } from './format'
import { paginate, type PlacedBlock, type PrintBlock, type PrintDay, type PrintDoc, type PrintSession, type PrintWeekCell } from './print-model'

export type ProfileLinks = { siteBase: string; segment: string | null } | null

export function teacherHref(profile: ProfileLinks, teacher: { hasPage: boolean; slug: string | null }): string | null {
  if (!profile?.segment || !teacher.hasPage || !teacher.slug) return null
  return `${profile.siteBase}/${profile.segment}/${teacher.slug}`
}

// ── Page geometry (mm) ───────────────────────────────────────────────────────
// A page 1 mm shorter than the paper: one exactly as tall can spill a blank page in some browsers.
type Geometry = { w: number; h: number; top: number; x: number; bottom: number; footer: number; running: number }
const PORTRAIT: Geometry = { w: 210, h: 296, top: 12, x: 14, bottom: 10, footer: 10, running: 11 }
const LANDSCAPE: Geometry = { w: 297, h: 209, top: 9, x: 11, bottom: 8, footer: 9, running: 9 }
const MM = 96 / 25.4
const geometryOf = (doc: PrintDoc) => (doc.kind === 'month' ? LANDSCAPE : PORTRAIT)

type Item = { block: PrintBlock; render: (continued: boolean) => ReactNode }

type DocProps = {
  doc: PrintDoc
  msg: TimetableMessages
  showCourseDescriptions?: boolean
  notes?: ReactNode
  membersNotes?: ReactNode
}

/** The document as blocks, in reading order. */
function useItems({ doc, msg, showCourseDescriptions = false, notes = null, membersNotes = null }: DocProps): Item[] {
  return useMemo(() => {
    const items: Item[] = []
    const push = (block: PrintBlock, render: Item['render']) => items.push({ block, render })

    push({ key: 'head' }, () => <FirstHeader doc={doc} msg={msg} />)

    if (doc.kind === 'month') {
      if (doc.weeks.length === 0) push({ key: 'empty' }, () => <p className="pv-empty">{msg.noClassesThisMonth}</p>)
      doc.weeks.forEach((week, i) => push({ key: `week-${i}` }, () => <CalendarWeek cells={week} msg={msg} />))
    } else {
      if (doc.days.length === 0) push({ key: 'empty' }, () => <p className="pv-empty">{msg.noClasses}</p>)
      for (const day of doc.days) {
        const group = `day-${day.date}`
        push({ key: group, group, heading: true }, (continued) => <DayHead day={day} continued={continued} msg={msg} />)
        if (day.holiday) push({ key: `${group}-holiday`, group }, () => <p className="pv-holiday-line">{day.holiday}</p>)
        for (const s of day.sessions) push({ key: `${group}-${s.id}`, group }, () => <ListRow s={s} msg={msg} />)
      }
    }

    const list = <T,>(group: string, title: string, rows: readonly T[], key: (r: T) => string, render: (r: T) => ReactNode) => {
      if (rows.length === 0) return
      push({ key: group, group, heading: true }, (continued) => <SectionHead title={title} continued={continued} msg={msg} />)
      for (const r of rows) push({ key: `${group}-${key(r)}`, group }, () => render(r))
    }

    list('updates', msg.scheduleUpdates, doc.updates, (u) => u.id, (u) => (
      <div className="pv-line" data-print-update>
        <span className="pv-line-date">{u.date}</span>
        <span>{u.text}</span>
      </div>
    ))

    list('rooms', msg.onlineRooms, doc.rooms, (r) => r.id, (r) => {
      const href = safeHttps(r.joinUrl)
      return (
        <div className="pv-line" data-print-room>
          <strong className="pv-line-date">{r.label}</strong>
          <span>
            {r.meetingId && <span className="pv-room-part">{msg.meetingId}: {r.meetingId}</span>}
            {r.passcode && <span className="pv-room-part">{msg.passcode}: {r.passcode}</span>}
            {href && <span className="pv-room-part pv-url"><a href={href}>{href}</a></span>}
            {r.note && <span className="pv-room-part">{r.note}</span>}
          </span>
        </div>
      )
    })

    if (doc.kind === 'week' && doc.hasVolunteers) push({ key: 'volunteers' }, () => <p className="pv-foot-note" data-volunteer-note>{msg.volunteerNote}</p>)
    if (notes) push({ key: 'notes' }, () => <div className="pv-notes">{notes}</div>)
    if (membersNotes) push({ key: 'members' }, () => <div className="pv-notes">{membersNotes}</div>)

    if (showCourseDescriptions && doc.courses.some((c) => c.description)) {
      push({ key: 'about', group: 'about', heading: true, pageBreak: true }, (continued) => <SectionHead title={msg.aboutCourses} continued={continued} msg={msg} />)
      for (const c of doc.courses.filter((x) => x.description))
        push({ key: `about-${c.id}`, group: 'about' }, () => (
          <div className="pv-about">
            <h4>{c.title}</h4>
            <p>{c.description}</p>
          </div>
        ))
    }
    return items
  }, [doc, msg, showCourseDescriptions, notes, membersNotes])
}

function FirstHeader({ doc, msg }: { doc: PrintDoc; msg: TimetableMessages }) {
  return (
    <header className="pv-head">
      <div className="pv-title-row">
        <h2 className="pv-title">
          {doc.title} <span className="pv-period">{doc.periodLabel}</span>
        </h2>
        {doc.siteHost && <span className="pv-host">{doc.siteHost}</span>}
      </div>
      <div className="pv-meta">
        <div className="pv-meta-left">
          {doc.filters && (
            <span className="pv-filters" data-print-filters>
              {doc.filters}
            </span>
          )}
          {doc.holidays && (
            <span className="pv-holidays" data-holidays>
              {doc.holidays}
            </span>
          )}
        </div>
        <div className="pv-legend" data-print-legend>
          <span>
            <s>{msg.courseLabel}</s> <span className="pv-flag">{msg.cancelled}</span>
          </span>
          <span>
            <span className="pv-changed">{msg.teacherLabel}</span> {msg.legendChanged}
          </span>
          <span className="pv-tag">{msg.workshop}</span>
          {doc.hasVolunteers && <span>{msg.volunteerNote}</span>}
        </div>
      </div>
    </header>
  )
}

function Teachers({ s }: { s: PrintSession }) {
  return (
    <>
      {s.teachers.map((t, i) => (
        <Fragment key={t.id}>
          {t.href ? <a href={t.href}>{t.name}</a> : t.name}
          {t.volunteer && '*'}
          {i < s.teachers.length - 1 ? ', ' : ''}
        </Fragment>
      ))}
    </>
  )
}

const Tags = ({ s, msg }: { s: PrintSession; msg: TimetableMessages }) => (
  <>
    {s.tags.map((t) => (
      <span key={t} className={t === 'online' ? 'pv-tag pv-tag-solid' : 'pv-tag'}>
        {t === 'online' ? msg.online : t === 'hybrid' ? msg.hybrid : msg.workshop}
      </span>
    ))}
  </>
)

/** A class in the month calendar. */
function Card({ s, msg }: { s: PrintSession; msg: TimetableMessages }) {
  return (
    <div className={`pv-card${s.cancelled ? ' pv-cancelled' : ''}${s.kind === 'event' ? ' pv-event' : ''}`} data-print-session={s.cancelled ? 'cancelled' : s.kind}>
      <div className="pv-card-r1">
        <b className={`pv-num pv-strike${s.timeChanged ? ' pv-changed' : ''}`}>{s.time}</b>
        {s.kind === 'event' ? <Tags s={s} msg={msg} /> : <span className="pv-lang pv-strike">{s.languageCodes}</span>}
      </div>
      <div className="pv-card-name pv-strike">{s.href ? <a href={s.href}>{s.course}</a> : s.course}</div>
      {s.cancelled ? (
        <span className="pv-flag">{msg.cancelled}</span>
      ) : (
        <>
          {s.teachers.length > 0 && (
            <div className={s.teacherChanged ? 'pv-changed' : undefined}>
              <Teachers s={s} />
            </div>
          )}
          {s.notes.map((n) => (
            <div key={n} className="pv-small-note">
              {n}
            </div>
          ))}
          {s.location && <div className={`pv-where${s.locationChanged ? ' pv-changed' : ''}`}>{s.location}</div>}
        </>
      )}
    </div>
  )
}

function DayCell({ day, msg }: { day: PrintDay; msg: TimetableMessages }) {
  return (
    <div className={`pv-cday${day.weekend ? ' pv-weekend' : ''}${day.otherMonth ? ' pv-other' : ''}`} data-print-date={day.date}>
      <div className="pv-cday-head">
        <span className="pv-wd">{day.weekdayShort}</span> <span className="pv-dn">{day.dayNumber}</span>
        {day.otherMonth && <span className="pv-om"> {day.otherMonth}</span>}
      </div>
      {day.holiday && (
        <div className="pv-hol">
          {day.holiday}
          <span>{msg.noClasses}</span>
        </div>
      )}
      {day.sessions.map((s) => (
        <Card key={s.id} s={s} msg={msg} />
      ))}
    </div>
  )
}

function CalendarWeek({ cells, msg }: { cells: PrintWeekCell[]; msg: TimetableMessages }) {
  return (
    <div className="pv-week" data-print-week>
      {cells.map((c) =>
        c.kind === 'day' ? (
          <DayCell key={c.day.date} day={c.day} msg={msg} />
        ) : (
          <div key={c.days[0].date} className="pv-na" style={{ gridColumn: `span ${c.days.length}` }} data-print-unavailable>
            <div className="pv-na-days" style={{ gridTemplateColumns: `repeat(${c.days.length}, 1fr)` }}>
              {c.days.map((d) => (
                <span key={d.date}>
                  <span className="pv-wd">{d.weekdayShort}</span> <span className="pv-dn">{d.dayNumber}</span> <span className="pv-om">{d.otherMonth}</span>
                </span>
              ))}
            </div>
            <p>{c.text}</p>
          </div>
        ),
      )}
    </div>
  )
}

function DayHead({ day, continued, msg }: { day: PrintDay; continued: boolean; msg: TimetableMessages }) {
  return (
    <div className="pv-day" data-print-day>
      <h3>
        {day.name}
        {continued && <span className="pv-cont"> ({msg.continued})</span>}
      </h3>
      <div className="pv-cols" aria-hidden="true">
        <span>{msg.timeLabel}</span>
        <span>{msg.courseLabel}</span>
        <span>{msg.teacherLabel}</span>
        <span>{msg.locationFilter}</span>
        <span>{msg.languageFilter}</span>
      </div>
    </div>
  )
}

function SectionHead({ title, continued, msg }: { title: string; continued: boolean; msg: TimetableMessages }) {
  return (
    <h3 className="pv-section">
      {title}
      {continued && <span className="pv-cont"> ({msg.continued})</span>}
    </h3>
  )
}

/** A class in the week list. */
function ListRow({ s, msg }: { s: PrintSession; msg: TimetableMessages }) {
  return (
    <div className={`pv-row${s.cancelled ? ' pv-cancelled' : ''}`} data-print-session={s.cancelled ? 'cancelled' : s.kind}>
      <div>
        <strong className={`pv-num pv-strike${s.timeChanged ? ' pv-changed' : ''}`}>{s.time}</strong>
      </div>
      <div>
        <strong className="pv-strike">{s.href ? <a href={s.href}>{s.course}</a> : s.course}</strong>
        <Tags s={s} msg={msg} />
        {s.cancelled && <span className="pv-flag pv-flag-inline">{msg.cancelled}</span>}
      </div>
      <div className={s.teacherChanged ? 'pv-changed' : undefined}>{!s.cancelled && <Teachers s={s} />}</div>
      <div className={s.locationChanged ? 'pv-changed' : undefined}>{!s.cancelled && s.location}</div>
      <div>{!s.cancelled && s.languages}</div>
      {s.notes.length > 0 && <div className="pv-row-notes">{s.notes.join(' · ')}</div>}
    </div>
  )
}

/**
 * The paginated document. Before it is measured (server render, first paint)
 * it is one continuous sheet; then it is cut into A4 pages.
 */
export function PrintDocument({ zoom = 1, ...props }: DocProps & { zoom?: number }) {
  const { doc, msg } = props
  const g = geometryOf(doc)
  const items = useItems(props)
  const measureRef = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<PlacedBlock[][] | null>(null)

  useLayoutEffect(() => {
    let alive = true
    const measure = () => {
      const box = measureRef.current
      if (!box || !alive) return
      const heights = [...box.children].map((el) => (el as HTMLElement).getBoundingClientRect().height)
      if (heights.length !== items.length || heights.every((h) => h === 0)) return // not laid out (tests, hidden)
      const content = g.h - g.top - g.bottom - g.footer
      const cap = (page: number) => (content - (page === 0 ? 0 : g.running)) * MM
      setPages(paginate(items.map((i) => i.block), heights, cap))
    }
    measure()
    // Web fonts change line heights: measure again once they are in.
    void document.fonts?.ready.then(measure)
    return () => {
      alive = false
    }
  }, [items, g])

  const footer = (n: number, total: number) => (
    <footer className="pv-footer">
      <span>
        {doc.siteHost ? `${doc.siteHost} · ` : ''}
        {doc.generatedOn}
      </span>
      <span data-page-number>{msg.pageOf(n, total)}</span>
    </footer>
  )

  return (
    <div className={`pv-doc pv-doc-${doc.kind}`}>
      <style>{pageCss(g)}</style>
      <div ref={measureRef} className="pv-measure" aria-hidden="true">
        {items.map((it) => (
          <div key={it.block.key} className="pv-block">
            {it.render(false)}
          </div>
        ))}
      </div>
      <div className="pv-pages" style={zoom !== 1 ? { zoom } : undefined}>
        {pages ? (
          pages.map((placed, p) => (
            <section key={p} className="pv-page" data-print-page={p + 1}>
              {p > 0 && (
                <div className="pv-running">
                  <span>
                    {doc.title} · {doc.periodLabel}
                  </span>
                  {doc.filters && <span>{doc.filters}</span>}
                </div>
              )}
              <div className="pv-content">
                {placed.map(({ index, continued }) => (
                  <div key={`${items[index].block.key}${continued ? '-c' : ''}`} className="pv-block">
                    {items[index].render(continued)}
                  </div>
                ))}
              </div>
              {footer(p + 1, pages.length)}
            </section>
          ))
        ) : (
          <section className="pv-page pv-page-flow" data-print-page="1">
            <div className="pv-content">
              {items.map((it) => (
                <div key={it.block.key} className="pv-block">
                  {it.render(false)}
                </div>
              ))}
            </div>
            {footer(1, 1)}
          </section>
        )}
      </div>
    </div>
  )
}

type ViewProps = DocProps & { open: boolean; onClose: () => void }

/** The print preview: full screen over the page, the pages on a grey desk, Print and Close on top. */
export function PrintView({ open, onClose, ...docProps }: ViewProps) {
  const { msg, doc } = docProps
  const ref = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const pageWidth = geometryOf(doc).w
  useFocusTrap(ref, open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const fit = () => setZoom(Math.min(1, (window.innerWidth - 32) / (pageWidth * MM)))
    fit()
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', fit)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', fit)
      document.body.style.overflow = overflow
    }
  }, [open, onClose, pageWidth])

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div ref={ref} className="ab-tt-pv" role="dialog" aria-modal="true" aria-label={`${msg.printPreview} · ${doc.periodLabel}`}>
      <style>{PRINT_VIEW_CSS}</style>
      <div className="pv-bar">
        <div className="pv-bar-text">
          <strong>{msg.printPreview}</strong>
          <span className="pv-bar-hint">{msg.printHint}</span>
        </div>
        <div className="pv-bar-actions">
          <button type="button" className="pv-btn" onClick={onClose}>
            <X aria-hidden="true" width={16} height={16} strokeWidth={1.75} />
            {msg.close}
          </button>
          <button type="button" className="pv-btn pv-btn-primary" onClick={() => window.print()} data-print-now>
            <Printer aria-hidden="true" width={16} height={16} strokeWidth={1.75} />
            {msg.printNow}
          </button>
        </div>
      </div>
      <div className="pv-desk">
        <PrintDocument {...docProps} zoom={zoom} />
      </div>
    </div>,
    document.body,
  )
}

/** Paper size and margins: portrait for the week, landscape for the month. */
const pageCss = (g: Geometry) => `
@page { size: A4 ${g === LANDSCAPE ? 'landscape' : 'portrait'}; margin: 0; }
.ab-tt-pv .pv-measure { width: ${g.w - 2 * g.x}mm; }
.ab-tt-pv .pv-page { width: ${g.w}mm; height: ${g.h}mm; padding: ${g.top}mm ${g.x}mm ${g.bottom}mm; }
.ab-tt-pv .pv-page-flow { height: auto; min-height: ${g.h}mm; }
.ab-tt-pv .pv-running { height: ${g.running - 3}mm; }
.ab-tt-pv .pv-footer { left: ${g.x}mm; right: ${g.x}mm; bottom: ${g.bottom - 2}mm; }
`

/**
 * Paper is white and the text dark whatever the site's theme. Plain greys only
 * (no gradients: some PDF viewers tint them), so it reads the same in black and white.
 */
export const PRINT_VIEW_CSS = `
.ab-tt-pv { position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column; background: #e8e6e1; color: #141414; font-family: var(--font-body, system-ui, sans-serif); }
.ab-tt-pv .pv-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px; background: #fff; border-bottom: 1px solid #d9d6cf; }
.ab-tt-pv .pv-bar-text { display: flex; flex-direction: column; gap: 2px; font-size: 15px; min-width: 0; }
.ab-tt-pv .pv-bar-hint { font-size: 12.5px; color: #5c5c5c; }
.ab-tt-pv .pv-bar-actions { display: flex; gap: 8px; }
.ab-tt-pv .pv-btn { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 16px; border-radius: 999px; border: 1px solid #cfccc4; background: #fff; color: #141414; font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; }
.ab-tt-pv .pv-btn:hover { background: #f4f2ee; }
.ab-tt-pv .pv-btn:focus-visible { outline: 2px solid #141414; outline-offset: 2px; }
.ab-tt-pv .pv-btn-primary { background: #141414; border-color: #141414; color: #fff; }
.ab-tt-pv .pv-btn-primary:hover { background: #333; }
.ab-tt-pv .pv-desk { flex: 1; overflow: auto; padding: 24px 16px 48px; }
.ab-tt-pv .pv-pages { display: flex; flex-direction: column; align-items: center; gap: 20px; }

.ab-tt-pv .pv-measure { position: absolute; left: -10000px; top: 0; visibility: hidden; pointer-events: none; }
.ab-tt-pv .pv-page { position: relative; box-sizing: border-box; background: #fff; color: #141414; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.08); }
.ab-tt-pv .pv-measure, .ab-tt-pv .pv-page { font-size: 8.6pt; line-height: 1.35; }
.ab-tt-pv .pv-doc-month .pv-measure, .ab-tt-pv .pv-doc-month .pv-page { font-size: 7.4pt; line-height: 1.28; }
.ab-tt-pv .pv-block { display: flow-root; }
.ab-tt-pv a { color: inherit; text-decoration: none; }
.ab-tt-pv .pv-num { font-variant-numeric: tabular-nums; }

.ab-tt-pv .pv-head { padding-bottom: 1mm; }
.ab-tt-pv .pv-title-row { display: flex; align-items: baseline; justify-content: space-between; gap: 6mm; padding-bottom: 2mm; border-bottom: 0.5mm solid #141414; }
.ab-tt-pv .pv-title { margin: 0; font-family: var(--font-heading, inherit); font-size: 17pt; line-height: 1.15; font-weight: 600; }
.ab-tt-pv .pv-period { font-weight: 400; display: inline-block; }
.ab-tt-pv .pv-period::first-letter { text-transform: uppercase; }
.ab-tt-pv .pv-host { font-size: 8.5pt; color: #555; white-space: nowrap; }
.ab-tt-pv .pv-meta { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 2mm 6mm; margin-top: 2mm; }
.ab-tt-pv .pv-meta-left { display: flex; flex-wrap: wrap; align-items: center; gap: 2mm 4mm; }
.ab-tt-pv .pv-filters { padding: 0.8mm 2.4mm; border: 0.3mm solid #141414; border-radius: 1.2mm; font-weight: 600; }
.ab-tt-pv .pv-holidays { font-weight: 600; }
.ab-tt-pv .pv-legend { display: flex; flex-wrap: wrap; gap: 1.5mm 4mm; align-items: center; margin-left: auto; font-size: 6.8pt; color: #333; }
.ab-tt-pv .pv-legend s { color: #777; }
.ab-tt-pv .pv-empty { margin: 6mm 0; font-size: 10pt; }

.ab-tt-pv .pv-changed { font-weight: 700; text-decoration: underline; text-decoration-thickness: 0.3mm; text-underline-offset: 0.5mm; }
.ab-tt-pv .pv-flag { display: inline-block; padding: 0 1.2mm; background: #141414; color: #fff; border-radius: 0.8mm; font-size: 6.2pt; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; text-decoration: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.ab-tt-pv .pv-flag-inline { margin-left: 1.5mm; vertical-align: 0.1em; }
.ab-tt-pv .pv-cancelled .pv-strike { text-decoration: line-through; color: #777; }
.ab-tt-pv .pv-tag { display: inline-block; margin-left: 1.2mm; padding: 0 1mm; border: 0.25mm solid #141414; border-radius: 0.8mm; font-size: 5.9pt; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; line-height: 1.5; vertical-align: 0.12em; }
.ab-tt-pv .pv-legend .pv-tag { margin-left: 0; }
.ab-tt-pv .pv-tag-solid { background: #141414; color: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

/* Month calendar */
.ab-tt-pv .pv-week { display: grid; grid-template-columns: repeat(7, 1fr); margin-top: 2.5mm; border-top: 0.4mm solid #141414; border-left: 0.2mm solid #bbb; }
.ab-tt-pv .pv-cday, .ab-tt-pv .pv-na { border-right: 0.2mm solid #bbb; border-bottom: 0.2mm solid #bbb; padding: 1.2mm 1.3mm 1.5mm; min-height: 22mm; min-width: 0; }
.ab-tt-pv .pv-weekend { background: #f5f5f5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.ab-tt-pv .pv-other .pv-cday-head { color: #888; }
.ab-tt-pv .pv-cday-head { margin-bottom: 1mm; }
.ab-tt-pv .pv-wd { font-size: 6.8pt; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #444; }
.ab-tt-pv .pv-dn { font-size: 10.5pt; font-weight: 700; }
.ab-tt-pv .pv-om { font-size: 6.8pt; color: #888; }
.ab-tt-pv .pv-card { padding: 1mm 0 1.1mm; border-top: 0.2mm solid #d6d6d6; }
.ab-tt-pv .pv-cday-head + .pv-card, .ab-tt-pv .pv-hol + .pv-card { border-top: 0; }
.ab-tt-pv .pv-card-r1 { display: flex; justify-content: space-between; align-items: baseline; gap: 1mm; }
.ab-tt-pv .pv-lang { font-size: 6.4pt; color: #444; letter-spacing: 0.03em; }
.ab-tt-pv .pv-card-name { font-weight: 600; }
.ab-tt-pv .pv-where { color: #555; }
.ab-tt-pv .pv-where.pv-changed { color: #141414; }
.ab-tt-pv .pv-small-note { font-size: 6.6pt; font-style: italic; color: #333; }
.ab-tt-pv .pv-event { margin-top: 1mm; padding: 1mm 1.2mm; border: 0.3mm dashed #141414; border-radius: 1mm; }
.ab-tt-pv .pv-hol { margin-top: 1mm; padding: 1.5mm; border: 0.3mm dashed #141414; border-radius: 1mm; text-align: center; font-weight: 700; }
.ab-tt-pv .pv-hol span { display: block; font-weight: 400; color: #444; }
.ab-tt-pv .pv-na { display: flex; flex-direction: column; background: #f5f5f5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.ab-tt-pv .pv-na-days { display: grid; }
.ab-tt-pv .pv-na-days, .ab-tt-pv .pv-na-days .pv-wd, .ab-tt-pv .pv-na-days .pv-dn { color: #888; }
.ab-tt-pv .pv-na p { margin: auto; padding: 4mm 0; font-size: 9pt; font-weight: 600; color: #333; text-align: center; }

/* Week list */
.ab-tt-pv .pv-day { padding-top: 4mm; }
.ab-tt-pv .pv-day h3, .ab-tt-pv .pv-section { margin: 0; font-size: 11pt; font-weight: 700; }
.ab-tt-pv .pv-day h3::first-letter { text-transform: uppercase; }
.ab-tt-pv .pv-section { padding: 5mm 0 1.6mm; border-bottom: 0.3mm solid #141414; }
.ab-tt-pv .pv-doc-month .pv-section { padding-top: 4mm; font-size: 9.5pt; }
.ab-tt-pv .pv-cont { font-weight: 400; color: #555; }
.ab-tt-pv .pv-cols, .ab-tt-pv .pv-row { display: grid; grid-template-columns: 21mm 1.45fr 1.15fr 1fr 0.8fr; column-gap: 3mm; }
.ab-tt-pv .pv-cols { margin-top: 1.2mm; padding-bottom: 1mm; border-bottom: 0.3mm solid #141414; font-size: 6.6pt; letter-spacing: 0.04em; text-transform: uppercase; color: #555; }
.ab-tt-pv .pv-row { padding: 1.6mm 0; border-bottom: 0.2mm solid #cfcfcf; }
.ab-tt-pv .pv-row-notes { grid-column: 2 / -1; margin-top: 0.6mm; font-size: 7.6pt; font-style: italic; color: #333; }
.ab-tt-pv .pv-holiday-line { margin: 0; padding: 1.6mm 0; border-bottom: 0.2mm solid #cfcfcf; font-weight: 700; }

.ab-tt-pv .pv-line { display: grid; grid-template-columns: 24mm 1fr; column-gap: 3mm; padding: 1.2mm 0; border-bottom: 0.2mm solid #cfcfcf; }
.ab-tt-pv .pv-line-date { font-weight: 600; }
.ab-tt-pv .pv-room-part { display: block; }
.ab-tt-pv .pv-url { word-break: break-all; }
.ab-tt-pv .pv-foot-note { margin: 3mm 0 0; font-size: 7.6pt; color: #333; }
.ab-tt-pv .pv-notes { margin-top: 4mm; padding-top: 2mm; border-top: 0.3mm solid #141414; }
.ab-tt-pv .pv-notes p, .ab-tt-pv .pv-notes ul, .ab-tt-pv .pv-notes ol { margin: 0 0 1.5mm; }
.ab-tt-pv .pv-about { padding: 2.5mm 0; border-bottom: 0.2mm solid #cfcfcf; }
.ab-tt-pv .pv-about h4 { margin: 0 0 0.8mm; font-size: 9.5pt; }
.ab-tt-pv .pv-about p { margin: 0; white-space: pre-line; }

.ab-tt-pv .pv-running { display: flex; justify-content: space-between; align-items: flex-end; gap: 6mm; margin-bottom: 3mm; padding-bottom: 1.5mm; box-sizing: border-box; border-bottom: 0.3mm solid #141414; font-size: 7.5pt; }
.ab-tt-pv .pv-running span:last-child { color: #333; text-align: right; }
.ab-tt-pv .pv-footer { position: absolute; display: flex; justify-content: space-between; gap: 6mm; padding-top: 1.5mm; border-top: 0.2mm solid #cfcfcf; font-size: 6.8pt; color: #555; }

@media print {
  html, body { background: #fff !important; }
  body > *:not(.ab-tt-pv) { display: none !important; }
  .ab-tt-pv { position: static !important; display: block !important; background: #fff !important; }
  .ab-tt-pv .pv-bar, .ab-tt-pv .pv-measure { display: none !important; }
  .ab-tt-pv .pv-desk { overflow: visible !important; padding: 0 !important; }
  .ab-tt-pv .pv-pages { display: block !important; zoom: 1 !important; }
  .ab-tt-pv .pv-page { box-shadow: none !important; break-after: page; page-break-after: always; }
  .ab-tt-pv .pv-page:last-child { break-after: auto; page-break-after: auto; }
}
`
