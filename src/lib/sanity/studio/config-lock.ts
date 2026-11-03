// ── Studio config lock (C9 §9.3, R2) — PURE (no React, no Sanity imports) ────
//
// A module whose manifest says `configSurface: 'dashboard'` (the Catalogue) is
// configured in the dashboard — Catalogue → Setup, the one configuration
// surface (ADR-014). From the R2 lock phase on, Studio shows that config
// READ-ONLY in two places: the Modules pane (values shown, no inputs, the save
// writes status only) and the raw project form (`moduleInstallations[].config`
// readOnly). Installing / enabling stays a Studio act (ADR-020). Break-glass
// does not unlock this: emergency config changes go through the server-side
// setup service (runbook), never Studio typing.

import { MODULE_REGISTRY } from '@/lib/modules/registry'
import type { ModuleManifest } from '@/lib/modules/types'
import { CATALOGUE_LOCK_PHASE, type LockPhase } from './catalogue-posture'

/** Where the module's config is edited, by manifest flag. */
export function modulesWithDashboardConfig(registry: readonly Pick<ModuleManifest, 'id' | 'configSurface'>[] = MODULE_REGISTRY): string[] {
  return registry.filter((m) => m.configSurface === 'dashboard').map((m) => m.id)
}

/** True when the module's config is dashboard-owned AND the lock phase has reached R2 (T-15). */
export function configSurfaceIsDashboard(moduleId: unknown, opts: { phase?: LockPhase; registry?: readonly Pick<ModuleManifest, 'id' | 'configSurface'>[] } = {}): boolean {
  if (typeof moduleId !== 'string') return false
  if ((opts.phase ?? CATALOGUE_LOCK_PHASE) !== 'R2') return false
  return modulesWithDashboardConfig(opts.registry).includes(moduleId)
}

/** The sentence the Modules pane shows instead of inputs (admin UI: English, CLAUDE.md exception). */
export const DASHBOARD_CONFIG_NOTICE = 'Configured in the Abluo dashboard → Catalogue → Setup.'

/** Text of one stored config value for the read-only summary (never an input). */
export function configValueText(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    return value
      .map((v) => (v && typeof v === 'object' ? String((v as { value?: unknown; key?: unknown }).value ?? (v as { key?: unknown }).key ?? '') : String(v)))
      .filter(Boolean)
      .join(', ')
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([k, v]) => !k.startsWith('_') && typeof v === 'string' && v)
    return entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join(' · ') : '—'
  }
  return '—'
}
