// Server-only: imports the service-role client; never import from a client component.
/**
 * "What's new" — the admin side (ADR-030, migration 035). Reads and writes
 * with the SERVICE ROLE, so every caller must have passed
 * `requireAbluoAdmin()` first (the admin page and the admin server actions do).
 */
import { createAdminClient } from '@/lib/supabase/admin'
import {
  audienceModules,
  cleanLocalized,
  isMissingTableError,
  PRODUCT_UPDATE_COLUMNS,
  type LocalizedText,
  type ProductUpdateRow,
  type ProductUpdateStatus,
} from './model'

/** One update as the admin editor works with it (plain data, client-safe). */
export type AdminProductUpdate = {
  id: string
  slug: string
  status: ProductUpdateStatus
  publishedAt: string | null
  updatedAt: string
  title: LocalizedText
  body: LocalizedText
  ctaLabel: LocalizedText
  ctaUrl: string
  imageUrl: string | null
  modules: string[]
  /** People who have opened it; null when not counted. */
  readCount: number | null
}

export function toAdminUpdate(row: ProductUpdateRow, readCount: number | null = null): AdminProductUpdate {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    title: cleanLocalized(row.title),
    body: cleanLocalized(row.body),
    ctaLabel: cleanLocalized(row.cta_label),
    ctaUrl: row.cta_url ?? '',
    imageUrl: row.image_url,
    modules: audienceModules(row.audience),
    readCount,
  }
}

export type AdminUpdatesResult =
  | { state: 'ok'; updates: AdminProductUpdate[] }
  | { state: 'missing' }
  | { state: 'error'; message: string }

/** Every update (drafts, published, archived): drafts first, then by publish date, newest first; with read counts. */
export async function listProductUpdatesForAdmin(limit = 200): Promise<AdminUpdatesResult> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('product_updates')
    .select(PRODUCT_UPDATE_COLUMNS)
    // By date, newest first; drafts (no date yet) on top so work in progress is easy to find.
    .order('published_at', { ascending: false, nullsFirst: true })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return isMissingTableError(error) ? { state: 'missing' } : { state: 'error', message: error.message }
  const rows = (data ?? []) as ProductUpdateRow[]
  // One head-count per update (no rows transferred). Only published/archived
  // updates can have been read.
  const counts = await Promise.all(
    rows.map(async (row) => {
      if (row.status === 'draft') return 0
      const { count, error: countError } = await admin
        .from('product_update_reads')
        .select('update_id', { count: 'exact', head: true })
        .eq('update_id', row.id)
      return countError ? null : (count ?? 0)
    }),
  )
  return { state: 'ok', updates: rows.map((row, i) => toAdminUpdate(row, counts[i])) }
}

export async function getProductUpdateForAdmin(id: string): Promise<ProductUpdateRow | null> {
  const { data } = await createAdminClient().from('product_updates').select(PRODUCT_UPDATE_COLUMNS).eq('id', id).maybeSingle()
  return (data as ProductUpdateRow | null) ?? null
}
