'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Field } from '@/components/app/ui/Field'
import { Panel } from '@/components/app/ui/Panel'
import { RadioList } from '@/components/app/ui/RadioList'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { Select } from '@/components/app/ui/Select'
import { TextInput } from '@/components/app/ui/TextInput'
import { TreeEditor } from '@/components/app/ui/TreeEditor'
import type { CardMenuItem } from '@/components/app/ui/CardMenu'
import { QUANTITY_UNITS, type QuantityUnit } from '@/lib/modules/catalogue/commerce/formats'
import { PROFILE_ORDER, type ItemProfile } from '@/lib/modules/catalogue/profiles'
import type { CatalogueSettingsView } from '@/lib/modules/catalogue/settings/service'
import { loadCatalogueSettingsAction, saveCatalogueSettingsAction } from '@/app/[locale]/(client)/[tenant]/catalogue/setup/settings-actions'
import { flatTree, keyFromLabel, labelText, parseQuantity, reorderedList, templateInputs, type Labels, type TemplateDraft } from './setup-model'
import { LabelFields, SetupHeader, useFailText, useSetupToast } from './setup-ui'

const NONE = 'none'

/**
 * Catalogue → Setup → Item Defaults (spec §10.6, C3-6): what the new-item flow preselects
 * ("What are you adding?" — always changeable per item) and the format templates (suggested
 * sizes such as "Glass 15 cl" / "Bottle 75 cl" for new items). Each change saves at once.
 */
export function ItemDefaults({ projectSlug, initial, backHref }: { projectSlug: string; initial: CatalogueSettingsView; backHref: string }) {
  const t = useTranslations('catalogue.setup.defaults')
  const tp = useTranslations('catalogue.dashboard.itemProfiles')
  const tu = useTranslations('app.ui.formatPrices.units')
  const [view, setView] = useState(initial)
  const [editing, setEditing] = useState<{ mode: 'add' } | { mode: 'edit'; key: string } | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useSetupToast()
  const failText = useFailText()
  const templates: TemplateDraft[] = useMemo(() => view.formatTemplates.map((x) => ({ key: x.key, label: x.label, quantity: x.quantity ? { value: x.quantity.value, unit: x.quantity.unit as QuantityUnit } : null })), [view.formatTemplates])
  const nameOf = (key: string) => labelText(templates.find((x) => x.key === key)?.label, view.defaultLocale, view.defaultLocale) || t('unnamed')

  async function save(set: Parameters<typeof saveCatalogueSettingsAction>[0]['set'], ok: string): Promise<boolean> {
    setBusy(true)
    const r = await saveCatalogueSettingsAction({ projectSlug, rev: view.rev, set })
    setBusy(false)
    if (!r.ok) {
      if (r.error === 'conflict') {
        const fresh = await loadCatalogueSettingsAction({ projectSlug })
        if (fresh.ok) setView(fresh.settings)
      }
      toast.show(failText(r), 'error')
      return false
    }
    const fresh = await loadCatalogueSettingsAction({ projectSlug })
    if (fresh.ok) setView(fresh.settings)
    toast.show(ok)
    return true
  }

  const saveTemplates = (next: TemplateDraft[], ok: string) => save({ formatTemplates: templateInputs(next) }, ok)
  const menuItems = (key: string): CardMenuItem[] => [
    { key: 'edit', label: t('editTemplate'), onSelect: () => setEditing({ mode: 'edit', key }) },
    { key: 'remove', label: t('removeTemplate'), destructive: true, separated: true, onSelect: () => setRemoving(key) },
  ]

  return (
    <div className="space-y-6">
      <SetupHeader title={t('title')} backHref={backHref} intro={t('intro')} />

      <Panel as="section">
        <RadioList<string>
          legend={t('profileLegend')}
          name="default-item-profile"
          value={view.defaultItemProfile ?? NONE}
          onChange={(v) => void save({ defaultItemProfile: v === NONE ? null : (v as ItemProfile) }, t('profileSaved'))}
          options={[
            { value: NONE, label: t('profileNone'), description: t('profileNoneHint') },
            ...PROFILE_ORDER.map((p) => ({ value: p, label: tp(p), description: tp(`${p}Help`) })),
          ]}
        />
        <p className="mt-3 text-sm text-muted-foreground">{t('profileHint')}</p>
      </Panel>

      <section className="space-y-3" aria-labelledby="setup-format-templates">
        <SectionHeading id="setup-format-templates" title={t('templatesTitle')} />
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('templatesIntro')}</p>
        {templates.length === 0 ? (
          <EmptyState compact titleAs="p" title={t('templatesEmpty')} />
        ) : (
          <TreeEditor
            label={t('templatesTitle')}
            tree={flatTree(templates.map((x) => x.key))}
            labelOf={nameOf}
            onMove={(req) => void saveTemplates(reorderedList(templates.map((x) => x.key), req).map((k) => templates.find((x) => x.key === k)!), t('templatesReordered'))}
            parentChangeDisabledReason={t('templatesFlat')}
            renderMeta={(key) => {
              const q = templates.find((x) => x.key === key)?.quantity
              return q ? <p className="text-sm text-muted-foreground">{t('quantityIs', { value: q.value, unit: tu(q.unit) })}</p> : null
            }}
            menuItems={menuItems}
          />
        )}
        <Button variant="secondary" onClick={() => setEditing({ mode: 'add' })}>
          {t('addTemplate')}
        </Button>
      </section>

      <TemplateSheet
        editing={editing}
        templates={templates}
        locales={view.locales}
        defaultLocale={view.defaultLocale}
        busy={busy}
        onClose={() => setEditing(null)}
        onSave={async (next, ok) => {
          if (await saveTemplates(next, ok)) setEditing(null)
        }}
      />
      <ConfirmDialog
        open={!!removing}
        title={removing ? t('removeTitle', { name: nameOf(removing) }) : ''}
        body={t('removeBody')}
        confirmLabel={t('removeTemplate')}
        busy={busy}
        onConfirm={() => {
          const key = removing
          if (!key) return
          void saveTemplates(templates.filter((x) => x.key !== key), t('removed', { name: nameOf(key) })).then(() => setRemoving(null))
        }}
        onCancel={() => setRemoving(null)}
      />
      {toast.node}
    </div>
  )
}

