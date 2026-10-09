'use client'

import { useActionState, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Pill, type PillTone } from '@/components/app/ui/list/cells'
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '@/components/admin/backlog/backlog-bits'
import { googleSetupAction, type GoogleRowResult, type GoogleSetupActionState } from '@/lib/admin/google-actions'
import type { GoogleCardState, GoogleRowState } from '@/lib/google/state'

const TONE: Record<GoogleRowState, PillTone> = { connected: 'success', not_set_up: 'muted', waiting_for_site: 'highlight', error: 'outline' }
const STATE_KEY: Record<GoogleRowState, string> = { connected: 'connected', not_set_up: 'notSetUp', waiting_for_site: 'waiting', error: 'error' }

type Which = 'analytics' | 'search_console' | 'both'

/**
 * The Google card's rows and buttons. Shows the stored state; after a run,
 * that run's result per row (with the reason when it stopped), then re-reads
 * the page so the stored state catches up.
 */
export function GoogleSetupPanel({
  projectId,
  initial,
  env,
  hasDomain,
  loaded,
}: {
  projectId: string
  initial: GoogleCardState
  env: { serviceAccount: boolean; analyticsAccount: boolean; owners: boolean }
  hasDomain: boolean
  loaded: boolean
}) {
  const t = useTranslations('admin.projectPage.google')
  const [state, action, pending] = useActionState<GoogleSetupActionState, FormData>(googleSetupAction, { status: 'idle' })
  const [which, setWhich] = useState<Which | null>(null)
  const router = useRouter()
  useEffect(() => {
    if (state.status === 'done') router.refresh()
  }, [state, router])

  const rowState = (stored: GoogleRowState, result: GoogleRowResult | undefined): GoogleRowState => result?.state ?? stored
  const analytics = rowState(initial.analytics.state, state.analytics)
  const searchConsole = rowState(initial.searchConsole.state, state.searchConsole)

  const reason = (result: GoogleRowResult | undefined, stored: GoogleRowState, fallback: string | null) => {
    if (result && result.state !== 'connected') {
      return (
        <span className="flex flex-col gap-0.5">
          <span className={result.state === 'error' ? 'text-destructive' : 'text-foreground'}>{t(`codes.${result.code}`, result.params)}</span>
          <span className="font-mono text-xs leading-5 break-words text-muted-foreground">{result.message}</span>
        </span>
      )
    }
    if (stored === 'waiting_for_site' && !result) return <span className="text-muted-foreground">{t('waitingStored')}</span>
    return fallback ? <span className="font-mono text-sm break-all text-muted-foreground">{fallback}</span> : null
  }

  const gaLine = initial.analytics.measurementId
    ? [initial.analytics.measurementId, initial.analytics.ga4PropertyId ? t('property', { id: initial.analytics.ga4PropertyId }) : null].filter(Boolean).join(' · ')
    : null

  const button = (w: Which, label: string, primary = false) => (
    <button
      type="submit"
      name="which"
      value={w}
      onClick={() => setWhich(w)}
      disabled={pending || !env.serviceAccount}
      aria-busy={(pending && which === w) || undefined}
      className={primary ? PRIMARY_BUTTON : SECONDARY_BUTTON}
    >
      {pending && which === w ? t('working') : label}
    </button>
  )

  return (
    <div className="flex flex-col gap-3">
      {!env.serviceAccount ? (
        <p role="alert" className="rounded-2xl border border-destructive px-4 py-3 text-sm text-destructive">
          {t('notConfigured')}
        </p>
      ) : null}
      {!loaded ? <p className="text-sm leading-5 text-destructive">{t('loadError')}</p> : null}

      <ul className="rounded-xl border border-border bg-card px-4">
        <Row label={t('analytics')} state={analytics} stateLabel={t(`state.${STATE_KEY[analytics]}`)}>
          {reason(state.analytics, initial.analytics.state, gaLine)}
        </Row>
        <Row label={t('searchConsole')} state={searchConsole} stateLabel={t(`state.${STATE_KEY[searchConsole]}`)}>
          {reason(state.searchConsole, initial.searchConsole.state, initial.searchConsole.siteUrl)}
        </Row>
      </ul>

      {!hasDomain ? <p className="text-sm leading-5 text-muted-foreground">{t('needsDomain')}</p> : null}
      {env.serviceAccount && !env.analyticsAccount && analytics !== 'connected' ? (
        <p className="text-sm leading-5 text-muted-foreground">{t('accountMissing')}</p>
      ) : null}
      {env.serviceAccount && !env.owners && searchConsole !== 'connected' ? <p className="text-sm leading-5 text-muted-foreground">{t('ownersMissing')}</p> : null}

      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="projectId" value={projectId} />
        {analytics !== 'connected' && searchConsole !== 'connected' ? button('both', t('setUpBoth'), true) : null}
        {button('analytics', analytics === 'connected' ? t('recheckAnalytics') : t('setUpAnalytics'))}
        {button('search_console', searchConsole === 'connected' ? t('recheckSearchConsole') : t('connectSearchConsole'))}
      </form>
      <p aria-live="polite" className="text-sm leading-5 text-muted-foreground">
        {pending ? (which === 'analytics' ? t('pendingAnalytics') : t('pendingSearchConsole')) : state.status === 'refused' ? t('refused') : state.status === 'failed' ? t('failed') : null}
      </p>
    </div>
  )
}

function Row({ label, state, stateLabel, children }: { label: string; state: GoogleRowState; stateLabel: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start justify-between gap-4 border-b border-border py-3 text-[0.9375rem] last:border-b-0">
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-medium text-foreground">{label}</span>
        {children ? <span className="text-sm leading-5">{children}</span> : null}
      </span>
      <Pill tone={TONE[state]} icon={state === 'error' ? <span aria-hidden="true" className="size-1.5 rounded-full bg-destructive" /> : undefined}>
        {stateLabel}
      </Pill>
    </li>
  )
}
