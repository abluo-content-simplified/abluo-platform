'use client'

import { createContext, useContext } from 'react'

/**
 * The "Show quick add button" preference, shared between the client dashboard's
 * floating "+" (provider: AddContentRoot) and the Preferences switch
 * (AppQuickAddSwitch), so flipping it takes effect at once. Null outside the
 * client dashboard (admin, account page): the switch then runs on its own.
 */
export type QuickAddState = { value: boolean; set: (on: boolean) => void }
export const QuickAddContext = createContext<QuickAddState | null>(null)
export function useQuickAdd() {
  return useContext(QuickAddContext)
}
