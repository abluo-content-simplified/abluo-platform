'use client'

import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useFormatter } from 'next-intl'

export type TrendPoint = { date: string; value: number }

/**
 * A day-by-day trend for ONE measure (analytics v2): this period as a solid
 * line in the app's primary colour over a faint area, the period before as a
 * thin dashed neutral line behind it. One y-axis, three recessive gridlines,
 * first / middle / last day on the x-axis. Inline SVG, no chart library.
 *
 * Hover (or focus + ←/→) shows a crosshair and a tooltip with both periods'
 * values for that day. Identity is never colour alone: the legend names the
 * solid and the dashed line, and a visually hidden table carries every value
 * for screen readers.
 *
 * All text comes from the caller (`labels`), so the component is
 * language-agnostic.
 */
export function TrendChart({
  title,
  current,
  previous,
  labels,
}: {
  title: string
  current: readonly TrendPoint[]
  /** Same length as `current` (day i of the period before); empty → one line only. */
  previous: readonly TrendPoint[]
  labels: { current: string; previous: string; date: string }
}) {
  const format = useFormatter()
  const id = useId()
  const [active, setActive] = useState<number | null>(null)
  if (current.length < 2) return null

  const hasPrevious = previous.length === current.length
  const W = 600
  const H = 180
  const PAD_L = 0
  const PAD_R = 8
  const PAD_T = 16
  const PAD_B = 22
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  const rawMax = Math.max(1, ...current.map((p) => p.value), ...(hasPrevious ? previous.map((p) => p.value) : []))
  const max = niceMax(rawMax)
  const n = current.length
  const x = (i: number) => PAD_L + (i / (n - 1)) * plotW
  const y = (v: number) => PAD_T + (1 - v / max) * plotH
  const path = (pts: readonly TrendPoint[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const line = path(current)
  const area = `${line} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`
  const day = (iso: string, long = false) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), long ? { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' })
  // Daily counts are whole numbers: no "2.5 visitors" gridline.
  const ticks = Number.isInteger(max / 2) ? [0, max / 2, max] : [0, max]
  const xTicks = [0, Math.floor((n - 1) / 2), n - 1]

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - box.left) / box.width) * W
    setActive(Math.min(n - 1, Math.max(0, Math.round(((px - PAD_L) / plotW) * (n - 1)))))
  }
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const step = e.key === 'ArrowRight' ? 1 : -1
      setActive((a) => Math.min(n - 1, Math.max(0, (a ?? (step > 0 ? -1 : n)) + step)))
    } else if (e.key === 'Escape') setActive(null)
  }

  const a = active
  const tipLeft = a === null ? 0 : (x(a) / W) * 100

  return (
    <figure className="flex flex-col gap-3" aria-labelledby={`${id}-title`}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span id={`${id}-title`} className="text-sm font-medium leading-5 text-foreground">
          {title}
        </span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-4 text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <svg aria-hidden="true" width="16" height="4" className="text-primary">
              <line x1="0" y1="2" x2="16" y2="2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {labels.current}
          </span>
          {hasPrevious ? (
            <span className="inline-flex items-center gap-1.5">
              <svg aria-hidden="true" width="16" height="4" className="text-muted-foreground">
                <line x1="0" y1="2" x2="16" y2="2" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" strokeLinecap="round" />
              </svg>
              {labels.previous}
            </span>
          ) : null}
        </span>
      </figcaption>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-44 w-full touch-pan-y overflow-visible focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          preserveAspectRatio="none"
          tabIndex={0}
          role="img"
          aria-label={title}
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
        >
          {ticks.map((t) => (
            <line key={t} x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          {hasPrevious ? (
            <path d={path(previous)} fill="none" className="stroke-muted-foreground" strokeWidth="1.5" strokeDasharray="4 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity="0.7" />
          ) : null}
          <path d={area} className="fill-primary" opacity="0.08" />
          <path d={line} fill="none" className="stroke-primary" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {a !== null ? (
            <line x1={x(a)} x2={x(a)} y1={PAD_T} y2={y(0)} className="stroke-foreground" strokeWidth="1" opacity="0.35" vectorEffect="non-scaling-stroke" />
          ) : null}
        </svg>

        {/* Text and dots live outside the stretched SVG so they keep their shape. */}
        {ticks.map((t) => (
          <span key={t} aria-hidden="true" className="pointer-events-none absolute left-0 -translate-y-[calc(100%+2px)] text-[0.6875rem] leading-none tabular-nums text-muted-foreground" style={{ top: `${(y(t) / H) * 100}%` }}>
            {format.number(t, { notation: t >= 10000 ? 'compact' : 'standard', maximumFractionDigits: t < 10 ? 1 : 0 })}
          </span>
        ))}
        {xTicks.map((i, k) => (
          <span
            key={i}
            aria-hidden="true"
            className={`pointer-events-none absolute bottom-0 text-[0.6875rem] leading-none whitespace-nowrap text-muted-foreground ${k === 0 ? '' : k === 1 ? '-translate-x-1/2' : '-translate-x-full'}`}
            style={{ left: `${(x(i) / W) * 100}%` }}
          >
            {day(current[i].date)}
          </span>
        ))}
        {a !== null ? (
          <>
            {hasPrevious ? (
              <span aria-hidden="true" className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground ring-2 ring-card" style={{ left: `${tipLeft}%`, top: `${(y(previous[a].value) / H) * 100}%` }} />
            ) : null}
            <span aria-hidden="true" className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-card" style={{ left: `${tipLeft}%`, top: `${(y(current[a].value) / H) * 100}%` }} />
            <div
              role="status"
              className={`pointer-events-none absolute top-0 z-10 flex min-w-36 flex-col gap-1 rounded-lg border border-border bg-popover px-3 py-2 text-xs leading-4 text-popover-foreground shadow-md ${tipLeft > 60 ? '-translate-x-[calc(100%+12px)]' : 'translate-x-3'}`}
              style={{ left: `${tipLeft}%` }}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{day(current[a].date, true)}</span>
                <span className="font-medium tabular-nums">{format.number(current[a].value)}</span>
              </span>
              {hasPrevious ? (
                <span className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{day(previous[a].date, true)}</span>
                  <span className="tabular-nums text-muted-foreground">{format.number(previous[a].value)}</span>
                </span>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.date}</th>
            <th scope="col">{labels.current}</th>
            {hasPrevious ? <th scope="col">{labels.previous}</th> : null}
          </tr>
        </thead>
        <tbody>
          {current.map((p, i) => (
            <tr key={p.date}>
              <th scope="row">{day(p.date, true)}</th>
              <td>{p.value}</td>
              {hasPrevious ? <td>{previous[i].value}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

/** A round top for the y-axis: 1, 2, 2.5, 5 × 10ⁿ at or above `v`. */
export function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}
