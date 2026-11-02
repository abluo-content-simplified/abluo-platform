import { describe, it, expect, vi } from 'vitest'
import { sheetDialogHandlers } from '../use-sheet-dialog'

const own = { id: 'panel' }
const child = { id: 'date-sheet' }
const ev = (target: object) => ({ target, currentTarget: own, preventDefault: vi.fn() }) as never

describe('sheetDialogHandlers — a sheet inside a panel', () => {
  it('a nested sheet closing does not close the panel (React bubbles through portals)', () => {
    const onClose = vi.fn()
    const h = sheetDialogHandlers(onClose, { current: false })
    h.onClose(ev(child))
    h.onCancel(ev(child))
    expect(onClose).not.toHaveBeenCalled()
  })
  it('its own Escape closes it (animated: the native close is prevented)', () => {
    const onClose = vi.fn()
    const e = ev(own)
    sheetDialogHandlers(onClose, { current: false }).onCancel(e)
    expect(onClose).toHaveBeenCalledOnce()
    expect((e as unknown as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault).toHaveBeenCalled()
  })
  it('a close it did not start tells the owner; one it started does not', () => {
    const onClose = vi.fn()
    const closingByUs = { current: true }
    const h = sheetDialogHandlers(onClose, closingByUs)
    h.onClose(ev(own))
    expect(onClose).not.toHaveBeenCalled()
    expect(closingByUs.current).toBe(false)
    h.onClose(ev(own))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
