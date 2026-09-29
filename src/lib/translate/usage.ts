/**
 * Translation metering — Supabase `translation_usage` (ADR-023 §7). Server-side.
 *
 * Inserts are service-role only (no RLS insert policy): a browser can never
 * forge or erase usage. Every service-role call goes through
 * runAsTrustedSystemOperation so it shows up in the RLS-bypass inventory.
 */

import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import type { TranslateFormat, TranslationProviderId } from './types'
import { monthStartUtc } from './quota'

export type UsageRow = {
  project_id: string
  provider: TranslationProviderId
  source_locale: string
  target_locale: string
  characters: number
  text_count: number
  format: TranslateFormat
  sanity_document_id: string | null
  actor_id: string | null
  environment: string
}

export function currentEnvironment(): string {
  return process.env.VERCEL_ENV || 'development'
}

/**
 * Characters used by a project in the current calendar month (UTC). Throws on failure.
 *
 * Summed IN SQL (translation_usage_month_total, migration 027): selecting rows
 * and adding them up here would silently stop at PostgREST's 1,000-row page and
 * under-count a busy site, so the quota would never trigger.
 */
export async function getMonthToDateCharacters(projectId: string, now: Date = new Date()): Promise<number> {
  return runAsTrustedSystemOperation(
    'translate: sum this project’s translation characters for the monthly quota check (ADR-023 §8)',
    async (supabase) => {
      const { data, error } = await supabase.rpc('translation_usage_month_total', {
        p_project_id: projectId,
        p_since: monthStartUtc(now).toISOString(),
      })
      if (error) throw new Error(`translation_usage_month_total failed: ${error.message}`)
      const n = typeof data === 'string' ? Number(data) : data
      if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('translation_usage_month_total: no number')
      return n
    }
  )
}

/**
 * True when the Supabase `projects` row exists — i.e. a usage row for it can
 * be inserted (translation_usage.project_id is a foreign key). Checked BEFORE
 * the provider is called, so a Sanity project that is not linked to Supabase
 * can never translate unmetered (ADR-023 decision 3).
 */
export async function projectIsMeterable(projectId: string): Promise<boolean> {
  return runAsTrustedSystemOperation(
    'translate: confirm the project exists in Supabase before spending provider credit (ADR-023 §6)',
    async (supabase) => {
      const { data, error } = await supabase.from('projects').select('id').eq('id', projectId).maybeSingle()
      if (error) throw new Error(`projects lookup failed: ${error.message}`)
      return Boolean(data)
    }
  )
}

/** Record usage rows. Throws on failure — the caller decides what that means. */
export async function recordUsage(rows: UsageRow[]): Promise<void> {
  if (rows.length === 0) return
  await runAsTrustedSystemOperation(
    'translate: record billed translation characters per project and provider (ADR-023 §7)',
    async (supabase) => {
      const { error } = await supabase.from('translation_usage').insert(rows)
      if (error) throw new Error(`translation_usage insert failed: ${error.message}`)
    }
  )
}
