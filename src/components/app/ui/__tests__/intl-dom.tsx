/**
 * Test helper (not a test): mounts a component in jsdom inside next-intl with
 * the real message bundles, and drives inputs the way React listens to them.
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import en from '../../../../../messages/en.json'
import it from '../../../../../messages/it.json'
import de from '../../../../../messages/de.json'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const BUNDLES = { en, it, de } as const
export type TestLocale = keyof typeof BUNDLES

export type Mounted = { host: HTMLDivElement; rerender: (ui: ReactNode) => void; unmount: () => void }

export function mount(ui: ReactNode, locale: TestLocale = 'en'): Mounted {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root: Root = createRoot(host)
  const wrap = (node: ReactNode) => (
    <NextIntlClientProvider locale={locale} messages={BUNDLES[locale]} timeZone="Europe/Rome">
      {node}
    </NextIntlClientProvider>
  )
  act(() => root.render(wrap(ui)))
  return {
    host,
    rerender: (next) => act(() => root.render(wrap(next))),
    unmount: () => {
      act(() => root.unmount())
      host.remove()
    },
  }
}

/** Sets a text field's value through the native setter so React's onChange fires. */
export function typeInto(el: Element | null, value: string) {
  if (!el) throw new Error('no element to type into')
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
  act(() => {
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

export function click(el: Element | null) {
  if (!el) throw new Error('no element to click')
  act(() => (el as HTMLElement).click())
}

export function key(el: Element | null, k: string) {
  if (!el) throw new Error('no element for a key press')
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })
}

/** The first element whose accessible name (aria-label or text) matches. */
export function byName(root: ParentNode, selector: string, name: string | RegExp): HTMLElement | null {
  const test = (s: string) => (typeof name === 'string' ? s === name : name.test(s))
  for (const el of root.querySelectorAll<HTMLElement>(selector)) {
    const n = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? ''
    if (test(n)) return el
  }
  return null
}
