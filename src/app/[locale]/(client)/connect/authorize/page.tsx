import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { loadProjectSummaries } from '@/lib/client/switchable-projects'
import { sandboxProjectIdsFromEnv } from '@/lib/connections/consent'
import { buildConsentView } from '@/lib/connections/consent-view'
import { createSupabaseConnectionsStore } from '@/lib/connections/supabase-store'
import { ConsentScreen } from '@/components/client/connections/ConsentScreen'

export const dynamic = 'force-dynamic'

const PARAMS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'project'] as const
type Params = Partial<Record<(typeof PARAMS)[number], string>>

/**
 * Connect a partner app to one of your websites (ADR-031 D2, Amendment B) —
 * Abluo's own OAuth consent screen. The person is signed in (proxy gate);
 * only sites where they hold `connections.manage` are offered, support mode
 * never consents, and an unknown app or untrusted return address shows an
 * error here instead of redirecting anywhere.
 */
export default async function ConnectAuthorizePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  const raw = await searchParams
  const query: Params = {}
  for (const k of PARAMS) {
    const v = raw[k]
    // A repeated parameter is refused (RFC 6749 §3.1): treat as missing.
    if (typeof v === 'string') query[k] = v
  }

  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) {
    const qs = new URLSearchParams(query as Record<string, string>).toString()
    redirect(`/login?next=${encodeURIComponent(`/${locale}/connect/authorize?${qs}`)}`)
  }

  const summaries = await loadProjectSummaries(ctx.projects.map((g) => g.projectId))
  const projectNames = Object.fromEntries(Object.entries(summaries).map(([id, s]) => [id, s.name]))
  const view = await buildConsentView(
    { ...ctx, projects: ctx.projects },
    query,
    { store: createSupabaseConnectionsStore(), sandboxProjectIds: sandboxProjectIdsFromEnv(), projectNames },
  )
  if (view.state === 'redirect') redirect(view.redirectTo)

  const t = await getTranslations('clientDashboard.connect')
  return (
    <main className="flex min-h-dvh justify-center p-4 md:p-10">
      <div className="w-full max-w-xl">
        <ConsentScreen view={view} params={query} title={t('pageTitle')} />
      </div>
    </main>
  )
}
