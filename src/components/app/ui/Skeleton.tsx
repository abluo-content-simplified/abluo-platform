/**
 * A loading placeholder block (a line of text, a title, an image) shown while
 * a screen's data arrives. Give it the size of what it stands for:
 *
 *   <div aria-busy="true" aria-label={t('loading')} className="space-y-3">
 *     <Skeleton className="h-6 w-1/3" />
 *     <Skeleton className="aspect-video w-full" shape="block" />
 *   </div>
 *
 * Decorative (aria-hidden): the container says it is loading. Pulses unless
 * the person prefers reduced motion. `onMuted` for use on a muted surface.
 */
export function Skeleton({ className = '', shape = 'line', onMuted = false }: { className?: string; shape?: 'line' | 'block'; onMuted?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse motion-reduce:animate-none ${shape === 'block' ? 'rounded-xl' : 'rounded'} ${onMuted ? 'bg-background' : 'bg-muted'} ${className}`}
    />
  )
}
