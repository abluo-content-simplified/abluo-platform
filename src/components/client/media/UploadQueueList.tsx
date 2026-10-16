'use client'

/**
 * The rows of an upload queue (ADR-035): local preview, name, progress and
 * the story line, with Try again / Dismiss on a failed row. Shared by Add
 * Photos and the gallery wizard's Add step.
 */
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
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
              <SmallButton onPress={() => uploads.retry(q.id)}>{t('retry')}</SmallButton>
              <SmallButton onPress={() => uploads.dismiss(q.id)}>{t('dismiss')}</SmallButton>
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
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full animate-pulse rounded-full bg-action transition-all" style={{ width: `${queueProgress(q) * 100}%` }} />
          </div>
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

function SmallButton({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="inline-flex min-h-11 items-center rounded-full border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
    </button>
  )
}
