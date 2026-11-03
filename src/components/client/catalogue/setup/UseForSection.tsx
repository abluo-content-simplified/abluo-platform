'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { UseForField } from '@/components/app/ui/UseForField'
import { useProfileUseFor } from '../use-for-ui'

/**
 * D-22 (C1.12.6) — "Use for" of a top-level category, a tag or an option list, saved explicitly.
 * Narrowing is previewed first: when items would stop fitting, a confirmation names how many (drafts
 * included) and says nothing is removed. Items are never changed. Used by the category and tag sheets.
 */
export function UseForSection({
  name,
  stored,
  hint,
  disabledReason,
  preview,
  save,
}: {
  name: string
  stored: readonly string[]
  hint?: string
  disabledReason?: string
  /** Items that would no longer fit with `useFor`, or null when the preview failed (the caller says why). */
  preview: (useFor: string[]) => Promise<number | null>
  /** True when saved. */
  save: (useFor: string[]) => Promise<boolean>
}) {
  const t = useTranslations('catalogue.useFor')
  const useFor = useProfileUseFor()
  const [draft, setDraft] = useState<string[]>([...stored])
  const [confirm, setConfirm] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const changed = draft.join() !== [...stored].join()

  async function commit() {
    setBusy(true)
    const ok = await save(draft)
    setBusy(false)
    setConfirm(null)
    if (!ok) setDraft([...stored])
  }

  async function review() {
    setBusy(true)
    const count = await preview(draft)
    setBusy(false)
    if (count === null) return
    if (count > 0) setConfirm(count)
    else await commit()
  }

  return (
    <section className="space-y-3">
      <UseForField legend={t('legend')} hint={hint ?? t('hint')} allLabel={useFor.allLabel} options={useFor.options} value={draft} onChange={setDraft} disabledReason={disabledReason} />
      {!disabledReason ? (
        <div className="flex flex-wrap items-start gap-2">
          <Button variant="primary" disabled={!changed || busy} aria-busy={busy || undefined} onClick={() => void review()}>
            {t('save')}
          </Button>
          {!changed ? <p className="py-2.5 text-sm text-muted-foreground">{t('unchanged')}</p> : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        title={t('narrowTitle', { name, profiles: useFor.text(draft) })}
        body={t('narrowBody', { count: confirm ?? 0 })}
        confirmLabel={t('save')}
        busy={busy}
        onConfirm={() => void commit()}
        onCancel={() => setConfirm(null)}
      />
    </section>
  )
}
