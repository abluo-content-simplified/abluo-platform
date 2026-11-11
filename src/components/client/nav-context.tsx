'use client'

import { createContext, useContext, type ReactNode } from 'react'

/**
 * What the client layout knows about the navigation and the pages below need
 * (Tom, 2026-11-11):
 * - `labels`: this project's own names for some sections, in the current
 *   interface language (People → "Teachers"); the sidebar and the section's
 *   page title both read them, so they always agree.
 * - `settings`: the Settings destinations this person may open, in tab order —
 *   each Settings page shows them as its top tabs.
 */
export type ClientNavContextValue = {
  labels: Partial<Record<string, string>>
  settings: { id: string; href: string }[]
}

const Ctx = createContext<ClientNavContextValue>({ labels: {}, settings: [] })

export function ClientNavProvider({ value, children }: { value: ClientNavContextValue; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useClientNav(): ClientNavContextValue {
  return useContext(Ctx)
}

/** A section's name as this project calls it, else `fallback` (the default, already translated). */
export function useNavLabel(id: string, fallback: string): string {
  return useContext(Ctx).labels[id]?.trim() || fallback
}
