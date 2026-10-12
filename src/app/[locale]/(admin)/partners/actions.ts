'use server'

/**
 * Admin — Partner apps actions (ADR-031 D8.2). Each calls `requireAbluoAdmin()`
 * (abluo_admin + two-factor) first; admin.ts checks `partners.manage` again.
 * A client secret is returned ONCE, to the screen that just created it.
 */
import { revalidatePath } from 'next/cache'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { approveApp, registerApp, rotateAppSecret, suspendApp } from '@/lib/connections/admin'
import { createSupabaseConnectionsStore } from '@/lib/connections/supabase-store'

export type PartnerActionResult = { ok: true; clientId?: string; clientSecret?: string } | { ok: false; error: string }

const refresh = () => revalidatePath('/[locale]/partners', 'page')

async function admin() {
  const actor = await requireAbluoAdmin()
  return actor ? { ...actor, projects: [] } : null
}

export async function registerPartnerAppAction(input: { name: unknown; redirectUris: unknown; contactEmail: unknown }): Promise<PartnerActionResult> {
  const subject = await admin()
  if (!subject) return { ok: false, error: 'forbidden' }
  const uris = typeof input.redirectUris === 'string' ? input.redirectUris.split(/\s+/).filter(Boolean) : []
  const email = typeof input.contactEmail === 'string' && input.contactEmail.trim() ? input.contactEmail.trim() : null
  const r = await registerApp(subject, { name: typeof input.name === 'string' ? input.name : '', redirectUris: uris, contactEmail: email }, { store: createSupabaseConnectionsStore() })
  if (!r.ok) return r
  refresh()
  return { ok: true, clientId: r.app.client_id, clientSecret: r.clientSecret }
}

export async function approvePartnerAppAction(appId: unknown): Promise<PartnerActionResult> {
  const subject = await admin()
  if (!subject || typeof appId !== 'string') return { ok: false, error: 'forbidden' }
  const r = await approveApp(subject, appId, { store: createSupabaseConnectionsStore() })
  if (!r.ok) return r
  refresh()
  return { ok: true }
}

export async function suspendPartnerAppAction(appId: unknown): Promise<PartnerActionResult> {
  const subject = await admin()
  if (!subject || typeof appId !== 'string') return { ok: false, error: 'forbidden' }
  const r = await suspendApp(subject, appId, { store: createSupabaseConnectionsStore() })
  if (!r.ok) return r
  refresh()
  return { ok: true }
}

export async function rotatePartnerSecretAction(appId: unknown): Promise<PartnerActionResult> {
  const subject = await admin()
  if (!subject || typeof appId !== 'string') return { ok: false, error: 'forbidden' }
  const r = await rotateAppSecret(subject, appId, { store: createSupabaseConnectionsStore() })
  if (!r.ok) return r
  return { ok: true, clientSecret: r.clientSecret }
}
