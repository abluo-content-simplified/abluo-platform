/**
 * Lead origin — turns a submission's stored `source` JSONB into the compact
 * "Where this lead came from" rows shown in the notification email and the
 * client dashboard. Pure; one builder so both surfaces always agree.
 *
 * Empty rows are omitted. Rows for submissions stored before first-touch
 * existed fall back to the per-submit fields (referrer, utm_*), so old leads
 * still show what is known.
 */
import type { LeadOriginMessages } from '@/lib/i18n/lead-origin-messages'

export interface LeadOriginRow {
  key:
    | 'entryPage'
    | 'referrer'
    | 'campaign'
    | 'adClick'
    | 'formPage'
    | 'cta'
    | 'location'
    | 'device'
    | 'language'
    | 'pagesViewed'
    | 'timeToSubmit'
  label: string
  value: string
}

function str(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim()
    return t ? t : null
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

function joinNonEmpty(parts: (string | null)[], sep: string): string | null {
  const kept = parts.filter((p): p is string => !!p)
  return kept.length ? kept.join(sep) : null
}

export function buildLeadOriginRows(
  source: Record<string, unknown> | null | undefined,
  m: LeadOriginMessages,
): LeadOriginRow[] {
  const s = source ?? {}
  const rows: LeadOriginRow[] = []
  const add = (key: LeadOriginRow['key'], label: string, value: string | null) => {
    if (value) rows.push({ key, label, value })
  }

  const hasFirstTouch = !!str(s.landing_page_url) || !!str(s.landing_page_path) || !!str(s.session_started_at)

  // Entry page — where the session started.
  add('entryPage', m.entryPage, str(s.landing_page_url) ?? str(s.landing_page_path))

  // External referrer, or "direct" when the session began without one.
  const firstRef = str(s.first_referrer_domain) ?? str(s.first_referrer)
  if (firstRef) add('referrer', m.referrer, firstRef)
  else if (hasFirstTouch) add('referrer', m.referrer, m.direct)
  else add('referrer', m.referrer, str(s.referrer_domain) ?? str(s.referrer))

  // Campaign — first-touch tags win; per-submit tags are the fallback.
  const utm = (k: string) => str(s[`first_utm_${k}`]) ?? str(s[`utm_${k}`])
  const campaign = joinNonEmpty(
    [joinNonEmpty([utm('source'), utm('medium')], ' / '), utm('campaign'), utm('term'), utm('content')],
    ' · ',
  )
  add('campaign', m.campaign, campaign)

  const ad = joinNonEmpty(
    [
      str(s.first_gclid) ?? str(s.gclid) ? m.googleAds : null,
      str(s.first_fbclid) ?? str(s.fbclid) ? m.metaAds : null,
    ],
    ', ',
  )
  add('adClick', m.adClick, ad)

  add('formPage', m.formPage, str(s.page_url) ?? str(s.page_path))

  // CTA — the label the visitor saw, its internal name, else the entry point.
  const ctaLabel = str(s.cta_label_snapshot)
  const ctaName = str(s.cta_internal_name)
  const cta = ctaLabel
    ? ctaName && ctaName !== ctaLabel
      ? `${ctaLabel} (${ctaName})`
      : ctaLabel
    : ctaName ?? str(s.source)
  add('cta', m.cta, cta)

  add('location', m.location, joinNonEmpty([str(s.city), str(s.region), str(s.country)], ', '))

  const device = str(s.device_type)
  add(
    'device',
    m.device,
    device ? (m.devices[device as keyof LeadOriginMessages['devices']] ?? device) : null,
  )

  add('language', m.language, str(s.browser_language))

  const pages = num(s.pages_viewed)
  add('pagesViewed', m.pagesViewed, pages !== null ? String(pages) : null)

  const secs = num(s.seconds_to_submit)
  add('timeToSubmit', m.timeToSubmit, secs !== null ? m.duration(secs) : null)

  return rows
}
