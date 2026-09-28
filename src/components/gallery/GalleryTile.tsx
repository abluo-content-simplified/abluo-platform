'use client'

import type { CSSProperties } from 'react'
import type { GalleryViewItem } from '@/lib/gallery/view'
import { IMAGE_HOVER_CLASSES } from '@/lib/image-presentation'

// One photo inside a box whose shape the LAYOUT decides. The photo fills the
// box (object-cover) around its focal point. When the tile opens the lightbox
// it is a real <button> with an accessible name; otherwise a plain figure.

interface TileProps {
  item: GalleryViewItem
  /** Accessible name when the tile opens the lightbox; undefined = not clickable. */
  openLabel?: string
  onOpen?: () => void
  /** Classes for the shaped box (aspect ratio / grow). */
  boxClassName?: string
  boxStyle?: CSSProperties
  sizes: string
  showCaption: boolean
  videoLabel: string
}

export function GalleryTile({ item, openLabel, onOpen, boxClassName = '', boxStyle, sizes, showCaption, videoLabel }: TileProps) {
  const caption = showCaption ? item.caption ?? item.title : undefined
  const clickable = !!onOpen && !item.isVideo && !!item.src

  const media = item.isVideo || !item.src ? (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ backgroundColor: 'var(--color-surface, var(--color-background))' }}
    >
      {item.isVideo && (
        <>
          <svg className="h-8 w-8" style={{ color: 'var(--color-text-primary)', opacity: 0.45 }} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
          <span className="sr-only">{item.title ?? videoLabel}</span>
        </>
      )}
    </div>
  ) : (
    <img
      src={item.src}
      srcSet={item.srcSet}
      sizes={sizes}
      alt={item.alt}
      width={item.width}
      height={item.height}
      loading="lazy"
      decoding="async"
      className={`absolute inset-0 h-full w-full object-cover ${IMAGE_HOVER_CLASSES}`}
      style={{ objectPosition: item.objectPosition }}
    />
  )

  const box = (
    <div
      className={`group relative w-full overflow-hidden rounded-[var(--radius-sm)] ${boxClassName}`}
      style={{
        // Tiny blurred preview while the photo loads (ADR-022 §7).
        backgroundImage: item.lqip ? `url(${item.lqip})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: item.objectPosition,
        backgroundColor: 'var(--color-surface, var(--color-background))',
        ...boxStyle,
      }}
    >
      {clickable ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={openLabel}
          className="absolute inset-0 block h-full w-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ outlineColor: 'var(--color-primary)' }}
        >
          {media}
        </button>
      ) : (
        media
      )}
    </div>
  )

  return (
    <figure className="flex h-full min-h-0 flex-col">
      {box}
      {caption && (
        <figcaption className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          {caption}
        </figcaption>
      )}
    </figure>
  )
}
