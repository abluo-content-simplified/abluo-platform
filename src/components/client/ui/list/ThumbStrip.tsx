import { MediaFrame } from './cells'

/**
 * A small mosaic that shows what is inside a collection (a gallery, an album,
 * a product's photos …): the lead image large on the left, up to four small
 * tiles on the right in a 2 × 2 block, and "+N" on the last tile when there
 * are more. Missing tiles are muted placeholders of the same size, so every
 * strip in a list lines up. One photo fills the whole frame; none shows the
 * shared image placeholder.
 *
 * The frame is sized by the caller — `size` for a fixed box in normal flow
 * (tables, phone cards), or `className` such as `absolute inset-0 size-full`
 * inside a sized box (the 16:10 media area of a ContentCard):
 *
 *   <ThumbStrip srcs={thumbs} total={count} size={{ width: '9rem', height: '4.5rem' }} className="rounded-lg" />
 *   <ContentCard mediaContent={<ThumbStrip srcs={thumbs} total={count} className="absolute inset-0 size-full" />} … />
 *
 * Decorative (`aria-hidden`): the card or row says what it is and how many
 * photos it holds in text.
 */
export function ThumbStrip({
  srcs,
  total,
  size,
  className = '',
  gap = 'gap-0.5',
}: {
  /** Image URLs, the lead first (already cropped to small squares; at most five are used). */
  srcs: readonly (string | null | undefined)[]
  /** How many images the collection holds (for "+N"); defaults to `srcs.length`. */
  total?: number
  /** Fixed frame, e.g. { width: '9rem', height: '4.5rem' }. */
  size?: { width: string; height: string }
  className?: string
  /** Gap between tiles (Tailwind class). */
  gap?: string
}) {
  const box = size ? { width: size.width, height: size.height, minWidth: size.width, minHeight: size.height } : undefined
  const list = srcs.filter((s): s is string => Boolean(s)).slice(0, 5)
  const count = Math.max(total ?? list.length, list.length)

  if (list.length <= 1) {
    return (
      <span aria-hidden="true" style={box} className={`relative block shrink-0 overflow-hidden ${className}`}>
        <MediaFrame src={list[0]} className="absolute inset-0 size-full" />
      </span>
    )
  }

  const small = list.slice(1, 5)
  const more = count - 1 - small.length
  return (
    <span aria-hidden="true" style={box} className={`grid shrink-0 grid-cols-4 grid-rows-2 overflow-hidden bg-background ${gap} ${className}`}>
      <span className="relative col-span-2 row-span-2 overflow-hidden">
        <MediaFrame src={list[0]} className="absolute inset-0 size-full" />
      </span>
      {[0, 1, 2, 3].map((n) => (
        <span key={n} className="relative overflow-hidden bg-muted">
          {small[n] ? <MediaFrame src={small[n]} className="absolute inset-0 size-full" /> : null}
          {n === 3 && more > 0 ? (
            <span className="absolute inset-0 grid place-items-center bg-foreground/65 text-xs font-semibold text-background tabular-nums">+{more}</span>
          ) : null}
        </span>
      ))}
    </span>
  )
}
