// @vitest-environment jsdom
/**
 * R2-K shared Catalogue components: rendering, keyboard paths, accessible
 * names, and that each one only calls back (no server calls).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { buildTree, validateMove } from '@/lib/modules/catalogue/taxonomy/tree'
import type { CategoryAssignment, CategoryNode, MoveRequest } from '@/lib/modules/catalogue/taxonomy/types'
import { asChannelKey, asFormatKey, type ChannelAvailabilityRule } from '@/lib/modules/catalogue/commerce/commerce-types'
import type { Format } from '@/lib/modules/catalogue/commerce/formats'
import { IMPLICIT_FORMAT_KEY } from '@/lib/modules/catalogue/commerce/format-key'
import { AvailabilitySwitch } from '../AvailabilitySwitch'
import { CategoryPicker } from '../CategoryPicker'
import { FormatPriceRows, parseAmount } from '../FormatPriceRows'
import { ImpactPreview } from '../ImpactPreview'
import { TreeEditor } from '../TreeEditor'
import { WeeklyScheduleEditor } from '../WeeklyScheduleEditor'
import { byName, click, key, mount, typeInto, type Mounted } from './intl-dom'

// next-intl's entry pulls in next/navigation, which does not load outside Next; its client hooks are use-intl's.
vi.mock('next-intl', async () => {
  const u = await import('use-intl')
  return { ...u, NextIntlClientProvider: u.IntlProvider }
})
vi.mock('@/i18n/navigation', () => ({ Link: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a> }))

let m: Mounted | null = null
afterEach(() => {
  m?.unmount()
  m = null
})

const node = (k: string, parentKey: string | null, order: number, archivedAt: string | null = null): CategoryNode => ({
  key: k,
  label: { en: k[0].toUpperCase() + k.slice(1) },
  parentKey,
  order,
  channelRules: {},
  defaultOptionListIds: [],
  archivedAt,
})
const NODES = [node('food', null, 1000), node('pizza', 'food', 1000), node('bianche', 'pizza', 1000), node('pasta', 'food', 2000), node('drinks', null, 2000), node('old', null, 3000, '2026-01-01T00:00:00Z')]
const CTX = { locale: 'en', defaultLocale: 'en', locales: ['en'] }
const status = (host: HTMLElement) => [...host.querySelectorAll('[role="status"]')].map((s) => s.textContent).join(' ')

// ── TreeEditor ────────────────────────────────────────────────────────────────

function applyMove(nodes: CategoryNode[], req: MoveRequest) {
  const plan = validateMove(buildTree(nodes), req)
  if (!plan.ok) return nodes
  const p = new Map(plan.patches.map((x) => [x.key, x]))
  return nodes.map((n) => (p.has(n.key) ? { ...n, parentKey: p.get(n.key)!.parentKey, order: p.get(n.key)!.order } : n))
}

function TreeHarness({ onMove, validate }: { onMove?: (r: MoveRequest) => void; validate?: Parameters<typeof TreeEditor>[0]['validate'] }) {
  const [nodes, setNodes] = useState(NODES)
  const tree = buildTree(nodes)
  return (
    <TreeEditor
      label="Categories"
      tree={tree}
      labelOf={(k) => tree.nodes.get(k)!.label.en!}
      validate={validate}
      onMove={(r) => {
        onMove?.(r)
        setNodes((ns) => applyMove(ns, r))
      }}
    />
  )
}

describe('TreeEditor', () => {
  it('names the list, each grip (with position and level) and each disclosure', () => {
    m = mount(<TreeHarness />)
    expect(m.host.querySelector('ul[aria-label="Categories"]')).not.toBeNull()
    expect(byName(m.host, 'button', /^Move Pizza, position 1 of 2, level 2\./)).not.toBeNull()
    expect(byName(m.host, 'button', 'More for Pasta')).not.toBeNull()
    const toggle = byName(m.host, 'button', 'Hide sub-categories of Food')!
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    click(toggle)
    expect(byName(m.host, 'button', 'Show sub-categories of Food')!.getAttribute('aria-expanded')).toBe('false')
    expect(byName(m.host, 'button', 'More for Pasta')).toBeNull()
  })

  it('ArrowRight on a grip moves the node into the category above, announces it and keeps focus on its grip', () => {
    const onMove = vi.fn()
    m = mount(<TreeHarness onMove={onMove} />)
    const grip = byName(m.host, 'button', /^Move Pasta,/)!
    grip.focus()
    key(grip, 'ArrowRight')
    expect(onMove).toHaveBeenCalledWith({ key: 'pasta', newParentKey: 'pizza', index: 1 })
    expect(status(m.host)).toContain('Pasta moved: position 2 of 2 in Pizza.')
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Move Pasta, position 2 of 2, level 3\./)
  })

  it('ArrowUp at the top says so and calls nothing; a refused move is announced and never sent', () => {
    const onMove = vi.fn()
    m = mount(<TreeHarness onMove={onMove} validate={(r) => ({ ok: false, code: 'category_cycle', key: r.key })} />)
    key(byName(m.host, 'button', /^Move Food,/), 'ArrowUp')
    expect(status(m.host)).toContain('Food is already first.')
    key(byName(m.host, 'button', /^Move Pasta,/), 'ArrowRight')
    expect(onMove).not.toHaveBeenCalled()
    expect(status(m.host)).toContain('Pasta can’t go inside Pizza: a category can’t be placed inside its own sub-category.')
  })

  it('without reordering there are no grips and the reason is shown', () => {
    const tree = buildTree(NODES)
    m = mount(<TreeEditor label="Categories" tree={tree} labelOf={(k) => k} onMove={() => undefined} reorderable={false} reorderDisabledReason="Clear the search to reorder." />)
    expect(byName(m.host, 'button', /^Move /)).toBeNull()
    expect(m.host.textContent).toContain('Clear the search to reorder.')
  })
})

// ── CategoryPicker ───────────────────────────────────────────────────────────

function PickerHarness({ onCreate, initial = { primary: null, additional: [] } }: { onCreate?: Parameters<typeof CategoryPicker>[0]['onCreate']; initial?: CategoryAssignment }) {
  const [nodes, setNodes] = useState(NODES)
  const [value, setValue] = useState<CategoryAssignment>(initial)
  return (
    <>
      <CategoryPicker
        label="Categories"
        presentation="inline"
        tree={buildTree(nodes)}
        pathContext={CTX}
        value={value}
        onChange={setValue}
        onCreate={
          onCreate
            ? async (input) => {
                const r = await onCreate(input)
                if (r.ok) setNodes((ns) => [...ns, { ...node(r.key, input.parentKey, 9000), label: { en: input.label } }])
                return r
              }
            : undefined
        }
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  )
}
const valueOf = (host: HTMLElement) => JSON.parse(host.querySelector('[data-testid="value"]')!.textContent!)

describe('CategoryPicker', () => {
  it('browses the tree with full paths, hides archived categories, and searches by path', () => {
    m = mount(<PickerHarness />)
    expect(byName(m.host, 'input', 'Choose Food › Pizza › Bianche')).not.toBeNull()
    expect(byName(m.host, 'input', 'Choose Old')).toBeNull()
    typeInto(m.host.querySelector('input[type="search"]'), 'pizza bia')
    const boxes = [...m.host.querySelectorAll('input[type="checkbox"]')].map((b) => b.getAttribute('aria-label'))
    expect(boxes).toEqual(['Choose Food › Pizza › Bianche'])
  })

  it('the first ticked category is primary; another can be made primary with a pressed toggle', () => {
    m = mount(<PickerHarness />)
    click(byName(m.host, 'input', 'Choose Food › Pasta'))
    click(byName(m.host, 'input', 'Choose Drinks'))
    expect(valueOf(m.host)).toEqual({ primary: 'pasta', additional: ['drinks'] })
    expect(byName(m.host, 'button', 'Primary: Food › Pasta')!.getAttribute('aria-pressed')).toBe('true')
    click(byName(m.host, 'button', 'Make primary: Drinks'))
    expect(valueOf(m.host)).toEqual({ primary: 'drinks', additional: ['pasta'] })
    expect(status(m.host)).toContain('Drinks is now the primary category.')
  })

  it('removing the primary promotes the next category', () => {
    m = mount(<PickerHarness initial={{ primary: 'pasta', additional: ['drinks'] }} />)
    click(byName(m.host, 'input', 'Choose Food › Pasta'))
    expect(valueOf(m.host)).toEqual({ primary: 'drinks', additional: [] })
  })

  it('inline add: chooses a parent, previews the full path, calls onCreate and selects the new category', async () => {
    const onCreate = vi.fn(async () => ({ ok: true as const, key: 'focacce' }))
    m = mount(<PickerHarness onCreate={onCreate} />)
    click(byName(m.host, 'button', 'Add category'))
    const form = m.host.querySelector('section')!
    typeInto(form.querySelector('input'), 'Focacce')
    typeInto(form.querySelector('select'), 'pizza')
    expect(form.textContent).toContain('It will be: Food › Pizza › Focacce')
    const { act } = await import('react')
    await act(async () => {
      byName(form, 'button', 'Add category')!.click()
    })
    expect(onCreate).toHaveBeenCalledWith({ parentKey: 'pizza', label: 'Focacce' })
    expect(valueOf(m.host)).toEqual({ primary: 'focacce', additional: [] })
  })

  it('without permission the add action is replaced by the reason', () => {
    m = mount(<CategoryPicker label="Categories" presentation="inline" tree={buildTree(NODES)} pathContext={CTX} value={{ primary: null, additional: [] }} onChange={() => undefined} createDisabledReason="Only category editors can add one." />)
    expect(byName(m.host, 'button', 'Add category')).toBeNull()
    expect(m.host.textContent).toContain('Only category editors can add one.')
  })
})

// ── WeeklyScheduleEditor ─────────────────────────────────────────────────────

const EVENING: ChannelAvailabilityRule = { state: 'unavailable', overrides: [{ kind: 'weekly', key: 'eve', days: [], from: '18:00', to: '23:00', state: 'available' }] }

describe('WeeklyScheduleEditor', () => {
  it('summarises the rule, names its controls and lists days Monday first', () => {
    m = mount(<WeeklyScheduleEditor label="Delivery hours" value={EVENING} onChange={() => undefined} />)
    expect(m.host.textContent).toContain('Available 18:00–23:00 every day')
    expect(m.host.querySelector('[role="radiogroup"][aria-label="Usually"]')).not.toBeNull()
    const days = [...m.host.querySelectorAll('[role="group"][aria-label="Days for Hours 1"] [role="checkbox"]')].map((b) => b.textContent)
    expect(days).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(byName(m.host, 'button', 'Remove Hours 1')).not.toBeNull()
  })

  it('labels an overnight interval and shows C5a overlap issues on both rows', () => {
    const rule: ChannelAvailabilityRule = {
      state: 'unavailable',
      overrides: [
        { kind: 'weekly', key: 'a', days: ['fri'], from: '22:00', to: '02:00', state: 'available' },
        { kind: 'weekly', key: 'b', days: ['fri'], from: '23:00', to: '23:30', state: 'available' },
      ],
    }
    m = mount(<WeeklyScheduleEditor label="Bar hours" value={rule} onChange={() => undefined} />)
    expect(m.host.textContent).toContain('Overnight: ends at 02:00 the next day.')
    expect(m.host.querySelectorAll('[role="alert"]').length).toBe(2)
    expect(m.host.textContent).toContain('These hours overlap other hours with the same priority.')
  })

  it('edits: a day chip and a time change call onChange with stored shapes (seven days = [])', () => {
    const onChange = vi.fn()
    m = mount(<WeeklyScheduleEditor label="Hours" value={EVENING} onChange={onChange} />)
    click(byName(m.host, '[role="checkbox"]', 'Sat'))
    expect(onChange).toHaveBeenLastCalledWith({ state: 'unavailable', overrides: [{ ...EVENING.overrides[0], days: ['sat'] }] })
    typeInto(m.host.querySelectorAll('select')[1], '23:30')
    expect(onChange).toHaveBeenLastCalledWith({ state: 'unavailable', overrides: [{ ...EVENING.overrides[0], to: '23:30' }] })
    click(byName(m.host, 'button', 'Add hours'))
    expect(onChange.mock.lastCall![0].overrides[1]).toMatchObject({ kind: 'weekly', days: [], from: '18:00', to: '23:00', state: 'available' })
  })

  it('German: weekdays localized, times still 24-hour', () => {
    m = mount(<WeeklyScheduleEditor label="Zeiten" value={EVENING} onChange={() => undefined} />, 'de')
    expect(m.host.textContent).toContain('Verfügbar 18:00–23:00 täglich')
    expect([...m.host.querySelectorAll('[role="checkbox"]')][0].textContent).toMatch(/^Mo/)
    expect([...m.host.querySelectorAll('option')].some((o) => o.textContent === '13:00')).toBe(true)
  })

  it('price-window mode has no baseline or state and says Always for none', () => {
    m = mount(<WeeklyScheduleEditor mode="priceWindow" label="When it applies" value={[]} onChange={() => undefined} />)
    expect(m.host.textContent).toContain('Always')
    expect(m.host.querySelector('[role="radiogroup"]')).toBeNull()
    expect(byName(m.host, 'button', 'Add a time')).not.toBeNull()
  })
})

// ── AvailabilitySwitch ───────────────────────────────────────────────────────

const DELIVERY = asChannelKey('delivery')
const FROM_PIZZA = { rule: EVENING, source: { level: 'category' as const, channel: DELIVERY, categoryKey: 'pizza', path: ['food', 'pizza'], inheritedFromAncestor: false } }

describe('AvailabilitySwitch', () => {
  it('inheriting: shows the category default with its path; Available from Inherit means all week', () => {
    const onChange = vi.fn()
    m = mount(<AvailabilitySwitch channelLabel="Delivery" level="item" rule={null} inherited={FROM_PIZZA} inheritedPath="Food › Pizza" onChange={onChange} />)
    expect(m.host.textContent).toContain('Category default: Available 18:00–23:00 every day, from Food › Pizza')
    const group = m.host.querySelector('[role="radiogroup"][aria-label="Availability on Delivery"]')!
    expect(byName(group, '[role="radio"]', 'Inherit')!.getAttribute('aria-checked')).toBe('true')
    click(byName(group, '[role="radio"]', 'Available'))
    expect(onChange).toHaveBeenCalledWith({ state: 'available', overrides: [] })
  })

  it('explicit: says so, and "Use category default" removes the row (null)', () => {
    const onChange = vi.fn()
    m = mount(<AvailabilitySwitch channelLabel="Delivery" level="item" rule={{ state: 'unavailable', overrides: [] }} inherited={FROM_PIZZA} inheritedPath="Food › Pizza" onChange={onChange} />)
    expect(m.host.textContent).toContain('Set for this item: Unavailable all week')
    click(byName(m.host, 'button', 'Use category default'))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('"Change hours for this item" copies the complete inherited rule', () => {
    const onChange = vi.fn()
    m = mount(<AvailabilitySwitch channelLabel="Delivery" level="item" rule={null} inherited={FROM_PIZZA} onChange={onChange} />)
    click(byName(m.host, 'button', 'Set hours'))
    click(byName(m.host, 'button', 'Change hours for this item'))
    expect(onChange).toHaveBeenCalledWith(EVENING)
  })

  it('row variant: one line, disabled with the reason', () => {
    m = mount(<AvailabilitySwitch variant="row" channelLabel="Takeaway" level="format" rule={null} inherited={{ rule: { state: 'available', overrides: [] }, source: { level: 'item', channel: asChannelKey('takeaway') } }} onChange={() => undefined} disabledReason="View only." />)
    expect(m.host.textContent).toContain('Item setting: Available all week')
    expect(m.host.textContent).toContain('View only.')
    expect([...m.host.querySelectorAll('[role="radio"]')].every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
  })
})

// ── FormatPriceRows ──────────────────────────────────────────────────────────

const base = { identifiers: {}, quantity: null, templateKey: null, availability: new Map() }
const SIMPLE: Format[] = [{ ...base, key: IMPLICIT_FORMAT_KEY, label: null, implicit: true, prices: [] }]
const text = (f: Format) => (f.label && typeof f.label === 'object' ? (f.label.en ?? '') : '')

function FormatsHarness({ initial, onChange }: { initial: Format[]; onChange?: (f: Format[]) => void }) {
  const [formats, setFormats] = useState(initial)
  return (
    <FormatPriceRows
      formats={formats}
      onChange={(f) => {
        onChange?.(f)
        setFormats(f)
      }}
      currency="EUR"
      channels={[{ key: DELIVERY, label: 'Delivery' }]}
      formatLabelText={text}
      newKey={(() => {
        let i = 0
        return () => `k${++i}`
      })()}
      renderLabelInput={({ format, id, onChange: set }) => <input id={id} value={text(format)} onChange={(e) => set({ en: e.target.value })} />}
    />
  )
}

describe('FormatPriceRows', () => {
  it('parses prices with either decimal separator, two decimals at most', () => {
    expect(parseAmount('12,5')).toBe(12.5)
    expect(parseAmount('0')).toBe(0)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('1.234')).toBeUndefined()
  })

  it('a simple item shows one Price field; typing writes a standard price', () => {
    const onChange = vi.fn()
    m = mount(<FormatsHarness initial={SIMPLE} onChange={onChange} />)
    const price = m.host.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!
    expect(m.host.querySelector(`label[for="${price.id}"]`)!.textContent).toBe('Price')
    typeInto(price, '12,50')
    expect(onChange.mock.lastCall![0][0].prices).toEqual([{ key: 'k1', scope: null, amount: 12.5, note: null, windows: [] }])
    expect(document.body.contains(price)).toBe(true)
    typeInto(price, '12,505')
    expect(m.host.textContent).toContain('Enter a price like 12.50')
    expect(price.getAttribute('aria-invalid')).toBe('true')
  })

  it('"Add another size or format" makes named rows that reorder from the keyboard', () => {
    const onChange = vi.fn()
    m = mount(<FormatsHarness initial={SIMPLE} onChange={onChange} />)
    click(byName(m.host, 'button', 'Add another size or format'))
    expect(m.host.querySelector('ul[aria-label="Sizes and formats"]')).not.toBeNull()
    const grip = byName(m.host, 'button', /^Move Format 1, position 1 of 2\./)!
    key(grip, 'ArrowDown')
    expect(onChange.mock.lastCall![0].map((f: Format) => f.key)).toEqual(['k1', IMPLICIT_FORMAT_KEY])
  })

  it('channel prices sit behind a disclosure and never touch availability', () => {
    const onChange = vi.fn()
    m = mount(<FormatsHarness initial={[{ ...SIMPLE[0], prices: [{ key: 'p', scope: null, amount: 10, note: null, windows: [] }] }]} onChange={onChange} />)
    const toggle = byName(m.host, 'button', 'Different price per channel')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    click(toggle)
    const field = [...m.host.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]')][1]
    expect(m.host.querySelector(`label[for="${field.id}"]`)!.textContent).toBe('Price on Delivery')
    typeInto(field, '11')
    const f: Format = onChange.mock.lastCall![0][0]
    expect(f.prices.map((p) => [p.scope, p.amount])).toEqual([
      [null, 10],
      [DELIVERY, 11],
    ])
    expect(f.availability.size).toBe(0)
  })

  it('codes and quantity are in a named disclosure on named rows', () => {
    m = mount(<FormatsHarness initial={[{ ...base, key: asFormatKey('s'), label: { en: 'Small' }, implicit: false, prices: [] }, { ...base, key: asFormatKey('l'), label: { en: 'Large' }, implicit: false, prices: [] }]} />)
    const d = byName(m.host, 'button', 'Codes and quantity for Large')!
    click(d)
    expect(d.getAttribute('aria-expanded')).toBe('true')
    expect(m.host.textContent).toContain('Barcode (GTIN)')
  })
})

// ── ImpactPreview ────────────────────────────────────────────────────────────

describe('ImpactPreview', () => {
  it('panel: the counts sentence, per-channel breakdown and the confirm action', () => {
    const onConfirm = vi.fn()
    m = mount(
      <ImpactPreview
        variant="panel"
        title="Change Delivery?"
        impact={{ itemsChanged: 12, formatsChanged: 3, shieldedByOverride: 2, byChannel: { [DELIVERY]: { gainAvailability: 0, loseAvailability: 9, scheduleOnly: 1 } } }}
        channelLabel="Delivery"
        channelName={() => 'Delivery'}
        confirmLabel="Apply change"
        onConfirm={onConfirm}
      />,
    )
    expect(m.host.textContent).toContain('12 items and 3 formats change on Delivery; 2 explicit overrides kept.')
    expect(m.host.textContent).toContain('Delivery: 9 stop being available, 1 changes hours')
    click(byName(m.host, 'button', 'Apply change'))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('nothing to change says so (Italian)', () => {
    m = mount(<ImpactPreview variant="panel" title="Controlla" impact={{ itemsChanged: 0, formatsChanged: 0, shieldedByOverride: 0 }} confirmLabel="Salva" onConfirm={() => undefined} />, 'it')
    expect(m.host.textContent).toContain('Nessun articolo cambia.')
  })

  it('dialog variant renders a labelled modal dialog (closed until open)', () => {
    m = mount(<ImpactPreview title="Change Delivery?" open={false} impact={{ itemsChanged: 1, formatsChanged: 1, shieldedByOverride: 0 }} confirmLabel="Apply" onConfirm={() => undefined} onCancel={() => undefined} />)
    const dialog = m.host.querySelector('dialog')!
    expect(dialog.getAttribute('aria-labelledby')).toBe('confirm-title')
    expect(dialog.textContent).toContain('1 item and 1 format change.')
  })
})
