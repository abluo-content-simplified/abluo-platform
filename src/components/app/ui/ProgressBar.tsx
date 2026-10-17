/**
 * A thin progress bar (an upload, a long task). `value` 0–1. `pulsing` while
 * the work is running and the number is only an estimate. Give it a label so
 * screen readers hear the progress, or set `decorative` when the same
 * progress is already written next to it.
 */
export function ProgressBar({ value, label, pulsing = false, decorative = false, className = '' }: { value: number; label?: string; pulsing?: boolean; decorative?: boolean; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div
      className={`h-1 overflow-hidden rounded-full bg-muted ${className}`}
      {...(decorative ? { 'aria-hidden': true } : { role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct })}
    >
      <div className={`h-full rounded-full bg-action transition-all motion-reduce:transition-none ${pulsing ? 'animate-pulse motion-reduce:animate-none' : ''}`} style={{ width: `${pct}%` }} />
    </div>
  )
}
