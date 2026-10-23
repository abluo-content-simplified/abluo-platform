'use client'

import { useState, type ReactNode } from 'react'
import { Button } from './Button'
import { ImageViewer, type ImageViewerLabels } from './ImageViewer'

/**
 * A small grid of screenshot thumbnails (support tickets: the side panel of the
 * admin ticket). Thumbnails sit at the top of their cell and show the top of
 * the picture. A click opens the shared ImageViewer at that picture; the
 * per-image `actions` (Delete) appear in the viewer's top bar. Pictures that
 * are gone (no `url`) stay as small dashed placeholders that say why, worded
 * by `labels.deleted(reason)`.
 *
 * No text of its own: everything arrives through `labels`. The component never
 * deletes anything — it only hosts the slot; confirm in a ConfirmDialog.
 */
export type ScreenshotGridItem = {
  id: string
  /** Short-lived link, or null once the picture is gone. */
  url: string | null
  /** Why it is gone ('redacted', 'retention', …), null while it is there. */
  deleted: string | null
}

export type ScreenshotGridLabels = {
  /** "Open screenshot 2" (n counts every picture, gone ones included). */
  open: (n: number) => string
  /** Placeholder text for a picture that is gone. */
  deleted: (reason: string | null) => string
  viewer: ImageViewerLabels
}

export function ScreenshotGrid({
  images,
  labels,
  actions,
  className = '',
}: {
  images: ScreenshotGridItem[]
  labels: ScreenshotGridLabels
  /** Per-image controls in the viewer's top bar (Delete). */
  actions?: (image: ScreenshotGridItem, n: number) => ReactNode
  className?: string
}) {
  const [at, setAt] = useState<number | null>(null)
  const numbered = images.map((a, i) => ({ ...a, n: i + 1 }))
  const live = numbered.filter((a) => a.url)

  return (
    <>
      <ul className={`grid grid-cols-3 items-start gap-2 ${className}`}>
        {numbered.map((a) => (
          <li key={a.id} className="min-w-0">
            {a.url ? (
              <Button
                variant="quiet"
                onClick={() => setAt(live.findIndex((x) => x.id === a.id))}
                aria-label={labels.open(a.n)}
                className="aspect-square !h-auto w-full !min-h-0 overflow-hidden !rounded-xl border border-border bg-muted !p-0"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed link */}
                <img src={a.url} alt="" loading="lazy" className="size-full object-cover object-top" />
              </Button>
            ) : (
              <span className="flex aspect-square w-full items-start rounded-xl border border-dashed border-border p-2 text-xs leading-4 text-muted-foreground">{labels.deleted(a.deleted)}</span>
            )}
          </li>
        ))}
      </ul>
      <ImageViewer
        open={at !== null && live.length > 0}
        images={live.map((a) => ({ key: a.id, src: a.url as string, alt: labels.open(a.n), actions: actions ? actions(a, a.n) : undefined }))}
        index={at ?? 0}
        onIndexChange={setAt}
        onClose={() => setAt(null)}
        labels={labels.viewer}
      />
    </>
  )
}
