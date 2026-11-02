import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The client (tenant) a project belongs to, read server-side — project grants
 * do not carry it. Once per request. null when unknown or on a read error.
 */
export const projectTenantId = cache(async (projectId: string): Promise<string | null> => {
  const { data, error } = await createAdminClient().from('projects').select('tenant_id').eq('id', projectId).maybeSingle()
  if (error) return null
  return (data?.tenant_id as string | undefined) ?? null
})
