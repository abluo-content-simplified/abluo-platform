// @vitest-environment jsdom
/** Checkbox field shown as an on/off switch (display: 'switch') — same boolean value as the checkbox. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CheckboxField } from '../fields/CheckboxField'
import type { CheckboxFieldConfig } from '../types'
import { toFieldConfig } from '@/lib/forms/render-mapping'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const LABEL = 'Credit me by name if the book is added'
const values: boolean[] = []
function Harness({ config }: { config: CheckboxFieldConfig }) {
  const [v, setV] = useState(false)
  return <CheckboxField config={config} value={v} onChange={(next) => { values.push(next); setV(next) }} />
}

describe('toFieldConfig — checkbox display', () => {
  it("passes display: 'switch' through, and only that", () => {
    expect(toFieldConfig({ id: 'c', type: 'checkbox', label: LABEL, display: 'switch' })).toMatchObject({ type: 'checkbox', display: 'switch', checkboxLabel: LABEL })
    expect(toFieldConfig({ id: 'c', type: 'checkbox', label: LABEL, display: 'list' })).not.toHaveProperty('display')
    expect(toFieldConfig({ id: 'c', type: 'checkbox', label: LABEL })).not.toHaveProperty('display')
  })
})

describe('CheckboxField as a switch', () => {
  const config: CheckboxFieldConfig = { id: 'credit_by_name', type: 'checkbox', label: LABEL, checkboxLabel: LABEL, display: 'switch', helpText: 'Only applies if you entered your name.' }

  it('is one labelled row: text first, then a switch, off by default; the label is not repeated', () => {
    act(() => root.render(<Harness config={config} />))
    const sw = host.querySelector<HTMLInputElement>('input[role="switch"]')!
    expect(sw).not.toBeNull()
    expect(sw.type).toBe('checkbox')
    expect(sw.checked).toBe(false)
    const row = host.querySelector('[data-field-switch]')!
    expect(row.getAttribute('for')).toBe('credit_by_name')
    expect(row.firstElementChild!.textContent).toBe(LABEL) // text left …
    expect(row.lastElementChild!.getAttribute('aria-hidden')).toBe('true') // … track right
    expect(host.textContent!.split(LABEL).length - 1).toBe(1)
    expect(host.textContent).toContain('Only applies if you entered your name.')
  })

  it('toggles the same boolean value as the checkbox, by clicking the row', () => {
    values.length = 0
    act(() => root.render(<Harness config={config} />))
    const row = host.querySelector<HTMLLabelElement>('[data-field-switch]')!
    act(() => row.click())
    expect(host.querySelector<HTMLInputElement>('input[role="switch"]')!.checked).toBe(true)
    act(() => row.click())
    expect(values).toEqual([true, false])
  })

  it('uses Design System colour tokens (light and dark follow the theme)', () => {
    act(() => root.render(<Harness config={config} />))
    const track = host.querySelector<HTMLElement>('[data-field-switch] > span[aria-hidden]')!
    expect(track.getAttribute('style')).toContain('var(--form-check-border')
    act(() => host.querySelector<HTMLLabelElement>('[data-field-switch]')!.click())
    expect(host.querySelector<HTMLElement>('[data-field-switch] > span[aria-hidden]')!.getAttribute('style')).toContain('var(--color-primary)')
  })

  it('without display stays the plain checkbox', () => {
    act(() => root.render(<Harness config={{ ...config, display: undefined }} />))
    expect(host.querySelector('input[role="switch"]')).toBeNull()
    expect(host.querySelector('input[type="checkbox"]')).not.toBeNull()
  })
})
