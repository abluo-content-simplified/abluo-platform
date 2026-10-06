'use client'

import type { MouseEvent, ReactNode } from 'react'
import { Link } from '@/i18n/navigation'
import { Checkbox, isShiftChange } from '@/components/client/ui/Checkbox'
import { MediaFrame } from './cells'

/**
 * Generic desktop content card (posts, galleries, events …) for CardGrid.
 *
 *   <ContentCard
 *     media={{ src: cover, focal }} title={title} href={href}
 *     onOpen={(newTab) => open(newTab)}
 *     selection={{ checked, onChange: (checked, shift) => …, label: 'Select …' }}
 *     overlay={<><FeaturedStar variant="chip" … /><CardMenu variant="chip" … /></>}
 *   >
 *     <Chips … /> <StatusPill … /> …
 *   </ContentCard>
 *
 * Every card is the same height in its grid row (`h-full flex flex-col`, the
 * body grows). The media area is a fixed 16:10 box: the image (object-cover
 * around the focal point) or a placeholder filling the same box, with a soft
 * top scrim when there is an image. Overlay controls are 2rem round chips:
 * the checkbox inset top-left, the `overlay` slot (star, ⋯ …) inset
 * top-right. The body is top-aligned, one thing per line: the title (max 2
 * lines), the subtitle (muted, max 2 lines), then `children` (categories,
 * status, languages, dates) with fixed spacing.
 */
export function ContentCard({
  media,
  title,
  subtitle,
  href,
  onOpen,
  selection,
  overlay,
  children,
}: {
  media: { src?: string | null; alt?: string; focal?: { x: number; y: number } | null }
  title: ReactNode
  /** Muted line(s) under the title (max 2). */
  subtitle?: ReactNode
  href?: string | null
  /** A click on the card body (outside its own links and controls). */
  onOpen?: (newTab: boolean) => void
  selection?: { checked: boolean; onChange: (checked: boolean, shift: boolean) => void; label: string }
  /** Top-right overlay chips. */
  overlay?: ReactNode
  /** Body slots under the title. */
  children?: ReactNode
}) {
  const clickable = Boolean(href || onOpen)
  const onClick = (e: MouseEvent<HTMLElement>) => {
    if (!onOpen) return
    if ((e.target as HTMLElement).closest('a,button,input,label,select,[role="dialog"]')) return
    onOpen(e.metaKey || e.ctrlKey)
  }
  const titleCls = 'line-clamp-2 text-[0.9375rem] leading-6 font-semibold text-foreground'
  return (
    <article
      onClick={onClick}
      className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground transition-shadow duration-200 ease-out ${
        clickable ? 'cursor-pointer hover:shadow-[var(--shadow-raise)]' : ''
      } ${selection?.checked ? 'border-action ring-1 ring-action' : 'border-border'}`}
    >
      <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden">
        <MediaFrame src={media.src} alt={media.alt} focal={media.focal} className="absolute inset-0 size-full" />
        {/* A soft top scrim so the overlay chips read on any photo. */}
        {media.src ? <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-linear-to-b from-scrim to-transparent" /> : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-stretch gap-2 p-4">
        {href ? (
          <Link href={href} className={`${titleCls} hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`}>
            {title}
          </Link>
        ) : (
          <span className={titleCls}>{title}</span>
        )}
        {subtitle ? <p className="-mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">{subtitle}</p> : null}
        {children}
      </div>
      {selection ? (
        <div className="absolute top-2 left-2">
          <Checkbox
            variant="chip"
            checked={selection.checked}
            aria-label={selection.label}
            onChange={(checked, e) => selection.onChange(checked, isShiftChange(e))}
          />
        </div>
      ) : null}
      {overlay ? <div className="absolute top-2 right-2 flex items-center gap-1.5">{overlay}</div> : null}
    </article>
  )
}

/** The cards grid: 2 / 3 / 4 columns, stretched rows so every card in a row is the same height. */
export function CardGrid({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="grid grid-cols-2 items-stretch gap-4 lg:grid-cols-3 xl:grid-cols-4">
      {children}
    </ul>
  )
}

/** One grid cell: fills the row height. */
export function CardGridItem({ children }: { children: ReactNode }) {
  return <li className="h-full">{children}</li>
}

/** "Select all" above the grid: the small 1.25rem checkbox and its label, inline with the count. */
export function SelectAll({
  label,
  ariaLabel,
  state,
  onChange,
}: {
  label: string
  ariaLabel?: string
  state: 'none' | 'some' | 'all'
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="inline-flex items-center text-sm leading-5 text-foreground">
      <Checkbox
        checked={state === 'all'}
        indeterminate={state === 'some'}
        aria-label={ariaLabel ?? label}
        onChange={(checked) => onChange(checked)}
        className="-my-3 -ml-3"
      />
      <span aria-hidden={ariaLabel ? true : undefined}>{label}</span>
    </label>
  )
}
