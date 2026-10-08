'use server'

/**
 * Admin Backlog (ADR-030 §5.5) server actions. Each one calls
 * `requireAbluoAdmin()` (abluo_admin + two-factor, the same decision as the
 * `(admin)` layout gate) BEFORE anything else and refuses when it is null;
 * the data layer checks the role again. Results are small codes the screen
 * maps to localized text (`admin.backlog.errors.*`).
 */
import { revalidatePath } from 'next/cache'
import { requireAbluoAdmin } from '@/lib/api/auth'
import {
  createBacklogItem,
  deleteBacklogItem,
  setBacklogStatus,
  updateBacklogItem,
  type BacklogResult,
} from '@/lib/admin/backlog'
import type { BacklogItem } from '@/lib/admin/backlog-model'

export type BacklogActionResult = BacklogResult<{ item?: BacklogItem }>

const refresh = () => revalidatePath('/[locale]/backlog', 'page')

export async function createBacklogItemAction(input: unknown): Promise<BacklogActionResult> {
  const actor = await requireAbluoAdmin()
  if (!actor) return { ok: false, error: 'forbidden' }
  const r = await createBacklogItem(actor, input)
  if (r.ok) refresh()
  return r
}

export async function updateBacklogItemAction(id: unknown, input: unknown): Promise<BacklogActionResult> {
  const actor = await requireAbluoAdmin()
  if (!actor) return { ok: false, error: 'forbidden' }
  const r = await updateBacklogItem(actor, id, input)
  if (r.ok) refresh()
  return r
}

export async function setBacklogStatusAction(id: unknown, status: unknown): Promise<BacklogActionResult> {
  const actor = await requireAbluoAdmin()
  if (!actor) return { ok: false, error: 'forbidden' }
  const r = await setBacklogStatus(actor, id, status)
  if (r.ok) refresh()
  return r
}

export async function deleteBacklogItemAction(id: unknown): Promise<BacklogActionResult> {
  const actor = await requireAbluoAdmin()
  if (!actor) return { ok: false, error: 'forbidden' }
  const r = await deleteBacklogItem(actor, id)
  if (r.ok) refresh()
  return r
}
