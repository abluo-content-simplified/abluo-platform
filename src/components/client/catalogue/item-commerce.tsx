'use client'

// ── Item editor: prices, availability and categories (Catalogue V2 R2) ───────
//
// Built only from shared Lab components: FormatPriceRows (C3/C4), AvailabilitySwitch
// (C5/C5a) and CategoryPicker (C1). This file only wires the item's model to them:
// which channels exist, what each level inherits and from where (C5 `effectiveRule`,
// the instant-free core of `explainAvailability`), and inline category creation
// through the ONE Catalogue taxonomy service (`createCatalogueTermInlineAction`, D-3).

import { useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AvailabilitySwitch } from '@/components/app/ui/AvailabilitySwitch'
import { CategoryPicker, type CategoryCreateResult } from '@/components/app/ui/CategoryPicker'
import { FormatPriceRows } from '@/components/app/ui/FormatPriceRows'
import { FieldLabel } from '@/components/app/ui/FieldLabel'
import { Notice } from '@/components/app/ui/Notice'
import { Button } from '@/components/app/ui/Button'
import { TextInput } from '@/components/app/ui/TextInput'
import { languageName } from '@/components/client/create/StepHeading'
import { createCatalogueTermInlineAction } from '@/app/[locale]/(client)/[tenant]/catalogue/setup/taxonomy-actions'
import { CATEGORY_RULES, availabilityInputsOf, effectiveRule } from '@/lib/modules/catalogue/commerce/channel-availability'
import type { ChannelSet } from '@/lib/modules/catalogue/commerce/channels'
import { asChannelKey, type ChannelAvailabilityRule, type ChannelKey, type FormatKey, type LocalizedText } from '@/lib/modules/catalogue/commerce/commerce-types'
import type { Format } from '@/lib/modules/catalogue/commerce/formats'
import type { FormatFormIssue, ItemRules } from '@/lib/modules/catalogue/dashboard-form'
import { buildTree, pathOf } from '@/lib/modules/catalogue/taxonomy/tree'
import type { CategoryAssignment, CategoryKey, CategoryNode, CategoryTree, PathContext } from '@/lib/modules/catalogue/taxonomy/types'
import { textIn } from './catalogue-ui'
import { useProfileUseFor } from './use-for-ui'
import { isCategoryCompatible } from '@/lib/modules/catalogue/taxonomy/profile-applicability'
import type { ItemProfile } from '@/lib/modules/catalogue/profiles'

const labelText = (label: LocalizedText | null, ui: string, d: string): string => (label == null ? '' : typeof label === 'string' ? label : textIn(label as Record<string, string>, ui, d))

/** The active channels as FormatPriceRows / AvailabilitySwitch read them, names in the viewer's language. */
export function useChannelChoices(channels: ChannelSet, defaultLocale: string) {
  const ui = useLocale()
  return useMemo(() => channels.active.map((c) => ({ key: c.key, label: labelText(c.label, ui, defaultLocale) || c.key })), [channels, ui, defaultLocale])
}

/** A format's name field: one input per site language (the main one first). */
function FormatLabelInput({ id, value, invalid, locales, defaultLocale, onChange }: { id: string; value: LocalizedText | null; invalid: boolean; locales: readonly string[]; defaultLocale: string; onChange: (next: Record<string, string>) => void }) {
  const ui = useLocale()
  const map = value && typeof value === 'object' ? (value as Record<string, string>) : {}
  const set = (l: string, v: string) => onChange({ ...map, [l]: v })
  return (
    <div className="mt-1.5 space-y-2">
      {locales.map((l, i) => (
        <TextInput
          key={l}
          id={i === 0 ? id : `${id}-${l}`}
          autoComplete="off"
          value={map[l] ?? ''}
          aria-invalid={(l === defaultLocale && invalid) || undefined}
          aria-label={locales.length > 1 ? languageName(l, ui) : undefined}
          placeholder={locales.length > 1 ? languageName(l, ui) : undefined}
          onChange={(e) => set(l, e.target.value)}
        />
      ))}
    </div>
  )
}

const ITEM_PROBE = '__item' as FormatKey

/**
 * Prices and availability of one item. Simple case: one price field; "Add another size or
 * format" for more (C3). With channels: one AvailabilitySwitch per active channel at item
 * level (effective value, its source, "Use category default", hours — C5/C5a), and, for an
 * item with several formats, the same per format (format overrides, C5 level 4).
 */
