import { redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'

/**
 * Client dashboard group layout (ADR-017 Phase 2 / task #81).
 *
 * Coarse authentication gate for the whole `(client)` route group: resolves the
 * caller's `TenantAuthorizationContext` once and redirects to `/login` when
 * there is no session. This is defence in depth — the proxy client-surface gate
 * (`src/proxy.ts` → `requireAuthenticatedInProxy`) already blocks anonymous
 * requests before the route renders — but the group must never assume the proxy
 * ran (e.g. a future host wiring, or direct RSC render). Per-project
 * authorization (which project, which modules) is decided deeper, in
 * `[tenant]/layout.tsx` and the data layer — never here.
 *
 * The project sidebar/shell is NOT built here: this layout sits above the
 * `[tenant]` (projectSlug) segment and has no active project. The user-level
 * `account` page renders directly inside this frame; project-scoped pages get
 * the sidebar from the nested `[tenant]/layout.tsx`.
 */
export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) {
    redirect('/login?next=/account')
  }

  return <div className="min-h-screen bg-zinc-50 text-zinc-900">{children}</div>
}
