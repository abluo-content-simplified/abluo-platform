/**
 * Home reads one provider per widget group; one failing must never take the
 * whole dashboard down. An authorization refusal means "this person doesn't
 * get that block" (null, silently); anything else is logged and the block is
 * left out too.
 */
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'

export async function settle<T>(label: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch (error) {
    if (!(error instanceof TenantAuthorizationError)) {
      console.error(`[dashboard] ${label} failed`, error)
    }
    return null
  }
}
