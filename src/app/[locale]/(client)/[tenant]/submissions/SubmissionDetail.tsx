'use client'

/**
 * Submission detail body — what the visitor sent, plus "Where it came from":
 * every piece of provenance the platform stores for the submission (entry page,
 * referrer, campaign, device, place, language, timezone, site, form, consent).
 * Shared by the desktop expanded row and the phone sheet. The visitor's IP
 * (submitter_ip) is deliberately never read into the dashboard.
 */

import { useTranslations } from 'next-intl'
import type { DashboardSubmission } from '@/lib/api/client-dashboard'
import { buildLeadOriginRows } from '@/lib/forms/lead-origin'
import { getLeadOriginMessages } from '@/lib/i18n/lead-origin-messages'

export function humanizeKey(key: string): string {
  const spaced = key.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function humanizeValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? '✓' : '—'
  if (Array.isArray(v)) return v.map((x) => humanizeValue(x)).join(', ')
  const s = String(v)
  if (/\s/.test(s) || s.length > 40) return s
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

export function rawValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map((x) => String(x)).join('; ')
  if (typeof v === 'object') return ''
  return String(v)
}

/** Locale-aware date+time in the VIEWER's timezone (render inside suppressHydrationWarning). */
export function formatReceived(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
  } catch {
    return iso
  }
}

function hostOf(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="w-32 shrink-0 text-muted-foreground sm:w-40">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{value}</dd>
    </div>
  )
}

export function SubmissionDetail({ s, locale }: { s: DashboardSubmission; locale: string }) {
  const t = useTranslations('clientDashboard')
  const msgs = getLeadOriginMessages(locale)
  const origin = buildLeadOriginRows(s.source, msgs)
  const src = s.source ?? {}
  const str = (k: string) => (typeof src[k] === 'string' && (src[k] as string).trim() ? (src[k] as string) : null)

  const extra: { key: string; label: string; value: string }[] = []
  const site = hostOf(src.page_url) ?? hostOf(src.landing_page_url)
  if (site) extra.push({ key: 'site', label: t('submissions.detail.site'), value: site })
  if (s.locale) extra.push({ key: 'locale', label: t('submissions.detail.siteLanguage'), value: s.locale })
  if (str('timezone')) extra.push({ key: 'tz', label: t('submissions.detail.timezone'), value: str('timezone')! })
  if (str('page_slug')) extra.push({ key: 'slug', label: t('submissions.detail.pageSlug'), value: str('page_slug')! })
  extra.push({
    key: 'form',
    label: t('submissions.columns.form'),
    value: s.formVersion !== null ? `${s.formId} (v${s.formVersion})` : s.formId,
  })
  extra.push({ key: 'recv', label: t('submissions.columns.received'), value: formatReceived(s.createdAt, locale) })
  if (s.consentAt) {
    extra.push({ key: 'consent', label: t('submissions.detail.consent'), value: formatReceived(s.consentAt, locale) })
  }

  const head = 'mb-2 text-[0.75rem] font-semibold uppercase tracking-wide text-muted-foreground'
  return (
    <div className="grid gap-6 text-[0.9375rem] md:grid-cols-2">
      <div>
        <p className={head}>{t('submissions.detail.submitted')}</p>
        <dl className="space-y-2">
          {Object.entries(s.data).map(([k, v]) => (
            <Row key={k} label={humanizeKey(k)} value={humanizeValue(v)} />
          ))}
        </dl>
      </div>
      <div>
        <p className={head}>{t('submissions.detail.cameFrom')}</p>
        <dl className="space-y-2">
          {origin.map((r) => (
            <Row key={r.key} label={r.label} value={r.value} />
          ))}
          {extra.map((r) => (
            <div key={r.key} className="flex items-start gap-3">
              <dt className="w-32 shrink-0 text-muted-foreground sm:w-40">{r.label}</dt>
              <dd className="min-w-0 flex-1 break-words">
                <span suppressHydrationWarning>{r.value}</span>
              </dd>
            </div>
          ))}
        </dl>
        {s.source && Object.keys(s.source).length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[0.8125rem] text-muted-foreground">
              {t('submissions.detail.attribution')}
            </summary>
            <dl className="mt-2 space-y-2">
              {Object.entries(s.source).map(([k, v]) => (
                <Row key={k} label={humanizeKey(k)} value={rawValue(v) || '—'} />
              ))}
            </dl>
          </details>
        )}
      </div>
    </div>
  )
}
