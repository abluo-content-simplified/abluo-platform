'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { deployment, isProduction } from '@/lib/deployment'

/**
 * Version + deployment time, quietly at the bottom of the app menu.
 *
 * The time is formatted in the VIEWER's browser, in their own time zone with
 * the zone named (e.g. "4 Oct 2026, 18:32 CEST") — never the server's clock.
 * It renders only after mount, so the server (UTC) never produces a value that
 * would then mismatch on hydration. The commit is shown outside production
 * only; clients see the version and date, which is what support needs.
 */
export function AppVersion() {
  const t = useTranslations('clientDashboard.version')
  const [built, setBuilt] = useState<string | null>(null)
  const version = process.env.NEXT_PUBLIC_PLATFORM_VERSION || deployment.release

  useEffect(() => {
    const d = new Date(deployment.buildTime)
    if (Number.isNaN(d.getTime())) return
    setBuilt(
      d.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      }),
    )
  }, [])

  return (
    <p className="text-[0.6875rem] leading-4 text-muted-foreground tabular-nums">
      {version}
      {!isProduction() && ` · ${deployment.commitSha}`}
      {built && (
        <>
          <br />
          {t('updated', { date: built })}
        </>
      )}
    </p>
  )
}
