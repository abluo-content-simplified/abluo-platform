'use client'

/**
 * EarlyAccessWrapper
 *
 * Client component that wraps Livener layout content with:
 *   - EarlyAccessProvider (context — carries tenantSlug + locale)
 *   - EarlyAccessModal (rendered once at layout level)
 *
 * Used in the Livener branch of WebsiteLayout (a Server Component).
 * The provider + modal are client-only; children can be server components.
 *
 * Pattern: server component passes children to client component as props.
 * This preserves server rendering for the page content while enabling
 * client state for the modal.
 */

import type { ReactNode } from 'react'
import { EarlyAccessProvider } from './EarlyAccessContext'
import { EarlyAccessModal } from './EarlyAccessModal'

interface EarlyAccessWrapperProps {
  children: ReactNode
  tenantSlug: string
  /** Sanity/Supabase project slug — resolved to project_id by the API */
  projectSlug?: string
  /** Current page locale — forwarded to context so form components can localise */
  locale: string
}

export function EarlyAccessWrapper({ children, tenantSlug, projectSlug, locale }: EarlyAccessWrapperProps) {
  return (
    <EarlyAccessProvider tenantSlug={tenantSlug} projectSlug={projectSlug} locale={locale}>
      {children}
      <EarlyAccessModal />
    </EarlyAccessProvider>
  )
}
