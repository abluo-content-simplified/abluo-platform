'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { AvailabilityImpact } from '@/lib/modules/catalogue/commerce/impact'
import type { ChannelKey } from '@/lib/modules/catalogue/commerce/commerce-types'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'
import { Notice } from './Notice'

/** The counts ImpactPreview reads — C5-6 `availabilityImpact(...)` (or the same shape from a server preview). */
export type ImpactCounts = Pick<AvailabilityImpact, 'itemsChanged' | 'formatsChanged' | 'shieldedByOverride'> & {
  byChannel?: AvailabilityImpact['byChannel']
}

type Common = {
  /** e.g. "Change Delivery for Pizza?" */
  title: string
  impact: ImpactCounts
  /** When the change is about ONE channel: its name ("Delivery"), for "… change on Delivery". */
  channelLabel?: string
  /** Channel names for the per-channel breakdown (byChannel keys → names). Without it the breakdown is not shown. */
  channelName?: (key: ChannelKey) => string
  /** Extra content under the counts (e.g. a sample of affected items). */
  children?: ReactNode
  confirmLabel: string
  onConfirm: () => void
  busy?: boolean
  error?: string | null
}

export type ImpactPreviewProps = Common &
  (
    | {
        /** dialog (default): a confirmation sheet on ConfirmDialog (focus returns to the opener on close). */
        variant?: 'dialog'
        open: boolean
        onCancel: () => void
        cancelLabel?: string
      }
    | {
        /** panel: the same text inline (a setup step, a pack preview), with the confirm action under it. */
        variant: 'panel'
        onCancel?: () => void
        cancelLabel?: string
      }
  )

/** "12 items and 3 formats change on Delivery; 2 explicit overrides kept." — the sentence ImpactPreview shows. */
export function useImpactSentence(): (impact: ImpactCounts, channelLabel?: string) => string {
  const t = useTranslations('app.ui.impact')
  return (impact, channelLabel) => {
    if (impact.itemsChanged === 0 && impact.formatsChanged === 0) {
      return impact.shieldedByOverride ? t('nothingKept', { kept: impact.shieldedByOverride }) : t('nothing')
    }
    const change = channelLabel
      ? t('changeOn', { items: impact.itemsChanged, formats: impact.formatsChanged, channel: channelLabel })
      : t('change', { items: impact.itemsChanged, formats: impact.formatsChanged })
    return impact.shieldedByOverride ? t('withKept', { change, kept: impact.shieldedByOverride }) : t('sentence', { change })
  }
}

/**
 * The confirmation before a rule or channel change (C5-6 impact preview):
 * how many items and formats change availability, on which channel, and how
 * many explicit item/format settings keep their result. Optional breakdown
 * per channel (become available / stop being available / hours change).
 * A dialog (ConfirmDialog) or an inline panel. Pure UI: counts in.
 */
export function ImpactPreview(props: ImpactPreviewProps) {
  const t = useTranslations('app.ui.impact')
  const sentence = useImpactSentence()
  const { title, impact, channelLabel, channelName, children, confirmLabel, onConfirm, busy, error } = props
  const body = sentence(impact, channelLabel)
  const rows = channelName && impact.byChannel ? Object.entries(impact.byChannel).filter(([, c]) => c.gainAvailability + c.loseAvailability + c.scheduleOnly > 0) : []
  const breakdown = rows.length ? (
    <ul aria-label={t('byChannel')} className="space-y-1.5">
      {rows.map(([key, c]) => (
        <li key={key} className="text-[0.9375rem] leading-6 text-foreground">
          <span className="font-medium">{channelName!(key as ChannelKey)}</span>
          {': '}
          {[
            c.gainAvailability ? t('gain', { count: c.gainAvailability }) : null,
            c.loseAvailability ? t('lose', { count: c.loseAvailability }) : null,
            c.scheduleOnly ? t('hours', { count: c.scheduleOnly }) : null,
          ]
            .filter(Boolean)
            .join(', ')}
        </li>
      ))}
    </ul>
  ) : null
  const extra =
    breakdown || children ? (
      <div className="space-y-3">
        {breakdown}
        {children}
      </div>
    ) : undefined

  if (props.variant === 'panel') {
    return (
      <Notice
        tone="info"
        title={title}
        action={
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="primary" onClick={onConfirm} disabled={busy} aria-busy={busy || undefined}>
              {confirmLabel}
            </Button>
            {props.onCancel ? (
              <Button variant="quiet" onClick={props.onCancel}>
                {props.cancelLabel ?? t('cancel')}
              </Button>
            ) : null}
          </div>
        }
      >
        <p aria-live="polite">{body}</p>
        {extra ? <div className="mt-3">{extra}</div> : null}
        {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
      </Notice>
    )
  }

  return (
    <ConfirmDialog
      open={props.open}
      title={title}
      body={body}
      confirmLabel={confirmLabel}
      cancelLabel={props.cancelLabel}
      busy={busy}
      error={error}
      onConfirm={onConfirm}
      onCancel={props.onCancel}
    >
      {extra}
    </ConfirmDialog>
  )
}
