'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { Notice } from '@/components/app/ui/Notice'
import {
  commitFromVersionResponse,
  isNewVersionAvailable,
  isRealCommit,
  shouldCheckOnFocus,
  VERSION_CHECK_INTERVAL_MS,
} from '@/lib/version/new-version'

/**
 * "Abluo has been updated. Reload when you're ready." — a calm, dismissible
 * notice for the client and admin dashboards (never the public websites).
 *
 * It compares the commit this page was built from (NEXT_PUBLIC_GIT_COMMIT_SHA)
 * with `/api/version`, every 5 minutes and when the tab comes back into focus
 * (no-store). It never reloads by itself, and stays silent when offline or when
 * the check fails. Dismissing hides it until an even newer build appears.
 */
export function NewVersionNotice({ className = '' }: { className?: string }) {
  const t = useTranslations('app.newVersion')
  const [latest, setLatest] = useState<string | null>(null)
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const lastCheck = useRef<number | null>(null)
  const current = process.env.NEXT_PUBLIC_GIT_COMMIT_SHA

  const check = useCallback(async () => {
    lastCheck.current = Date.now()
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      const res = await fetch('/api/version', { cache: 'no-store', headers: { accept: 'application/json' } })
      if (!res.ok) return
      const commit = commitFromVersionResponse(await res.json())
      if (commit && isNewVersionAvailable(current, commit)) setLatest(commit)
    } catch {
      // Offline or a hiccup: say nothing, try again later.
    }
  }, [current])

  useEffect(() => {
    // Nothing to compare against (local development): don't poll at all.
    if (!isRealCommit(current)) return
    const timer = setInterval(() => void check(), VERSION_CHECK_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && shouldCheckOnFocus(lastCheck.current, Date.now())) void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [check, current])

  if (!latest || dismissedFor === latest) return null
  return (
    <Notice
      tone="info"
      layout="row"
      className={className}
      action={
        <Button variant="primary" onClick={() => window.location.reload()}>
          {t('reload')}
        </Button>
      }
      onDismiss={() => setDismissedFor(latest)}
      dismissLabel={t('dismiss')}
    >
      {t('message')}
    </Notice>
  )
}