export function CommerceField({
  formats,
  itemRules,
  channels,
  tree,
  primaryCategory,
  currency,
  locales,
  defaultLocale,
  issues,
  onFormats,
  onItemRules,
  hiddenByAmazon = false,
  disabled,
}: {
  formats: readonly Format[]
  itemRules: ItemRules
  channels: ChannelSet
  tree: CategoryTree
  primaryCategory: CategoryKey | null
  currency: string
  locales: readonly string[]
  defaultLocale: string
  issues: readonly FormatFormIssue[]
  onFormats: (next: Format[]) => void
  onItemRules: (next: ItemRules) => void
  hiddenByAmazon?: boolean
  disabled?: boolean
}) {
  const t = useTranslations('catalogue.dashboard.item.availability')
  const ta = useTranslations('catalogue.dashboard.item.fields.amazon')
  const ui = useLocale()
  const choices = useChannelChoices(channels, defaultLocale)
  const pathCtx: PathContext = { locale: ui, defaultLocale, locales }
  const inputs = useMemo(() => availabilityInputsOf(channels, { tree, category: CATEGORY_RULES }), [channels, tree])
  const ruleMap = useMemo(() => new Map(Object.entries(itemRules).map(([k, r]) => [asChannelKey(k), r])), [itemRules])
  const [formatRulesOpen, setFormatRulesOpen] = useState(() => formats.some((f) => f.availability.size > 0))

  const inheritedFor = (e: ReturnType<typeof effectiveRule>, explicit: boolean) => (explicit ? e.inherited : { rule: e.rule, source: e.source })
  const pathText = (src: ReturnType<typeof effectiveRule>['source'] | undefined) => (src?.level === 'category' ? pathOf(tree, src.categoryKey, pathCtx).text : undefined)

  const setItemRule = (channel: ChannelKey, rule: ChannelAvailabilityRule | null) => {
    const next: Record<string, ChannelAvailabilityRule> = { ...itemRules }
    if (rule) next[channel] = rule
    else delete next[channel]
    onItemRules(next)
  }
  const setFormatRule = (f: Format, channel: ChannelKey, rule: ChannelAvailabilityRule | null) => {
    const availability = new Map(f.availability)
    if (rule) availability.set(channel, rule)
    else availability.delete(channel)
    onFormats(formats.map((x) => (x.key === f.key ? { ...x, availability } : x)))
  }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        {hiddenByAmazon ? <Notice tone="info">{ta('priceHint')}</Notice> : null}
        <FormatPriceRows
          formats={formats}
          onChange={onFormats}
          currency={currency}
          channels={choices}
          issues={issues.filter((i) => i.formatKey !== undefined || i.code.startsWith('format.'))}
          formatLabelText={(f) => labelText(f.label, ui, defaultLocale)}
          renderLabelInput={({ format, id, invalid, onChange }) => <FormatLabelInput id={id} value={format.label} invalid={invalid} locales={locales} defaultLocale={defaultLocale} onChange={onChange} />}
          disabled={disabled}
        />
      </div>

      {choices.length ? (
        <section className="space-y-3" aria-labelledby="item-availability-title">
          <h3 id="item-availability-title" className="text-[0.9375rem] font-semibold text-foreground">
            {t('title')}
          </h3>
          <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('helper')}</p>
          {choices.map((c) => {
            const explicit = ruleMap.get(c.key) ?? null
            const e = effectiveRule(inputs, { itemId: '', primaryCategory, itemRules: ruleMap, formats: [{ key: ITEM_PROBE, availability: new Map(), implicit: true }] }, ITEM_PROBE, { kind: 'channel', channel: c.key })
            const inherited = inheritedFor(e, explicit !== null)
            return (
              <AvailabilitySwitch
                key={c.key}
                channelLabel={c.label}
                level="item"
                rule={explicit}
                inherited={inherited}
                inheritedPath={pathText(inherited?.source)}
                onChange={(r) => setItemRule(c.key, r)}
                disabledReason={disabled ? t('readOnly') : undefined}
              />
            )
          })}
          {formats.length > 1 ? (
            <div className="space-y-3">
              <Button variant="link" className="-ml-1 px-1" aria-expanded={formatRulesOpen} aria-controls="item-format-availability" onClick={() => setFormatRulesOpen((o) => !o)}>
                {t('perFormat')}
              </Button>
              <div id="item-format-availability" hidden={!formatRulesOpen} className="space-y-4">
                {formatRulesOpen
                  ? formats.map((f, n) => (
                      <div key={f.key} className="space-y-1">
                        <FieldLabel as="p">{labelText(f.label, ui, defaultLocale) || t('formatN', { n: n + 1 })}</FieldLabel>
                        {choices.map((c) => {
                          const explicit = f.availability.get(c.key) ?? null
                          const e = effectiveRule(inputs, { itemId: '', primaryCategory, itemRules: ruleMap, formats }, f.key, { kind: 'channel', channel: c.key })
                          const inherited = inheritedFor(e, explicit !== null)
                          return (
                            <AvailabilitySwitch
                              key={c.key}
                              variant="row"
                              channelLabel={c.label}
                              level="format"
                              rule={explicit}
                              inherited={inherited}
                              inheritedPath={pathText(inherited?.source)}
                              onChange={(r) => setFormatRule(f, c.key, r)}
                              disabledReason={disabled ? t('readOnly') : undefined}
                            />
                          )
                        })}
                      </div>
                    ))
                  : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

/**
 * The item's categories: CategoryPicker with one primary + additional (C1). "Add category"
 * creates through `createCatalogueTermInlineAction` — the same CatalogueTaxonomyService as
 * Setup (D-3), with the parent the person picks and the full path previewed. The new node
 * joins the local tree at once so the picker can show its path.
 */
export function ItemCategoriesField({
  projectSlug,
  label,
  hint,
  nodes,
  value,
  onChange,
  canCreate,
  locales,
  defaultLocale,
  error,
  presentation,
  profile = null,
}: {
  projectSlug: string
  label: string
  hint?: string
  /** D-22 (C1.12.5): the item's type — only branches used for it are offered; null = no filter yet. */
  profile?: ItemProfile | null
  nodes: readonly CategoryNode[]
  value: CategoryAssignment
  onChange: (next: CategoryAssignment) => void
  /** Holds `catalogue.taxonomy.write` (and may edit the item). */
  canCreate: boolean
  locales: readonly string[]
  defaultLocale: string
  error?: string
  presentation?: 'sheet' | 'inline'
}) {
  const t = useTranslations('catalogue.dashboard.item.categories')
  const ui = useLocale()
  const [added, setAdded] = useState<CategoryNode[]>([])
  const tree = useMemo(() => buildTree([...nodes, ...added.filter((a) => !nodes.some((n) => n.key === a.key))]), [nodes, added])
  const pathContext: PathContext = { locale: ui, defaultLocale, locales }
  const tu = useTranslations('catalogue.useFor')
  const useFor = useProfileUseFor()
  const compatible = profile ? (k: CategoryKey) => isCategoryCompatible(tree, k, profile) : undefined
  const profileName = profile ? useFor.labelOf(profile) : ''

  const onCreate = async (input: { parentKey: CategoryKey | null; label: string }): Promise<CategoryCreateResult> => {
    const labels = { [defaultLocale]: input.label }
    // D-22: a new top-level category created from an item is used for the item's type.
    const r = await createCatalogueTermInlineAction({ projectSlug, kind: 'category', labels, parentKey: input.parentKey, ...(input.parentKey === null && profile && { useFor: [profile] }) })
    if (!r.ok) return { ok: false, message: r.error === 'forbidden' ? t('createForbidden') : r.error === 'category_conflict' ? t('createConflict') : t('createFailed') }
    const order = Math.max(0, ...[...tree.nodes.values()].filter((n) => n.parentKey === input.parentKey).map((n) => n.order)) + 1000
    setAdded((prev) => [...prev, { key: r.term.key, label: r.term.label, parentKey: input.parentKey, order, channelRules: {}, defaultOptionListIds: [], archivedAt: null, ...(input.parentKey === null && profile && { useFor: [profile] }) }])
    return { ok: true, key: r.term.key }
  }

  return (
    <CategoryPicker
      label={label}
      hint={hint}
      tree={tree}
      pathContext={pathContext}
      value={value}
      onChange={onChange}
      onCreate={canCreate ? onCreate : undefined}
      createDisabledReason={canCreate ? undefined : t('createNotAllowed')}
      error={error}
      presentation={presentation}
      compatible={compatible}
      incompatibleText={() => tu('notUsedFor', { profile: profileName })}
      topLevelHint={profile ? tu('inlineRoot', { profile: profileName }) : undefined}
    />
  )
}
