'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { BottomSheet } from '../ui/BottomSheet'
import { Button } from '../ui/Button'
import { PublicationDateField } from './PublicationDateField'

/**
 * "Set unpublish date" (ADR-032 slice 6) for any list or editor: one date in
 * the site's zone, in the future (the picker refuses earlier moments), Save,
 * and "Remove unpublish date" when the content already has one. The caller
 * performs the change; `busy` keeps the buttons off meanwhile.
 *
 *   <UnpublishDateSheet open={!!row} busy={busy} zone={zone} onClose={close}
 *     onSave={(iso) => act(row, 'setUnpublishDate', iso)} onRemove={row?.unpublishOn ? remove : undefined} />
 */
export function UnpublishDateSheet({
  open,
  busy,
  zone,
  helper,
  onClose,
  onSave,
  onRemove,
}: {
  open: boolean
  busy: boolean
  /** The site's IANA time zone. */
  zone: string
  /** The module's own explanation (default: "On this date it is unpublished by itself…"). */
  helper?: string
  onClose: () => void
  onSave: (iso: string) => void
  /** Offers "Remove unpublish date". */
  onRemove?: () => void
}) {
  const tl = useTranslations('app.lifecycle')
  return (
    <BottomSheet open={open} title={tl('actions.setUnpublishDate')} onClose={onClose}>
      {open ? <SheetBody busy={busy} zone={zone} helper={helper ?? tl('unpublishSheet.helper')} onSave={onSave} onRemove={onRemove} /> : null}
    </BottomSheet>
  )
}

function SheetBody({ busy, zone, helper, onSave, onRemove }: { busy: boolean; zone: string; helper: string; onSave: (iso: string) => void; onRemove?: () => void }) {
  const tl = useTranslations('app.lifecycle')
  const [iso, setIso] = useState<string | null>(null)
  return (
    <>
      <p className="text-[0.9375rem] leading-6 text-muted-foreground">{helper}</p>
      <PublicationDateField id="unpublish-date-sheet" className="mt-4" label={tl('dates.unpublishOn')} value={iso} onChange={setIso} zone={zone} />
      <Button variant="primary" size="lg" fullWidth className="mt-4" disabled={!iso || busy} onClick={() => iso && onSave(iso)}>
        {tl('unpublishSheet.save')}
      </Button>
      {iso || busy ? null : <p className="mt-2 text-sm text-muted-foreground">{tl('unpublishSheet.pickFirst')}</p>}
      {onRemove ? (
        <Button variant="quiet" size="lg" fullWidth className="mt-2" disabled={busy} onClick={onRemove}>
          {tl('actions.removeUnpublishDate')}
        </Button>
      ) : null}
    </>
  )
}
