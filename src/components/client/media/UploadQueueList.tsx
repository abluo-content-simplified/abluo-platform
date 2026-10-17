'use client'

/**
 * The rows of an upload queue (ADR-035): local preview, name, progress and
 * the story line, with Try again / Dismiss on a failed row. Shared by Add
 * Photos and the gallery wizard's Add step.
 */
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Chip } from '@/components/app/ui/Chip'
import { ProgressBar } from '@/components/app/ui/ProgressBar'
import { queueProgress, type QueueItem } from '@/lib/client/gallery-upload-queue'
import { useUploadStory, type UseMediaUploads } from '@/components/client/media/use-media-uploads'

export function UploadQueueList({ uploads }: { uploads: UseMediaUploads }) {
  const t = useTranslations('clientDashboard.media.add')
  const story = useUploadStory()
  if (!uploads.queue.length) return null
  return (
    <ul className="mt-4 flex flex-col gap-3" aria-live="polite">
      {uploads.queue.map((q) => (
        <Row key={q.id} q={q} story={story(q)}>
          {q.status === 'error' && (
            <span className="flex shrink-0 gap-1">
              <Chip onClick={() => uploads.retry(q.id)}>{t('retry')}</Chip>
              <Chip onClick={() => uploads.dismiss(q.id)}>{t('dismiss')}</Chip>
            </span>
          )}
        </Row>
      ))}
    </ul>
  )
}

function Row({ q, story, children }: { q: QueueItem; story: string; children?: ReactNode }) {
  const preview = q.preview
  const busy = q.status !== 'done' && q.status !== 'error'
  return (
    <li className="flex items-start gap-3">
      <span className="size-11 shrink-0 overflow-hidden rounded-lg bg-muted" aria-hidden="true">
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL of the picked file
          <img
            src={preview}
            alt=""
            width="44"
            height="44"
            className="size-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{q.name}</p>
        {busy && (
          <ProgressBar className="mt-1" value={queueProgress(q)} pulsing decorative />
        )}
        <p className={`mt-1 text-xs ${q.status === 'error' ? 'text-destructive' : q.status === 'done' ? 'text-success' : 'text-muted-foreground'}`}>
          {q.status === 'done' && <span aria-hidden="true">✓ </span>}
          {story}
        </p>
      </div>
      {children}
    </li>
  )
}
