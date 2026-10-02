// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useRef, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useFocusTrap } from '../FormModal'
import { useFocusOnChange } from '../useFocusOnChange'

// QA 2026-10-02 (Early Access form): after Continue and after Submit focus was
// on <body>, outside the dialog; closing it did not return focus to the CTA.

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

function Trap({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, active)
  return (
    <div ref={ref} tabIndex={-1}>
      <button id="first">first</button>
      <button id="last">last</button>
    </div>
  )
}

describe('useFocusTrap', () => {
  it('moves focus in on open and back to the opener on close', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    act(() => root.render(<Trap active />))
    expect(document.activeElement?.id).toBe('first')

    act(() => root.render(<Trap active={false} />))
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('pulls focus back into the dialog when Tab is pressed from outside it', () => {
    act(() => root.render(<Trap active />))
    ;(document.activeElement as HTMLElement).blur()
    expect(document.activeElement).toBe(document.body)

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement?.id).toBe('first')

    ;(document.activeElement as HTMLElement).blur()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement?.id).toBe('last')
  })
})

function Step({ step }: { step: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusOnChange(ref, step)
  return (
    <div ref={ref} tabIndex={-1} id={`step-${step}`}>
      step {step}
    </div>
  )
}

describe('useFocusOnChange', () => {
  it('does not steal focus on first render, then focuses the new step', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()

    act(() => root.render(<Step step={1} />))
    expect(document.activeElement).toBe(outside)

    act(() => root.render(<Step step={2} />))
    expect(document.activeElement?.id).toBe('step-2')
    outside.remove()
  })
})
