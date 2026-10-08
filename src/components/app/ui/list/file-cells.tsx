'use client'

import { useLocale } from 'next-intl'
import { formatBytes } from '@/lib/client/format-bytes'

/**
 * File facts for DataTable cells (media library, documents, attachments …),
 * following the cells.tsx alignment contract: the first line is a 1.5rem
 * line box.
 *
 *   <CellFileInfo width={1920} height={1080} bytes={240_000} />
 *   → "1920 × 1080 px"
 *     "240 KB"            (muted, second line)
 *
 * Either part may be missing; with neither, `empty` ("—") sits on the line.
 * Sizes use decimal units in the viewer's number format (formatBytes).
 */
export function CellFileInfo({
  width,
  height,
  bytes,
  empty = '—',
}: {
  width?: number | null
  height?: number | null
  bytes?: number | null
  empty?: string
}) {
  const locale = useLocale()
  const dims = width && height ? `${width} × ${height} px` : ''
  const size = formatBytes(bytes, locale)
  if (!dims && !size) return <span className="flex min-h-6 items-center text-sm text-muted-foreground">{empty}</span>
  const [first, second] = dims ? [dims, size] : [size, '']
  return (
    <span className="flex flex-col items-start whitespace-nowrap">
      <span className="flex min-h-6 items-center text-sm leading-6 text-foreground tabular-nums">{first}</span>
      {second ? <span className="text-sm leading-5 text-muted-foreground tabular-nums">{second}</span> : null}
    </span>
  )
}
