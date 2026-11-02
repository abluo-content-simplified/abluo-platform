import { describe, it, expect } from 'vitest'
import { isOwnDialogEvent } from '../use-sheet-dialog'

describe('isOwnDialogEvent — a sheet inside a panel', () => {
  const panel = { id: 'panel' }
  const dateSheet = { id: 'date-sheet' }
  it("the nested sheet's close, bubbled to the panel through the portal, is not the panel's", () => {
    expect(isOwnDialogEvent({ target: dateSheet, currentTarget: panel })).toBe(false)
  })
  it("the panel's own close/Escape is", () => {
    expect(isOwnDialogEvent({ target: panel, currentTarget: panel })).toBe(true)
  })
})
