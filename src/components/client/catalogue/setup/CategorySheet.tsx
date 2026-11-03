'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AvailabilitySwitch } from '@/components/app/ui/AvailabilitySwitch'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { ImpactPreview } from '@/components/app/ui/ImpactPreview'
import { Panel } from '@/components/app/ui/Panel'
import { fullPath } from '@/components/app/ui/TreeEditor'
import { asChannelKey, type ChannelAvailabilityRule } from '@/lib/modules/catalogue/commerce/commerce-types'
import type { RuleChangePreview } from '@/lib/modules/catalogue/taxonomy/service'
import { archiveCatalogueCategoryAction, previewCatalogueCategoryRuleAction, setCatalogueCategoryRuleAction } from '@/app/[locale]/(client)/[tenant]/catalogue/setup/taxonomy-actions'
import { inheritedCategoryRule, labelText, previewImpact, sameRule } from './setup-model'
import type { TaxonomyScreen } from './taxonomy-context'

type Pending = { channel: string; rule: ChannelAvailabilityRule | null; preview: RuleChangePreview }

/**
 * One category's details: its name (Rename opens the name sheet), its availability per active
 * channel (AvailabilitySwitch, category level — Inherit = the parent's rule or the channel
 * default), archive / restore and delete. Rule changes are previewed with their impact and need
 * a confirmation (C5-6, `category.rule_changed`); they and archiving need `setup.manage` and are
 * shown disabled with the reason otherwise.
 */
export function CategorySheet({
  screen,
  categoryKey,
  onClose,
  onRename,
  onDelete,
}: {
  screen: TaxonomyScreen
  categoryKey: string | null
  onClose: () => void
  onRename: (key: string) => void
  onDelete: (key: string) => void
}) {
  const t = useTranslations('catalogue.setup.categorySheet')
  const { view, tree } = screen
  const node = categoryKey ? tree.nodes.get(categoryKey) : undefined
  const [drafts, setDrafts] = useState<Record<string, ChannelAvailabilityRule | null>>({})
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const archiveReasonId = useId()
  // A different category starts with no unsaved rule changes.
  const [shownKey, setShownKey] = useState(categoryKey)
  if (shownKey !== categoryKey) {
    setShownKey(categoryKey)
    setDrafts({})
    setPending(null)
  }

  if (!categoryKey || !node) return <BottomSheet open={false} title="" onClose={onClose}>{null}</BottomSheet>
  const key = categoryKey
  const name = screen.categoryName(key)
  const manage = view.can.manage
  const channelName = (k: string) => labelText(screen.channels.find((c) => c.key === k)?.label, view.defaultLocale, view.defaultLocale)

  async function review(channel: string) {
    const rule = drafts[channel] ?? null
    setBusy(channel)
    const r = await previewCatalogueCategoryRuleAction({ projectSlug: screen.projectSlug, key, channel, rule })
    setBusy(null)
    if (!r.ok) return void screen.show(screen.failText(r), 'error')
    setPending({ channel, rule, preview: r.preview })
  }

  async function confirm() {
    if (!pending) return
    setBusy(pending.channel)
    const r = await setCatalogueCategoryRuleAction({ projectSlug: screen.projectSlug, key, channel: pending.channel, rule: pending.rule, rev: view.rev, baseHashes: screen.baseHashes() })
    setBusy(null)
    const channel = pending.channel
    setPending(null)
    const ok = await screen.settle(r, t('ruleSaved', { name, channel: channelName(channel) }))
    if (ok) setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== channel)))
  }

  async function archive(archived: boolean) {
    setBusy('archive')
    const r = await archiveCatalogueCategoryAction({ projectSlug: screen.projectSlug, key, archived })
    setBusy(null)
    await screen.settle(r, archived ? t('archivedDone', { name }) : t('restoredDone', { name }))
  }

  return (
    <BottomSheet open title={name} onClose={onClose} size="lg">
      <div className="space-y-5">
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('path', { path: fullPath(tree, key, screen.categoryName) })}</p>
        {view.can.write ? (
          <div>
            <Button variant="secondary" onClick={() => onRename(key)}>
              {t('rename')}
            </Button>
          </div>
        ) : null}

        <section className="space-y-3" aria-labelledby="category-sheet-availability">
          <h3 id="category-sheet-availability" className="text-[1.0625rem] font-semibold">
            {t('availability')}
          </h3>
          {screen.channels.length === 0 ? (
            <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('noChannels')}</p>
          ) : (
            <>
              <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('availabilityHint')}</p>
              {screen.channels.map((c) => {
                const stored = node.channelRules?.[asChannelKey(c.key)] ?? null
                const draft = c.key in drafts ? drafts[c.key] : stored
                const inherited = inheritedCategoryRule(tree, key, c)
                const changed = !sameRule(draft, stored)
                return (
                  <div key={c.key} className="space-y-2">
                    <AvailabilitySwitch
                      channelLabel={channelName(c.key)}
                      level="category"
                      rule={draft}
                      inherited={inherited}
                      inheritedPath={inherited.source.level === 'category' ? fullPath(tree, inherited.source.categoryKey, screen.categoryName) : undefined}
                      onChange={(next) => setDrafts((d) => ({ ...d, [c.key]: next }))}
                      disabledReason={manage ? undefined : t('needsSetup')}
                    />
                    {changed ? (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="primary" disabled={busy !== null} onClick={() => void review(c.key)}>
                          {t('review', { channel: channelName(c.key) })}
                        </Button>
                        <Button variant="quiet" onClick={() => setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== c.key)))}>
                          {t('undo')}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </>
          )}
        </section>

        <Panel tone="muted">
          <h3 className="text-[0.9375rem] font-semibold">{node.archivedAt ? t('restoreTitle') : t('archiveTitle')}</h3>
          <p className="mt-1 text-[0.9375rem] leading-6 text-muted-foreground">{node.archivedAt ? t('restoreBody') : t('archiveBody')}</p>
          {/* Disabled Archive / Restore says why (Tom's rule): the reason sits above the button and describes it. */}
          {!manage ? (
            <p id={archiveReasonId} className="mt-2 text-sm text-muted-foreground">
              {node.archivedAt ? t('restoreNeedsSetup') : t('archiveNeedsSetup')}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-start gap-2">
            <Button variant="secondary" disabled={!manage || busy !== null} aria-describedby={manage ? undefined : archiveReasonId} title={manage ? undefined : node.archivedAt ? t('restoreNeedsSetup') : t('archiveNeedsSetup')} onClick={() => void archive(!node.archivedAt)}>
              {node.archivedAt ? t('restore') : t('archive')}
            </Button>
            {view.can.write || manage ? (
              <Button variant="destructive" onClick={() => onDelete(key)}>
                {t('delete')}
              </Button>
            ) : null}
          </div>
        </Panel>
      </div>
      {pending ? (
        <ImpactPreview
          open
          title={t('confirmTitle', { channel: channelName(pending.channel), name })}
          impact={previewImpact(pending.preview.impact)}
          channelLabel={channelName(pending.channel)}
          confirmLabel={t('confirm')}
          busy={busy !== null}
          onConfirm={() => void confirm()}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </BottomSheet>
  )
}
