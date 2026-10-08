/**
 * A tiny trend line (ADR-029 §4): one series, no axes, inline SVG — no chart
 * library. Draws in the app's primary colour (`text-primary`, so it follows
 * light/dark), a 2px line over a faint area, and a dot on the latest value.
 * Hovering a day shows its label (native tooltip, from `labels`).
 *
 * It is decoration for a number that is already written out next to it
 * (StatTile `trend` slot), so its accessible name is a short summary passed
 * in by the caller — never the only place a value is said.
 *
 *   <Sparkline values={[3, 5, 4, 8]} labels={['1 Oct: 3', …]} label="Daily visitors, last 28 days" />
 */
export function Sparkline({
  values,
  labels,
  label,
  className = 'h-10 w-full',
}: {
  values: readonly number[]
  /** Per-point tooltip text ("7 Oct · 55"), same length as `values`. */
  labels?: readonly string[]
  /** Accessible summary. */
  label: string
  className?: string
}) {
  if (values.length < 2) return null
  const W = 100
  const H = 32
  const PAD = 3 // keeps the 2px line and the end dot inside the box
  const max = Math.max(...values)
  const min = Math.min(0, ...values)
  const span = max - min || 1
  const x = (i: number) => (i / (values.length - 1)) * W
  const y = (v: number) => PAD + (1 - (v - min) / span) * (H - PAD * 2)
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`
  const last = values.length - 1
  const step = W / (values.length - 1)

  return (
    <span className={`relative block text-primary ${className}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className="absolute inset-0 size-full overflow-visible">
        <path d={area} className="fill-current opacity-10" />
        <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {labels
          ? values.map((_, i) => (
              <rect key={i} x={Math.max(0, x(i) - step / 2)} y={0} width={step} height={H} fill="transparent">
                <title>{labels[i]}</title>
              </rect>
            ))
          : null}
      </svg>
      {/* The end dot sits outside the stretched SVG so it stays round. */}
      <span
        aria-hidden="true"
        className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-card"
        style={{ left: '100%', top: `${(y(values[last]) / H) * 100}%` }}
      />
    </span>
  )
}
