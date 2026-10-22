// Server-only.
/**
 * Screenshot retention (ADR-039 D11): files whose expires_at has passed are
 * removed from storage and marked deleted_reason = 'retention'; an internal
 * `attachment_deleted` event records it.
 */
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { ATTACHMENT_BUCKET } from './model'

export async function purgeExpiredAttachments(limit = 200): Promise<{ found: number; purged: number; failed: number }> {
  return runAsTrustedSystemOperation(
    'Support ticket screenshot retention (ADR-039 D11) — delete expired screenshots from storage and mark them deleted.',
    async (db) => {
      const { data } = await db
        .from('support_ticket_attachments')
        .select('id, ticket_id, storage_path')
        .lt('expires_at', new Date().toISOString())
        .is('deleted_at', null)
        .order('expires_at', { ascending: true })
        .limit(limit)
      const rows = (data ?? []) as Array<{ id: string; ticket_id: string; storage_path: string }>
      let purged = 0
      let failed = 0
      for (const row of rows) {
        const rm = await db.storage.from(ATTACHMENT_BUCKET).remove([row.storage_path])
        if (rm.error) { failed++; continue }
        const upd = await db
          .from('support_ticket_attachments')
          .update({ deleted_at: new Date().toISOString(), deleted_reason: 'retention' })
          .eq('id', row.id)
          .is('deleted_at', null)
          .select('id')
        if (upd.error) { failed++; continue }
        if ((upd.data ?? []).length > 0) {
          await db.from('support_ticket_events').insert({ ticket_id: row.ticket_id, actor_id: null, kind: 'attachment_deleted', to_value: 'retention', visibility: 'internal' })
        }
        purged++
      }
      return { found: rows.length, purged, failed }
    },
  )
}