function TemplateSheet({
  editing,
  templates,
  locales,
  defaultLocale,
  busy,
  onClose,
  onSave,
}: {
  editing: { mode: 'add' } | { mode: 'edit'; key: string } | null
  templates: TemplateDraft[]
  locales: string[]
  defaultLocale: string
  busy: boolean
  onClose: () => void
  onSave: (next: TemplateDraft[], ok: string) => Promise<void>
}) {
  const t = useTranslations('catalogue.setup.defaults')
  const tu = useTranslations('app.ui.formatPrices.units')
  const current = editing?.mode === 'edit' ? templates.find((x) => x.key === editing.key) : undefined
  const [labels, setLabels] = useState<Labels>({})
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState<QuantityUnit>('cl')
  const [opened, setOpened] = useState<typeof editing>(null)
  if (editing !== opened) {
    setOpened(editing)
    setLabels(Object.fromEntries(locales.map((l) => [l, current?.label[l] ?? ''])))
    setAmount(current?.quantity ? String(current.quantity.value) : '')
    setUnit(current?.quantity?.unit ?? 'cl')
  }
  if (!editing) return <BottomSheet open={false} title="" onClose={onClose}>{null}</BottomSheet>

  const main = (labels[defaultLocale] ?? '').trim()
  const quantity = parseQuantity(amount)
  const reason = !main ? t('nameRequired') : quantity === undefined ? t('quantityInvalid') : null

  function submit() {
    if (reason) return
    const draft: TemplateDraft = { key: current?.key ?? keyFromLabel(main, templates.map((x) => x.key), 'template'), label: labels, quantity: quantity ? { value: quantity, unit } : null }
    void onSave(current ? templates.map((x) => (x.key === draft.key ? draft : x)) : [...templates, draft], current ? t('templateSaved', { name: main }) : t('templateAdded', { name: main }))
  }

  return (
    <BottomSheet open title={current ? t('editTitle', { name: labelText(current.label, defaultLocale, defaultLocale) }) : t('addTitle')} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <LabelFields locales={locales} defaultLocale={defaultLocale} value={labels} onChange={setLabels} label={t('templateName')} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('quantity')} hint={t('quantityHint')} error={quantity === undefined ? t('quantityInvalid') : undefined}>
            {(p) => <TextInput {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
          <Field label={t('unit')}>
            {(p) => (
              <Select {...p} value={unit} onChange={(e) => setUnit(e.target.value as QuantityUnit)}>
                {QUANTITY_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {tu(u)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button type="submit" variant="primary" disabled={busy || !!reason}>
            {current ? t('save') : t('addTemplate')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
        </div>
        {reason ? <p className="text-sm text-muted-foreground">{reason}</p> : null}
      </form>
    </BottomSheet>
  )
}
