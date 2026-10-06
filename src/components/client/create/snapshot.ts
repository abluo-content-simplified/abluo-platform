import type { WizardStep } from '@/lib/api/post-drafts'
import type { PendingSet } from '@/lib/client/autosave/journal'
import type { DraftSnapshot } from './types'

/** Applies autosave patch paths to the local snapshot (what the user sees at once). */
export function applyToSnapshot(snap: DraftSnapshot, set: PendingSet): DraftSnapshot {
  let next = snap
  for (const [path, value] of Object.entries(set)) {
    if (path === 'categories') next = { ...next, categories: Array.isArray(value) ? (value as string[]) : [] }
    else if (path === 'wizard.step') next = { ...next, step: value as WizardStep }
    else if (path === 'wizard.furthest') next = { ...next, furthest: value as WizardStep }
    else if (path === 'gallery') next = { ...next, gallery: typeof value === 'string' && value ? value : null }
    else if (path === 'cta.mode') {
      const mode = value as 'default' | 'none' | 'custom'
      next = { ...next, cta: { mode, ref: mode === 'custom' ? (next.cta?.ref ?? null) : null } }
    } else if (path === 'cta.ref') {
      next = { ...next, cta: { mode: next.cta?.mode ?? 'custom', ref: typeof value === 'string' && value ? value : null } }
    }
    else {
      const [field, locale] = path.split('.')
      if (!locale || !['title', 'subtitle', 'excerpt', 'body'].includes(field)) continue
      const map = { ...(next[field as 'title'] as Record<string, unknown>) }
      if (value === '' || value === null || (Array.isArray(value) && value.length === 0)) delete map[locale]
      else map[locale] = value
      next = { ...next, [field]: map }
    }
  }
  return next
}
