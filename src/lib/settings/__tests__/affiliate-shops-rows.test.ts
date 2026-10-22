import { describe, expect, it } from 'vitest'
import { idsToSave, moveShop, moveShopTo, stateFromStored, toggleApproved, unapprovedShops } from '../affiliate-shops-rows'

describe('shop order state', () => {
  it('lists Amazon first plus the approved shops in stored order; the rest are unapproved', () => {
    expect(stateFromStored([]).order).toEqual(['amazon'])
    expect(unapprovedShops(stateFromStored([]))).toEqual(['ibs', 'lafeltrinelli', 'mondadori'])
    expect(stateFromStored(['lafeltrinelli', 'ibs']).order).toEqual(['amazon', 'lafeltrinelli', 'ibs'])
    expect(stateFromStored(['ibs', 'amazon']).order).toEqual(['ibs', 'amazon'])
  })
  it('ticking appends at the end, unticking removes; Amazon cannot be unticked', () => {
    let s = toggleApproved(stateFromStored([]), 'ibs', true)
    s = toggleApproved(s, 'lafeltrinelli', true)
    expect(s.order).toEqual(['amazon', 'ibs', 'lafeltrinelli'])
    expect(unapprovedShops(toggleApproved(s, 'ibs', false))).toEqual(['ibs', 'mondadori'])
    expect(toggleApproved(s, 'amazon', false)).toBe(s)
  })
  it('saves Amazon only when it was moved off the first place', () => {
    let s = toggleApproved(stateFromStored([]), 'ibs', true)
    expect(idsToSave(s)).toEqual(['ibs'])
    s = moveShop(s, 'ibs', -1)
    expect(idsToSave(s)).toEqual(['ibs', 'amazon'])
    expect(idsToSave(moveShop(s, 'amazon', -1))).toEqual(['ibs'])
  })
  it('moves are bounded and drag-to-index works', () => {
    const s = toggleApproved(toggleApproved(stateFromStored([]), 'ibs', true), 'mondadori', true)
    expect(moveShop(s, 'amazon', -1)).toBe(s)
    expect(moveShopTo(s, 'mondadori', 0).order[0]).toBe('mondadori')
  })
})
