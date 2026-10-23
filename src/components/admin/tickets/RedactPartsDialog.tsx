'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { Notice } from '@/components/app/ui/Notice'
import { TextMarker } from '@/components/app/ui/TextMarker'
import { maskRanges, type RedactionRange } from '@/lib/support-tickets/redaction'
import { addRange } from '@/lib/support-tickets/redaction-select'

/**
 * Hide parts of one message for good (ADR-039 round 3). The admin marks parts
 * (mouse selection + "Hide selection", or tapping words), sees a live preview of
 * the result, and confirms in a second step that spells out it cannot be undone.
 * "Remove the whole message" hands over to the parent's existing confirmation.
 */
export function RedactPartsDialog({
  body,
  busy,
  error,
  onClose,
  onConfirm,
  onRemoveWhole,
}: {
  /** The message text; null = closed. */
  body: string | null
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: (ranges: RedactionRange[]) => void
  onRemoveWhole: () => void
}) {
  const t = useTranslations('admin.supportTickets.redactParts')
  const [ranges, setRanges] = useState<RedactionRange[]>([])
  const [selection, setSelection] = useState<RedactionRange | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    setRanges([])
    setSelection(null)
    setConfirming(false)
  }, [body])

  const text = body ?? ''
  const preview = maskRanges(text, ranges)
  const count = preview.removed

  return (
    <BottomSheet open={body !== null} title={t('title')} onClose={onClose} size="lg">
      {confirming ? (
        <div className="flex flex-col gap-4">
          <Notice tone="error" title={t('confirmTitle', { count })}>
            {t('confirmBody')}
          </Notice>
          <p className="rounded-xl bg-muted p-3 text-[0.9375rem] leading-6 break-words whitespace-pre-wrap">{preview.body}</p>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button variant="primary" size="lg" fullWidth disabled={busy} aria-busy={busy || undefined} onClick={() => onConfirm(ranges)}>
              {t('confirmAction')}
            </Button>
            <Button variant="secondary" size="lg" fullWidth disabled={busy} onClick={() => setConfirming(false)}>
              {t('back')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-5 text-muted-foreground">{t('hint')}</p>
          <div className="max-h-[40dvh] overflow-y-auto rounded-xl border border-border p-3">
            <TextMarker text={text} value={ranges} onChange={setRanges} onSelect={setSelection} label={t('textLabel')} />
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <Button variant="secondary" disabled={!selection} onClick={() => selection && setRanges(addRange(ranges, selection, text.length))}>
              {t('hideSelection')}
            </Button>
            <Button variant="quiet" disabled={ranges.length === 0} onClick={() => setRanges([])}>
              {t('clear')}
            </Button>
          </div>
          <div>
            <h3 className="text-sm font-semibold">{t('preview')}</h3>
            <p className="mt-1 text-[0.9375rem] leading-6 break-words whitespace-pre-wrap text-muted-foreground">{count ? preview.body : t('previewEmpty')}</p>
          </div>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="flex flex-col gap-2">
            <Button variant="primary" size="lg" fullWidth disabled={count === 0} onClick={() => setConfirming(true)}>
              {t('confirm', { count })}
            </Button>
            {count === 0 ? <p className="text-sm leading-5 text-muted-foreground">{t('nothingMarked')}</p> : null}
            <Button variant="destructive" size="lg" fullWidth onClick={onRemoveWhole}>
              {t('whole')}
            </Button>
          </div>
        </div>
      )}
    </BottomSheet>
  )
}
