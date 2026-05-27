import { headers } from 'next/headers'

/**
 * Read the resolved tenant slug in a Next.js Server Component.
 * The value is injected by middleware from the request hostname.
 *
 * Returns null on the admin/landing domain (no tenant).
 *
 * Usage:
 *   const tenantId = await getTenantId()
 *   if (!tenantId) redirect('/admin')
 */
export async function getTenantId(): Promise<string | null> {
  const headersList = await headers()
  return headersList.get('x-tenant-id')
}
