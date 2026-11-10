'use client'

import { useState } from 'react'
import type { DigitalCardTargetOption } from '@/lib/api/digital-cards'
import { formatDigitalCardsMessage, type DigitalCardsMessages } from '@/lib/i18n/digital-cards-messages'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import type { FieldControlProps } from '@/components/app/ui/Field'
import { PickerOption, PickerTrigger } from '@/components/app/ui/PickerButton'
import { TextInput } from '@/components/app/ui/TextInput'
import { targetGroups, type TargetGroup } from './links-model'

/** The quiet second line of an option: what it is, and its address. */
export function targetSecondary(o: DigitalCardTargetOption, e: DigitalCardsMessages['editor']): string {
  const kind =
    o.type === 'cataloguePage'
      ? e.linkTargetCataloguePage
      : o.type === 'catalogueCollection'
        ? e.linkTargetCollection
        : o.type === 'catalogueItem'
          ? e.linkTargetItem
          : o.type === 'section'
            ? e.linkTargetSection
            : o.type === 'module'
              ? e.linkTargetModule
              : ''
  const path = o.path === undefined ? '' : `/${o.path}`
  return [kind, path].filter(Boolean).join(' · ')
}

/**
 * "Page on this website" (ADR-049 Amendment B): one searchable list of what a
 * link can open, grouped Pages → Catalogue → Sections — the same reach as the
 * navigation picker. A select-looking trigger opens a sheet with a search
 * field (PickerTrigger, BottomSheet, TextInput, PickerOption from the Lab).
 * `pagesOnly` for form / booking links, which point at a page.
 */
export function DigitalCardPagePicker({
  control,
  value,
  options,
  onChange,
  pagesOnly = false,
  e,
}: {
  control: FieldControlProps
  /** The chosen option id (cardLinkTargetId), or null. */
  value: string | null
  options: readonly DigitalCardTargetOption[]
  onChange: (id: string) => void
  pagesOnly?: boolean
  e: DigitalCardsMessages['editor']
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const chosen = value ? (options.find((o) => o.id === value) ?? null) : null
  const groups = targetGroups(options, query, pagesOnly)
  const groupLabel: Record<TargetGroup, string> = { pages: e.linkGroupPages, catalogue: e.linkGroupCatalogue, sections: e.linkGroupSections }
  const close = () => {
    setOpen(false)
    setQuery('')
  }

  return (
    <>
      <PickerTrigger
        id={control.id}
        aria-describedby={control['aria-describedby']}
        aria-invalid={control['aria-invalid']}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        secondary={chosen ? targetSecondary(chosen, e) || undefined : value ? e.linkPageGone : undefined}
      >
        {chosen?.title ?? e.linkPageNone}
      </PickerTrigger>
      <BottomSheet open={open} title={e.linkPageNone} onClose={close}>
        <TextInput type="search" value={query} maxLength={80} placeholder={e.linkPageSearch} aria-label={e.linkPageSearch} onChange={(ev) => setQuery(ev.target.value)} />
        <div className="mt-2 max-h-[60vh] overflow-y-auto">
          {groups.map((g) => (
            <section key={g.group} aria-label={groupLabel[g.group]}>
              <h3 className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">{groupLabel[g.group]}</h3>
              <ul className="flex flex-col gap-0.5">
                {g.options.map((o) => (
                  <li key={o.id}>
                    <PickerOption
                      current={o.id === value}
                      secondary={targetSecondary(o, e) || undefined}
                      onClick={() => {
                        onChange(o.id)
                        close()
                      }}
                    >
                      {o.title}
                    </PickerOption>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {groups.length === 0 ? (
            <p role="status" className="px-3 py-4 text-sm text-muted-foreground">
              {formatDigitalCardsMessage(e.linkPageNoMatch, { query: query.trim() })}
            </p>
          ) : null}
        </div>
      </BottomSheet>
    </>
  )
}
