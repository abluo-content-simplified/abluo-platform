// ADR-033 Amendment I (I-4.2) — what the editor's "Change type" tells the person first.
//
// Guidance only: the server stays the authority (`applyItemRules` clears the
// allergen declaration when an item leaves food; book details are never
// touched, only hidden by the reader). Pure: no React, no I/O.

import { can, type ItemProfile } from './profiles'

/** 'allergens' = a warning before the declaration is cleared; 'bookDetails' = a lighter note; null = change straight away. */
export type ChangeTypeWarning = 'allergens' | 'bookDetails' | null

export function changeTypeWarning({ from, to, hasBookDetails }: { from: ItemProfile | null; to: ItemProfile; hasBookDetails: boolean }): ChangeTypeWarning {
  if (from === null || from === to) return null
  if (can(from, 'foodInformation') && !can(to, 'foodInformation')) return 'allergens'
  if (can(from, 'bookDetails') && !can(to, 'bookDetails') && hasBookDetails) return 'bookDetails'
  return null
}
